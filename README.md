# Survivor-like in der Welt Ghen

Ein 3D-Survivor-like in der Spielwelt von **Die Alte Ordnung** (DAO). Eine Nacht dauert 15 Minuten:
Von der Abendglocke bis zum Sonnenaufgang hält sich die Spielfigur im Licht, entzündet Feuerschalen,
wehrt die Horde ab und widersteht dem Staub und der Finsternis. Gegen Ende der Nacht erscheint der Verschlinger.
Wer bis zum Sonnenaufgang überlebt, gewinnt.

Das Spiel ist ein früher Prototyp. Es gibt drei Klassen (Kämpfer, Wildnisläufer, Magier), Stufenaufstiege
mit Stärkungen, Segen der Höheren Mächte, eine Gegnerhorde, Feuerschalen als Lichtinseln und einen
Endgegner. Die Zielplattform (Browser oder Desktop) ist noch offen; vorerst läuft das Spiel im Browser.

## Schnellstart

Voraussetzung ist [Node.js](https://nodejs.org) (getestet mit Version 22) und ein Browser mit WebGL.

```bash
npm install        # Abhängigkeiten holen
npm run dev        # Entwicklungsserver auf http://localhost:5173
```

| Befehl              | Wirkung                                                              |
| ------------------- | -------------------------------------------------------------------- |
| `npm run dev`       | Entwicklungsserver mit Hot Reload (Port 5173, fest)                  |
| `npm run typecheck` | TypeScript prüfen, ohne etwas zu erzeugen                            |
| `npm run build`     | Typen prüfen und das fertige Spiel nach `dist/` bauen                |
| `npm run preview`   | Den gebauten Stand aus `dist/` lokal ansehen                         |

Es gibt noch keine automatischen Tests. Vor jedem Pull Request müssen `npm run typecheck` und
`npm run build` fehlerfrei laufen.

## Steuerung

| Taste                      | Aktion                                  |
| -------------------------- | --------------------------------------- |
| WASD oder Pfeiltasten      | Bewegen                                 |
| Esc oder P                 | Pause (dort stehen auch die Tonregler)  |
| M                          | Ton an oder aus                         |
| 1, 2, 3 oder Pfeile, Enter | Klasse und Stärkungen wählen, Bestätigen |

Die Eingabe läuft über Aktionen (`src/core/input.ts`), damit später ein Gamepad ohne Eingriff in die
Spiellogik dazukommen kann.

## Technik

- **Three.js** für die 3D-Darstellung, **TypeScript** (strikt) und **Vite** als Entwicklungsserver und Bündler.
- Keine Spiel-Engine und kein UI-Framework: Das HUD ist einfaches HTML aus `index.html`, gesteuert von `src/ui/hud.ts`.
- Modelle sind GLB-Dateien in `public/models`. Fehlt ein Modell, steht stattdessen ein Platzhalter da.
- Ton und Musik kommen aus Dateien in `public/audio`, die `public/audio/audio.json` den Ereignissen zuordnet (Web Audio, ohne Bibliothek).
- Der Boden, die Effekte und die Finsternis entstehen zur Laufzeit aus Shadern und Texturen, nicht aus Dateien.
- Gegner laufen mit gebackener Bewegung (Vertex-Animation-Textur, `src/game/vat.ts`), damit die Horde flüssig bleibt.

## Aufbau des Projekts

```
index.html            Seite des Spiels mit allen HUD-Elementen
modell.html           Modell-Prüfer (nur für die Entwicklung, nicht Teil des Spiels)
finsternis.md         Lore-Quelle: Staub und Finsternis
magie_mystik/         Lore-Quelle: Katalog von Magie und Mystik, geordnet nach Domänen und Mächten
public/models/        Spielfertige GLB-Modelle (Figuren, Gegner, Kulisse unter welt/)
public/audio/         Klänge und Musik (sfx/, schleifen/, musik/) und audio.json, die Zuordnung Ereignis → Datei
src/
  main.ts             Einstieg: baut das Spiel und hängt Entwicklungswerkzeuge nur im Dev-Modus an
  config.ts           Zentrale Stellschrauben: Nachtdauer, Welt, Gegnerarten, Kulisse
  core/               Eingabe, deterministischer Zufall, Raumgitter, Einstellungen (Tonregler)
  audio/              Ton und Musik: Engine, Ereignisnamen, Lesen von audio.json
  game/               Spiellogik und Darstellung (siehe unten)
  ui/hud.ts           Anzeigen, Auswahlkarten, Pause, Ende
  tools/              Entwicklungswerkzeuge: Messlauf und Modell-Prüfer
tools/                Skripte außerhalb des Spiels (Blender: Modelle verkleinern; Python: Klänge erzeugen)
```

Wichtige Teile von `src/game/`:

| Datei                          | Inhalt                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| `game.ts`                      | Hauptschleife und Phasen (Laden, Klassenwahl, Spiel, Pause, Ende)       |
| `classes.ts`                   | Die drei Klassen mit Werten, Modell und Ausrüstung                      |
| `weapons.ts`, `arsenal.ts`     | Alle Angriffe als Daten und ihre Ausführung                             |
| `effects.ts`, `strips.ts`, `particles.ts`, `props.ts` | Wie die Angriffe aussehen                        |
| `enemies.ts`, `boss.ts`, `threats.ts` | Horde, Verschlinger und die Zauber der Gegner                    |
| `progression.ts`               | Stufen, Stärkungen und die Segen der Höheren Mächte                     |
| `zones.ts`, `darkness.ts`, `dust.ts` | Lichtinseln, Finsternis und Verstaubung                           |
| `world.ts`, `ground.ts`, `scenery.ts` | Welt, Boden und Kulisse                                          |
| `models.ts`                    | Lädt GLB-Dateien und bringt sie auf die Maße, die das Spiel braucht     |

## Ton und Musik

Alle Klänge liegen als einzelne Dateien in `public/audio/` (`sfx/` für Töne, `schleifen/` für Dauerklänge, `musik/` für Stücke).
Im Code kommt kein Dateiname vor: Das Spiel meldet nur Ereignisse (etwa `treffer.stahl` oder `boss.erscheint`), und
`public/audio/audio.json` sagt, welche Datei dazu klingt. Zu jedem Eintrag steht dort eine kurze Beschreibung, wann er ausgelöst wird.
Die mitgelieferten Dateien sind **Platzhalter**, die `tools/audio-erzeugen.py` aus Rechnung erzeugt hat (Lizenzen: `public/audio/LIZENZEN.md`).

### Einen Klang austauschen

Ohne Änderung am Code, auch im fertigen Spiel unter `dist/`:

1. **Gleicher Name:** Die Datei in `public/audio/` durch die eigene ersetzen, die denselben Namen trägt. Das Format ist egal, solange der
   Browser es abspielt (OGG, WAV, MP3); die Endung muss zum Namen im Eintrag passen.
2. **Neuer Name:** Die eigene Datei in `public/audio/` ablegen und in `audio.json` beim Ereignis unter `"datei"` ihren Namen eintragen.
3. **Mehrere Varianten:** `"datei"` kann eine Liste sein. Bei jedem Abspielen wird eine zufällig gewählt (so klingen Treffer nicht gleich).

Danach die Seite neu laden. Fehlt eine Datei oder lässt sie sich nicht lesen, bleibt dieses Ereignis stumm, steht eine Meldung in der
Browser-Konsole, und das Spiel läuft weiter. Ein Ereignis ohne Eintrag ist ebenfalls stumm.

### Felder in `audio.json`

| Abschnitt     | Was darin steht                                                                        |
| ------------- | -------------------------------------------------------------------------------------- |
| `ereignisse`  | Kurze Töne: Angriffe, Treffer, Feuerschalen, Boss, Oberfläche                          |
| `schleifen`   | Dauerklänge, deren Lautstärke das Spiel führt: Feuerknistern, Wind, Finsternis         |
| `musik`       | Stücke; immer nur eines zugleich, Wechsel mit Überblendung                             |

| Feld           | Gilt für            | Bedeutung                                                                                    |
| -------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| `datei`        | alle                | Pfad unter `public/audio`; bei Ereignissen auch eine Liste von Pfaden                        |
| `lautstaerke`  | alle                | Faktor auf die Lautstärke, 1 = unverändert                                                   |
| `streuung`     | Ereignisse          | Zufällige Abweichung der Tonhöhe in Cent (100 Cent = ein Halbton)                            |
| `abstand`      | Ereignisse          | Mindestsekunden zwischen zwei Wiedergaben, damit Dauerfeuer nicht zum Brei wird              |
| `reichweite`   | Ereignisse, Schleifen | Meter, ab denen ein Ton mit Ort nicht mehr zu hören ist                                    |
| `prioritaet`   | Ereignisse          | 0 (Nebensache) bis 3 (muss klingen); bei Andrang verdrängt Wichtiges Unwichtiges             |
| `schleife`     | Musik               | `false`: Das Stück spielt einmal und endet (Sieg, Niederlage)                                |
| `einblenden`   | Musik               | Sekunden der Überblendung vom vorigen Stück                                                  |

Namen mit Punkt haben einen **Rückfall**: Gibt es für `gegner-tod.brute` keinen Eintrag, gilt `gegner-tod`. Eine neue Waffe (`angriff.<id>`),
eine neue Gegnerart (`gegner-tod.<id>`, `gegner-laut.<id>`) braucht also nur dann einen eigenen Klang, wenn sie einen haben soll;
trägt man ihn in `audio.json` ein, klingt er ohne Änderung am Code. Ein neues *Ereignis* dagegen muss einmal im Code gemeldet werden
(`audio.play('name', x, z)`, den Namen vorher in `src/audio/ids.ts` eintragen).

Bei Musik, die in der Schleife läuft, sollte das Stück nahtlos enden und beginnen. OGG und WAV tun das; MP3 hat am Anfang und Ende kurze Lücken.

### Lautstärke und Stummschalten

Im Pausenbild (Esc oder P) stehen drei Regler: Gesamt, Effekte, Musik. Die Taste **M** schaltet den Ton überall an oder aus, auch im Menü; ein
Hinweis unten rechts erinnert daran, solange er aus ist. Die Einstellung bleibt erhalten (`localStorage`, mit Rückfall auf den Speicher der Sitzung).
Browser spielen erst nach der ersten Eingabe Ton ab: Bis zur ersten Taste oder dem ersten Klick bleibt die Klassenwahl still.

### Wie der Ton abgemischt wird

- Töne mit Ort (Treffer, Gegner, Feuerschalen, Boss) werden mit der Entfernung zur Spielfigur leiser und liegen links oder rechts, je nachdem, wo sie sind.
- **In der Finsternis werden Geräusche gedämpft**, so wie es `finsternis.md` beschreibt („Schritte werden zu Flüstern und Rufe verhallen nach wenigen Metern“):
  In einer Schwade sinkt die Grenzfrequenz, die Lautstärke und die Reichweite; auch die Musik wird dumpf, und ein tiefes Brummen setzt ein.
  Töne, die in einer Schwade entstehen, klingen auch von außen dumpf.
- Die Musik folgt dem Spiel: Klassenwahl, Nacht, dichtere Nacht ab der 8. Minute, Verschlinger, danach ein kurzes Stück für Sieg oder Niederlage.
  In der Pause und bei der Wahl einer Stärkung tritt sie zurück.
- Alle Zahlen der Abmischung stehen in `CONFIG.audio` (`src/config.ts`).

### Klänge neu erzeugen

```bash
python tools/audio-erzeugen.py                 # alles
python tools/audio-erzeugen.py --only boss     # nur Dateien, deren Name "boss" enthält
```

Das Skript braucht Python 3, `numpy` und `ffmpeg`. Es schreibt dieselben Dateien, die schon im Repository liegen, und überschreibt dabei eigene
Dateien mit gleichem Namen. Neu erzeugte OGG-Dateien nur einchecken, wenn sich der Klang ändern soll: Jede Fassung vergrößert die Git-Historie.

## Entwicklungswerkzeuge

- **Messlauf** (`src/tools/messlauf.ts`): Im Dev-Modus steht `__messlauf` in der Browser-Konsole. Eine Automatik-Figur
  spielt Nächte im Zeitraffer und zeigt grobe Schieflagen im Gleichgewicht. Beispiele stehen im Kopf der Datei.
- **Ton**: Im Dev-Modus steht `__audio` in der Konsole. `__audio.played` zählt, wie oft jedes Ereignis erklang, `__audio.dropped`, wie viele
  Töne bei Andrang verworfen wurden. Der Messlauf schaltet den Ton für die Dauer des Laufs ab.
- **Modell-Prüfer**: `http://localhost:5173/modell.html` zeigt eine GLB-Datei im Licht und aus der Kamera des Spiels
  und misst sie an den Vorgaben für Gegner und Figuren.
- **Modelle verkleinern**: `tools/modelle-verkleinern.py` macht aus schweren Meshy-Exporten spielfertige Kopien.
  Es läuft in Blender (`blender --background --factory-startup --python tools/modelle-verkleinern.py`). Die schweren
  Originale liegen im Ordner `modelle-original/`, der wegen seiner Größe nicht im Repository ist (siehe `.gitignore`).

## Lore

Die Spielwelt folgt dem Wiki von Die Alte Ordnung: <https://wiki.dao-rpg.de>. Die für das Spiel nötigen Seiten liegen als
Markdown im Repository, jede mit der Quell-URL in der ersten Zeile:

- `finsternis.md`: Staub, Nacht, Finsternis und Finsterlande.
- `magie_mystik/`: Magie und Mystik. Die Domänen (Ghen, Sor, Dhargass, Branjur, Dundar, Mischdomänen) liefern die
  Zauber und Segen, `maechte.md` ordnet sie den Höheren Mächten zu.

Das Wiki ist ein **Leitfaden**, keine Vorschrift. Wo sich etwas im Spiel nicht umsetzen lässt oder Probleme machen würde,
darf das Spiel davon abweichen.

## Zielplattform

Offen ist, ob das Spiel im Browser bleibt oder als Desktop-Programm erscheint. Bis das entschieden ist, läuft es im Browser,
und nichts im Code soll eine spätere Desktop-Hülle (etwa Electron oder Tauri) verbauen. Der Build verwendet deshalb
relative Pfade (`base: './'` in `vite.config.ts`), und Dateien (Modelle, Klänge) werden über `import.meta.env.BASE_URL` geladen.

## Mitarbeit

Jede Änderung entsteht auf einem eigenen Branch und kommt als Pull Request an Fabian. Auf `main` wird nicht direkt
gearbeitet. Die Arbeitsregeln für Claude stehen in [`CLAUDE.md`](CLAUDE.md).
