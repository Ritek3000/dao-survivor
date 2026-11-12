# Arbeitsregeln für Claude

Dies ist ein 3D-Survivor-like in der Welt Ghen aus *Die Alte Ordnung* (Three.js, TypeScript, Vite).
Die Übersicht für Menschen steht in `README.md`; hier steht, wie in diesem Repository gearbeitet wird.

## Sprache

- Mit Fabian wird auf **Deutsch** geschrieben, ebenso Commit-Nachrichten und Pull Requests.
- **Kommentare, Doc-Kommentare (`/** … */`) und alle Texte im Spiel sind deutsch.** Kommentare erklären das Warum und
  die Einheiten, nicht das Offensichtliche. Einheiten sind Meter und Sekunden.
- Bezeichner im Code folgen dem bestehenden Stil: technische Begriffe englisch (`hpFactor`, `spawn`, `update`),
  Begriffe der Spielwelt deutsch in ASCII-Umschrift (`kaempfer`, `wildnislaeufer`, `verschlinger`, `Segen`, `Finsternis`;
  ä/ö/ü/ß werden zu ae/oe/ue/ss). In Dateinamen und Bezeichnern stehen keine Umlaute.
- Texte im Spiel haben echte Umlaute und verwenden die Begriffe der Lore (Sor, Dhargass, Höhere Macht, Verstaubung, Finsternis).
- Python-Skripte unter `tools/` sind ASCII-only, wie das vorhandene Skript.

## Befehle

```bash
npm install          # einmalig; es gibt eine package-lock.json, also notfalls npm ci
npm run dev          # Vite auf http://localhost:5173 (Port ist fest, strictPort)
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + vite build nach dist/
npm run preview      # gebauten Stand ansehen
```

Es gibt keine automatischen Tests und keinen Linter. **Bevor ein Pull Request aufgeht, laufen `npm run typecheck` und
`npm run build` fehlerfrei.** Wer Spielverhalten ändert, prüft es im Browser (`npm run dev`); wer das Gleichgewicht
ändert, nutzt zusätzlich den Messlauf (`__messlauf` in der Browser-Konsole, Beschreibung in `src/tools/messlauf.ts`).

## Stack und Struktur

- Three.js ohne Engine und ohne UI-Framework. Das HUD ist HTML in `index.html`, gesteuert von `src/ui/hud.ts`.
- TypeScript ist sehr streng eingestellt (`strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`,
  `verbatimModuleSyntax`). Typen werden mit `import type` bzw. `type`-Modifikator importiert.
- `src/config.ts` ist der Ort für Stellschrauben (Nachtdauer, Gegnerarten, Kulisse, Boss). Neue Zahlen, die man beim
  Balancing anfassen will, gehören dorthin und nicht tief in die Logik.
- Angriffe, Klassen, Segen, Steigerungen und Gegnerarten sind **Daten** (`weapons.ts`, `classes.ts`, `progression.ts`,
  `steigerung.ts`, `config.ts`). Neue Inhalte sind meist ein weiterer Eintrag, kein neuer Code-Pfad.
- Die Welt entsteht deterministisch aus einem Seed (`createRandom` in `src/core/random.ts`). Wer die Welt, die Kulisse
  oder das Spawnen ändert, nimmt diesen Zufall und nicht `Math.random`. `Math.random` ist nur für rein Optisches erlaubt.
- Im Kampf entstehen keine neuen Objekte: Teilchen, Gegner und Geschosse liegen in Pools bzw. Instanznetzen. Neue Effekte
  folgen diesem Muster, damit die Horde flüssig bleibt.
- Ton und Musik sind Dateien in `public/audio/`, die `public/audio/audio.json` den Ereignissen zuordnet. Im Code stehen keine
  Dateinamen, sondern Ereignisse: `audio.play('treffer.stahl', x, z)` (`src/audio/`; neue Namen kommen in `src/audio/ids.ts`).
  So lässt sich jeder Klang ohne Codeänderung austauschen. Mischregeln (Reichweite, Dämpfung in der Finsternis) stehen in
  `CONFIG.audio`. Es werden nur selbst erzeugte oder frei lizenzierte Klänge verwendet; ihre Herkunft steht in
  `public/audio/LIZENZEN.md`. Die mitgelieferten Dateien erzeugt `tools/audio-erzeugen.py` (ASCII-only, deterministisch).
- Entwicklungswerkzeuge (`src/tools/`, `modell.html`) gehören nicht ins fertige Spiel. Sie werden nur im Dev-Modus
  (`import.meta.env.DEV`) nachgeladen.

## Lore

Die Quellen liegen im Repository, jede Datei trägt die Wiki-URL in der ersten Zeile:

- `finsternis.md`: Staub, Nacht, Finsternis, Finsterlande.
- `magie_mystik/`: Katalog von Magie und Mystik. `start.md` erklärt, wie er zu lesen ist; die Unterordner `ghen/`, `sor/`,
  `dhargass/`, `branjur/`, `dundar/` und `mischdomaenen/` enthalten die Domänen mit ihren Effektfamilien; `maechte.md` ordnet
  die Domänen den Höheren Mächten zu (die Zuordnung ist dort teilweise noch offen).

