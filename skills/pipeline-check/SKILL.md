---
name: pipeline-check
description: Prueft fehlgeschlagene ETL-Pipelines seit gestern 17 Uhr via Grafana Loki + Slack und zeigt Ursachen
user-invocable: true
argument-hint: Optional Zeitraum z.B. "48h" oder "heute" (Standard seit gestern 17 Uhr)
allowed-tools: mcp__grafana__query_loki_logs, mcp__grafana__list_datasources, mcp__claude_ai_Slack__slack_read_channel, mcp__claude_ai_Slack__slack_search_channels, mcp__claude_ai_Slack__slack_search_public_and_private, Bash, Read, Grep
---

# Pipeline Failure Check

Pruefe alle fehlgeschlagenen ETL-Jobs via Grafana Loki, ergaenze mit Kontext aus dem Slack-Channel `#data-engineering-monitoring` und erstelle einen strukturierten Fehlerbericht.

## Konfiguration

- **Loki-Datasource:** `loki-ix01` (UID: `c683e452-1ea5-4b20-bb80-0b7eca8b43dc`)
- Falls die UID sich geaendert hat: `list_datasources` mit type=loki aufrufen und `loki-ix01` suchen
- **Slack-Channels (IDs sind stabil — direkt verwenden, kein `slack_search_channels` noetig):**
  - `#data-engineering-monitoring` → `C04S1RXASTV`
  - `#airbyte-monitoring` → `C0ASJ07UMRQ`
  - Nur falls ein Read mit `channel_not_found` fehlschlaegt: per `slack_search_channels` neu aufloesen und die ID hier korrigieren.

## Zeitraum

- Standard: seit gestern 17:00 Uhr (lokale Zeit) bis jetzt — deckt beim morgendlichen Check alles seit Feierabend des Vortags ab
- Falls der User einen anderen Zeitraum als Argument uebergibt, passe start/end entsprechend an
- Berechne start/end als RFC3339, z.B. `date -d 'yesterday 17:00' --rfc-3339=seconds` (Unix-TS fuer Slack-`oldest`: `date -d 'yesterday 17:00' +%s`)

## Ablauf

### Schritt 1: Daten sammeln (parallel)

Die folgenden Abfragen (1a–1c sowie der Sanity-Check) sind unabhaengig und muessen in **einem** Tool-Block **parallel** gestartet werden. 1e/1f sind bedingt und laufen erst nachgelagert (siehe dort).

**1a) Slack** — Beide Channels parallel lesen, **auf das Zeitfenster begrenzt**:
- `#data-engineering-monitoring` (`C04S1RXASTV`) — ETL-Pipeline-Alerts und Fehler
- `#airbyte-monitoring` (`C0ASJ07UMRQ`) — Airbyte-Sync-Fehler und -Warnungen
- **Payload klein halten:** `oldest=<Unix-TS des Fensterstarts>` setzen und `response_format: "concise"` verwenden. `#airbyte-monitoring` schickt sehr lange, oft duplizierte Schema-Change-Nachrichten — ohne `oldest` werden 20 Nachrichten bis weit vor das Fenster gelesen (massiver Token-/Latenz-Verlust). `limit: 20` bleibt als Obergrenze ok, das Zeitfenster ist der eigentliche Filter.
- Relevante Nachrichten filtern: Bot-Alerts, Error-Keywords (`failed`, `error`, `OOM`, `timeout`, `down`, `sync failed`), Pipeline-/Service-Namen (`etl-*`, Airbyte-Connection-Namen).
- Reine Status-Updates oder Erfolgs-Meldungen ignorieren.

**Sanity-Check (im selben Parallel-Batch ausfuehren):** `query_loki_stats` mit dem reinen Selector `{service=~"etl-.*"}` ueber das Zeitfenster. Liefert Stream-/Entry-Count. Zweck: Wenn 1b/1c **leer** zurueckkommen, sofort unterscheiden zu koennen zwischen *"keine Fehler"* (Stats zeigen normale Log-Mengen, z.B. zehntausende Entries → **all clear**, so berichten) und *"Selector/Ingest kaputt"* (Stats = 0 → Labels/Datasource pruefen). Spart die sonst noetige zweite Verifikationsrunde.

