---
name: pipeline-obr
description: Erstellt den monatlichen OBR-Carrier-Report — Voraussetzungen pruefen, Berechnung, Datenvalidierung, Versand und Slack-Post — Nutzen wenn der monatliche OBR-Report ansteht.
user-invocable: true
argument-hint: Optional Monat als YYYY-MM-01 (Standard ist der Vormonat)
allowed-tools: Bash, Read, Grep, mcp__mysql-dwh__execute_sql, mcp__bigquery__execute_sql, mcp__grafana__query_loki_logs
---

# OBR Monats-Report

**Wann nutzen:** Einmal im Monat, wenn der OBR-Carrier-Report fuer den Vormonat erstellt und versendet werden soll.

Fuehrt den monatlichen OBR-Workflow (Outbound Routing Reports) aus: Voraussetzungen pruefen, `cdr_incoming` berechnen, Daten validieren, Report versenden und die Zahlen im #obr-Channel posten. Hintergrund und Tabellen-Doku: `cdr/obr/README.md`.

## Konfiguration

- **Monat:** Standard ist der Vormonat (`YYYY-MM-01`). Argument ueberschreibt.
- **Server:** Alle Scripts laufen via SSH auf `analytics-db01.live.sipgate.net` (eigener User, kein etl-Login noetig).
- **Slack #obr:** `C02D9CD1Y80` (ID stabil, direkt verwenden)
- **Google Sheet:** https://docs.google.com/spreadsheets/d/19qPDhq8UM8_xIyBBEHVTKS3yda9t_esD48oiJ34hLTo
- **Loki:** Datasource `loki-ix01` (UID `c683e452-1ea5-4b20-bb80-0b7eca8b43dc`), Service-Label `etl-obr`

## Ablauf

### Schritt 1: Voraussetzungen pruefen

**1a) Roh-Daten fuer den Monat komplett? (zuerst ausfuehren)** Die Aggregationstabellen haben nur Monats-Granularitaet — Vollstaendigkeit ist nur auf den Roh-Tabellen (db-etl) pruefbar: pro Tabelle muss jeder Kalendertag des Monats Zeilen haben (gleiche Idee wie der Gap-Check in `cdr_agg.py`). Im Hintergrund starten, dauert einige Minuten:

```bash
cat <<'EOF' | ssh analytics-db01.live.sipgate.net "/usr/local/etl-scripts/libs/miniconda3/bin/python3 -"
# Day-gap completeness check for the report month
import configparser
import calendar
from datetime import date
config = configparser.ConfigParser()
config.read('/usr/local/etl-scripts/etc/config.ini')
from sqlalchemy import create_engine

month_start = date(<JAHR>, <MONAT_NR>, 1)
days_expected = calendar.monthrange(month_start.year, month_start.month)[1]
month_end = <ERSTER TAG FOLGEMONAT als date(...)>

engine = create_engine(
    'mysql+mysqlconnector://' + config['db_etl']['user'] + ':' + config['db_etl']['pass']
    + '@' + config['db_etl']['host'] + '/basefeatured', pool_pre_ping=True)

tables = ['safran_cdr.cdr_raw_safran', 'nq_tkom_cdr.cdr_raw_nq_tkom',
          'sgwl_telekom_cdr.cdr_raw_sipgatewireless']
for table in tables:
    sql = f'''select date(timestamp) as d, count(*) as c from {table}
              where timestamp >= '{month_start}' and timestamp < '{month_end}'
              group by d order by d'''
    with engine.connect() as conn:
        rows = conn.execute(sql).fetchall()
    if not rows:
        print(f"{table}: EMPTY for {month_start}")
        continue
    days_found = {r[0] for r in rows}
    missing = [str(date(month_start.year, month_start.month, d))
               for d in range(1, days_expected + 1)
               if date(month_start.year, month_start.month, d) not in days_found]
    status = 'COMPLETE' if not missing else f'GAPS: {", ".join(missing)}'
    print(f"{table}: {len(days_found)}/{days_expected} days, min_rows_per_day={min(r[1] for r in rows):,} -> {status}")
EOF
```

- **GAPS** → stoppen und melden: Rohdaten auf db-etl unvollstaendig, erst die Quelle klaeren (siehe README Troubleshooting), sonst rechnet `obr.py` mit Luecken.
- Auch ein auffaellig niedriges `min_rows_per_day` (Teilimport eines Tages) ansprechen.

Die uebrigen Checks (1b–1d) koennen parallel laufen, waehrend 1a rechnet:

**1b) Neue Preislisten/Dialcodes?** `#obr` (`C02D9CD1Y80`) lesen (limit 20) und mit `cdr/obr/files.ini` abgleichen. Neue Listen werden dort von Percy Christensen angekuendigt (netzquadrat/safran XLSX, Telekom-DCL). Falls eine neuere Liste angekuendigt wurde als in `files.ini` steht → **stoppen** und den manuellen Import-Schritt anbieten (Dateien nach `cdr/obr/imports/data/<carrier>/` kopieren, `files.ini` anpassen, `imports/file_imports.py` ausfuehren — siehe README Schritt 2).

