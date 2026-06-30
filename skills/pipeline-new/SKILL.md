---
name: pipeline-new
description: Erstellt eine neue ETL-Pipeline mit run.py, Script/SQL, Crontab-Eintrag und Monitoring-Setup
user-invocable: true
argument-hint: Name der Pipeline z.B. "myPipeline" oder "aggregation/myPipeline"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Neue Pipeline erstellen

Erstelle eine neue ETL-Pipeline nach den Repository-Konventionen. Referenz: `docs/pipelines/neue-pipeline-erstellen.md`.

**Leitbild: Self-Healing ist kein Add-On, sondern Default.** Pipelines laufen unbeaufsichtigt auf Production. Jeder transiente Fehler, der menschlichen Eingriff fordert, ist ein Defekt im Design. Weise den User bei jeder neuen Pipeline aktiv auf Self-Healing-Optionen hin (siehe Schritt 4) und setze sinnvolle Defaults, wo immer moeglich.

## Ablauf

### Schritt 1: Name und Zielverzeichnis bestimmen

Aus dem Argument den **Pipeline-Namen** und das **Zielverzeichnis** ableiten:

- Wenn ein Pfad angegeben wurde (z.B. `aggregation/myPipeline`): Verzeichnis und Name direkt uebernehmen
- Wenn nur ein Name angegeben wurde: den User fragen wo die Pipeline hin soll

**Name validieren:**
- Nur **lowercase** (ein Wort) oder **camelCase** (zusammengesetzte Namen) erlaubt
- Kein snake_case, kein kebab-case, kein PascalCase
- Regeln: `docs/pipelines/naming-conventions.md`

**Verzeichniswahl** (falls nicht angegeben, User fragen):

| Situation | Zielverzeichnis |
|-----------|----------------|
| Daten von externer API/Service | Eigenes Top-Level-Verzeichnis |
| Interne Aggregation/Reporting | `aggregation/<name>/` |
| Metadaten/Stammdaten | `metadata/<name>/` |
| Eigenstaendiges Thema | Eigenes Top-Level-Verzeichnis |

### Schritt 2: Pipeline-Typ bestimmen

Den User fragen (falls nicht aus dem Kontext klar):

- **SQL-Pipeline** — reine SQL-Transformationen via `exec/execSql.py`
- **Python-Pipeline** — Python-Script fuer API-Calls, komplexe Logik, Multi-Source
- **Multi-Step** — Kombination aus SQL und Python oder mehrere Schritte

### Schritt 3: Dateien erstellen

#### 3a) run.py (immer)

```python
#!/usr/local/etl-scripts/venv/bin/python3
"""<name> pipeline."""

import sys
sys.path.insert(0, '/usr/local/etl-scripts')
from utils.job_runner import Job

with Job(__file__, name='<name>') as job:
    job.run('<pfad/zum/script_oder_sql>')
```

Regeln:
- Shebang fuer **neue** Scripts: `#!/usr/local/etl-scripts/venv/bin/python3` (3.12). Bestehende Scripts auf `libs/miniconda3/bin/python3` (3.7) bleiben vorerst unveraendert — Migration laeuft schrittweise.
- `name=` Parameter MUSS gesetzt werden — daraus wird das Loki-Label `etl-<name>` (wichtig fuer `/pipeline-check`)
- Pfade in `job.run()` relativ zum Repo-Root

**Doppellauf-Schutz (`exclusive=True`)** — pruefen ob die Pipeline davor geschuetzt werden muss, dass eine zweite Instanz parallel startet (z.B. wenn der vorherige Lauf noch nicht fertig ist, cron aber neu triggert). Relevant fuer:
- Intraday-Jobs die laenger als ihr Cron-Intervall laufen koennen
- Pipelines die dieselbe Zieltabelle schreiben wie andere Jobs (z.B. alles in `basefeatured` → Lockfile `/tmp/basefeatured_etl.lock`)
- Lang laufende Builds mit teurem Setup (DB-Connections, Downloads)

Mit `exclusive=True` legt der Job-Runner automatisch `/var/run/etl-<name>.lock` an und eine zweite Instanz exit-ed sauber mit 0, statt zu failen:

```python
with Job(__file__, name='<name>', timeout=240, exclusive=True) as job:
    job.run('<pfad>')
```