**Die Wiki-Lore ist ein Leitfaden, keine Vorschrift.** Wo sie sich im Spiel nicht umsetzen lässt oder Probleme machen würde
(Spielbarkeit, Lesbarkeit, Leistung, Gleichgewicht), darf man von ihr abweichen. In dem Fall:

1. Die Abweichung klein halten und den Geist der Lore erhalten (Namen, Stimmung, Zusammenhänge).
2. In einem Kommentar oder in der Pull-Request-Beschreibung festhalten, **wovon** abgewichen wurde und **warum**.
3. Keine Lore erfinden, die der Quelle widerspricht, wenn eine Abweichung nicht nötig ist. Was im Spiel nur ein Vorschlag
   ist, wird als Vorschlag gekennzeichnet (so wie es `progression.ts` bei den Segen schon tut).

## Zielplattform offen: Browser jetzt, Desktop später möglich

Ob das Spiel im Browser bleibt oder als Desktop-Programm erscheint, ist noch nicht entschieden. Bis dahin:

- Das Spiel muss **im Browser lauffähig bleiben** (`npm run dev` und `npm run build` + `npm run preview`).
- Es darf **nichts eingebaut werden, was eine spätere Desktop-Hülle (Electron, Tauri o. ä.) verhindert**. Das heißt:
  - Der Build bleibt mit relativen Pfaden lauffähig (`base: './'` in `vite.config.ts` nicht ändern); Dateien aus `public/`
    werden über `import.meta.env.BASE_URL` geladen und nicht über absolute Pfade wie `/models/…`.
  - Keine Abhängigkeit von einem Server, Cookies oder einem festen Host. Alles Nötige steckt in `dist/`. Aus demselben Grund
    läuft der Stand von `main` nach jedem Merge unter dem Unterpfad `/dao-survivor/` auf GitHub Pages
    (`.github/workflows/pages.yml`); ein absoluter Pfad würde dort ins Leere laufen.
  - Eingabe nur über die Aktionen in `src/core/input.ts` (Gamepad kommt später dazu), nicht über verstreute Tastenabfragen.
  - Browser-APIs, die in einer Hülle fehlen können (etwa Vollbild, Zeigersperre, Speicher), nur mit Rückfall verwenden.
    Spielstand und Einstellungen liegen hinter einer kleinen Schicht, die sich austauschen lässt (`src/core/storage.ts`,
    `savegame.ts`, `settings.ts`); neue Daten, die bleiben sollen, gehören in den Spielstand und nicht direkt in `localStorage`.
    Das Format des Spielstands trägt eine Versionsnummer; wer es ändert, hebt sie an und hebt alte Stände in `parseSavegame` an.
  - Keine Node- oder Electron-Pakete in `src/` einziehen. Desktop-Code käme später in einen eigenen Ordner.
- Wer etwas ändert, das diese Linie berührt, erwähnt es im Pull Request.

## Arbeitsweise

- **Nie direkt auf `main`.** Jede Änderung entsteht auf einem eigenen Feature-Branch und kommt als **Pull Request an Fabian**
  (GitHub-Login `Ritek3000`). Fabian entscheidet über das Zusammenführen; Claude merged nicht selbst.
- Ein Pull Request, ein Thema. Lieber mehrere kleine als ein großer, der Aufräumen und neue Funktion mischt.
- Die Beschreibung sagt auf Deutsch, was sich ändert und warum, wie es geprüft wurde (`typecheck`, `build`, im Browser
  angesehen?) und ob von der Lore oder von diesen Regeln abgewichen wird.
- Commit-Nachrichten auf Deutsch, in der Gegenwart oder als kurzer Titel (wie im ersten Commit), mit Begründung im Text,
  wenn die Änderung nicht selbsterklärend ist.
- Vor dem Löschen oder Umbenennen von Dateien prüfen, ob sie irgendwo eingebunden sind (`grep`). Keine Sicherungskopien im
  Repository ablegen (`… - Kopie.ts` o. ä.); dafür gibt es Git.

## Dateien und Größen

- `public/models/` enthält nur spielfertige GLB-Dateien (wenige Tausend Dreiecke, kleine Texturen). Die schweren Meshy-Originale
  liegen lokal in `modelle-original/` und sind per `.gitignore` ausgeschlossen (GitHub erlaubt keine Dateien über 100 MB).
  Neue Modelle werden mit `tools/modelle-verkleinern.py` (Blender) aufbereitet und in `tools/modelle-verkleinern.json` eingetragen.
- `*.glb` gilt für Git als Binärdatei (`.gitattributes`). Binärdateien nur ändern, wenn es nötig ist; jede neue Fassung bläht
  die Historie auf.
- Neue Modelle bringt das Spiel mit `src/game/models.ts` auf seine Maße; ein fehlendes Modell fällt auf einen Platzhalter zurück.
  Mit `modell.html` (Modell-Prüfer) lässt sich ein neues Modell vor dem Einbau messen.