**1c) CDR-Aggregation gelaufen?** (laeuft automatisch am 1. um 12:00)

```sql
select month, count(*) from cdr.cdr_carrier_monthly where month = '<MONAT>' group by month
```

Leer → `cdr/cdr_agg/cdr_agg.py` ist nicht gelaufen, erst das klaeren (siehe README Troubleshooting). **Achtung Timing:** Am 1. des Monats vor 12:00 ist das planmaessig — die Aggregation laeuft erst um 12:00, kein Fehler.

**1d) Stand `cdr_incoming`:** Hat der Monat schon Zeilen? Eine Wiederholung ist unkritisch (`obr.py` loescht den Monat vor der Neuberechnung), aber dem User sagen, ob es ein Erst- oder Wiederholungslauf ist.

### Schritt 2: Berechnung

```bash
ssh analytics-db01.live.sipgate.net "/usr/local/etl-scripts/cdr/obr/run.py -m <MONAT>"
```

- **Im Hintergrund starten** und auf die Notification warten — Laufzeit ca. 20 Minuten.
- **stdout ist leer** (job_runner schluckt die Ausgabe). Erfolg verifizieren ueber:
  - Loki: `{service="etl-obr"}` → `Job completed` mit `steps=2`
  - MySQL: Zeilen/Summen fuer den Monat in `cdr.cdr_incoming`

### Schritt 3: Datenvalidierung

`check_obr.py` lief zwar in `run.py` mit, aber ohne sichtbare Ausgabe — fuer den Bericht einmal manuell ausfuehren:

```bash
ssh analytics-db01.live.sipgate.net "/usr/local/etl-scripts/cdr/obr/check_obr.py -m <MONAT>"
```

Ergaenzend (via `mcp__mysql-dwh__execute_sql`):

1. **Detail der CHECK-1-Warnungen:** Zeilen mit `billtime_minutes > 0` und fehlendem Preis/Betrag anzeigen. **Known Noise:** `destination = 'UIFN'` (+800 International Freephone, einstellige Calls, wenige Minuten) kommt in jedem Monat vor und hat in keiner Preisliste einen Preis — kein Fehler.
2. **Job ↔ Preisliste:** `select job, price_file, dialcode_file, count(*) ... group by` — B.1-Jobs muessen auf die Carrier-Preislisten aus `files.ini` zeigen, `safran-O.3-*` und `argon-B.1-telekom` haben pauschale Raten und **leeres** `price_file`, alle Zeilen dieselbe DCL.
3. **B.1-Mapping vollstaendig:** `alnr is null` bei `%B.1-telekom%` muss 0 Zeilen liefern (unmapped ist nur bei safran-Jobs normal, check_obr stuft das als INFO ein).
4. **Coverage einordnen:** CHECK 7 (cdr_incoming vs. cdr_carrier_monthly incoming) liegt normal bei **~48 %**. Mit den Vormonaten vergleichen — Abweichung um mehr als 1–2 Punkte ist auffaellig.
5. **Duplikat-Raten fuer den ganzen Monat** (gehoeren in den Slack-Post; bei > 0 % muessen sie in den Rechnungen beruecksichtigt werden). Gleiche Logik wie `dataQualityChecks/check_duplicates_cdr.py`, aber Monatsfenster — laeuft auf den Roh-Tabellen auf db-etl, daher per SSH (dauert einige Minuten, im Hintergrund starten):

```bash
cat <<'EOF' | ssh analytics-db01.live.sipgate.net "/usr/local/etl-scripts/libs/miniconda3/bin/python3 -"
# Monthly duplicate rates, same logic as dataQualityChecks/check_duplicates_cdr.py
import configparser
config = configparser.ConfigParser()
config.read('/usr/local/etl-scripts/etc/config.ini')
from sqlalchemy import create_engine

engine = create_engine(
    'mysql+mysqlconnector://' + config['db_etl']['user'] + ':' + config['db_etl']['pass']
    + '@' + config['db_etl']['host'] + '/basefeatured', pool_pre_ping=True)

tables = ['safran_cdr.cdr_raw_safran', 'nq_tkom_cdr.cdr_raw_nq_tkom',
          'sgwl_telekom_cdr.cdr_raw_sipgatewireless']
for table in tables:
    sql = f'''
    select count(billid),
           count(case when rowcount > 1 then billid else null end),
           count(case when rowcount > 1 then billid else null end) / count(billid)
    from (select billid, count(billid) as rowcount from {table}
          where timestamp >= '<MONAT>' and timestamp < '<FOLGEMONAT>'
          and status = 'answered' and direction = 'incoming'
          group by billid) x'''
    with engine.connect() as conn:
        row = conn.execute(sql).fetchone()
    print(f"{table}: calls={row[0]:,} duplicates={row[1]:,} rate={float(row[2] or 0):.2%}")
EOF
```

