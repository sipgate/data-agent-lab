---
name: metadata-tariff-check-monthly-recurring-flag
description: Verifiziert das monthlyRecurring-Flag in metadata.tariff datenbasiert aus dem Billing-Muster (billing20.statsAggregateDaily). MRR-Tarife werden am 1. des Monats (automatische Vertragsverlaengerung) gebillt und zeigen einen wiederkehrenden Zeilen-Spike; Usage/Overage verteilt sich ueber den Monat. Der Billing-type disambiguiert Grenzfaelle (Seats/Phones/SIM = MRR pro-rata trotz schwachem Spike, Minuten/Calls = Verbrauch). Read-only. Einzelne oder alle Tarife. Fragt IMMER nur einen Monat je Query ab und merged mehrere Monate. — Nutzen bevor monthlyRecurring gesetzt wird (z.B. aus metadata-tariff-fill) oder als Audit gegen Fehlklassifizierung.
user-invocable: true
argument-hint: Optional eine oder mehrere Tarif-IDs (Space/Komma-getrennt). Ohne Argument = alle billenden Tarife auditieren und Flag-Mismatches melden.
allowed-tools: mcp__mysql-dwh__execute_sql, Bash
---

# monthlyRecurring-Flag pruefen (Billing-Muster)

**Wann nutzen:** immer bevor `metadata.tariff.monthlyRecurring` gesetzt/geerbt wird (Sub-Skill von [`/metadata-tariff-fill`](../metadata-tariff-fill/SKILL.md)), und als eigenstaendiges Audit, um bestehende Fehlklassifizierungen zu finden.

## Prinzip

`monthlyRecurring` trennt zentral **Fixed MRR** (`=1`) von **Metered/Usage** (`=0`) — der Wert fliesst ueber `insert_tariffHeapCustomer.sql` (`monthlyRecurring=1 -> actualMRR`, `=0 -> actualNonMRR`) in Retention, financialModel, billingDaily, FiSt und FP&A. Ein falsches Flag verschiebt Umsatz zwischen Fixed und Metered und macht z.B. die Fixed-MRR-Retention kaputt.

Zwei sich ergaenzende Signale aus `billing20.statsAggregateDaily`:

1. **1.-des-Monats-Spike (Headline-Signal).** Die automatische **Vertragsverlaengerung laeuft am 1.** → ein echter MRR-Tarif erzeugt Monat fuer Monat am `day(dim)=1` einen **wiederkehrenden Zeilen-Spike**. Verbrauch (Minuten/Calls) verteilt sich ueber den ganzen Monat.
2. **Billing-`type` (Disambiguator, entscheidend bei schwachem Spike).** Der Spike ist nur bei **Fee-Tarifen** (eine Gebuehr/Monat) massiv. **Per-Unit-Abos** (Seats/Phones/SIM) werden pro-rata auch mitten im Monat gebillt (Seat-Zugang/-Abgang) → ihr 1.-Spike ist **schwach oder fehlt**, obwohl sie MRR sind. Deshalb entscheidet bei schwachem Spike der `type`:
   - **Recurring → `monthlyRecurring = 1`:** `deposit_contract` (Vertragsgebuehr) sowie per-Unit-Abos `disbursement_seat`, `disbursement_team_extra_voip_phone`, `disbursement_team_shared_voip_phone`, `disbursement_additional_sim`.
   - **Consumption → `monthlyRecurring = 0`:** verbrauchsbasiert `disbursement_call`, `disbursement_frontdesk_minute`, `disbursement_aiflow_minute` (allg. `disbursement_*_minute`).

> **Realer Miss:** Die Tarife `746`–`751` (AI-Agent-Overage) trugen ausschliesslich `disbursement_frontdesk_minute`-Zeilen (Verbrauch, ueber den Monat verteilt, **kein** 1.-Spike), waren aber `monthlyRecurring=1` → Overage landete faelschlich in Fixed MRR. Consumption-`type` + kein Spike bei Flag=1 = genau die Signatur, die dieser Check meldet.

## Datenquelle

`billing20.statsAggregateDaily` — Tageskorn. Relevante Spalten: `dim` (DATETIME, ein Tag), `tariff`, `type` (Billing-Art, s.o.), `billedUnit`, `billedAmount` (Charge < 0). Gezaehlt werden **umsatztragende** Zeilen wie im MRR-Split: `billedUnit = 'credit_real' and billedAmount < 0` (Free-/Within-Allowance-Zeilen mit `billedAmount=0` sind kein Signal).

## WICHTIG — immer nur EINEN Monat je Query

