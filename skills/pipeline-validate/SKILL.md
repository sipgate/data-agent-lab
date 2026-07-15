---
name: pipeline-validate
description: Prueft eine bestehende ETL-Pipeline gegen die Repository-Konventionen (Checkliste aus docs/pipelines/neue-pipeline-erstellen.md) — Nutzen wenn eine bestehende Pipeline gegen die Konventionen geprueft werden soll.
user-invocable: true
argument-hint: Pfad zur Pipeline z.B. "featureos" oder "aggregation/accountData"
allowed-tools: Read, Bash, Glob, Grep
---

# Pipeline validieren

**Wann nutzen:** Wenn eine bestehende ETL-Pipeline gegen die Repository-Konventionen geprueft werden soll.

Pruefe eine bestehende ETL-Pipeline gegen die Checkliste in `docs/pipelines/neue-pipeline-erstellen.md` (Abschnitt 12: "Checkliste: Pipeline-Launch").

## Argument parsen

- Falls ein Pfad angegeben: Pipeline-Verzeichnis ist `/usr/local/etl-scripts/<argument>/`
- Falls kein Argument: User fragen welche Pipeline geprueft werden soll
- Pipeline-Name aus dem letzten Pfadsegment ableiten

## Ablauf

1. Lies `docs/pipelines/neue-pipeline-erstellen.md` Abschnitt 12 fuer die aktuelle Checkliste
2. Fuehre fuer jeden Punkt den passenden automatischen Check aus (siehe unten)
3. Gib eine strukturierte Ergebnistabelle aus

## Automatische Checks

Fuer jeden Checklisten-Punkt den passenden Befehl ausfuehren. Ergebnis pro Check: **PASS**, **WARN** oder **FAIL**.

### Vorbereitung

| Checklisten-Punkt | Check-Methode |
|---|---|
| Verzeichnis angelegt | Glob: Pipeline-Pfad existiert |
| run.py mit Job-Wrapper | Read run.py, Grep nach `with Job(__file__` und `name=` Parameter |
| Pipeline-Script oder SQL | Glob nach `*.py` und `*.sql` im Verzeichnis |
| SQL-Keywords lowercase | Grep in allen `.sql` Dateien nach uppercase `SELECT\|FROM\|WHERE\|JOIN\|GROUP BY\|ORDER BY\|INSERT\|DELETE\|UPDATE\|CREATE\|DROP\|ALTER` — **WARN** bei Treffern |
| Shebang korrekt | Read Zeile 1 von run.py. Neue Scripts: `#!/usr/local/etl-scripts/venv/bin/python3` (Python 3.12). Bestehende Scripts: `#!/usr/local/etl-scripts/libs/miniconda3/bin/python3` (Python 3.7) — beide akzeptiert, **WARN** bei anderem Shebang. |
| sys.path.insert | Grep in run.py (oder Haupt-Script) nach `sys.path.insert(0, '/usr/local/etl-scripts')` |
| Keine Secrets im Code | Grep nach hardcodierten Passwoertern, API-Keys in .py Dateien — **FAIL** bei Treffern |

### Datenbankzugriff

| Checklisten-Punkt | Check-Methode |
|---|---|
| Korrekte Module | Grep nach `from utils.mysql import` oder `from utils.bigquery import` — **PASS** wenn gefunden |
| Keine Legacy-Module | Grep nach `from utils.log import` und `from utils.database import` — **FAIL** bei Treffern |
| Idempotente Queries | In `.sql` Dateien pruefen ob vor `insert` ein `delete` steht — **WARN** wenn nur INSERT ohne DELETE |

### Test

| Checklisten-Punkt | Check-Methode |
|---|---|
| Syntax-Check | `python3 -c "import py_compile; py_compile.compile('<datei>', doraise=True)"` fuer alle `.py` Dateien |
| Executable | `ls -la run.py` pruefen ob `x`-Bit gesetzt — **FAIL** wenn nicht |

