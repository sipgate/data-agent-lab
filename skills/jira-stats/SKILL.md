---
name: jira-stats
description: AI-Session-Statistiken aus Jira auswerten — Kosten, Commits, Aenderungen ueber alle Tickets — Nutzen wenn eine Auswertung/Reporting der AI-Sessions gebraucht wird.
user-invocable: true
argument-hint: Optional Zeitraum oder Filter z.B. "letzte 30 Tage", "DENG-336"
allowed-tools: Bash
---

# Jira AI Session Stats

**Wann nutzen:** Fuer Auswertung und Reporting der AI-Session-Kosten und -Aenderungen ueber Tickets hinweg.

Liest `ai_session` Properties von Jira-Tickets und erstellt eine Auswertung.

## Ablauf

1. **Tickets mit AI-Sessions laden:**

```bash
/usr/local/etl-scripts/jira/cli.py check
```

Projekt(e) aus dem Output entnehmen — `check` listet bei mehreren Boards mehrere `Projekt=`-Zeilen. Dann die Tickets des Users suchen (bei mehreren Projekten `project in (...)`; enger filtern, wenn der User einen Zeitraum / ein einzelnes Ticket erwaehnt hat):

```bash
/usr/local/etl-scripts/jira/cli.py search "project in (DENG, BYL) AND assignee = currentUser() ORDER BY updated DESC"
```

2. **Properties lesen (TSV-Output):**

```bash
/usr/local/etl-scripts/jira/cli.py read-session DENG-336 DENG-341 DENG-349
```

Der Command gibt eine Tabelle aus mit Spalten: `ticket, commits, files, insertions, deletions, cost_usd, tokens_in, tokens_out, model, dirs`. Tickets ohne `ai_session`-Property werden mit `(keine AI-Session-Daten)` markiert.

3. **Auswertung erstellen:**

Fasse die Ergebnisse als Markdown-Tabelle zusammen:

| Ticket | Commits | Files | +/- Lines | Kosten | Verzeichnisse |
|--------|---------|-------|-----------|--------|---------------|

Berechne Summen:
- **Gesamt-Commits** ueber alle Tickets
- **Gesamt-Aenderungen** (Insertions + Deletions)
- **Gesamt-Kosten** (falls vorhanden)
- **Haeufigste Verzeichnisse** (welche Bereiche wurden am meisten bearbeitet)

Falls der User einen Zeitraum angegeben hat, filtere die Tickets anhand des `updated`-Datums aus Schritt 1. Falls der User ein einzelnes Ticket angegeben hat, zeige nur dessen Details.

4. **Vergleiche anbieten:**

Falls genug Daten vorhanden sind, biete Vergleiche an:
- Durchschnittliche Kosten pro Ticket
- Durchschnittliche Commits pro Ticket
- Teuerste/groesste Sessions
