---
name: github-daily
description: Fasst alle GitHub-Aenderungen des Users in der sipgate-Org fuer einen Tag zusammen — Commits, PRs, Issues und Reviews via `gh` Search. Nutzen wenn du einen Tagesrueckblick deiner GitHub-Aktivitaet brauchst.
user-invocable: true
argument-hint: Optional Datum YYYY-MM-DD (Standard heute) und/oder GitHub-Login (Standard authentifizierter User)
allowed-tools: Bash
---

# GitHub Daily

**Wann nutzen:** Wenn du einen Tagesrueckblick deiner eigenen GitHub-Aenderungen in der sipgate-Org brauchst (Commits, PRs, Issues, Reviews).

Fasst die Aktivitaet eines GitHub-Users in der Organisation `sipgate` fuer einen einzelnen Tag zusammen — ausschliesslich ueber die GitHub CLI (`gh`), read-only (nur `gh search`/`gh api`, nie schreibende Befehle).

## Voraussetzungen

- `gh` installiert und authentifiziert (`gh auth status`). Falls nicht: `gh auth login`.
- Der Token braucht Lesezugriff auf die (privaten) sipgate-Repos.

## Konfiguration

- **Org:** `sipgate`
- **User:** Standard = authentifizierter Account (`gh api user --jq .login`). Ein als Argument uebergebener Login ueberschreibt.
- **Datum:** Standard = heute (`date +%F`). Ein Argument `YYYY-MM-DD` ueberschreibt.

## Ablauf

### 1. User und Datum bestimmen

```bash
LOGIN=$(gh api user --jq .login)   # oder aus dem Argument
DATE=$(date +%F)                   # oder aus dem Argument
echo "User=$LOGIN Datum=$DATE"
```

### 2. Daten sammeln (parallel)

Die folgenden Queries sind unabhaengig — in **einem** Tool-Block parallel starten. `$LOGIN`/`$DATE` aus Schritt 1 einsetzen.

**2a) Commits** (author-date = der Tag). Datum steckt in `.commit.author.date`, Betreff in `.commit.message` (erste Zeile), Repo in `.repository.fullName`, Kurz-SHA aus `.sha[0:7]`:

```bash
gh search commits --owner sipgate --author "$LOGIN" --author-date "$DATE" \
  --limit 100 --json sha,repository,commit
```

**2b) PRs geoeffnet:**

```bash
gh search prs --owner sipgate --author "$LOGIN" --created "$DATE" \
  --limit 100 --json number,title,repository,state,url,createdAt
```

**2c) PRs gemerged:**

```bash
gh search prs --owner sipgate --author "$LOGIN" --merged "$DATE" \
  --limit 100 --json number,title,repository,url,closedAt
```

**2d) PRs aktualisiert** (laufende Arbeit — faengt neue Commits auf bereits offenen PRs):

```bash
gh search prs --owner sipgate --author "$LOGIN" --updated "$DATE" \
  --limit 100 --json number,title,repository,state,url
```

**2e) Reviews gegeben** (Naeherung: von dir reviewte PRs mit Aktivitaet am Tag — `gh` kann nicht nach Review-Datum filtern):

```bash
gh search prs --owner sipgate --reviewed-by "$LOGIN" --updated "$DATE" \
  --limit 50 --json number,title,repository,url
```

**2f) Issues geoeffnet:**

```bash
gh search issues --owner sipgate --author "$LOGIN" --created "$DATE" \
  --limit 50 --json number,title,repository,state,url
```

### 3. Ausgabe (Slack-Copy-Paste-tauglich)

Ergebnisse **deduplizieren** (eine PR kann in 2b–2e mehrfach auftauchen), **nach Repo gruppiert**, und als **Slack-mrkdwn** ausgeben — so, dass der User den Text 1:1 in eine Slack-Nachricht kopieren kann.

**Slack-Format-Regeln (wichtig):**
- **Kein** `#`/`##` (Slack zeigt sie woertlich), **keine** Markdown-Tabellen (erscheinen als rohe `|`), **kein** `**fett**`.
- Fett = `*text*`, kursiv = `_text_`, Aufzaehlung = `•` am Zeilenanfang, Zeiten/Keys in Backticks.
- Links als **rohe URLs** (Slack verlinkt sie beim Einfuegen automatisch). Das API-Format `<url|Text>` NICHT verwenden — beim Einfuegen in die Nachricht wird es woertlich angezeigt.
- Den fertigen Block dem User in einem Code-Fence praesentieren, damit er bequem kopierbar ist; der **Inhalt** selbst ist reines Slack-mrkdwn (nicht noch einmal in Backtick-Fences wickeln).

**Vorlage:**

```
*GitHub — <Datum> — <Login> @ sipgate*
_<X> Commits · <Y> Repos · <A> PRs (<a> geöffnet / <b> gemerged) · <N> Reviews_

*<owner/repo>* (<n>)
• `HH:MM` `<sha7>` [<TICKET>] <Betreff>
• `HH:MM` `<sha7>` <Betreff ohne Ticket>

*<owner/repo2>* (<n>)
• …

*PRs*
• #<nr> <Titel> [<state>] — <url>

*Reviews*
• #<nr> <Titel> — <url>

Tickets: <DENG-…, BYL-…> · Schwerpunkt: <Repo mit den meisten Aenderungen>
```

Regeln zur Vorlage:
- Leere Abschnitte weglassen (keine PRs → kein `*PRs*`-Block usw.).
- Commits je Repo chronologisch; Repos mit den meisten Commits zuerst.
- Kurz-SHA je Commit (`.sha[0:7]`, 7 Zeichen) in Backticks direkt nach der Zeit — kompakt und org-weit eindeutig genug für ein `git show <sha>` (volle 40-Zeichen-Hashes wären zu lang).
- Ticket-Keys (`[A-Z]{2,}-\d+`) aus Commit-/PR-Titeln ziehen; die `Tickets:`-Zeile listet alle eindeutigen Keys des Tages.
- Leerer Tag: nur die Kopfzeile + `_keine Aktivität am <Datum>_`.

## Hinweise

- `--author`/`--reviewed-by` erwarten den GitHub-**Login**, nicht die Git-Autor-Email; `gh` mappt Commits ueber die im GitHub-Account hinterlegten Emails.
- `gh search` deckt auch **private** Repos ab, solange der Token Zugriff hat.
- Fuer einen groesseren Zeitraum als einen Tag Datums-Range-Qualifier nutzen, z.B. `--author-date ">=2026-07-01"` bzw. `--created ">=2026-07-01"`.
- Nur lesend: keine `gh pr create`/`merge`/`comment`- oder sonstigen schreibenden Aufrufe.