### Deployment

| Checklisten-Punkt | Check-Methode |
|---|---|
| Crontab-Eintrag | Grep in `etc/crontab/crontab` nach dem Pipeline-Pfad — **FAIL** wenn nicht gefunden |
| Zeitslot | Minute aus Crontab-Eintrag parsen — **WARN** bei `:00` (ueberfuellter Slot) |

### Zusaetzliche Checks (nicht in der Checkliste, aber wichtig)

| Check | Methode |
|---|---|
| Naming Convention | Pipeline-Name pruefen: nur lowercase oder camelCase (Regeln aus `docs/pipelines/naming-conventions.md`) — **FAIL** bei snake_case, kebab-case, PascalCase |
| Shell-Wrapper | Glob nach `*.sh` im Verzeichnis — **WARN** bei vorhandenen Shell-Wrappern |
| Silent Exceptions | Grep nach `except.*:\s*pass` in `.py` Dateien — **FAIL** bei stummen Exception-Handlern |
| Loki-Label | `name=` Parameter aus Job-Aufruf extrahieren, resultierendes Label `etl-<name>` anzeigen — **WARN** wenn name nicht zum Verzeichnisnamen passt |
| Datenherkunft in der Zieltabelle | Wenn die Pipeline eine **neue** Zieltabelle anlegt (BigQuery: `load_dataframe` auf neue Tabelle, `create or replace table`, `create table`; MySQL: `create table`): pruefen ob eine Table-`description`/`comment` mit Quellangabe gesetzt wird. Grep nach `options(description` / `comment =` (BQ-DDL) bzw. `comment '` / `comment =` (MySQL) **oder** einem `CREATE_TABLE_SQL`-Konstrukt. Fehlt → **WARN** "Zieltabelle ohne Provenienz-Metadaten — Quellsystem/Pipeline/Ticket in die Table- und Spalten-`description` schreiben (siehe `/pipeline-new` Schritt 3g)". Live gegen BigQuery pruefbar: `get_table_info` ueber das BigQuery-MCP zeigt, ob `description` gesetzt ist |
| Partitionierung / Clustering (BigQuery) | Wenn die Pipeline eine BQ-Tabelle schreibt: live pruefen via `INFORMATION_SCHEMA.COLUMNS` (`is_partitioning_column`, `clustering_ordinal_position`) oder `get_table_info`. **WARN** wenn die Tabelle einen Datums-/Zeitbezug hat (Spalte wie `*Date`/`*date`/`eventTime`, `@date`-Pipeline) **und nicht** danach partitioniert ist ("Zeitreihen-/Snapshot-Tabelle ohne Partitionierung — Partition-Pruning + partitionsweiser Retention-DELETE fehlen, siehe `/pipeline-new` Schritt 3h"). **WARN** wenn **Clustering auf einer kleinen Tabelle** gesetzt ist (Partitionen << 1 GB / wenige Zeilen pro Tag — "Clustering ohne Nutzen, nur Ballast"). Statisch: grep nach `clustering_fields=`/`cluster by` und `date_col=`/`partition by` im Code zur Plausibilisierung |
| Indizes (MySQL) | Wenn die Pipeline eine MySQL-Zieltabelle schreibt, die von anderen Pipelines/Dashboards gelesen wird (grep im Repo nach dem Tabellennamen): pruefen ob auf den Filter-/Join-Spalten ein Index existiert (`show index from <t>` bzw. `create table`-DDL) und ob bei `insert … on duplicate key update` ein passender Unique/Primary Key da ist. Fehlt → **WARN** "MySQL-Zieltabelle ohne Index auf Filter-/Join-Spalten bzw. ohne Unique-Key fuer idempotenten Upsert" |

### Self-Healing & Robustheit