**1a-2) Slack-Suche** — Parallel zur Channel-Lesung eine workspace-weite Suche via `slack_search_public_and_private` ausfuehren:
- Query: `analytics-db01 OR db-etl OR "etl failed" OR business-analytics-216810 OR data-integration-400516 OR metabase OR lookerstudio OR "looker studio" OR amplitude OR bigquery`
- Limit: 10 Ergebnisse
- Liefert Kontext aus anderen Channels (z.B. #infrastructure, #ops, #general), der in den Monitoring-Channels nicht auftaucht — etwa Server-Wartungen, Netzwerk-Probleme, BigQuery-/Metabase-/Looker-Ausfaelle oder manuelle Eingriffe.
- **Einschraenkung:** Die Suche findet nur Nachrichten in Channels, in denen der User Mitglied ist.
- Ergebnisse nach Zeitraum filtern (nur Nachrichten im abgefragten Zeitfenster beruecksichtigen).
- **Sortierung nach Relevanz:** Ergebnisse nach Engagement priorisieren — Nachrichten mit vielen Thread-Replies und Reaktionen (Emojis/Likes) zuerst, danach alle anderen. Hohe Aktivitaet deutet darauf hin, dass das Thema viele Leute betrifft oder aktiv diskutiert wird.

**1b) Loki — fehlgeschlagene Jobs:**

```logql
{service=~"etl-.*"} |= "Job failed"
```

Limit: 50, direction: backward, Zeitraum wie oben.

**1c) Loki — OOM-Kills:**

```logql
{service="etl-oom-kernel"}
```

Limit: 20, gleicher Zeitraum. OOM-Kills erscheinen nicht als "Job failed" und muessen separat abgefragt werden.

> **Hinweis (Laufzeiten):** Eine fruehere Stufe `{service=~"etl-.*"} |= "runtime_sec" | json | runtime_sec > 0` wurde entfernt — das Feld wird im aktuellen Logformat nicht so emittiert, die Query lieferte strukturell **immer** leer. Wieder aufnehmen erst, wenn das tatsaechliche Laufzeit-Logformat (Feldname/JSON-Struktur) verifiziert ist.

**1e) Proxy-Connectivity direkt auf dem Server pruefen:**

Falls in den Loki-Ergebnissen (1b) Fehler mit `ProxyError`, `ConnectionError`, `ConnectTimeout` oder `403 Forbidden` auftauchen, **direkt auf analytics-db01 die betroffenen URLs testen**:

1. Aus dem Fehlernamen den betroffenen Service identifizieren (z.B. `etl-featureos`)
2. Im Pipeline-Code (via `Grep`) die externen URLs/Domains finden die die Pipeline aufruft (z.B. `api.featureos.app`, `api.hubapi.com`)
3. Pro gefundener Domain einen Connectivity-Check ausfuehren:

```bash
ssh analytics-db01.live.sipgate.net "export HTTPS_PROXY=http://proxy.sipgate.net:8888; /usr/local/etl-scripts/libs/miniconda3/bin/python3 -c \"
import requests
try:
    r = requests.get('https://<DOMAIN>/', timeout=10)
    print('<DOMAIN>: HTTP', r.status_code, '(erreichbar)')
except requests.exceptions.ProxyError:
    print('<DOMAIN>: PROXY BLOCKED')
except Exception as e:
    print('<DOMAIN>:', type(e).__name__)
\""
```

**Ergebnis interpretieren:**
- HTTP 400/401/403/404 von der API → Proxy laesst durch, Domain ist freigeschaltet
- `PROXY BLOCKED` → Domain fehlt in der Proxy-ACL → Freischaltung noetig (siehe `docs/infra/proxy-config.md`)
- `ConnectionError` → Proxy-Server selbst nicht erreichbar

