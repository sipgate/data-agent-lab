---
name: jira-start
description: Startet eine Arbeitseinheit — prüft/erstellt Jira-Ticket und setzt Status auf In Progress
user-invocable: true
argument-hint: Kurze Beschreibung der Aufgabe
allowed-tools: Bash, Read
---

# Jira Ticket starten

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

1. **Suche** nach existierendem Ticket (escape-sicher, arbeitet auf dem Projekt des Users):

```bash
/usr/local/etl-scripts/jira/cli.py find "$ARGUMENTS"
```

2. **Entscheide:**
   - **Ticket gefunden:** Zeige es an, frage ob dieses verwendet werden soll.
   - **Kein Ticket:** Erstelle ein neues mit einem **kurzen, einzeiligen Summary** (~80 Zeichen):

```bash
/usr/local/etl-scripts/jira/cli.py create "Kurzer Summary in einer Zeile"
```

> **CLI-Falle (wichtig):** `create` akzeptiert genau **ein** Argument und nimmt **jeden** uebergebenen String als Summary — auch `--description`, `--help` oder andere Flag-aehnliche Strings. Das CLI hat **keine** Flags fuer Description, Labels o.ae.
>
> - **Niemals** `--description`, `--help`, `--label` o.ae. an `create` haengen → das wuerde diesen String als Summary nehmen und ein Ghost-Ticket anlegen.
> - **Niemals** den vollen `$ARGUMENTS` (mehrzeilig, ggf. mit URLs) direkt als Summary verwenden — erst zu einem knappen Titel verdichten.
> - Brauchst Du eine Description? **Nach** dem Create separat per `update` setzen:
>
> ```bash
> /usr/local/etl-scripts/jira/cli.py update DENG-XXX "## Ziel
> ...mehrzeilige Markdown-Description..."
> ```

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
