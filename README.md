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
| Esc oder P                 | Pause                                   |
| 1, 2, 3 oder Pfeile, Enter | Klasse und Stärkungen wählen, Bestätigen |

Die Eingabe läuft über Aktionen (`src/core/input.ts`), damit später ein Gamepad ohne Eingriff in die
Spiellogik dazukommen kann.

## Technik

- **Three.js** für die 3D-Darstellung, **TypeScript** (strikt) und **Vite** als Entwicklungsserver und Bündler.
- Keine Spiel-Engine und kein UI-Framework: Das HUD ist einfaches HTML aus `index.html`, gesteuert von `src/ui/hud.ts`.
- Modelle sind GLB-Dateien in `public/models`. Fehlt ein Modell, steht stattdessen ein Platzhalter da.
- Der Boden, die Effekte und die Finsternis entstehen zur Laufzeit aus Shadern und Texturen, nicht aus Dateien.
- Gegner laufen mit gebackener Bewegung (Vertex-Animation-Textur, `src/game/vat.ts`), damit die Horde flüssig bleibt.

## Aufbau des Projekts

```
index.html            Seite des Spiels mit allen HUD-Elementen
modell.html           Modell-Prüfer (nur für die Entwicklung, nicht Teil des Spiels)
finsternis.md         Lore-Quelle: Staub und Finsternis
magie_mystik/         Lore-Quelle: Katalog von Magie und Mystik, geordnet nach Domänen und Mächten
public/models/        Spielfertige GLB-Modelle (Figuren, Gegner, Kulisse unter welt/)
src/
  main.ts             Einstieg: baut das Spiel und hängt Entwicklungswerkzeuge nur im Dev-Modus an
  config.ts           Zentrale Stellschrauben: Nachtdauer, Welt, Gegnerarten, Kulisse
  core/               Eingabe, deterministischer Zufall, Raumgitter für Nachbarschaftsabfragen
  game/               Spiellogik und Darstellung (siehe unten)
  ui/hud.ts           Anzeigen, Auswahlkarten, Pause, Ende
  tools/              Entwicklungswerkzeuge: Messlauf und Modell-Prüfer
tools/                Skripte außerhalb des Spiels (Blender: Modelle verkleinern)
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

## Entwicklungswerkzeuge

- **Messlauf** (`src/tools/messlauf.ts`): Im Dev-Modus steht `__messlauf` in der Browser-Konsole. Eine Automatik-Figur
  spielt Nächte im Zeitraffer und zeigt grobe Schieflagen im Gleichgewicht. Beispiele stehen im Kopf der Datei.
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
relative Pfade (`base: './'` in `vite.config.ts`), und Dateien werden über `import.meta.env.BASE_URL` geladen.

## Mitarbeit

Jede Änderung entsteht auf einem eigenen Branch und kommt als Pull Request an Fabian. Auf `main` wird nicht direkt
gearbeitet. Die Arbeitsregeln für Claude stehen in [`CLAUDE.md`](CLAUDE.md).