Falls **keine** Connectivity-Fehler in den Loki-Logs auftauchen, diesen Schritt ueberspringen.

**1f) Verwaiste Staging-Tabellen pruefen:**

Einige Pipelines nutzen das Zero-Downtime-Pattern (Build in `<tbl>_tmp`, dann atomic `RENAME TABLE` → live). Wenn der Build erfolgreich war aber der Swap crashte, bleiben `_tmp`/`_old`/`_new`-Tabellen liegen und blockieren den naechsten Lauf. Direkt auf `analytics-db01` pruefen:

```bash
ssh analytics-db01.live.sipgate.net "/usr/local/etl-scripts/libs/miniconda3/bin/python3 -c \"
import sys
sys.path.insert(0, '/usr/local/etl-scripts')
from utils.mysql import MySQLClient, Server, Db
with MySQLClient(Server.ANALYTICS, Db.BFD) as db:
    rows = db.fetchall(
        'select table_schema, table_name, create_time '
        'from information_schema.tables '
        \\\"where table_name regexp '_(tmp|old|new|staging)$' \\\"
        'order by create_time'
    )
    for r in rows: print(r)
\""
```

BigQuery: analog ueber `INFORMATION_SCHEMA.TABLES` in den relevanten Datasets (`business-analytics-216810`).

**Einordnung:**
- Tabelle aelter als der letzte erfolgreiche Pipeline-Lauf → Hinweis auf abgebrochenen Swap, im Bericht unter **Staging-Leichen** melden mit Verweis auf die betroffene Pipeline
- Tabelle juenger als der letzte Lauf → kann gerade in-flight sein, nur notieren

### Schritt 2: Unique Services extrahieren

Aus den Loki-Ergebnissen (1b + 1c) die eindeutigen `service`-Labels extrahieren. Das sind die Pipelines die gefailed sind. Bei OOM-Kills den betroffenen Prozessnamen aus der Log-Nachricht dem Service zuordnen.

**Zusaetzlich immer pruefen** — auch wenn 1b leer war: Der Service `etl-unknown` ist der Catch-all-Bucket fuer Logzeilen, die keiner Pipeline zugeordnet werden konnten. Echte Tracebacks landen dort haeufig mit `level="unknown"` (nicht `level="error"`). Einmal breit abfragen:

```logql
{service="etl-unknown"} |~ "Traceback|Exception|Error|killed"
```

Limit: 50, gleicher Zeitraum. Treffer in die Service-Liste fuer Schritt 3 aufnehmen.

### Schritt 3: Fehlerdetails pro Pipeline abfragen

Fuer jeden unique Service **parallel** die Fehlerdetails abfragen. **Nicht** auf `level="error"` allein verlassen — die Level-Labels sind unzuverlaessig (Fehler erscheinen auch als `level="unknown"`). Daher zuerst level-unabhaengig nach Traceback/Exception filtern:

```logql
{service="etl-SERVICENAME"} |~ "Traceback|Exception|Uncaught|Error"
```

und nur ergaenzend, falls das nichts liefert:

```logql
{service="etl-SERVICENAME", level="error"}
```

Limit: 5, gleicher Zeitraum. Daraus den konkreten Fehler (Exception, Traceback, Fehlermeldung) extrahieren.

**Vor dem Berichten gegen die Known-Noise-Liste (unten) abgleichen** — bekanntes, harmloses Rauschen nicht als Fehler melden.

### Schritt 4: Bericht erstellen

Fasse die Ergebnisse als strukturierte Liste zusammen, sortiert nach Schweregrad:

1. **OOM-Kills** zuerst (kritisch, Prozess wurde vom Kernel getoetet)
2. **Dauerfehler** (multiple Failures desselben Jobs)
3. **Einmalige Fehler**
4. **Unklare Fehler** (nur "Job failed" ohne Details) zuletzt

