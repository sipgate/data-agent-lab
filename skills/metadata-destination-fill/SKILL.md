---
name: metadata-destination-fill
description: Fuellt fehlende Klassifizierung (group/subGroup + Laender-Attribute) in metadata.destination durch Vererbung von der laengsten bereits klassifizierten Land-Geschwisterzeile. Generiert UPDATE-Statements zum Review, wendet sie erst nach Bestaetigung an. — Nutzen wenn in metadata.destination Klassifizierung (group/subGroup) fehlt.
user-invocable: true
argument-hint: Optional "apply" um nach dem Review direkt anzuwenden (Standard nur Vorschlag)
allowed-tools: mcp__mysql-dwh__execute_sql
---

# Destination-Metadaten auffuellen

**Wann nutzen:** wenn in `metadata.destination` Zeilen ohne Klassifizierung (`group`/`subGroup`) auftauchen und aufgefuellt werden sollen.

Fuellt die leeren (NULL-) Zeilen in `metadata.destination` auf. Wiederkehrende Aufgabe: Der Cron-Job `metadata/destination/destination.py` (taeglich 06:15) fuegt automatisch neue Destination-Namen aus `billing20.statsAggregateMonthly` ein, die noch keine Konfiguration haben — diese landen mit nur gefuelltem PK `destination` und sonst NULL. `destination.py` mailt anschliessend eine Liste "destinations without config" (Bedingung `\`group\` is null`) an analytix@sipgate.de. Dieser Skill klassifiziert diese Zeilen automatisiert.

> Analog zu [`/metadata-tariff-fill`](../metadata-tariff-fill/SKILL.md), aber: **es gibt keine externe Pruef-/Autoritaetstabelle** (bei Tarifen war das `basefeatured`). Die Klassifizierung kommt **ausschliesslich aus Geschwister-Zeilen desselben Landes** in `metadata.destination` selbst. Was sich nicht aus einem Geschwister ableiten laesst (neues Land ohne Vorbild), wird dem User zur **manuellen** Einordnung vorgelegt — "welches Land gehoert in welche Gruppe".

## Hintergrund / Datenmodell

- `metadata.destination` ist eine **manuell gepflegte Dimensionstabelle** (PK `destination`). Spalten:
  `destination, group, subGroup, beggerState, supersaverPrivate, supersaverBusiness, costsPerMinute, coveredByFlat, countryCode, isoCountryCode3, isoCountryCode2`.
  (`group` ist ein MySQL-Reserved-Word → in SQL immer mit Backticks: `` `group` ``.)
- Eine `destination` ist ein **Zielgebiet** im Billing, benannt nach Schema `<LAND> [MODIFIER]`:
  - kein Suffix → Festnetz (LANDLINE), Bsp. `LATVIA`, `AUSTRIA`, `GERMANY`
  - ` MOBILE` → Mobilfunk, ` SPECIAL`/` SPECIAL 1` → Sonderrufnummern des Landes, ` PAGER`, ` TOLL FREE`, ` PNS`
  - Ziffern-Suffix (` 0800`, ` 01805`, ` 0900-1`, ` 0810`, ` 4350`) → Premium-/Service-Rufnummern
  - Spezial-Praefixe ohne Land: `INTERNAL_ACCOUNT:<LAND>`, `INTERNAL_NETWORK[:…]`, `ZONE_…`, `X:…`, `APPLICATION:…`, `SERVICE:…`, sowie reine Tokens wie `DATA_ROAMING`, `WEB-FAX`, `CLICK2DIAL`.
- **`group`** = geografische/kategoriale Region, ist faktisch **pro Land** konstant (alle `LATVIA*` → `EU`). Werte:
  `DE` (Deutschland), `EU`, `EFTA` (Island/Norwegen/Liechtenstein), `ROW` (Rest of World — **inkl. Schweiz!**), sowie die Spezial-Gruppen `INTERNAL_ACCOUNT`, `INTERNAL_NETWORK`, `NO_DESTINATION`, `ACD`, `ADAC`, `FAX`.
- **`subGroup`** kombiniert Region + Anruftyp, ist aber **nicht** sauber funktional ableitbar:
  - typ-praefigiert: `EU_LANDLINE`, `EU_MOBILE`, `EU_SPECIAL`, `DE_LANDLINE`, `DE_MOBILE`, `DE_PAGER`, `EFTA_LANDLINE`, `EFTA_MOBILE`, `ROW`, `ROW_SPECIAL`, `TOP_DESTINATION`
  - gruppen-unabhaengige (literale) Subgruppen: `TOLL_FREE`, `PREMIUM_RATE_NUMBER`, `MINI_DESTINATION`
  - Sonderfall: die Schweiz liegt in `group=ROW`, nutzt aber `subGroup=EFTA_LANDLINE/EFTA_MOBILE/EFTA_SPECIAL`.
  Deshalb wird `subGroup` **vorgeschlagen**, aber immer zum Review gestellt.

