---
name: pipeline-visualize
description: Analysiert den Code des AKTUELLEN Repos und (re)generiert eine visuelle Architektur-Doku (Default docs/architektur-diagramme.md) als Mermaid/C4. Repo-unabhängig — Diagramme werden aus dem CODE des jeweiligen Repos abgeleitet, nicht aus dem Gedächtnis. Nutzen nach größeren Umbauten oder wenn Diagramme veraltet wirken; wiederholbar.
user-invocable: true
argument-hint: Optional Ziel-Doc-Pfad (Default docs/architektur-diagramme.md)
allowed-tools: Read, Glob, Grep, Write, Edit, Bash
---

# Pipeline Visualize — Architektur-Diagramme aus dem Code regenerieren

**Wann nutzen:** Nach größeren Umbauten oder wenn die Architektur-Diagramme veraltet wirken.

Regeneriert eine Architektur-Doku (Default `docs/architektur-diagramme.md`, oder der als Argument
übergebene Pfad) als **Diagrams-as-Code** (Mermaid — GitHub rendert nativ, Änderungen sind
PR-diffbar), strukturiert nach C4-Ebenen. **Repo-unabhängig:** die Quellen werden im *aktuellen*
Repo selbst entdeckt, nichts ist fest verdrahtet.

## Argument

- Kein Argument → Ziel ist `docs/architektur-diagramme.md`.
- Pfad übergeben → dorthin schreiben.

## Vorgehen

### 1. Repo analysieren (Pflicht — NICHT aus dem Gedächtnis zeichnen)

Zuerst die Struktur des aktuellen Repos entdecken, dann die Diagramme daraus ableiten. Generisch —
pro Zeile die Quelle im Repo suchen (glob/grep/read), nicht raten:

| Diagramm | Wo im Repo ableiten |
|---|---|
| System-Kontext (C4-L1) | README / AGENTS.md (Funktionsweise), Deploy-/Infra-Config (`.github/workflows/*`, `*nautilus*.y*ml`, `docker-compose*`, `Dockerfile`, `etc/crontab/*`), externe Systeme + Trust-/Egress-Grenzen |
| Komponenten (C4-L2/L3) | Top-Level-Verzeichnisse + Manifeste (`package.json`, `pyproject.toml`/`setup.py`, `Cargo.toml`, `go.mod`); Import-/Abhängigkeitsgraph der Hauptmodule |
| Schlüssel-Flows (Sequenz/Flowchart) | Entrypoints (`main.*`, `run.py`, `index.*`, `cmd/*`, HTTP-Routen/Handler, CLI) → den wichtigsten Request-/Datenfluss verfolgen |
| Deploy-Pipeline (Flowchart) | CI (`.github/workflows/*`), Ansible/Nautilus, `crontab` — Build→Deploy→(Gate)→Prod |
| Datenmodell/Lineage (nur Daten-Repos) | falls vorhanden: Migrations/Schema/dbt/Katalog — Tabellen + Beziehungen (`erDiagram`) |

Nur Diagramme erzeugen, für die es im Repo **tatsächlich** eine Quelle gibt (ein reines
Library-Repo hat keine Deploy-Pipeline → weglassen, nicht erfinden).

### 2. Diagramm-Set (re)generieren

Ziel-Doc komplett neu schreiben — Kopfzeile mit **Repo-Name**, Stand-Datum und Hinweis
„generiert via /pipeline-visualize, Quelle ist der Code". Reihenfolge (soweit im Repo vorhanden):
System-Kontext → Komponenten → Schlüssel-Flows → Deploy-Pipeline → (Datenmodell).

Regeln:
- **Ehrlichkeit:** Gebautes vs. Geplantes trennen (Geplantes gestrichelt `-.->` + „geplant"-Label;
  Quelle für Geplantes z.B. `TODO`/Backlog). Nichts erfinden — nur was im Code/Config steht.
- Deutsch beschriften; **keine Secrets/Tokens/PII** in Diagramme.
- Mermaid-Stolperfallen: Knoten-/Entity-IDs **ASCII-only** (`[^A-Za-z0-9_]` → `_`), Labels und
  Sonderzeichen (`{}`, `()`) in `"…"`.

### 3. Validieren (Pflicht)

Jeden ```mermaid-Block headless parsen — kein Block darf beim Rendern brechen. Je nach Umgebung:

- **Headless-Browser-Tool** (z.B. omp `browser`, `action: run`) — kein Setup, mermaid von CDN,
  `<ZIEL-DOC>` einsetzen:
  ```js
  const fs = require('fs');
  const blocks = [...fs.readFileSync('<ZIEL-DOC>','utf8').matchAll(/```mermaid\n([\s\S]*?)```/g)].map(m=>m[1]);
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.evaluate(async () => { const m = await import('https://cdn.jsdelivr.net/npm/mermaid@11/+esm');
    window.__m = m.default || m; window.__m.initialize({startOnLoad:false}); });
  const failed = [];
  for (let i=0;i<blocks.length;i++){ const e = await page.evaluate(async c => {
    try { await window.__m.parse(c); return null; } catch(e){ return String((e&&e.message)||e); } }, blocks[i]);
    if (e) failed.push({i, e}); }
  display(failed); return failed.length ? 'FAILURES' : 'ALL VALID';
  ```
- **CLI-Alternative** (kein Browser-Tool verfügbar): `npx -y @mermaid-js/mermaid-cli -i <ziel-doc> -o /tmp/_mmdc.md`
  — rendert alle Blöcke, Exit ≠ 0 bei Syntaxfehler (lädt Chromium beim ersten Lauf).

Fehler beheben, bis alle Blöcke grün sind (`ALL VALID`).

### 4. Abschließen

- Falls ein Doku-Index existiert (`docs/README*`, `mkdocs.yml`, `dokumentation.md`): Eintrag fürs
  Ziel-Doc prüfen/ergänzen.
- Diff dem User zeigen (was hat sich strukturell geändert?).
- Erst **nach Bestätigung** committen (viele Repos deployen bei Push):
  `docs(diagramme): regeneriert via /pipeline-visualize`.

## Hinweise

- Repo-unabhängig: nichts ist auf ein bestimmtes Repo verdrahtet — die Quellen werden je Repo neu
  entdeckt. Läuft in jedem Repo, das diese Skills einbindet.
- Prüft/erzeugt **Struktur-Doku**, keine Logik-/Datenqualität.
- Sprache: Doku Deutsch.
