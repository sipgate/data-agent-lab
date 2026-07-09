---
name: babelfish
description: Regeneriert die babelfish-Datenmodell-Doku (babelfish/docs/datenmodell.md) aus dem Katalog in BigQuery — zertifizierte/relevante Assets, ER-Diagramme aus den inferierten Foreign Keys, Pipeline-Lineage; alles als Mermaid. Nutzen nach FK-/Katalog-Änderungen oder wenn das Datenmodell veraltet wirkt — wiederholbar, Diagramme werden aus dem KATALOG (BQ) abgeleitet, nicht aus dem Gedächtnis.
---

# /babelfish — Datenmodell aus dem Katalog regenerieren

Regeneriert `babelfish/docs/datenmodell.md` als **Diagrams-as-Code** (Mermaid — GitHub
rendert nativ, Änderungen sind PR-diffbar). Quelle ist ausschließlich das babelfish-Dataset
`business-analytics-216810.babelfish.*` — **nie das Gedächtnis**. babelfish ist selbst die
Source of Truth; dieses Doc ist eine *Projektion* daraus (kein neuer Fakt).

## Vorgehen

### 1. Katalog abfragen (Pflicht — NICHT aus dem Gedächtnis zeichnen)

Jeder Abschnitt wird aus genau einer Query abgeleitet:

| Abschnitt | Quelle der Wahrheit (BigQuery) |
|---|---|
| §1 Assets-Overview | `asset` (status in certified/relevant) ⋈ `assetAnnotation` |
| §2 ER je Dataset | `assetColumn` (`fkSource='inferred'`, `referencesFqn`/`referencesColumn`/`fkConfidence`) ⋈ `asset` (Kind + Eltern) |
| §3 Pipeline-Lineage | `lineageEdge` (`source` in pipeline/copyConfig) ⋈ `asset` (downstream certified/relevant) |

Ausführen mit dem BigQuery-Client (venv, Creds via `common.config`) oder direkt in BQ.
`DS = business-analytics-216810.babelfish`:

```sql
-- §1 Overview
select a.fqn, a.status, coalesce(a.domain,'—') as domain,
       coalesce(a.queries30d,0) as q30,
       coalesce(aa.description, a.description, '') as descr
from `DS.asset` a
left join `DS.assetAnnotation` aa on aa.fqn = a.fqn
where a.status in ('certified','relevant') and not a.deleted
order by a.status, a.domain, a.fqn;

-- §2 Inferierte FK-Kanten (ER)
select a.datasetOrSchema as ds, a.tableName as child, ac.name as fk_col,
       pa.datasetOrSchema as pds, pa.tableName as parent,
       ac.referencesColumn as ref_col, round(ac.fkConfidence,2) as conf
from `DS.assetColumn` ac
join `DS.asset` a  on a.fqn = ac.fqn
join `DS.asset` pa on pa.fqn = ac.referencesFqn
where ac.fkSource='inferred'
order by ds, child, fk_col;

-- §3 Pipeline-Lineage in zertifizierte/relevante Marts
select le.upstreamFqn as up, le.downstreamFqn as down, le.source as src
from `DS.lineageEdge` le
join `DS.asset` d on d.fqn = le.downstreamFqn
where d.status in ('certified','relevant') and le.source in ('pipeline','copyConfig')
order by down, up;
```

> Die inferierten FKs kommen aus `writer.derive_foreign_keys` (Richtung aus `isPrimaryKey`,
> sonst Spalte `id`; `fkConfidence` aus PK-Signal + `joinCount`). Sind sie leer/veraltet,
> zuerst `./load_babelfish.py --foreignkeys` laufen lassen — dann dieses Doc regenerieren.

### 2. Doc regenerieren

`babelfish/docs/datenmodell.md` komplett neu schreiben — Kopfzeile mit Stand-Datum und Hinweis
„generiert via /babelfish aus dem Katalog, nicht aus dem Gedächtnis". Fester Satz (Konsistenz
über Läufe):

1. **§1 Zertifizierte & relevante Assets** — Tabelle: Status · Domain · fqn · Queries/30d ·
   Beschreibung (auf ~90 Zeichen kürzen, `|`/Newlines escapen).
2. **§2 ER je Dataset** — ein `erDiagram` je `datasetOrSchema` mit **≥2** Beziehungen (kleinere
   überspringen). Kante: `PARENT ||--o{ CHILD : "fk_col->ref_col (conf)"` (Eltern = referenzierte
   PK-Seite, Kind = FK). Kanten je `(parent,child,fk_col,ref_col)` **deduplizieren** (mysqlDwh +
   mysqlRepl liefern dieselbe Beziehung → max `conf`). Cross-Dataset-Eltern als `pds__parent`
   präfixen, damit die Entity eindeutig ist.
3. **§3 Pipeline-Lineage** — ein `flowchart LR`, Knoten `id["<fqn>"]`, Kante `up --> down`.
   Ist die Menge leer, ehrlich vermerken (dbt-Lineage wird noch nicht aus dem `manifest`
   gezogen → certified dbt-Marts haben wenige/keine Kanten).

Regeln:
- **Ehrlichkeit:** Beziehungen sind **inferiert** (`conf`<1), keine deklarierten Constraints —
  im Kopf klar sagen. Keine erfundenen Kanten; nur was die Queries liefern.
- Deutsch beschriften (Doku-Sprache); **keine Secrets/PII** in Diagramme (fqns/Spaltennamen ok).
- Mermaid-Stolperfallen: Entity-/Knoten-IDs **ASCII-only** (`[^A-Za-z0-9_]` → `_`), Labels in
  `"…"`, keine ungequoteten Sonderzeichen.

### 3. Validieren (Pflicht)

Jeden ```mermaid-Block headless parsen — kein Block darf beim Rendern brechen. `mmdc` ist hier
nicht installiert; nutze den Browser + mermaid von CDN (wie ein headless Renderer):

```js
// browser: action run — parst jeden Block via mermaid.parse(), listet Fehler
const fs = require('fs');
const md = fs.readFileSync('/usr/local/etl-scripts/babelfish/docs/datenmodell.md','utf8');
const blocks = [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map(m=>m[1]);
await page.setContent('<!doctype html><html><body></body></html>');
await page.evaluate(async () => {
  const m = await import('https://cdn.jsdelivr.net/npm/mermaid@11/+esm');
  window.__m = m.default || m; window.__m.initialize({startOnLoad:false});
});
const failed = [];
for (let i=0;i<blocks.length;i++){
  const r = await page.evaluate(async c => { try { await window.__m.parse(c); return null; }
    catch(e){ return String((e&&e.message)||e); } }, blocks[i]);
  if (r) failed.push({i, err:r});
}
display(failed); return failed.length===0 ? 'ALL VALID' : 'FAILURES';
```

Fehler beheben, bis alle Blöcke grün sind (`ALL VALID`).

### 4. Abschließen

- Diff dem User zeigen (was hat sich strukturell geändert — neue Tabellen/FKs/Lineage?).
- Erst nach Bestätigung committen: `docs(babelfish): datenmodell regeneriert via /babelfish`.
  babelfish deployt mit jedem Push auf Production — nie ungefragt committen.