Ergebnis als Zwischenbericht zusammenfassen (Tabelle: Check → Ergebnis).

**Ad-hoc-Validierungs-Scripte** (nur bei Auffaelligkeiten, nicht Teil des Standardlaufs):

- `cdr/obr/check.sql` — manuelle SQL-Vorlage; die Queries sind durch check_obr.py + die Checks oben abgedeckt
- `cdr/obr/dailcodes_comparison.sql` — Diff zweier DCL-Versionen; sinnvoll nach dem Import einer neuen DCL (Schritt 1b), um die Aenderungen gegen die Ankuendigung im #obr-Channel zu pruefen
- `cdr/obr/invalid_numbers.sql` — Sonderrufnummern (0800/110/112/0137...) in den Aggregationstabellen nachschlagen, z.B. bei Reklamationen
- `cdr/obr/debug/dest_agg.sql` — Destination-Aggregation zum Debuggen einzelner Ziele

### Schritt 4: Report versenden — nur nach Freigabe

> **⚠️** `report.py` verschickt eine **Mail an obr@sipgate.de** (externer Verteiler). Vor der Ausfuehrung die Validierung zeigen und explizit fragen.

```bash
ssh analytics-db01.live.sipgate.net "/usr/local/etl-scripts/cdr/obr/report.py -m <MONAT>"
```

Erzeugt drei Excels in `cdr/obr/reports/` (Gesamt, Vodafone, BT), synct `cdr_incoming` nach BigQuery und versendet die Mail.

**Danach den BQ-Sync verifizieren** — `report.py` ignoriert den Exit-Code des Sync-Aufrufs (`os.system`), Exit 0 des Scripts beweist den Sync also nicht:

```sql
-- mcp__bigquery__execute_sql; bei lokalem Auth-Fehler (invalid_rapt):
-- serverseitig via google.cloud.bigquery mit etc/google_cloud_bigquery_credentials.json
select month, count(*), round(sum(bill_amount), 2)
from `business-analytics-216810.cdr.cdr_incoming`
where month >= '<VORMONAT>' group by month order by month
```

Cent-Differenzen zur MySQL-Summe sind Float-Rundung im Aggregat, kein Fehler.

> **⚠️ Kein blinder Re-Run:** Wenn nur der BQ-Sync fehlgeschlagen ist, `report.py` **nicht** erneut ausfuehren — das wuerde die Mail doppelt an den Verteiler schicken. Stattdessen nur den Sync nachholen:
>
> ```bash
> ssh analytics-db01.live.sipgate.net "/usr/local/etl-scripts/libs/miniconda3/bin/python3 /usr/local/etl-scripts/googleBigQuery/bq_csv_truncate.py cdr_incoming"
> ```

### Schritt 5: Slack-Post in #obr

Nach dem Mail-Versand die Zahlen in `#obr` posten (Vorlage = Posts der Vormonate, z.B. "OBR 2025-12"):

```
**OBR <YYYY-MM>**

https://docs.google.com/spreadsheets/d/19qPDhq8UM8_xIyBBEHVTKS3yda9t_esD48oiJ34hLTo

E-Mail mit Excel Files ist auch raus.

Die Duplikate sehen im <Monat> wie folgt aus:
netzquadrat <x>%
sipgatewireless <x>%
safran <x>%

<Bei 0 %: "Es muss diesmal keine Duplikat-Rate in den Rechnungen beruecksichtigt werden.">
<Bei > 0 %: "Bitte die Duplicates Rates in den Rechnungen beruecksichtigen.">

Folgende Metadaten wurden verwendet:
[dialcode]
<DCL-Datei>
[netzquadrat]
<Datei>
[safran]
<Datei>
[sipgate_wireless]
<Datei>

fyi <@UPFP54S4E> <@U4ANJG83A> <@U03LYDGFR>
```

(fyi-Mentions: Thea Mantwill `UPFP54S4E`, Sonja Buerger `U4ANJG83A`, Percy Christensen `U03LYDGFR`)

### Schritt 6: Manuelle Restarbeit erinnern

Den User am Ende erinnern: **Google Sheet manuell refreshen** (Connected Sheets aktualisiert nicht automatisch — Sheet oeffnen → Connected-Sheets-Bereich → "Aktualisieren").

## Known Noise

- **UIFN-Zeilen ohne Preis** (CHECK 1): +800 International Freephone, jeden Monat 1–15 Calls — kein Fehler, keine Preislisten-Luecke.
- **Coverage ~48 %** (CHECK 7): cdr_incoming deckt bewusst nur einen Teil von cdr_carrier_monthly ab — der Wert ist nur im Vergleich zu den Vormonaten aussagekraeftig.