Fuer Pipelines die **mit anderen** Pipelines einen gemeinsamen Lock brauchen (nicht nur self-exclusive) siehe `basefeatured/customer_product/run.py` — macht `fcntl.flock` manuell auf einem shared lockfile.

#### 3b) SQL-Dateien (bei SQL-Pipeline)

SQL-Datei(en) im Unterverzeichnis `sql/` oder direkt neben run.py:
- `@date` Placeholder fuer Datumsiteration
- SQL-Keywords immer **lowercase**
- Idempotent: DELETE + INSERT statt nur INSERT

**Zero-Downtime pruefen:** Wird die Zieltabelle von anderen Pipelines / Dashboards / Metabase aktiv gelesen? Dann NICHT `TRUNCATE + INSERT` auf der Live-Tabelle (Konsumenten sehen zwischenzeitlich leere oder halbfertige Daten). Stattdessen **Staging-Pattern** verwenden (siehe 3e).

#### 3c) Python-Script (bei Python-Pipeline)

Script neben run.py:
- `sys.path.insert(0, '/usr/local/etl-scripts')` am Anfang
- `from utils.mysql import MySQLClient, Server, Database` fuer MySQL
- `from utils.bigquery import BigQueryClient` fuer BigQuery
- `logging.getLogger(__name__)` fuer Log-Output
- Kein `except: pass` — Fehler muessen propagiert werden

#### 3d) Dateien ausfuehrbar machen

```bash
chmod +x <pfad>/run.py
```

#### 3e) Staging-Logik fuer Zero-Downtime (wenn Tabelle aktiv gelesen wird)

Vollrebuilds auf einer Live-Tabelle machen sie kurzzeitig leer oder inkonsistent — Konsumenten (andere Pipelines, Metabase, Looker, Dashboards) sehen dann falsche Daten. **Immer pruefen:** Wird die Zieltabelle ausserhalb der Pipeline gelesen? Falls ja, Staging-Pattern verwenden.

**Entscheidungshilfe:**
- Append-only (INSERT neuer Zeilen, nie DELETE) → kein Staging noetig
- Upsert/MERGE pro Zeile → kein Staging noetig
- Partitionsweises Neuschreiben (z.B. `@date`-Partition, DELETE + INSERT fuer genau einen Tag) → kein Staging noetig, solange nur eine Partition betroffen ist
- **Vollrebuild / TRUNCATE+INSERT auf einer aktiv gelesenen Tabelle** → Staging pflicht

**MySQL:** `MySQLClient.atomic_swap(live, tmp)` aus `utils/mysql.py` — macht RENAME TABLE atomar, droppt die alte Tabelle, handelt Erstlauf (live existiert noch nicht) und verwaiste `_old`-Tabellen aus gescheitertem Vor-Swap selbst.

```python
# 1. In tmp-Tabelle schreiben
job.run('<name>/build.py', '--tmp-table', retries=3, retry_all=True)

# 2. Atomic swap
def swap():
    with MySQLClient(Server.ANALYTICS, Db.BFD) as db:
        db.atomic_swap('<name>', '<name>_tmp')

job.call(swap)
```

**BigQuery:** Wenn der Build in einer Query machbar ist → direkt `create or replace table <live> as select ...` (ist schon atomic). Nur wenn der Build ueber Load-Jobs oder mehrere Statements laeuft → `BigQueryClient.atomic_swap(live, tmp)`:

```python
with BigQueryClient() as bq:
    # ... build into <tmp> via load jobs / multiple queries ...
    bq.atomic_swap('dataset.<name>', 'dataset.<name>_tmp')
```

**Regeln:**
- Staging-Tabellen konsequent `<name>_tmp` benennen (siehe `/pipeline-check` — prueft auf verwaiste Staging-Tabellen nach gescheitertem Swap)
- Swap muss idempotent / wiederaufnehmbar sein — beim Retry darf `_tmp` existieren und wird ueberschrieben
- Bei Fehlern zwischen Build und Swap bleibt die Live-Tabelle unveraendert — das ist der ganze Sinn des Patterns
- Referenz-Implementierung inline (ohne Helper, aus Legacy-Gruenden): `basefeatured/customer_product/run.py`

#### 3f) Dry-Run / Test-Mode CLI-Flags

Pipelines sollten einen Modus haben, in dem sie **ohne Seiteneffekte** lokal ausfuehrbar sind — fuer Testing auf `analytics-db01` und fuer schnelle Iteration bei Aenderungen. Patterns je nach Pipeline-Typ:

- `--dry-run` — SQL-/Query-Validierung ohne Execution (Beispiele: `octopus/pipeline.py`, `slackAlerts/run_alerts.py`, `billing20/rwstats/sync_rwstats.py`)
- `--query-only` — Daten ziehen, aber nicht schreiben (Beispiel: `slackAlerts`)
- `--test-mode` — Slack-Nachrichten an Test-Channel statt Production (Beispiel: `slackAlerts`)
- `--list` — Nur auflisten was gemacht wuerde (Beispiel: `aggregation/retention/retention.py`)

```python
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--dry-run', action='store_true',
                    help='Validate queries without writing to target')
args = parser.parse_args()

if args.dry_run:
    log.info('DRY RUN — no data will be written')
    # validate / log only
    return
# real execution
```

**Faustregel:** Wenn die Pipeline in Production Daten schreibt / Nachrichten sendet / APIs aufruft, **muss** es einen sicheren lokalen Testmodus geben. Ohne ist manuelles Testen auf `analytics-db01` riskant.

#### 3g) Datenherkunft in die Zieltabelle schreiben

Die **Provenienz gehoert als Metadaten in die Zieltabelle**, nicht nur ins README. Wer die Tabelle spaeter in BigQuery / Metabase / Looker / Grafana anschaut, soll ohne Repo-Zugriff sehen, woher die Daten kommen und welche Pipeline sie befuellt.

**BigQuery — Zieltabelle explizit mit `CREATE TABLE IF NOT EXISTS` anlegen** (idempotent, no-op sobald die Tabelle existiert, ruehrt bestehende Zeilen nie an). Provenienz in die Table- und Spalten-`description`:

```python
CREATE_TABLE_SQL = f"""
create table if not exists `{BQ_TABLE_ID}`
(
  snapshotDate date    options(description = 'Day this snapshot was taken'),
  cnt          int64   options(description = 'Number of unused eSIMs (used=0)')
)
partition by snapshotDate
options(
  description =
    'Daily snapshot of the free eSIM pool. '
    'Source: esim.esim_pool on db-etl.sipgate.net (DB05). '
    'Populated by ETL pipeline esim/esimPool/ (Loki label etl-esimPool), '
    'daily at 03:20. See DENG-<n>.'
)
"""
# Vor dem ersten Load ausfuehren: bq.execute(CREATE_TABLE_SQL)
```

In die Table-`description` gehoeren: **Quellsystem + Quelltabelle**, **befuellende Pipeline (Pfad + Loki-Label)**, **Schedule**, ggf. Retention-Regel und **Ticket-Key**. Pro Spalte eine kurze `description`.

**MySQL-Ziele:** Provenienz als `COMMENT` setzen — Tabelle: `alter table <t> comment = '...'`; Spalten: `comment '...'` im `create table` / `alter table modify`.

**Regeln:**
- Description-Texte sind Code → **Englisch** (wie Kommentare/Logs), nicht Deutsch.
- DDL vorab gegen BigQuery validieren (`execute_sql` mit `dry_run=true` ueber das BigQuery-MCP, oder `bq query --dry_run`).
- Bei neuem **Dataset**: in derselben **Region** wie die Geschwister-Datasets anlegen (sonst brechen Joins / der Grafana-Datasource) und den lesenden Consumern (z.B. `grafana@…`-SA, `bigquery-users-view@sipgate.de`) `READER` geben.
- Wenn der Build sowieso `create or replace table … as select …` nutzt, die `description`/Spalten-Options direkt dort mitgeben — kein separates `CREATE TABLE IF NOT EXISTS` noetig.

#### 3h) Partitionierung / Clustering (BigQuery) bzw. Indizes (MySQL)

Beim Anlegen einer neuen Zieltabelle die physische Organisation **bewusst** waehlen — abhaengig von Datenmenge und Abfragemuster, nicht per Default-Reflex. Mit dem User durchgehen.