Pro Job ausgeben:
- **Jobname** und Zeitpunkt(e)
- **Ursache** (konkreter Error aus dem Traceback, oder "OOM-Kill" bei Kernel-Kill)
- **Kategorie** (OOM, Quota, Schema-Change, Proxy, Connectivity, Permission, fehlende Tabelle, Bug, unklar)
- **Haeufigkeit** (einmalig / wiederkehrend / Dauerschleife)

Falls Slack-Nachrichten aus Schritt 1a oder die workspace-weite Suche (1a-2) zusaetzlichen Kontext liefern (bekannte Ausfaelle, Server-Wartungen, Netzwerk-Probleme, manuelle Fixes, Hinweise von Kollegen), diesen beim jeweiligen Job erwaehnen oder als separaten Abschnitt **Slack-Kontext** anfuegen. Bei Treffern aus der Suche den Channel und Absender nennen, damit der Kontext nachvollziehbar ist.

Falls Schritt 1f **verwaiste Staging-Tabellen** gefunden hat (`_tmp`/`_old`/`_new` aelter als der letzte erfolgreiche Lauf), diese als eigenen Abschnitt **Staging-Leichen** anfuegen — pro Tabelle: Schema, Tabellenname, `create_time`, zugeordnete Pipeline und Empfehlung (manuell droppen oder naechsten Pipeline-Lauf abwarten, je nachdem ob die Pipeline das Re-Anlegen selbst handelt).

Am Ende eine kurze **Prioritaeten-Empfehlung** geben:
- OOM-Kills > Dauerfehler > Staging-Leichen (blockieren naechsten Lauf) > Proxy/Connectivity > Bugs > Infrastruktur > Transient

Bei **Proxy-Fehlern** konkret angeben:
- Welche Domain blockiert wird (aus der Fehlermeldung extrahieren)
- Verweis auf `docs/infra/proxy-config.md` fuer den Freischaltungsprozess
- Falls mehrere Pipelines gleichzeitig Proxy-Fehler haben → Proxy-Ausfall wahrscheinlicher als fehlende ACL

## Known Noise (nicht als Fehler melden)

Diese Log-Muster sind bekannt und **harmlos** — sie kennzeichnen keinen Job-Fehler. Im Bericht hoechstens als Randnotiz erwaehnen, nie als Fehler/Prioritaet:

- **`ImportError: file_cache is unavailable when using oauth2client >= 4.0.0 or google-auth`** (oft mit `ModuleNotFoundError: No module named 'oauth2client.locked_file'` / `oauth2client.contrib.locked_file` und Traceback aus `googleapiclient/discovery_cache/file_cache.py`). Bekanntes `googleapiclient`-Fallback auf dem Legacy-Python-3.7 (`libs/miniconda3`): Der Discovery-Client kann den File-Cache nicht laden, faengt das **intern ab** und laeuft ohne Cache weiter. Kein Abbruch (sonst gaebe es ein `Job failed`). Verschwindet mit der Migration nach `venv` (3.12).
- **Appfigures Daily Check** (`#data-engineering-monitoring`): Off-by-one wie "BigQuery has 1 more than API". Wiederkehrender, benigner Datenqualitaets-Check — kein Pipeline-Fehler.
- **Airbyte "schema changes detected / please review"** (`#airbyte-monitoring`): Informative Schema-Drift-Benachrichtigung (meist `HubSpot → BigQuery - Low Prio (daily)`), kein Sync-Fehler. Nur erwaehnen, wenn sie taeglich unbestaetigt wiederkehrt (dann Hinweis: in Airbyte approven oder dismissen).

## Hinweise

- LogQL unterstuetzt kein `or` zwischen Pipeline-Stages. Statt `|= "A" or |= "B"` separate Queries verwenden oder Regex: `|~ "A|B"`
- Proxy-Doku mit Domain-Whitelist und Freischaltungsprozess: `docs/infra/proxy-config.md`
- Sprache: Bericht auf Deutsch, wie in CLAUDE.md festgelegt
