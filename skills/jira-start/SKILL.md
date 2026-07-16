---
name: jira-start
description: Startet eine Arbeitseinheit — prüft/erstellt Jira-Ticket und setzt Status auf In Progress — Nutzen wenn eine neue Arbeitseinheit beginnt.
user-invocable: true
argument-hint: Kurze Beschreibung der Aufgabe
allowed-tools: Bash, Read
---

# Jira Ticket starten

**Wann nutzen:** Zu Beginn einer Arbeitseinheit, um das passende Jira-Ticket zu finden/erstellen und auf „In Progress" zu setzen.

## Nur eine Jira-URL / einen Ticket-Key geprompted? → Nur lesen + Kontext setzen

Wenn der User **nur eine Jira-URL oder einen Ticket-Key** schickt (ohne
expliziten Arbeitsauftrag), gilt: **nur das Ticket lesen und den Session-Kontext
setzen — mehr nicht.** Keine Arbeit beginnen, nicht weiter investigieren (kein
BigQuery/Repo-Graben), keine naechsten Schritte vorschlagen, keine Transition.
Danach kurz bestaetigen (Summary + gesetzter Kontext) und auf eine explizite
Anweisung warten.

```bash
/usr/local/etl-scripts/jira/cli.py context set TICKET-KEY
/usr/local/etl-scripts/jira/cli.py show TICKET-KEY
```

Der vollstaendige Ablauf unten (Ticket finden/erstellen, Transition auf „Doing",
Arbeit beginnen) gilt **nur** bei explizitem `/jira-start <Beschreibung>` oder
einem klaren Arbeitsauftrag.

## Wichtig: Ticket-Links

Jede Erwaehnung eines Ticket-Keys gegenueber dem User MUSS als klickbarer Markdown-Link formatiert werden: `[DENG-123](https://sipgatede.atlassian.net/browse/DENG-123)`.

## Wann KEIN Ticket noetig ist

Reine Tooling-/Setup-Aenderungen (z. B. `setup/morning-setup.sh`, `.claude/`-Configs, persoenliche Tooling-Tweaks) duerfen ohne Ticket commited werden. Stattdessen `[no-ticket]` in die Commit-Message aufnehmen — der Pre-Commit-Hook laesst den Commit durch und der Marker bleibt im Log als Audit-Trail. Fuer Produkt-Code, Pipelines, SQL oder Wiki/Doku **immer** ein Ticket. Details: AGENTS.md / jira/README.md.

## Voraussetzungen

```bash
/usr/local/etl-scripts/jira/cli.py check
```

Falls "SKIP": Informiere den User dass Jira-Credentials oder users.conf-Eintrag fehlen. Brich ab.

## Ablauf

1. **Suche** nach existierendem Ticket (escape-sicher; durchsucht **alle konfigurierten Projekte** des Users, per `--project KEY` eingrenzbar):

```bash
/usr/local/etl-scripts/jira/cli.py find "$ARGUMENTS"
```

2. **Entscheide:**
   - **Ticket gefunden:** Zeige es an, frage ob dieses verwendet werden soll.
   - **Kein Ticket:** Erstelle ein neues mit einem **kurzen, einzeiligen Summary** (~80 Zeichen):

```bash
/usr/local/etl-scripts/jira/cli.py create "Kurzer Summary in einer Zeile"
# Bei mehreren konfigurierten Projekten (X Boards) das Zielprojekt angeben:
/usr/local/etl-scripts/jira/cli.py create --project BYL "Kurzer Summary"
```

> **Projektwahl bei mehreren Boards:** Hat der User mehrere Projekte in `users.conf` (z. B. `DENG,BYL`), muss `create` wissen, wohin. Reihenfolge: `--project KEY` > Projekt des aktiven Kontext-Tickets > einziges konfiguriertes Projekt. Ist es mehrdeutig (mehrere Projekte, kein Hinweis), bricht `create` ab und verlangt `--project`. `find` durchsucht standardmaessig **alle** Projekte; mit `--project KEY` eingrenzen.
>
> **CLI-Falle (wichtig):** `create` hat **nur** das Flag `--project`; es gibt **keine** Flags fuer Description/Labels. Unbekannte flag-artige Argumente (`--help`, `--description`, ...) werden **abgewiesen** (Exit 2) — sie landen nicht mehr als Summary im Ticket.
>
> - **Niemals** den vollen `$ARGUMENTS` (mehrzeilig, ggf. mit URLs) direkt als Summary verwenden — erst zu einem knappen Titel verdichten.
> - Brauchst Du eine Description? **Nach** dem Create separat per `update` setzen:
>
> ```bash
> /usr/local/etl-scripts/jira/cli.py update DENG-XXX "## Ziel
> ...mehrzeilige Markdown-Description..."
> ```

**Description-Formatierung — Markdown, NICHT Jira-Wiki-Markup.** Jira **Cloud** rendert altes Server-Wiki-Markup nicht (es erscheint woertlich = kaputte Optik); `cli.py` wandelt **Markdown → ADF** (`jira/adf.py`). Descriptions und Kommentare also in Markdown schreiben:

| statt Wiki-Markup | Markdown |
|---|---|
| `h3. Titel` | `### Titel` |
| `{code:sql} … {code}` | Dreifach-Backtick-Block mit Sprache `sql` |
| `{{monospace}}` | einfache Backticks `` `monospace` `` |
| `(/)` / `(x)` | `- [x]` / `- [ ]` (Tasklist) |
| Fett-Markup | `**fett**` |
| Link | `[Text](url)` oder rohe URL |

Vom Konverter unterstuetzt: `#`/`##`/`###`, `**fett**`, `` `code` ``, dreifach-Backtick-Codebloecke (mit optionaler Sprache), `-`/`*`-Listen, `- [ ]`-Tasklists, `[Text](url)`/rohe URLs. Alles andere — insbesondere jedes Wiki-Markup — landet als Klartext im Ticket.

3. **Ticket-Key als Session-Kontext speichern** (Key aus `create` / `find`-Output):

```bash
/usr/local/etl-scripts/jira/cli.py context set TICKET-KEY
```

4. **Ticket auf „Doing" transitionieren** — `transition` akzeptiert den Namen, `list-transitions` ist nicht noetig:

```bash
/usr/local/etl-scripts/jira/cli.py transition TICKET-KEY Doing
```

Falls das Projekt „Doing" nicht hat (z.B. „In Progress" / „Wird erledigt"), lass dir mit `list-transitions TICKET-KEY` die Namen anzeigen und rufe `transition` mit dem passenden Namen auf. Wenn das Ticket bereits aktiv ist, ignoriert Jira die Transition.

5. **Ticket-Kontext laden** — Description und letzte Kommentare holen:

```bash
/usr/local/etl-scripts/jira/cli.py show TICKET-KEY
```

Lese den Output und merke dir:
- Was ist die Aufgabe? (aus Summary/Description)
- Gibt es bereits Fortschritt? (aus Kommentaren)
- Gibt es offene Fragen oder Hinweise?

Fasse den Kontext kurz fuer den User zusammen (2-3 Saetze).

6. **Gib den Ticket-Key aus** als klickbaren Markdown-Link: `[DENG-123](https://sipgatede.atlassian.net/browse/DENG-123)` — und beginne mit der Arbeit.