**BigQuery:**
- **Partitionieren** nach der Datums-/Zeitspalte, auf die Queries filtern (`snapshotDate`, `eventDate`, `@date`). Vorteile: Partition-Pruning in Queries, billiger partitionsweiser `DELETE`/Rewrite (heutige Slice, Retention), kein Full-Scan. Fuer Snapshot-/Event-/Zeitreihen-Tabellen praktisch immer.
- **4000-Partitionen-Limit** beachten: taegliche Partitionen reichen ~11 Jahre. Bei laengerer Historie **oder** hoher Tages-Cardinalitaet auf `partition by date_trunc(col, month)` oder Ingestion-Time ausweichen. Retention (Ausduennen/Loeschen alter Tage) haelt die Partitionszahl klein.
- **Clustern nur bei grossen Partitionen** (Faustregel > 1 GB / Partition) **und** wenn Queries auf wenige Spalten filtern/joinen. Cluster-Spalten in Reihenfolge der Filter-Haeufigkeit. **Kleine Tabellen NICHT clustern** — unterhalb der Block-Schwelle bringt es nichts, ist nur Ballast (Beispiel: `esim.esimPool` ~6 Zeilen/Tag → kein Clustering; Gegenbeispiel `aggregation.contractSnapshot` ~110k Zeilen/Tag → clustert auf `masterSipId`).
- `load_dataframe(date_col=…, clustering_fields=[…])` setzt beides beim Erstanlegen; bei `create table`/`create or replace table` via `partition by` / `cluster by`.
- **Keine Partition-Expiration**, wenn die Aufbewahrung schon ueber einen Retention-`DELETE` laeuft (sonst loescht BQ ungewollt mit).

**MySQL:**
- Der wichtigste Hebel ist der **Index**, nicht Partitionierung. Index auf die Join-/Filter-/`where`-Spalten der lesenden Pipelines + Dashboards setzen. **Primary/Unique Key** dort, wo idempotent ge-upsertet wird (`insert … on duplicate key update`).
- **MySQL-Tabellenpartitionierung** ist im Repo selten noetig — nur bei sehr grossen Tabellen mit Range-Pruning nach Datum oder fuer Retention per `drop partition`. Im Normalfall reichen Index + das `atomic_swap`-Pattern.

**Live pruefen** (BigQuery): `INFORMATION_SCHEMA.COLUMNS` zeigt `is_partitioning_column` und `clustering_ordinal_position`; oder `get_table_info` ueber das BigQuery-MCP.

### Schritt 4: Self-Healing

**Pflicht-Schritt.** Gehe mit dem User aktiv die folgenden sechs Punkte durch, bevor die Pipeline fertiggestellt wird. Jeder Punkt ist entweder **umgesetzt**, **bewusst verworfen (mit Begruendung)** oder **als Follow-up-TODO im README festgehalten**. Frage pro Punkt, statt eine pauschale "willst du Self-Healing?"-Frage zu stellen — User entscheiden konkreter, wenn sie das Szenario vor Augen haben.

**4a) Staging-Leichen-Cleanup**

*Szenario:* Pipeline crasht zwischen Build und Swap, `<name>_tmp` / `<name>_old` bleiben liegen und blockieren den naechsten Lauf.

- MySQL: `MySQLClient.atomic_swap()` raeumt `_old` und ueberschreibt `_tmp` beim Retry bereits selbst. Bei eigenem Staging-Code dasselbe Verhalten implementieren.
- BigQuery: analog — `_tmp`-Tabelle am Anfang der Pipeline `create or replace` (ueberschreibt kommentarlos), `_old` am Ende verwerfen.
- Preflight-Check als Sicherheitsnetz: vor Build pruefen ob eine `_tmp` aelter als der letzte erfolgreiche Lauf existiert → loggen + droppen statt blind weiterarbeiten.

Frage an den User: *"Soll die Pipeline Staging-Leichen vom letzten Crash beim Start selbstaendig aufraeumen?"* — Default: **ja, solange kein Lock-Konflikt-Risiko besteht.**

**4b) Stuck-Lock-Recovery**

*Szenario:* Prozess wird per OOM / kill -9 / Server-Reboot abgeschossen, Lockfile bleibt liegen → naechster Lauf exited sauber mit "already running" und die Pipeline steht dauerhaft.

- `utils/job_runner.py` nutzt `fcntl.flock` → Kernel gibt den Lock beim Prozess-Tod automatisch frei. **Stuck-Lock ist damit bei `exclusive=True` bereits geloest.**
- Achtung bei selbstgebauten Lockfiles (`basefeatured`-Pattern): dort muss die PID im Lockfile stehen und beim Start mit `os.kill(pid, 0)` geprueft werden, ob der Prozess noch lebt. Tote PID → Lockfile droppen und uebernehmen.

