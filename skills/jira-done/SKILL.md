---
name: jira-done
description: Schliesst die Arbeit am aktuellen Jira-Ticket ab — Zusammenfassung, Status-Update — Nutzen wenn die Arbeit an einem Ticket abgeschlossen ist.
user-invocable: true
argument-hint: Optional Ticket-Key (sonst aus Session-Context)
allowed-tools: Bash, Read
---

# Jira Ticket abschliessen

**Wann nutzen:** Am Ende einer Arbeitseinheit, um Session-Statistiken zu schreiben und das Ticket abzuschliessen.

## Wichtig: Ticket-Links

Jede Erwaehnung eines Ticket-Keys gegenueber dem User MUSS als klickbarer Markdown-Link formatiert werden: `[DENG-123](https://sipgatede.atlassian.net/browse/DENG-123)`.

## Voraussetzungen

```bash
/usr/local/etl-scripts/jira/cli.py check
```

Falls "SKIP": nichts zu tun.

## Ablauf

1. **Ticket-Key ermitteln** (Argument oder Session-Context):

```bash
/usr/local/etl-scripts/jira/cli.py context
```

2. **Token-Nutzung und Kosten schaetzen:**

Schaetze basierend auf der Konversation:
- Ungefaehre Input-Tokens (alle User-Nachrichten + Tool-Ergebnisse)
- Ungefaehre Output-Tokens (alle deine Antworten + Tool-Aufrufe)
- Kosten nach aktuellem Pricing:
  - **Claude Opus 4:** $15/M Input, $75/M Output
  - **Claude Sonnet 4:** $3/M Input, $15/M Output

3. **Session-Property und Abschluss-Kommentar in einem Aufruf schreiben:**

```bash
/usr/local/etl-scripts/jira/cli.py write-session TICKET-KEY \
    --tokens-in 500000 \
    --tokens-out 50000 \
    --cost 11.25 \
    --model claude-opus-4-7
```

Der Command berechnet Git-Stats aus dem Session-Kontext, schreibt sie als `ai_session`-Property (querybar via JQL) und postet einen formatierten Kommentar. Ohne `TICKET-KEY` wird der Session-Context verwendet.

4. **Status transitieren** (Namen, keine IDs noetig):

```bash
/usr/local/etl-scripts/jira/cli.py transition TICKET-KEY Done
```

Wenn „Done" im Projekt nicht existiert, probiere „Review" oder lass dir mit `list-transitions TICKET-KEY` die verfuegbaren Namen zeigen. `transition` akzeptiert sowohl Namen als auch IDs.

Wenn das geschlossene Ticket dem Session-Context entsprach, leert `transition` den Context automatisch — ein separater `context clear` ist nicht noetig.

5. Informiere den User: Ticket abgeschlossen (mit klickbarem Link).

## JQL-Abfragen fuer Auswertung

Nach dem Schreiben der Property koennen Tickets so gefiltert werden:

```
issue.property[ai_session].commits > 0           -- alle AI-bearbeiteten Tickets
issue.property[ai_session].cost_usd > 1.0        -- teure Sessions
issue.property[ai_session].files_changed > 10    -- grosse Aenderungen
```
