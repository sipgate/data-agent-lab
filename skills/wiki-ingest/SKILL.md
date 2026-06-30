---
name: wiki-ingest
description: Erkenntnisse aus der aktuellen Session ins Wiki schreiben
user-invocable: true
argument-hint: "Thema oder Quelle (optional, sonst wird aus der Session abgeleitet)"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# Wiki Ingest

Verarbeitet neues Wissen und integriert es in die Wiki Knowledge Base.

> **Portabilitaet:** Pfade und deterministische Schritte laufen ueber `bin/`-Helfer. Andere LLM-Harnesses (z.B. [Pi](https://pi.dev)) koennen den Body uebernehmen und nur das Frontmatter anpassen. Siehe `bin/README.md`.

## Pfade & Helfer

Wiki- und Docs-Root nie hartcodieren — immer ueber Skripte aufloesen:

```bash
WIKI_ROOT="$(bin/wiki-root)"
DOCS_ROOT="$(bin/docs-root)"
```

Verfuegbare Helfer (`bin/`):

- `bin/wiki-root`, `bin/docs-root` — Pfad-Resolver
- `bin/wiki-search [--in wiki|docs|both] [--qmd] PATTERN` — Suche
- `bin/wiki-pii-scan [--include-docs]` — PII-Pruefung
- `bin/wiki-broken-links [--include-docs]` — Broken-Links
- `bin/wiki-stale-pages [DAYS]` — veraltete Seiten
- `bin/wiki-log-append OP "TITLE" "DETAILS" "PAGES"` — Log-Eintrag

## Ablauf

### Schritt 1: Schema und Index lesen (parallel)

Parallel:

- `$WIKI_ROOT/SCHEMA.md` — Konventionen, Seitenformat, Naming
- `$WIKI_ROOT/index.md` — bestehende Seiten

(`$WIKI_ROOT/overview.md` wird erst in Schritt 6 bedingt geladen.)

### Schritt 2: Erkenntnisse identifizieren und kategorisieren

Falls der User ein Argument uebergeben hat, ist das die Quelle oder das Thema.

Falls kein Argument: Analysiere den bisherigen Gespraechsverlauf und identifiziere die wichtigsten Erkenntnisse (neue Fakten, geloeste Probleme, Zusammenhaenge, Entscheidungen).

Zeige dem User eine nummerierte Liste und frage: **"Welche davon sollen ins Wiki? (Nummern oder 'alle')"**

Ordne jede gewaehlte Erkenntnis einer Kategorie zu:

| Kategorie | Verzeichnis | Wann |
|-----------|-------------|------|
| **pipeline** | `$WIKI_ROOT/pipelines/` | Neues Wissen ueber eine bestimmte Pipeline |
| **incident** | `$WIKI_ROOT/incidents/` | Fehler, Root Cause, Loesung |
| **concept** | `$WIKI_ROOT/concepts/` | Konzepte, Tribal Knowledge, Muster |
| **source** | `$WIKI_ROOT/sources/` | Zusammenfassung einer externen Quelle |

### Schritt 3: Seiten erstellen oder aktualisieren

Fuer jede Erkenntnis:

1. **Existierende Seite?** Anhand des Index (Schritt 1) und optional `bin/wiki-search --qmd "<thema>"` pruefen
2. **Falls ja:** Seite lesen, neue Information einarbeiten, `updated`-Datum aktualisieren
3. **Falls nein:** Neue Seite erstellen mit Frontmatter gemaess `$WIKI_ROOT/SCHEMA.md`

Beim Erstellen/Aktualisieren:

- Frontmatter vollstaendig (type, created, updated, tags, status, sources)
- Quellen angeben (Dateiname, Loki-Query, Slack-Permalink, URL, Dashboard-Link)
- Cross-References: Relative Markdown-Links fuer Wiki (`[Titel](datei.md)` oder `[Titel](../kategorie/datei.md)`), relative Pfade fuer `docs/` (`../../docs/...`)
- Kompakt halten (max 200 Zeilen)

### Schritt 4: Backlink-Audit

Anhand des in Schritt 1 gelesenen Index:

1. Thematisch verwandte Seiten identifizieren (`bin/wiki-search "<thema>"`)
2. Pruefen ob diese einen Link zur neuen Seite haben sollten
3. Falls ja: Cross-Reference im "See Also"-Abschnitt ergaenzen

### Schritt 5: Index aktualisieren

`$WIKI_ROOT/index.md` aktualisieren:

- Neue Seiten in die passende Kategorie-Tabelle eintragen
- Bestehende Eintraege aktualisieren (Zusammenfassung, Datum)
- Alphabetisch sortiert halten

### Schritt 6: Overview bedingt aktualisieren

**Nur falls** die Erkenntnis das Gesamtbild aendert (neues Muster, wichtige Entscheidung):

1. `$WIKI_ROOT/overview.md` lesen
2. Relevante Sektion aktualisieren

Bei kleinen Ingests diesen Schritt ueberspringen.

### Schritt 7: PII-Sweep + Log-Eintrag

```bash
bin/wiki-pii-scan
```

Falls Treffer: vor dem Log-Eintrag beheben (Mitarbeiter-Telefonnummern, Kunden-IBANs etc.).

```bash
bin/wiki-log-append ingest "Kurzer Titel" "Was wurde gemacht" "datei1.md, datei2.md"
```

Falls QMD installiert: `qmd update && qmd embed` ausfuehren.

### Schritt 8: Zusammenfassung

Zeige dem User: erstellte/aktualisierte Seiten, gesetzte Cross-References, ob Overview aktualisiert wurde.

## Hinweise

- **Keine Halluzinationen** — nur Fakten aus der Session oder konkreten Quellen
- **Widersprueche** — wenn neue Info alten Eintraegen widerspricht, beide Seiten updaten
- **docs/ nicht anfassen** — das Wiki referenziert docs/, aendert es aber nie
- **Sprache:** Wiki-Inhalte auf Deutsch
- **Datenschutz:** Kunden-IDs, IBAN-Werte, Mitarbeiter-Privattelefone niemals aufnehmen (`bin/wiki-pii-scan` faengt das)