Frage an den User: *"Nutzt diese Pipeline `exclusive=True` (Kernel-Lock) oder einen shared Lockfile? Bei shared: PID-Liveness-Check einbauen?"*

**4c) Self-Heal auf transiente API-Fehler**

*Szenario:* Google-API / MySQL / externe REST-API liefert kurzzeitig 500 / Timeout / `ConnectionResetError`. Ohne Retry faellt die Pipeline, obwohl 30 Sekunden spaeter alles wieder laeuft (siehe `datev_budget` 500 vom 2026-04-21).

- Retry-Loop **im Python-Script** gehoert um jede externe I/O-Grenze (API-Call, Remote-DB-Query). Patterns:
  - `tenacity`: `@retry(stop=stop_after_attempt(5), wait=wait_exponential(min=4, max=60), retry=retry_if_exception_type((RequestException, 5xx)))`
  - Manuell: `for attempt in range(5): try: ... except TransientError: sleep(2**attempt); continue`
- **Wichtig:** nur transiente Fehler retryen (5xx, Timeouts, Connection-Reset, Rate-Limits mit `Retry-After`). 4xx-Client-Errors, Auth-Errors, Schema-Errors sind **keine** transienten Fehler und duerfen nicht still wiederholt werden.
- `utils/bigquery.py` und `utils/mysql.py` haben eigene Retries eingebaut — nur fuer **externe** APIs (Datev, Hubspot, Featureos, Slack, etc.) selber bauen.

Frage an den User: *"Welche externen APIs ruft die Pipeline auf? Pro API: ist ein 5xx / Timeout tolerierbar oder muss er den Lauf failen?"* — Default: **Retry mit Exponential Backoff um jede externe API.**

**4d) Idempotenz-Pflicht**

*Szenario:* Pipeline wird mit demselben Input zweimal gestartet (Crash-Retry, manuell nachgezogen, Cron-Doppelsprung) → Duplikate in der Zieltabelle, falsche Aggregate.

- DB-Writes idempotent: `DELETE WHERE date = @date` vor `INSERT`, oder `MERGE` / `INSERT ... ON DUPLICATE KEY UPDATE`, oder `CREATE OR REPLACE TABLE`.
- API-Seiteneffekte idempotent: beim zweiten Lauf nichts doppelt verschicken (Slack, Jira, Mails). Wenn nicht natuerlich idempotent → Ledger-Tabelle mit "bereits gesendet"-Markern.
- Test: *"Wenn ich den Job sofort nochmal starte, ist das Ergebnis identisch?"* Muss `ja` sein, sonst nicht idempotent.

Frage an den User: *"Ist jeder Write der Pipeline idempotent? Was passiert bei zweitem Lauf mit demselben @date?"* — Default: **pflicht, nicht verhandelbar.** Ohne Idempotenz kein Merge.

**4e) Schema-Drift-Toleranz**

*Szenario:* Upstream (MySQL-Quelle, API-Response, CSV-Import) bekommt eine neue Spalte oder eine bestehende wird optional. Die Pipeline explodiert mit `KeyError` / `column not found`.

- BigQuery-Writes: `schema_update_options=['ALLOW_FIELD_ADDITION']` beim Load-Job, oder explizit `autodetect=True` bei neuen Tabellen.
- MySQL-Inserts: Spalten explizit aufzaehlen (`insert into t (a,b,c) values ...`), niemals `insert into t values (...)` — schuetzt gegen neue Spalten in der Mitte.
- API-Responses: `dict.get('key', default)` statt `dict['key']` fuer Felder, die optional sein koennen. Unbekannte Felder **loggen statt crashen**.
- Harte Schema-Changes (Typ-Wechsel, Umbenennung, Loeschung) muessen trotzdem failen — nur additive Aenderungen tolerieren.

Frage an den User: *"Welche Felder der Quelle sind stabil, welche koennen sich aendern? Bei additiver Aenderung: durchlassen oder failen?"* — Default: **additive Aenderungen tolerieren und warnen, Breaking Changes failen.**

**4f) Backfill-Window statt nur "gestern"**

*Szenario:* Pipeline laedt taeglich nur `@date = yesterday`. Faellt sie drei Tage aus (Wartung, Proxy-Ausfall, Silent-Fail), fehlen drei Tage dauerhaft. Manuelles Nachziehen noetig.