## Klassifizierungs-Logik

Fuer eine NULL-Zeile `D`:

1. **Land-Geschwister finden** = der **laengste bereits klassifizierte** `destination`, der ein **Praefix von `D` an einer Wortgrenze** ist (Praefix + Leerzeichen). Bsp.: fuer `LATVIA SPECIAL` ist `LATVIA` (EU/EU_LANDLINE) das Geschwister; `LATVIA MOBILE` ist es nicht (kein Praefix). Die Wortgrenze verhindert Falschtreffer wie `AUSTRIA` → `AUSTRALIA`.
2. **`group`** wird **direkt vom Geschwister uebernommen** (Land-Region ist typ-unabhaengig konstant). Das ist der robuste, automatisierbare Teil.
3. **Laender-Attribute** (`isoCountryCode2`, `isoCountryCode3`, `countryCode`, `coveredByFlat`, `supersaverPrivate`, `supersaverBusiness`, `beggerState`) ebenfalls vom Geschwister erben (Land-konstant; `coveredByFlat`/Flags sind pro Land gleich, auch wenn die Minutenpreise je Typ variieren).
4. **`subGroup`** wird aus `group` + erkanntem Typ **vorgeschlagen** (siehe Tabelle) und **muss reviewed werden**.
5. **`costsPerMinute`** wird **nicht** hier gesetzt — das uebernimmt `metadata/destination/update_costs.sql` aus `metadata.destinationCostsMonthly` (analog zu `currentDePrice` bei Tarifen). NULL lassen.

**Typ → subGroup-Vorschlag:**

| Modifier in `D` | Typ | subGroup-Vorschlag |
|---|---|---|
| ` MOBILE` | Mobile | `<GROUP>_MOBILE` (DE_/EU_/EFTA_; in ROW oft `ROW`) |
| ` SPECIAL[ N]` | Special | `<GROUP>_SPECIAL` (EU_SPECIAL, ROW_SPECIAL; CH→EFTA_SPECIAL) |
| ` PAGER` | Pager | `DE_PAGER` |
| ` TOLL FREE`, ` CORONA HOTLINE` | Toll-Free | `TOLL_FREE` (literal) |
| Ziffern-/Service-Suffix | Premium | `PREMIUM_RATE_NUMBER` (literal) |
| kein Suffix (neues Festnetz-Land) | Landline | `<GROUP>_LANDLINE` bzw. `ROW`/`TOP_DESTINATION` (manuell pruefen) |

## Ablauf

### Schritt 1 — NULL-Zeilen finden

```sql
select destination from metadata.destination where `group` is null order by destination;
```

Wenn keine Zeilen: melden, dass nichts zu tun ist, fertig. (`destination.py` setzt nur `group` als Indikator; `subGroup is null` zusaetzlich pruefen schadet nicht.)

### Schritt 2 — Parent-Mapping berechnen (Dry-Run)

Fuer jede NULL-Zeile das laengste klassifizierte Land-Geschwister suchen. **Wichtig:** Die LIKE-Wildcards `_` und `%` im Praefix escapen, und ein **Leerzeichen** hinter dem Praefix verlangen (Wortgrenze).

```sql
select n.destination as child, p.destination as parent,
       p.`group`, p.subGroup,
       p.isoCountryCode2, p.isoCountryCode3, p.countryCode,
       p.coveredByFlat, p.supersaverPrivate, p.supersaverBusiness, p.beggerState
from metadata.destination n
join metadata.destination p
  on p.destination = (
      select p2.destination from metadata.destination p2
      where p2.`group` is not null
        and n.destination like concat(replace(replace(p2.destination,'%','\\%'),'_','\\_'), ' %')
      order by length(p2.destination) desc limit 1
  )
where n.`group` is null
order by n.destination;
```

Diese Query zeigt pro NULL-Zeile das gewaehlte Geschwister, die uebernommene `group` und die Land-Attribute. Den passenden `subGroup`-Vorschlag aus der Typ-Tabelle oben dazu ableiten.

### Schritt 3 — Orphans erkennen

NULL-Zeilen ohne klassifiziertes Land-Geschwister tauchen in Schritt 2 nicht auf:

```sql
select n.destination
from metadata.destination n
where n.`group` is null
  and not exists (
      select 1 from metadata.destination p2
      where p2.`group` is not null
        and n.destination like concat(replace(replace(p2.destination,'%','\\%'),'_','\\_'), ' %')
  )
order by n.destination;
```