`statsAggregateDaily` ist gross. Ein Mehr-Monats-Scan **sprengt den 30-Sekunden-MCP-Timeout**; ein Ein-Monats-Scan laeuft zuverlaessig durch. Deshalb:

- **Je Query genau ein Monat** (`dim >= @MONTH and dim < @MONTH + 1 Monat`).
- Fuer die 3 letzten Monate **drei separate Queries** absetzen (`@MONTH` = erster des Vor-, Vorvor- und Vorvorvormonats), dann die Ergebnisse **agentenseitig mergen** (Zeilen aufsummieren, s. "Merge & Verdict"). Nie mehrere Monate in einer Query.
- Kein `WITH`/CTE (MySQL 5.7). Kein Verdict in SQL (Alias-Referenzen auf Aggregate in `HAVING` sind in 5.7 unzuverlaessig) — die Query liefert nur die Roh-Kennzahlen je Tarif/Monat, das Verdict wird beim Merge berechnet.

## Modus A — einzelne Tarif(e) pruefen

Pro Monat **eine** Query (hier `@MONTH` = z.B. `'2026-06-01'`), mit `tariff in (...)`:

```sql
select
  b.tariff,
  m.tariffName,
  m.monthlyRecurring as current_flag,
  sum(case when day(b.dim) = 1  then 1 else 0 end) as rows_day1,
  sum(case when day(b.dim) <> 1 then 1 else 0 end) as rows_other,
  count(distinct case when day(b.dim) <> 1 then date(b.dim) end) as other_days,
  group_concat(distinct b.type order by b.type separator ',') as bill_types
from billing20.statsAggregateDaily b
join metadata.tariff m on m.tariff = b.tariff
where b.tariff in ('<TARIFF_1>', '<TARIFF_2>')
  and b.billedUnit = 'credit_real'
  and b.billedAmount < 0
  and b.dim >= '@MONTH'
  and b.dim <  date_add('@MONTH', interval 1 month)
group by b.tariff, m.tariffName, m.monthlyRecurring;
```

Drei Mal ausfuehren (drei Monate), dann mergen.

## Modus B — alle Tarife auditieren (Flag-Mismatch-Report)

Ohne Argument: dieselbe Ein-Monats-Query **ohne** `tariff`-Filter, mit Mindest-Volumen. `count(*)` = Zeilen der Gruppe (alle erfuellen das `where`), deshalb 5.7-sicher als Volumenfilter:

```sql
select
  b.tariff,
  m.tariffName,
  m.monthlyRecurring as current_flag,
  sum(case when day(b.dim) = 1  then 1 else 0 end) as rows_day1,
  sum(case when day(b.dim) <> 1 then 1 else 0 end) as rows_other,
  count(distinct case when day(b.dim) <> 1 then date(b.dim) end) as other_days,
  group_concat(distinct b.type order by b.type separator ',') as bill_types
from billing20.statsAggregateDaily b
join metadata.tariff m on m.tariff = b.tariff
where b.billedUnit = 'credit_real'
  and b.billedAmount < 0
  and b.dim >= '@MONTH'
  and b.dim <  date_add('@MONTH', interval 1 month)
group by b.tariff, m.tariffName, m.monthlyRecurring
having count(*) >= 10;
```

Drei Mal (drei Monate) ausfuehren, mergen, Verdict + Mismatch je Tarif berechnen. Bei Bedarf zusaetzlich per Praefix eingrenzen (`and b.tariff like 'ai_%'`).

## Merge & Verdict

Je Tarif ueber die 3 Monatsergebnisse zusammenfuehren:

- `rows_day1_sum`, `rows_other_sum`, `other_days_sum` = Summe ueber die Monate.
- `months_present` = Anzahl Monate, in denen der Tarif vorkam.
- `months_day1_dominant` = Anzahl Monate, in denen **in diesem Monat** `rows_day1 > rows_other / other_days` (der 1. lag ueber dem Schnitt der anderen Tage).
- `avg_day1  = rows_day1_sum / months_present`
- `avg_other = rows_other_sum / other_days_sum`
- `ratio = avg_day1 / avg_other`
- `bill_types` = Vereinigung der Typen ueber alle Monate.

Verdict (Spike zuerst, `type` entscheidet den Rest):

