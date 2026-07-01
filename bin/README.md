# `bin/` – Wiki-Helfer fuer Claude Code, Pi & Co

Deterministische CLI-Tools fuer die Wiki-Workflows. Jeder LLM-Harness mit Bash-Zugriff (Claude Code, [Pi](https://pi.dev), Codex, plain Shell ...) kann sie aufrufen — die Skills wickeln die LLM-getriebenen Schritte drumherum.

> **Kanonischer Ort:** Diese Helfer leben kanonisch im [data-agent-lab](../)-Repo unter `bin/`. Ein Wiki-Repo (z.B. etl-scripts, controlling, operations) konsumiert sie ueber einen **per-user `bin/`-Symlink** auf `data-agent-lab/bin/` (analog zu `.claude/skills`). Setup siehe unten.

## Tools

| Tool | Zweck | Exit-Code |
|---|---|---|
| `wiki-root` | Pfad des Wiki-Roots (des *aufrufenden* Repos) ausgeben | 0 |
| `docs-root` | Pfad des Docs-Roots ausgeben | 0 |
| `wiki-search [--in wiki\|docs\|both] [--qmd] PATTERN` | Suche, `grep -n`-Format; ruft optional `qmd` mit auf | 0 |
| `wiki-pii-scan [--include-docs]` | IBAN/Tel/Email-Patterns finden | 1 bei Treffern |
| `wiki-broken-links [--include-docs]` | Kaputte relative Markdown-Links | 1 bei Treffern |
| `wiki-stale-pages [DAYS]` | Seiten mit `updated:` aelter als N Tage (Default 180) | 0 |
| `wiki-log-append OP "TITLE" "DETAILS" "PAGES"` | Eintrag in `wiki/log.md` anhaengen | 0 |

## Pfad-Resolution (Cross-Repo)

`wiki-root` / `docs-root` resolviert in dieser Reihenfolge:

1. `$DUC_WIKI_ROOT` / `$DUC_DOCS_ROOT` (Env-Var, hoechste Prio)
2. `$(git rev-parse --show-toplevel)/wiki` — **im CWD**, d.h. gegen das Repo, in dem der Skill laeuft (nicht gegen den Ort des Skripts)
3. `<bin-parent>/wiki` (script-relativer Fallback fuer Tarball-Checkouts)

Punkt 2 ist der entscheidende Hebel: ein Skill, der in `controlling/` laeuft, findet `controlling/wiki/` — obwohl das Skript selbst in `data-agent-lab/bin/` (oder einem per-repo-Symlink dorthin) liegt. So funktionieren die wiki-Skills in *jedem* Repo mit `wiki/`+`docs/`, ohne Pfad-Hardcodierung.

## PII-Allowlist (`wiki-pii-scan`)

`wiki-pii-scan` unterdrueckt Treffer anhand einer Allowlist (eine Pattern pro Zeile, `#` = Kommentar; Substring-Match auf die ganze Zeile). Geladen wird, in dieser Reihenfolge:

1. `$DUC_PII_ALLOWLIST_FILE` (Env-Var)
2. `<cwd-repo-root>/etc/pii-allowlist` — **repo-lokal**, so bleibt Sipgate-spezifischer Kontext (`@sipgate.de`, Service-Accounts) im jeweiligen Repo
3. leer (Default — strikt: kein Treffer wird unterdrueckt; over-blocking statt under-blocking)

Das macht `wiki-pii-scan` generisch: sipgate-Repos legen eine `etc/pii-allowlist` ab, andere Repos laufen strikt. Der Helfer selbst ist nicht mehr sipgate-spezifisch.

## Setup (pro Wiki-Repo, einmalig)

Jedes Repo, das die wiki-Skills nutzen will, legt einen per-user `bin/`-Symlink an (ungetrackt, gitignored) — analog zum `.claude/skills`-Symlink:

```bash
cd <repo>
ln -s "$HOME/git/data-agent-lab/bin" bin
# ggf. in .gitignore aufnehmen:
#   echo "bin" >> .gitignore
```

Dann funktionieren die cwd-relativen Aufrufe (`bin/wiki-root` etc.) aus den Skills heraus. Fuer CI/pre-commit: der Symlink muss auf der Lauf-Maschine existieren (gleicher Setup-Schritt).

## Standalone-Nutzung (ohne LLM)

Die Tools laufen auch direkt in CI / pre-commit / Cronjob:

```bash
# Pre-Commit-Hook
bin/wiki-pii-scan || { echo "PII gefunden"; exit 1; }
bin/wiki-broken-links || { echo "Broken Links"; exit 1; }
```

## Tests

Quick-Smoke-Test (im Ziel-Repo ausfuehren):

```bash
bin/wiki-root
bin/docs-root
bin/wiki-search "VDST" | head -3
bin/wiki-stale-pages 365
bin/wiki-pii-scan
bin/wiki-broken-links
```

Erwartung: alle Pfade absolut + existieren, Suche findet Treffer, PII-Scan + Broken-Links Exit 0 (bzw. 1, falls Treffer).

## Portabilitaet auf andere Harnesses

Die SKILL.md-Dateien haben Claude-Code-spezifisches Frontmatter (`user-invocable`, `allowed-tools`, `argument-hint`). Der Body ist harness-agnostisch — alle Pfad-Aufloesungen laufen ueber `bin/`-Calls, deterministische Schritte ebenfalls. Pi ignoriert unbekannte Frontmatter-Felder; der Body laeuft 1:1.

| Claude Code Frontmatter | Pi | Hinweis |
|---|---|---|
| `name:` | gleichnamiges Feld | direkt |
| `description:` | gleichnamiges Feld | direkt |
| `user-invocable: true` | Skills sind per Default invocable | kann entfallen |
| `argument-hint:` | Doku/Help | als Kommentar im Body lassen |
| `allowed-tools: ...` | Bash/Write via Extension | spezifische Tool-Namen entfallen; Bash reicht |