- Pattern: Pipeline laedt ein **Lookback-Fenster** (z.B. letzte 7/14/30 Tage) mit idempotentem Upsert. Ein Tag Ausfall heilt sich beim naechsten Lauf automatisch.
- Trade-off: laengeres Fenster = mehr Last, aber robusteres System. Sweet Spot pro Pipeline:
  - Stabile Quelle, teurer Rebuild → kurzes Fenster (3–7 Tage)
  - Flakey Quelle, guenstiger Rebuild → langes Fenster (14–30 Tage)
  - Append-only, sehr teurer Rebuild → nur `yesterday`, dafuer Monitoring fuer Luecken
- CLI: `--days <N>` oder `--from <date> --to <date>` fuer manuellen Backfill.

Frage an den User: *"Wie gross soll das Lookback-Fenster sein? Oder strikt nur `yesterday` — und wenn ja, wie entdecken wir Luecken?"* — Default: **mindestens 3 Tage Lookback, sofern die Quelle unveraenderliche Werte fuer vergangene Tage liefert.**

**Dokumentation:** Die getroffenen Entscheidungen (was umgesetzt, was bewusst weggelassen, warum) im Pipeline-README kurz festhalten — damit der naechste Mensch am Code versteht, warum z.B. kein Backfill existiert.

### Schritt 5: Tests

**Pflicht-Schritt.** Nicht ueberspringen — `/pipeline-validate` prueft darauf und flagged fehlende Tests als WARN. Den User aktiv fragen, statt nur passiv zu erwaehnen.

**Entscheidungslogik:**

1. Schaue dir den gerade erstellten Code an. Gibt es **nicht-triviale Transformationslogik in Python** (Parsing, Mapping, Aggregation, Filter-Regeln, Datumsberechnungen, mehr als reine Glue-Aufrufe an `utils.mysql`/`utils.bigquery`/externe APIs)?
2. **Ja** → Tests erstellen. Default: **einen Teststub anlegen und umsetzen**, nicht nur vorschlagen. User-Frage: *"Ich lege `<pfad-zu-test>` mit Tests fuer die Transformationslogik an — OK, oder willst du es selbst schreiben?"*
3. **Nein** (reine SQL-Pipeline via `execSql.py`, trivialer Wrapper-Code ohne eigene Logik) → explizit dokumentieren: im README-Abschnitt oder als Kommentar im run.py *"Keine Tests: reine SQL-Pipeline, Logik liegt in `<sql-datei>` und wird via `--dry-run` / `/pipeline-validate` geprueft."* — damit `/pipeline-validate` das als bewusste Entscheidung einordnen kann.

**Ort der Testdatei:**

- Separates Test-Verzeichnis: `tests/<pipeline-name>/test_*.py` — wenn die Pipeline komplex ist und mehrere Testdateien sinnvoll sind (Beispiele: `tests/octopus/`, `tests/datalake/`, `tests/utils/job_runner/`)
- Test-Datei neben der Pipeline: `<pfad>/<name>_test.py` — fuer einfache Testfaelle (Beispiele: `billing20/balance/balance_test.py`, `hubspot/personio_test.py`)

**Mindest-Stub** (anlegen, wenn der User nicht selbst schreibt):

```python
"""Tests for <name> pipeline."""
import sys
sys.path.insert(0, '/usr/local/etl-scripts')

# TODO: import the pure transformation functions from the pipeline module
# from <pfad>.<modul> import <transformation_fn>


def test_<something>():
    # TODO: cover the core transformation with a fixture
    pass
```

Stub ist **kein** Abschluss — beim gemeinsamen Durchlauf des Codes mindestens **einen echten Test** ausformulieren, der die Kern-Transformation abdeckt. Ein leerer `pass`-Test zaehlt nicht als "Tests vorhanden".

**Ausfuehren:**

```bash
# pytest (3.12-venv, Default fuer neue Pipelines)
/usr/local/etl-scripts/venv/bin/pytest tests/<pipeline-name>/
# oder direkt (3.7-miniconda, Legacy)
python3 tests/<pipeline-name>/test_<something>.py
```