1. **`monthlyRecurring = 1` (sicher):** `ratio >= 5` **und** `months_day1_dominant = months_present` → starker, wiederkehrender 1.-Spike (klassischer Fee-Tarif).
2. Sonst nach `bill_types`:
   - enthaelt **nur Consumption**-Typen (`disbursement_call`, `disbursement_*_minute`) **und** `ratio <= ~1.5` (kein 1.-Konzentration) → **`monthlyRecurring = 0`** (Verbrauch — das ist die Overage/PAYG-Signatur).
   - enthaelt einen **Recurring/Per-Unit**-Typ (`deposit_contract`, `disbursement_seat`, `*_voip_phone`, `*_additional_sim`) → **`monthlyRecurring = 1`**, auch bei schwachem Spike (pro-rata verwaessert den Spike — **kein** Mismatch).
3. **Ambig → Mensch:** alles andere (gemischte Typen, `ratio` im Graubereich ~1.5–5, unbekannter neuer `type`, oder `rows_day1_sum + rows_other_sum` klein/duenn). Nicht automatisch entscheiden — Kennzahlen zeigen.

**Mismatch** = sicheres Verdict (Fall 1 oder 2) ≠ `current_flag`. Nur sichere Verdicts als Mismatch melden; ambige nie.

## Kalibrierung (an Live-Daten verifiziert)

| Tarif | Billing-`type` | ratio `avg_day1/avg_other` | Verdict | warum |
|---|---|---|---|---|
| `ai_assistant_frontdesk_minutes_100` | `deposit_contract` (Fee) | ~75× | 1 | starker 1.-Spike |
| `648_seat_w` | `disbursement_seat` (Per-Unit-MRR) | ~2.7× | 1 | schwacher Spike, aber Recurring-`type` |
| `648_team_extra_voip_phone_e` | `disbursement_team_extra_voip_phone` | ~0.4× | 1 | kein Spike, aber Per-Unit-`type` |
| `740` | `disbursement_frontdesk_minute` (Usage) | ~0.75× | 0 | Consumption-`type`, kein Spike |
| `746` | `disbursement_frontdesk_minute` (Overage) | ~0.18× | 0 | Consumption-`type`, kein Spike |

Lehren: (a) `months_day1_dominant = months` allein reicht nicht — auch Usage billt am 1. (b) Ein schwacher/fehlender Spike bedeutet **nicht** automatisch Metered — Seats/Phones/SIM sind MRR und billen pro-rata. Erst der `type` trennt Per-Unit-MRR (schwacher Spike, trotzdem 1) von echtem Verbrauch (0). Der Ratio-Test allein wuerde Seats faelschlich als Mismatch flaggen.

## Ausgabe

- **Modus A:** je Tarif eine Zeile `tariff → current_flag → data_verdict (1|0|ambig)` mit `ratio`, `months_day1_dominant/months_present` und `bill_types`; bei Abweichung markieren.
- **Modus B:** nur die **Mismatches** (sicheres Verdict ≠ `current_flag`) plus die ambigen Faelle als Tabelle — das ist der Audit-Mehrwert.
- Der Skill **schreibt nie**. Er liefert nur das Verdict. Das Setzen von `monthlyRecurring` passiert in [`/metadata-tariff-fill`](../metadata-tariff-fill/SKILL.md) bzw. per manuellem `UPDATE` — erst nach User-Bestaetigung (Ziel ist Production).

## Hinweise

- **Read-only** — ausschliesslich SELECTs.
- **Ein Monat je Query, mergen** (s.o.) — nie mehrere Monate scannen (Timeout).
- **MySQL 5.7** — kein `WITH`; kein Verdict/Alias-Arithmetik in `HAVING` (nur `count(*)` als Volumenfilter).
- **Neue Tarife ohne Historie:** < 1 Monat Billing → duenne Datenlage, Verdict unsicher → auf `type` + Vererbung aus [`/metadata-tariff-fill`](../metadata-tariff-fill/SKILL.md) zurueckfallen und als "noch nicht datenbelegbar" melden.
- **Unbekannter `type`:** taucht ein neuer `disbursement_*`-Typ auf, der nicht in den Listen steht → nicht raten, als ambig dem User vorlegen (ist es Verbrauch oder ein Abo?).
- Sprache: Code/SQL englisch, Ausgabe an den User deutsch (siehe CLAUDE.md).

## Verweise

- [Skill metadata-tariff-fill](../metadata-tariff-fill/SKILL.md) — ruft diesen Skill auf, bevor `monthlyRecurring` gesetzt wird.
- [Skill metadata-tariff-backup](../metadata-tariff-backup/SKILL.md) — Backup vor schreibenden Aenderungen an `metadata.tariff`.
- `aggregation/tariffHeap/insert_tariffHeapCustomer.sql` — nutzt `monthlyRecurring` fuer den Fixed/Metered-Split (`actualMRR` vs `actualNonMRR`).
