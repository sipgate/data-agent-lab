---
name: metadata-tariff-backup
description: Erstellt ein mysqldump-Backup der Tabelle metadata.tariff (Schema + Daten) in metadata/tariff/backups/ mit datiertem Dateinamen, verifiziert es gegen die Live-Zeilenzahl und bietet optional einen Commit an.
user-invocable: true
argument-hint: Optional "commit" um nach Verifikation direkt mit [no-ticket] zu committen
allowed-tools: Bash, Read, mcp__mysql-dwh__execute_sql
---

# metadata.tariff Backup

Sichert die manuell gepflegte Dimensionstabelle `metadata.tariff` (mysql-dwh) als `mysqldump` in `metadata/tariff/backups/`. Sinnvoll **vor** jeder schreibenden Aenderung an der Tabelle — z.B. vor [`/metadata-tariff-fill`](../metadata-tariff-fill/SKILL.md).

## Konvention

- **Zielverzeichnis:** `/usr/local/etl-scripts/metadata/tariff/backups/`
- **Dateiname:** `$(date +%Y-%m-%d-%H.%M.%S)_tariff.sql` (wie das alte `tariff_dump.sh`, aber gegen den aktuellen DWH-Host statt `schlitz`)
- **Inhalt:** Schema (`CREATE TABLE`) + alle Daten
- Die vorhandenen Backups in dem Verzeichnis sind in Git eingecheckt; der Dump ist **nicht** gitignored.

## Umgebung / Credentials

Die `metadata`-DB liegt auf `analytics-db01.live.sipgate.net`. Credentials aus `etc/config.ini`:

- Auf dem Server (`hostname` enthaelt `analytics-db01`): Sektion `[analytics_etl]` (user `etl`).
- Auf einer Workstation mit Netzzugang zu `analytics-db01:3306`: Sektion `[analytics_arens]` (user `arens`).

Das Passwort **nie** auf der Kommandozeile uebergeben (waere in `ps` sichtbar). Stattdessen eine temporaere `--defaults-extra-file` schreiben (chmod 600) und nach dem Dump loeschen.

## Ablauf

### Schritt 1 — Vorbedingungen pruefen

```bash
echo "hostname: $(hostname)"
command -v mysqldump >/dev/null || echo "FEHLT: mysqldump"
nc -zv -w3 analytics-db01.live.sipgate.net 3306 2>&1 | tail -1   # Erreichbarkeit
```

Falls `analytics-db01` im Hostnamen steckt, Sektion `analytics_etl` verwenden, sonst `analytics_arens`.

### Schritt 2 — Live-Zeilenzahl merken (fuer Verifikation)

Via MCP: `select count(*) from metadata.tariff;` — diesen Wert fuer Schritt 4 merken.

### Schritt 3 — Dump erstellen

```bash
cd /usr/local/etl-scripts/metadata/tariff/backups
SECTION=analytics_arens   # bzw. analytics_etl auf dem Server
CNF=$(mktemp); trap 'rm -f "$CNF"' EXIT
python3 -c "
import configparser
c=configparser.ConfigParser(); c.read('/usr/local/etl-scripts/etc/config.ini')
s=c['$SECTION']
print('[client]'); print('host='+s['host']); print('user='+s['user']); print('password='+s['pass'])
" > "$CNF"; chmod 600 "$CNF"
OUT="$(date +%Y-%m-%d-%H.%M.%S)_tariff.sql"
mysqldump --defaults-extra-file="$CNF" --single-transaction --no-tablespaces --skip-comments metadata tariff > "$OUT"
echo "written: $OUT"; ls -la "$OUT"
```

- `--single-transaction`: konsistenter Snapshot ohne Schreib-Lock.
- `--no-tablespaces`: vermeidet die `PROCESS`-Privileg-Anforderung neuerer mysqldump-Versionen.
- `--skip-comments`: schlankerer Dump (keine Server-Kommentar-Zeilen).
- Die Meldung `Warning: column statistics not supported by the server` ist **harmlos** (mysqldump-Client neuer als der MySQL-5.7-Server).

### Schritt 4 — Verifizieren

```bash
OUT=<dateiname>
grep -c 'CREATE TABLE `tariff`' "$OUT"          # muss 1 sein
python3 -c "
import re
d=open('$OUT',encoding='utf-8').read()
t=sum(ins.count('),(')+1 for ins in re.findall(r'INSERT INTO \`tariff\` VALUES (.+);', d))
print('tuples:', t)
"
```

Die `tuples`-Zahl muss der Live-Zeilenzahl aus Schritt 2 entsprechen. (Standard-`mysqldump` nutzt extended-insert → meist **eine** `INSERT`-Zeile mit allen Tupeln, daher Tupel via `),(` zaehlen, nicht `INSERT`-Statements.) Optional eine zuletzt geaenderte Zeile stichprobenartig im Dump suchen, um den aktuellen Stand zu bestaetigen.

### Schritt 5 — Bericht + optionaler Commit

Pfad, Groesse und verifizierte Zeilenzahl ausgeben. Wenn der Skill mit Argument `commit` aufgerufen wurde **und** die Verifikation ok ist, committen — sonst nur anbieten:

```bash
cd /usr/local/etl-scripts
git add metadata/tariff/backups/<dateiname>
git commit -m "backup: metadata.tariff Dump <datum> [no-ticket]

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push origin main
```

Ein Daten-Dump ins Git ist eine Veroeffentlichung — vor dem Commit bestaetigen lassen, ausser `commit` wurde explizit als Argument uebergeben. `metadata.tariff` enthaelt nur Tarif-Klassifizierung (keine Kundendaten/Secrets), und die vorhandenen Backups sind ebenfalls eingecheckt.

## Hinweise

- **Restore:** `mysql --defaults-extra-file=<cnf> metadata < backups/<datei>.sql` (der Dump enthaelt `DROP TABLE IF EXISTS` + `CREATE TABLE`). Restore ist eine schreibende Production-Aenderung — nur nach expliziter Bestaetigung.
- Sprache: Code/SQL englisch, Ausgabe an den User deutsch (siehe CLAUDE.md).

## See Also

- [Skill metadata-tariff-fill](../metadata-tariff-fill/SKILL.md) — fuellt leere Zeilen; vorher dieses Backup laufen lassen.
- [Concept metadata.tariff auffuellen](/usr/local/etl-scripts/wiki/concepts/metadata-tariff-fill.md)
- `metadata/tariff/backups/tariff_dump.sh` — das urspruengliche (veraltete) Dump-Script (Host `schlitz`).
