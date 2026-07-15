---
name: wiki-lint
description: Wiki-Gesundheitscheck — findet Luecken, Widersprueche und verwaiste Seiten. Nutze bei regelmaessigem Gesundheitscheck.
user-invocable: true
argument-hint: "Optional: 'full' fuer ausfuehrlichen Check (Standard: quick)"
allowed-tools: Read, Glob, Grep, Edit, Write, Bash
---

# Wiki Lint

**Wann nutzen:** Fuer einen regelmaessigen Gesundheitscheck der Wiki Knowledge Base.

Prueft die Gesundheit der Wiki Knowledge Base und schlaegt Verbesserungen vor.

> **Portabilitaet:** Deterministische Checks (PII, Broken Links, Stale) sind in `bin/`-Skripte ausgelagert — laufen ohne LLM und sind in CI / pre-commit nutzbar. Heuristische Checks bleiben LLM-getrieben. Siehe `bin/README.md`.

## Pfade & Helfer

```bash
WIKI_ROOT="$(bin/wiki-root)"
```

Deterministische Checks (Bash-aufrufbar):

- `bin/wiki-pii-scan` — IBAN/Tel/Email-Patterns mit sipgate-Allowlist (Exit 1 bei Treffern)
- `bin/wiki-broken-links` — kaputte relative Markdown-Links (Exit 1 bei Treffern)
- `bin/wiki-stale-pages [DAYS]` — Seiten mit `updated:` aelter als N Tage (Default 180; fuer ETL-Repos eher 90)

## Ablauf

### Schritt 1: Inventar erstellen

1. Alle Markdown-Dateien in `$WIKI_ROOT` auflisten (`find $WIKI_ROOT -name '*.md'`)
2. Pro Datei: Frontmatter lesen (title, type, created, updated, status, tags)
3. Gesamtstatistik: Anzahl Seiten pro Kategorie (pipelines, concepts, incidents, sources), aelteste/neueste Seite

### Schritt 2: Deterministische Checks (Bash, parallel)

```bash
bin/wiki-pii-scan
bin/wiki-broken-links
bin/wiki-stale-pages 90
```

Zusaetzlich LLM-seitig pruefen:

**2a) Fehlende Frontmatter**
- Jede Seite (ausser SCHEMA.md) braucht: title, type, created, updated

**2b) Index-Konsistenz**
- Jede Wiki-Seite muss in `$WIKI_ROOT/index.md` gelistet sein
- Jeder Index-Eintrag muss auf eine existierende Datei zeigen

**2c) docs/-Referenzen**
- Alle Links auf `docs/`-Dateien extrahieren (`bin/wiki-search 'docs/'`), pruefen ob Ziel existiert

### Schritt 3: Heuristische Checks (LLM-getrieben)

**3a) Verwaiste Seiten (Orphans)**
- Seiten auf die keine andere Seite verlinkt (ausser index.md)

**3b) Fehlende Seiten** (nur bei `full`)
- Pipelines aus `etc/crontab/crontab` ohne Wiki-Steckbrief
- Konzepte die erwaehnt aber nie erklaert werden

**3c) Widersprueche** (nur bei `full`)
- Entitaeten extrahieren die auf mehreren Seiten vorkommen (z.B. `bin/wiki-search "tariffHeap"`)
- Nur fuer diese Ueberschneidungen: betroffene Seiten vergleichen
- Nicht paarweise alle Seiten vergleichen — entitaetsbasiert vorfiltern

### Schritt 4: Lint-Report

Ausgabe sortiert nach Schweregrad:

```
## Wiki Lint Report — YYYY-MM-DD

### Statistik
- X Seiten total (Y pipelines, Z incidents, W concepts, V sources)

### Fehler (muessen behoben werden)
1. PII-Treffer (immer Fehler)
2. ...

### Warnungen (sollten geprueft werden)
1. ...

### Vorschlaege (optional)
1. ...
```

### Schritt 5: Fixes anbieten

Konkreten Fix pro Fehler/Warnung vorschlagen. Frage: **"Soll ich die Fehler automatisch beheben?"**

**PII-Treffer immer sofort loeschen** — keine Rueckfrage noetig.

### Schritt 6: Log-Eintrag

```bash
bin/wiki-log-append lint "Lint-Lauf YYYY-MM-DD" "Zusammenfassung in 1-2 Saetzen" "betroffene Seiten oder 'keine Aenderungen'"
```

Falls Seiten geaendert wurden und QMD installiert: `qmd update && qmd embed`.

## Hinweise

- **Quick** (Standard): Schritte 2 + 3a
- **Full** (`/wiki-lint full`): Alle Checks inkl. 3b–3c
- Lint-Reports werden nicht als Wiki-Seite gespeichert — sie sind transient
- Die `bin/`-Checks koennen auch standalone in CI / pre-commit laufen (Exit-Codes > 0 bei Treffern)
