---
name: wiki-query
description: Fragen gegen die Wiki Knowledge Base stellen
user-invocable: true
argument-hint: "Frage an das Wiki (z.B. 'Welche Pipelines schreiben in BigQuery?')"
allowed-tools: Read, Glob, Grep, Bash, Agent
---

# Wiki Query

Beantwortet Fragen auf Basis der Wiki Knowledge Base.

> **Portabilitaet:** Pfade und Suche laufen ueber `bin/`-Helfer — andere Harnesses (z.B. [Pi](https://pi.dev)) koennen den Body 1:1 uebernehmen. Siehe `bin/README.md`.

## Pfade & Helfer

```bash
WIKI_ROOT="$(bin/wiki-root)"
DOCS_ROOT="$(bin/docs-root)"
```

- `bin/wiki-search [--in wiki|docs|both] [--qmd] PATTERN` — Standard-Suche, ruft optional `qmd` mit auf
- `bin/wiki-log-append query ...` — Log-Eintrag

## Ablauf

### Schritt 1: Suche

```bash
bin/wiki-search --qmd "<user-frage-keywords>"
```

`bin/wiki-search` macht intern:

- Grep ueber `$WIKI_ROOT` und `$DOCS_ROOT` (immer)
- `qmd query` (falls qmd auf PATH ist und `--qmd` gesetzt) fuer semantische Treffer — Hybrid BM25 + Vector + Reranking

### Schritt 2: Index + relevante Seiten lesen (parallel)

Parallel:

- `$WIKI_ROOT/index.md` lesen — Kategorie-Uebersicht
- Die 3–5 relevantesten Seiten aus den Treffern in Schritt 1 lesen
- Cross-References folgen (relative Markdown-Links in „See Also"-Abschnitten)

### Schritt 3: Antwort formulieren

- **Konkret** — mit Verweisen auf Wiki-Seiten und `docs/`-Dateien
- **Zitieren** — welche Seite die Information enthaelt
- **Luecken benennen** — wenn das Wiki die Frage nicht beantwortet, explizit sagen

Format:

```
[Antwort]

**Quellen:**
- wiki/pipelines/tariff-heap.md
- docs/pipelines/job-runner.md
```

### Schritt 4: Ergebnis optional speichern

Falls die Antwort eine wertvolle Synthese ist, anbieten:

> "Soll ich diese Antwort als Wiki-Seite speichern?"

Falls ja: Seite erstellen, Index und Log aktualisieren (siehe `wiki-ingest`).

### Schritt 5: Log-Eintrag

```bash
bin/wiki-log-append query "Kurzer Titel der Frage" "Antwort-Synthese in 1-2 Saetzen" "gelesen: a.md, b.md"
```

Falls QMD installiert und Seiten geaendert: `qmd update && qmd embed`.

## Hinweise

- **QMD zuerst (via `--qmd`), Grep immer** — QMD findet semantische Treffer (falls installiert), Grep findet exakte Keywords
- Falls das Wiki duenn ist: Ehrlich sagen und auf `docs/` oder den Code verweisen
- Bei haeufig gestellten Fragen ohne Wiki-Eintrag: Seite zum Anlegen vorschlagen
