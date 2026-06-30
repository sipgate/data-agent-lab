---
name: metadata-tariff-fill
description: Fuellt fehlende Klassifizierung in metadata.tariff (tariffName is null) durch Vererbung vom laengsten bereits klassifizierten Praefix-Tarif. Generiert UPDATE-Statements zum Review, wendet sie erst nach Bestaetigung an.
user-invocable: true
argument-hint: Optional "apply" um nach dem Review direkt anzuwenden (Standard nur Vorschlag)
allowed-tools: mcp__mysql-dwh__execute_sql, Read, Grep, Bash
---

# Tariff-Metadaten auffuellen

Fuellt die leeren (NULL-) Zeilen in `metadata.tariff` auf. Wiederkehrende Aufgabe: Der Cron-Job `metadata/tariff/tariff.py` fuegt automatisch neue Tarif-IDs aus `billing20.statsAggregateMonthly` ein, die noch keine Konfiguration haben — diese landen mit nur gefuelltem PK `tariff` (und `postpaid=0`) und sonst NULL. `tariff.py` mailt anschliessend eine Liste "tariffs without config" an <analytix@sipgate.de>. Dieser Skill klassifiziert diese Zeilen automatisiert.

## Hintergrund / Datenmodell

- `metadata.tariff` ist eine **manuell gepflegte Dimensionstabelle** (PK `tariff`). Spalten: `tariffName, serviceGroup, productLayerPrefix, productLayer, segment, privateBusiness, brand, type, contract, flatDetail, displayName, description, withCosts, preview, beyondTermination, voucher, uniqueBrand, monthlyRecurring, isFreshInYear, postpaid, currentDePrice, amount, seats, channels, numbers, megabytes, minutes, sms, apicalls`.
- `productLayerPrefix` / `productLayer` (Product-Layer-Klassifizierung, [DENG-422](https://sipgatede.atlassian.net/browse/DENG-422)) werden hier **mit-vererbt** (die Variante erbt den Layer des Basis-Tarifs — praeziser als jede Heuristik). `metadata.tariff` ist alleinige Source of Truth; die frueheren Mapping-/Klassifizierungs-Skripte (`metadata/tariff/productLayer/`) wurden mit DENG-446 entfernt. Orphans ohne Basis-Tarif werden per `UPDATE metadata.tariff` von Hand zugeordnet (Heuristik als Leitlinie). Details: [wiki/concepts/product-layer-mapping.md](/usr/local/etl-scripts/wiki/concepts/product-layer-mapping.md).
- Neue Tarif-IDs sind fast immer **Billing-Varianten** eines bereits existierenden Tarifs. Die Variante haengt einen Suffix an den Basis-Tarif an, z.B. `_contract_`, `_contract_y`, `_contract_t`, `_call_x`, `_special_c`. Beispiele:
  - `sipgate_mobile_dataflat_1000_contract_` → Basis `sipgate_mobile_dataflat_1000`
  - `sipgate_trunking_de_landline_20000_contract_t` → Basis `sipgate_trunking_de_landline_20000`
  - `466_call_x` → Basis `466`
- **Etablierte Konvention (verifiziert):** Eine Variante erbt die **komplette** Klassifizierung vom Basis-Tarif — identische Werte ueber alle Spalten. Belegt durch bereits von Hand befuellte Geschwister wie `sipgate_mobile_dataflat_6000_2023_contract_` / `..._contract_y` (Werte identisch zu `sipgate_mobile_dataflat_6000_2023`) und `466_call_e` / `466_call_f` (identisch zu `466`).
- Der Basis-Tarif ist der **laengste bereits klassifizierte Tarif, der ein Praefix der neuen Tarif-ID ist**.

## Rolle von basefeatured

Die eigentliche Klassifizierungs-Taxonomie (`segment`, `brand`, `type`, `contract`, ...) ist sipgate-intern und lebt **ausschliesslich** in `metadata.tariff` — sie ist **nicht** aus `basefeatured` ableitbar. Insbesondere gilt `basefeatured.product.display_name` ≠ `tariffName` (Bsp.: Produkt "6 GB Datenvolumen & Mobil DE Flat" → tariffName "PSP Flat Bundle"). `basefeatured` dient deshalb nur als **Cross-Check**: bestaetigt, dass die Variante zu einem echten Produkt gehoert. Die Basis-Query dafuer:

```sql
select p.id, p.name, p.display_name, p.type, pg.name as product_group, p.contract_type, p.active
from basefeatured.product p
join basefeatured.product_group pg on p.product_group_id = pg.id
left join basefeatured.base_features_to_products bftp on p.id = bftp.product_id
left join basefeatured.base_features bf on bftp.bf_id = bf.id
where p.name like '<basis-name>%'
```

(Die base_features-Joins sind duenn besetzt und liefern keine fuer `metadata.tariff` nutzbaren Felder — deshalb als LEFT JOIN und nur informativ.)

### Was ein Tarif technisch kann — `base_features_avp` lesen

Waehrend `metadata.tariff` die **Marketing-/Klassifizierungs-Taxonomie** haelt, beschreibt `basefeatured.base_features` + `base_features_avp` die **technischen Faehigkeiten** eines Features/Tarifs. Nuetzlich als Cross-Check ("was kann der Tarif wirklich, wozu ist er gut?"), nicht zum Befuellen von `metadata.tariff`.

- `base_features` (PK `id`): `name`, `description`, `system` (`extensiond|numd|tariffd|featured`), `domain`, `contractRequired`. Tarife = `system='tariffd'`.
- `base_features_avp` ist eine **Attribute-Value-Pair**-Tabelle (daher `_avp`): pro `base_feature_id` (FK → `base_features.id`) je eine Zeile pro Eigenschaft.
  - `attribute` = Eigenschaftsname, `value` = Wert, `unit` = Einheit/Typ (`bool|int|day|days|minute|months|credits|string|subsystem|second|year|text`)
  - `type` = Geltungsbereich (`basefeature|feature|webuser|register|fax|callthrough`), `subsystem` = betroffenes Subsystem (`featured|numd|faxd|voicemaild|register`)
- Produktbezug: `base_features_to_products` (`bf_id` → `base_features.id`, `product_id` → `basefeatured.product.id`).

**Alle Capabilities zu einer base_feature_id:**

```sql
select bf.id, bf.name, bf.description, bf.system, bf.domain, bf.contractRequired,
       avp.attribute, avp.value, avp.unit, avp.type, avp.subsystem
from basefeatured.base_features bf
left join basefeatured.base_features_avp avp on avp.base_feature_id = bf.id
where bf.id = <BASE_FEATURE_ID>
order by avp.type, avp.attribute;
```

**Attribut-Bedeutung (aus den Daten abgeleitet, Stand 2026-06):**

| Attribute | Aussage | typische Werte |
|---|---|---|
| `tariff_type` | Tarif-Art | `normal`, `bookd_contingent` |
| `tariff_apply_to_extensions_type` | auf welche Extension-Typen der Tarif wirkt | `e,f,p,g,x` (Standard-Set), `i` (SIM), `c`, `p` |
| `calls_concurrent_max`, `max_concurrent_calls_billing`(`_incoming`) | max. gleichzeitige Gespraeche | int (`0` = unbegrenzt/n.a.) |
| `account_wide` | gilt accountweit vs. pro Extension | bool |
| `bound_to_phone_number`, `bound_to_extension` | Bindung an Nummer bzw. Extension | bool |
| `customerdelete_allowed` | Kunde darf selbst kuendigen/loeschen | bool |
| `rollbacktime_before` / `_after` | Storno-/Rueckabwicklungsfenster | meist `30` / `0` (day) |
| `number_source` | Nummern-Provider (subsystem) | `inud, nmsd, didww, voxbone, magrathead, argon, vintagewireless` |
| `duration` | Laufzeit | `1`, `90` (months) |
| `amount` + `unit` | Voucher-Inhalt | int + `minute`/`credit_fake`/`fax` |
| `forwarding_capable`, `recording_capable`, `pickup_allowed`, `callgroup_member_capable` | Telefonie-Faehigkeiten | bool |
| `call_forwarding_*`, `screening_allowed`, `metaproxy_allowed`, `local_prefix_*` (`type=feature`) | featured-Subsystem-Faehigkeiten | bool/int |
| `datad_read/change/delete/trash`, `sipcredentials_view`, `click2dial_allowed`, `*_frontend` (`type=webuser`) | Webuser-/Frontend-Rechte | bool |
| `require_addressid`, `require_subscriberid`, `require_area_code`, `max_nums_onhold` (`subsystem=numd`) | Nummern-Subsystem-Regeln | bool/int |

**Lese-Heuristik:** `description` + `name` geben den Zweck; `tariff_apply_to_extensions_type` zeigt die Zielgruppe (z.B. `i` = reiner SIM-/Mobilfunktarif, `e,f,p,g,x` = klassische Telefonie-Extensions); `bound_to_extension`/`account_wide` zeigt die Bindungsebene; `amount`+`unit` markiert Voucher/Contingent-Tarife; die `feature`-/`webuser`-Zeilen listen freigeschaltete Funktionen.

Beispiel `id=565` (`sipgate_simconnect_mini`): `tariff_apply_to_extensions_type=i` + `bound_to_extension=true` + `account_wide=false` → reiner Abrechnungstarif **pro SIM-Karte**, ohne Fallback-Tarife (deckt sich mit `description`).

## Ablauf

### Schritt 1 — NULL-Zeilen finden

```sql
select tariff from metadata.tariff where tariffName is null order by tariff;
```

Wenn keine Zeilen: melden, dass nichts zu tun ist, fertig.

### Schritt 2 — Parent-Mapping berechnen (Dry-Run)

Fuer jede NULL-Zeile den laengsten klassifizierten Praefix-Tarif suchen. **Wichtig:** Im `LIKE` muessen die LIKE-Wildcards `_` und `%` im Praefix escaped werden, sonst matcht `_` jedes beliebige Zeichen und liefert evtl. einen falschen Parent.

```sql
select n.tariff as child, p.tariff as parent,
       p.tariffName, p.serviceGroup, p.productLayerPrefix, p.productLayer, p.segment, p.privateBusiness, p.brand, p.type,
       p.contract, p.flatDetail, p.monthlyRecurring, p.withCosts, p.isFreshInYear,
       p.currentDePrice, p.amount
from metadata.tariff n
join metadata.tariff p
  on p.tariff = (
      select p2.tariff from metadata.tariff p2
      where p2.tariffName is not null and p2.tariff <> ''
        and n.tariff like concat(replace(replace(p2.tariff,'%','\\%'),'_','\\_'), '%')
      order by length(p2.tariff) desc limit 1
  )
where n.tariffName is null
order by n.tariff;
```

Diese Query zeigt pro NULL-Zeile den gewaehlten Parent und die wichtigsten Werte, die uebernommen wuerden.

### Schritt 3 — Orphans erkennen

NULL-Zeilen, fuer die **kein** Parent gefunden wird (kein klassifizierter Praefix), tauchen in Schritt 2 nicht auf. Sie separat listen:

```sql
select n.tariff
from metadata.tariff n
where n.tariffName is null
  and not exists (
      select 1 from metadata.tariff p2
      where p2.tariffName is not null and p2.tariff <> ''
        and n.tariff like concat(replace(replace(p2.tariff,'%','\\%'),'_','\\_'), '%')
  )
order by n.tariff;
```

Orphans **nicht** automatisch befuellen. Pro Orphan via basefeatured pruefen, ob ein echtes Produkt dahinter steckt, und dem User zur **manuellen** Klassifizierung vorlegen (es gibt keine Schwester-Zeile, von der geerbt werden kann).

#### Orphan-Recherche: wer hat den Tarif angelegt? (GitHub-Suche)

**Nur als letzter Schritt** — wenn ein Orphan weder ueber den Prefix-Parent (Schritt 2) noch ueber `basefeatured` (echtes Produkt? Familie? `base_features`?) sinnvoll klassifizierbar ist und auch die Billing-Plausibilisierung (Umsatz/Nutzung) keinen klaren Tarif-Charakter zeigt. Ziel ist dann **nicht** mehr die automatische Klassifizierung, sondern den **menschlichen Ansprechpartner** zu finden, den man fragen kann.

Tarife/Produkte werden in **`sipgate/db-changes`** per DML-Datei angelegt (basefeatured + billing). Die Tarif-ID dort suchen und den Commit-Autor ermitteln:

```bash
# 1. Wo wird die Tarif-ID angelegt?
gh search code --owner sipgate "<TARIFF_ID>"

# 2. Commit-Autor + Message der Treffer-Datei (gibt den Ansprechpartner)
gh api "repos/sipgate/db-changes/commits?path=<PFAD_AUS_SCHRITT_1>&per_page=5" \
  --jq '.[] | "\(.commit.author.date)  \(.commit.author.name) <\(.commit.author.email)>  \(.sha[0:9])  \(.commit.message | split("\n")[0])"'
```

Die Treffer liegen typischerweise unter `files-dml/live/db05/basefeatured/...` (Produktdefinition) und `files-dml/live/db14/billing/...` (Preis). Commit-Autor + Message (z.B. "add enabling contract for special customers") liefern Zweck und Person. Bei Bedarf zusaetzlich `basefeatured.product.date_created`/`date_changed` (per `id`) und die Nutzung in `billing20.statsAggregateMonthly` (`domain`, `masterSipId`, Umsatz) als Kontext.

Dem User dann **Person + vermutlicher Zweck** nennen, damit er beim Anlegenden rueckfragen kann — statt zu raten. Solche „Tarife" sind oft gar keine Endkunden-Tarife, sondern interne Flags/Enabler (Preis 0, `type=extension`), die nicht in die normale Taxonomie passen; dann ist NULL-lassen + Rueckfrage die richtige Wahl.

### Schritt 4 — Vorschlag praesentieren

Das Mapping aus Schritt 2 als Tabelle (child → parent → tariffName/segment/brand/type) ausgeben. Optional pro Parent den basefeatured-Cross-Check (Produkt existiert? `active`?) ergaenzen. Auffaelligkeiten markieren:

- Parent ist sehr kurz / generisch (z.B. einstellige Zahl) und der Suffix lang → ggf. falscher Match, beim User rueckfragen.
- `currentDePrice = 0.00` oder `isFreshInYear` wirkt unplausibel → nur Hinweis; diese beiden Felder werden von `tariff.py` ohnehin spaeter aus Billing neu abgeleitet (s.u.).

### Schritt 5 — Anwenden (nur nach Bestaetigung)

Standardmaessig **nur Vorschlag**. Erst wenn der User bestaetigt (oder der Skill mit Argument `apply` aufgerufen wurde und der User den Vorschlag gesehen hat), die UPDATEs ausfuehren.

Pro Kind-Tarif **ein** explizites UPDATE mit konstantem Parent (vermeidet MySQL-Error 1093 "can't specify target table for update in FROM", da kein Subquery auf die Ziel-Tabelle laeuft und der Parent eine Konstante ist):

```sql
update metadata.tariff n
join metadata.tariff p on p.tariff = '<PARENT>'
set
  n.tariffName        = p.tariffName,
  n.serviceGroup      = p.serviceGroup,
  n.productLayerPrefix = p.productLayerPrefix,
  n.productLayer      = p.productLayer,
  n.segment           = p.segment,
  n.privateBusiness   = p.privateBusiness,
  n.brand             = p.brand,
  n.type              = p.type,
  n.contract          = p.contract,
  n.flatDetail        = p.flatDetail,
  n.displayName       = p.displayName,
  n.description       = p.description,
  n.withCosts         = p.withCosts,
  n.preview           = p.preview,
  n.beyondTermination = p.beyondTermination,
  n.voucher           = p.voucher,
  n.uniqueBrand       = p.uniqueBrand,
  n.monthlyRecurring  = p.monthlyRecurring,
  n.isFreshInYear     = p.isFreshInYear,
  n.currentDePrice    = p.currentDePrice,
  n.amount            = p.amount,
  n.seats             = p.seats,
  n.channels          = p.channels,
  n.numbers           = p.numbers,
  n.megabytes         = p.megabytes,
  n.minutes           = p.minutes,
  n.sms               = p.sms,
  n.apicalls          = p.apicalls
where n.tariff = '<CHILD>' and n.tariffName is null;
```

`tariff` (PK) und `postpaid` werden bewusst **nicht** ueberschrieben.

### Schritt 6 — Verifizieren

```sql
select count(*) as remaining_nulls from metadata.tariff where tariffName is null;
```

Sollte um die Anzahl der befuellten Zeilen gesunken sein. Verbleibende NULLs = die Orphans aus Schritt 3.

## Hinweise

- **MySQL 5.7 — keine CTEs.** Der DWH-MySQL unterstuetzt kein `WITH ... as (...)`. Alle Queries mit korrelierten Subqueries formulieren (wie oben), nicht mit CTEs.
- **Transitive Parents sind harmlos.** Wenn in einem frueheren Lauf bereits ein kuerzeres Geschwister befuellt wurde (z.B. `..._contract_`), loest ein spaeter auftauchendes `..._contract_y` auf dieses Geschwister statt auf den Basis-Tarif auf — weil es nun der laengste *klassifizierte* Praefix ist. Das ist wertgleich (das Geschwister hat selbst vom Basis-Tarif geerbt) und damit unkritisch.
- **Schreibziel ist Production.** `metadata.tariff` liegt auf dem DWH und wird live von Reporting/Looker genutzt. Niemals ohne expliziten Review/Bestaetigung schreiben.
- `metadata/tariff/tariff.py` aktualisiert `currentDePrice` (aus `billing20.tariff_products`) und `isFreshInYear` (Jahr des ersten Auftretens in `billing20.tariff_products`) bei jedem Lauf neu. Vom Parent kopierte Werte dieser beiden Felder koennen also beim naechsten Lauf ueberschrieben werden — das ist erwuenscht und kein Fehler.
- Die neuen Varianten tauchen typischerweise frisch in `billing20.statsAggregateMonthly` auf (Spalte `dim` = Monat). Zur Plausibilisierung: `select tariff, min(dim), max(dim), sum(billedAmount)/10000 from billing20.statsAggregateMonthly where tariff in (...) group by tariff`.
- Sprache: Code/SQL englisch, Ausgabe an den User deutsch (siehe CLAUDE.md).