Patterns aus `/pipeline-new` Schritt 4 (4a–4f) plus Zero-Downtime / Dry-Run / Tests. **Die Checks melden WARN, nicht FAIL** — nicht jede Pipeline braucht jedes Pattern, aber das Fehlen sollte bewusst sein. In der Zusammenfassung am Ende die Anzahl umgesetzter Self-Healing-Kategorien als "Self-Healing-Score X/6" ausgeben (4a–4f).

| Check | Methode |
|---|---|
| Staging / Zero-Downtime | In `.py`/`.sql` nach `truncate table`, `drop table` (nicht-`_tmp`/`_old`), `write_mode='WRITE_TRUNCATE'` auf Nicht-Staging-Tabellen suchen. Wenn gefunden **und** die betroffene Tabelle von anderen Pipelines oder Dashboards gelesen wird (grep im Repo nach dem Tabellennamen → mehr als nur die Pipeline selbst) → **WARN** "Vollrebuild auf Live-Tabelle, Staging-Pattern pruefen (`MySQLClient.atomic_swap` / `BigQueryClient.atomic_swap` oder `create or replace table`)" |
| **4a Staging-Leichen-Cleanup** | Bei Pipelines mit Staging (`_tmp`-Schreibzugriff gefunden): pruefen ob am Anfang der Pipeline ein `create or replace table <tmp>` (BigQuery) oder `drop table if exists <tmp>`/`MySQLClient.atomic_swap` (MySQL — raeumt `_old` selbst) verwendet wird. Fehlt das → **WARN** "Staging-Pattern raeumt nicht selbst auf, Crash zwischen Build und Swap blockiert naechsten Lauf". Zusaetzlich: `information_schema`-Check auf `<tabellenname>_tmp`/`_old`/`_new` aelter als 48h → **WARN** mit Tabellenname (siehe `/pipeline-check` Schritt 1f) |
| **4b Stuck-Lock-Recovery** | In `run.py` nach `exclusive=True` im `Job(...)`-Aufruf **oder** nach `fcntl.flock`/Lockfile-Pattern suchen. Fehlt beides **und** die Pipeline laeuft haeufiger als einmal pro Stunde (Crontab-Frequenz pruefen) **oder** kann laenger als ihr Cron-Intervall laufen → **WARN** "Kein Doppellauf-Schutz — `exclusive=True` im `Job()` pruefen". Wenn **shared Lockfile** (eigenes `fcntl.flock` auf `/tmp/*.lock`): pruefen ob PID ins Lockfile geschrieben wird und beim Start mit `os.kill(pid, 0)` geprueft wird → **WARN** "Shared Lockfile ohne PID-Liveness-Check — tote PID blockiert naechsten Lauf dauerhaft" |
| **4c Self-Heal transiente API-Fehler** | Wenn die Pipeline externe HTTP-APIs aufruft (grep nach `requests.`, `http.client`, `urllib`, `googleapiclient`, `hubspot`, `slack_sdk` etc.) pruefen ob ein Retry-Mechanismus drumrum liegt: grep nach `tenacity`, `@retry`, `for attempt in range`, `while retries`. Fehlt → **WARN** "Externer API-Call ohne Retry — transiente 5xx/Timeouts failen die Pipeline (siehe `datev_budget` 500-Incident)". Ausnahme: `utils/bigquery.py`/`utils/mysql.py` bringen eigene Retries mit — nicht doppelt pruefen |
| **4d Idempotenz** | SQL: in `.sql` Dateien pruefen ob vor `insert` ein `delete where ...` oder ein `MERGE`/`insert ... on duplicate key update`/`create or replace table` steht. Fehlt → **WARN** "SQL-Write nicht idempotent — Zweitlauf produziert Duplikate". Python-Seiteneffekte: wenn die Pipeline Slack/Jira/Mail versendet, grep nach "ledger"/"sent"/"marker"-Tabellen oder Deduplizierung. Fehlt bei seitenwirksamer Pipeline → **WARN** "API-Seiteneffekte nicht idempotent — Wiederanlauf sendet doppelt" |
| **4e Schema-Drift-Toleranz** | Python: grep nach harten dict-Zugriffen `row['feld']` vs `row.get('feld')`, Tuple-Unpacking aus API-Responses. Wenn viele harte Zugriffe **und** Quelle ist externe API → **WARN** "Harte Feldzugriffe, Schema-Aenderung der Quelle laesst Pipeline crashen — `.get()` mit Default verwenden". BigQuery-Loads: grep nach `ALLOW_FIELD_ADDITION` / `schema_update_options`. Fehlt bei Load-Jobs auf bestehende Tabelle → **WARN** "BQ-Load ohne `ALLOW_FIELD_ADDITION` — neue Spalten in der Quelle failen den Job". MySQL: grep nach `insert into <tabelle> values` ohne Spaltenliste → **WARN** "INSERT ohne Spaltenliste — Schema-Aenderung laesst Inserts falsch landen" |
| **4f Backfill-Window** | Wenn `@date`-Placeholder oder `yesterday`-Pattern in der Pipeline: pruefen ob ein Lookback-Loop (`for days_back in range(...)`, `--days`-CLI-Arg, `--from`/`--to`) existiert. Reine `yesterday`-Pipelines ohne Gap-Monitoring → **WARN** "Laedt nur `yesterday` — dreitaegiger Ausfall fuehrt zu dauerhaften Luecken, Lookback-Fenster erwaegen". Bei append-only-Pipelines ist das ok, dann im Detail der WARN-Meldung erwaehnen ("ok fuer append-only, sonst Gap-Monitoring einbauen") |
| Dry-Run / Test-Mode | In allen `.py` Dateien der Pipeline nach argparse-Argumenten `--dry-run`, `--query-only`, `--test-mode`, `--list` suchen. Wenn keines gefunden **und** die Pipeline nicht nur reines SQL ueber `execSql.py` ist → **WARN** "Kein sicherer Testmodus — erschwert lokales Testen auf analytics-db01" |
| Tests | Glob nach `tests/<pipeline-name>/test_*.py` **oder** `<pipeline-pfad>/*_test.py` **oder** `<pipeline-pfad>/test_*.py`. Wenn nichts gefunden **und** die Pipeline nicht-triviale Transformationslogik hat (>100 Zeilen Python) → **WARN** "Keine Tests — Regressionen schwer zu erkennen" |