**Was getestet werden sollte:**
- Reine Transformationslogik (ohne DB/API-Calls → mocks/fixtures)
- SQL-Validierung falls nicht ueber `--dry-run` abgedeckt
- Edge-Cases die in der Production-Historie aufgetreten sind (als Regression-Tests)
- Die in Schritt 4 getroffenen Self-Healing-Entscheidungen, wenn sie testbar sind (z.B. dass ein Retry-Wrapper tatsaechlich retryed, dass eine `.get()`-Schemadrift-Toleranz funktioniert)

**Was NICHT getestet werden sollte:**
- Echte DB-Queries / API-Calls im CI — dafuer ist der manuelle Test auf `analytics-db01` da
- Triviale Getter/Setter oder Wrapper-Code

Sprich mit dem User konkret: *"Ich sehe folgende nicht-triviale Logik in `<datei>:<funktion>` — ich schreibe dazu einen Test."* Keine "Tests generell sinnvoll"-Frage — die wird abgewunken.

### Schritt 6: Crontab-Eintrag

Die aktuelle Crontab lesen (`etc/crontab/crontab`) und einen passenden Zeitslot vorschlagen:

- **Nicht zur vollen Stunde (:00)** — dort laufen schon viele Jobs
- **Abhaengigkeiten beachten** — falls die Pipeline Daten von anderen braucht
- Crontab-Eintrag dem User zeigen und erst nach Bestaetigung einfuegen

Format:
```cron
# <name> - <Beschreibung>
<minute> <hour> * * * /usr/local/etl-scripts/<pfad>/run.py
```

### Schritt 7: Validierung

Dem User vorschlagen, die neue Pipeline mit `/pipeline-validate <pfad>` gegen alle Konventionen zu pruefen. Die Checkliste lebt in `docs/pipelines/neue-pipeline-erstellen.md` Abschnitt 12.

### Schritt 8: Refactoring — /simplify ueber den gesamten neuen Code

**Pflicht-Schritt am Ende, bevor die Pipeline als fertig gilt.** Nachdem alle Dateien geschrieben sind, `run.py`, Script(s), SQL, Tests und README gemeinsam noch einmal mit dem `/simplify`-Skill pruefen.

Ziel:
- Reuse: gibt es schon einen Helper in `utils/` den der neue Code dupliziert?
- Qualitaet: verstaendliche Namen, keine toten Pfade, keine ueberfluessigen Kommentare
- Effizienz: unnoetige DB-Round-Trips, N+1-Loops, redundante Berechnungen
- Konsistenz mit den Self-Healing-Entscheidungen aus Schritt 4 (sind die Retries wirklich nur um die richtigen Calls? Ist die Idempotenz an jedem Write eingehalten?)

Ausfuehrung: nach Abschluss von Schritt 7 den `/simplify`-Skill aufrufen und die gefundenen Verbesserungen direkt umsetzen. Erst danach ist die Pipeline fertig.

### Schritt 9: Zusammenfassung

Dem User ausgeben:
- Erstellte Dateien
- Loki-Service-Label: `etl-<name>` (wird von `/pipeline-check` ueberwacht)
- Crontab-Eintrag (falls hinzugefuegt)
- Welche Self-Healing-Mechanismen aus Schritt 4 umgesetzt wurden (und welche bewusst weggelassen, mit Begruendung)
- **Naechste Schritte:**
  - `/pipeline-validate <pfad>` ausfuehren fuer den vollstaendigen Konventions-Check
  - `/simplify` auf alle neu erstellten Dateien (falls in Schritt 8 noch nicht erfolgt)
  - Lokal mit Dry-Run testen (falls Schritt 3f umgesetzt)
  - Auf `analytics-db01` testen: `ssh analytics-db01.live.sipgate.net "/usr/local/etl-scripts/<pfad>/run.py"`
  - Nach Push: In Grafana Pipeline Monitor pruefen
  - Erinnerung: Jeder Push auf `main` deployt sofort auf Production

## Hinweise

- **Kein Staging:** Jeder Push deployt. Immer vorher auf analytics-db01 testen.
- **Legacy-Module vermeiden:** Kein `utils/log.py`, kein `utils/database.py`.
- **Keine Shell-Wrapper:** Immer run.py mit Job-Context-Manager.
- **Retries:** Scripts die `MySQLClient`/`BigQueryClient` nutzen brauchen kein `retry_all=True` (die Module haben eigene Retries). Default `retries=2` reicht.
- Sprache: Ausgabe auf Deutsch, Code-Kommentare und Logs auf Englisch.