Orphans **nicht** automatisch befuellen — das sind neue Laender ohne Vorbild oder Spezial-Tokens (`ZONE_…`, `APPLICATION:…`, neue `DATA_…`-Dienste). Hier gilt "welches Land gehoert in welche Gruppe": dem User mit Einordnungs-Hilfe vorlegen — EU-Mitglied → `EU`, EFTA (IS/NO/LI) → `EFTA`, Schweiz → `ROW`/`EFTA_*`, sonst → `ROW`; Spezial-Tokens → passende Spezial-Gruppe. Manuell klassifizieren lassen.

### Schritt 4 — Vorschlag praesentieren

Mapping aus Schritt 2 als Tabelle ausgeben: `child → parent → group / subGroup-Vorschlag` plus die geerbten Land-Attribute. Auffaelligkeiten markieren:
- Geschwister sehr kurz/generisch oder Land-Mismatch (z.B. Praefix `GERMANY` faengt faelschlich `GERMANY MOBILE`-Varianten) → rueckfragen.
- subGroup-Vorschlag unsicher (ROW-Sonderfaelle, Schweiz/EFTA, neues Festnetz-Land) → explizit als "bitte bestaetigen" kennzeichnen.

### Schritt 5 — Anwenden (nur nach Bestaetigung)

Standardmaessig **nur Vorschlag**. Erst nach Bestaetigung (oder Argument `apply` + gesehenem Vorschlag) ausfuehren. Pro Zeile **ein** explizites UPDATE mit konstantem Parent (vermeidet MySQL-Error 1093) — `subGroup` als reviewten Literal-Wert einsetzen, nicht aus dem Parent kopieren:

```sql
update metadata.destination n
join metadata.destination p on p.destination = '<PARENT>'
set
  n.`group`            = p.`group`,
  n.subGroup           = '<REVIEWED_SUBGROUP>',
  n.isoCountryCode2    = p.isoCountryCode2,
  n.isoCountryCode3    = p.isoCountryCode3,
  n.countryCode        = p.countryCode,
  n.coveredByFlat      = p.coveredByFlat,
  n.supersaverPrivate  = p.supersaverPrivate,
  n.supersaverBusiness = p.supersaverBusiness,
  n.beggerState        = p.beggerState
where n.destination = '<CHILD>' and n.`group` is null;
```

`destination` (PK) und `costsPerMinute` werden bewusst **nicht** gesetzt (costsPerMinute kommt aus `update_costs.sql`).

### Schritt 6 — Verifizieren

```sql
select count(*) as remaining_nulls from metadata.destination where `group` is null;
```

Sollte um die Anzahl der befuellten Zeilen gesunken sein. Verbleibende NULLs = die Orphans aus Schritt 3.

## Hinweise

- **Backup zuerst.** Vor dem Schreiben [`/metadata-destination-backup`](../metadata-destination-backup/SKILL.md) laufen lassen.
- **`group` ist Reserved Word** → in jedem Statement Backticks `` `group` `` verwenden.
- **MySQL 5.7 — keine CTEs.** Korrelierte Subqueries nutzen (wie oben), kein `WITH`.
- **Keine externe Pruef-Tabelle.** Anders als bei Tarifen (`basefeatured`) gibt es keine Autoritaet ausserhalb der Tabelle — die einzige "Quelle der Wahrheit" sind die bereits klassifizierten Geschwister. Deshalb Orphans nie raten.
- **Transitive Parents sind harmlos** (analog tariff-fill): wird in einem frueheren Lauf ein kuerzeres Geschwister befuellt, loest ein spaeteres laengeres darauf auf — wertgleich, da das Geschwister selbst korrekt geerbt hat.
- **Schreibziel ist Production.** `metadata.destination` liegt auf dem DWH und wird live von Reporting/Looker (Kosten/Flat-Logik) genutzt. Niemals ohne Review/Bestaetigung schreiben.
- Sprache: Code/SQL englisch, Ausgabe an den User deutsch (siehe CLAUDE.md).

## See Also

- [Skill metadata-destination-backup](../metadata-destination-backup/SKILL.md) — Backup vor dem Auffuellen.
- [Skill metadata-tariff-fill](../metadata-tariff-fill/SKILL.md) — analoger Workflow fuer `metadata.tariff` (dort mit `basefeatured`-Cross-Check).
- `metadata/destination/destination.py` — Cron, der neue Destinations einfuegt und die "without config"-Mail verschickt.
- `metadata/destination/update_costs.sql` — setzt `costsPerMinute` aus `metadata.destinationCostsMonthly`.