## Ergebnis ausgeben

Strukturierte Tabelle:

```
Pipeline: <name>
Verzeichnis: <pfad>
Loki-Label: etl-<name>

  #   Check                  Status   Details
  1   Naming Convention      PASS     "featureos" (lowercase)
  2   run.py vorhanden       PASS     featureos/run.py
  3   Shebang                PASS     miniconda3 python3
  ...
```

Zusammenfassung am Ende:
- **X PASS, Y WARN, Z FAIL**
- **Self-Healing-Score: N/6** — wie viele der sechs Kategorien (4a Staging-Cleanup, 4b Lock-Recovery, 4c API-Retry, 4d Idempotenz, 4e Schema-Drift, 4f Backfill) umgesetzt sind. Unter 4/6 → Hinweis auf `/pipeline-new` Schritt 4 zum Nachruesten
- Bei FAILs: konkrete Handlungsempfehlung
- Bei WARNs: Hinweis zur Verbesserung

## Hinweise

- Prueft Konventionen, nicht Logik oder Datenqualitaet
- Die Checkliste in `docs/pipelines/neue-pipeline-erstellen.md` ist die Single Source of Truth — wenn dort ein Punkt ergaenzt wird, diesen Skill entsprechend erweitern
- Umgekehrt: Wenn `/pipeline-new` um neue Patterns erweitert wird (Staging, Doppellauf-Schutz, Dry-Run, Tests, Self-Healing-Kategorien etc.), den Abschnitt "Self-Healing & Robustheit" hier synchron halten
- Sprache: Ausgabe auf Deutsch
