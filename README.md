# Survivor-like in der Welt Ghen

Ein 3D-Survivor-like in der Spielwelt von **Die Alte Ordnung** (DAO). Eine Nacht dauert 15 Minuten:
Von der Abendglocke bis zum Sonnenaufgang hält sich die Spielfigur im Licht, entzündet Feuerschalen,
wehrt die Horde ab und widersteht dem Staub und der Finsternis. Gegen Ende der Nacht erscheint der Verschlinger.
Wer bis zum Sonnenaufgang überlebt, gewinnt.

Das Spiel ist ein früher Prototyp. Es gibt drei Klassen (Kämpfer, Wildnisläufer, Magier), Stufenaufstiege
mit Stärkungen, Segen der Höheren Mächte, eine Gegnerhorde, Feuerschalen als Lichtinseln und einen
Endgegner. Das Gold, das eine Nacht einbringt, bezahlt zwischen den Nächten dauerhafte Steigerungen jeder Klasse
(siehe [Gold und Steigerungen](#gold-und-steigerungen)). Die Zielplattform (Browser oder Desktop) ist noch offen;
vorerst läuft das Spiel im Browser.

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

## Online ausprobieren (GitHub Pages)

Nach jedem Merge auf `main` baut GitHub das Spiel und veröffentlicht den Stand unter
**<https://ritek3000.github.io/dao-survivor/>**. So lässt sich jede Änderung sofort im Browser testen, ohne etwas zu installieren.

- Der Ablauf steht in `.github/workflows/pages.yml`: `npm ci`, `npm run build` (inklusive Typprüfung), dann Veröffentlichen von `dist/`.
  Schlägt der Build fehl, bleibt die zuletzt veröffentlichte Seite unverändert. Den Stand der Läufe zeigt der Reiter **Actions**;
  dort lässt sich die Veröffentlichung auch von Hand starten („Run workflow“).
- Nach einem Merge dauert es in der Regel wenige Minuten, bis der neue Stand online ist. Danach hilft bei Bedarf ein hartes Neuladen
  (Strg + F5), weil der Browser alte Dateien behalten kann.
- Die Modelle sind zusammen etwa 107 MB groß. Beim ersten Aufruf lädt das Spiel deshalb eine Weile; spätere Aufrufe kommen aus dem Browser-Cache.
- Einmalig muss in den Repository-Einstellungen unter **Settings → Pages → Build and deployment → Source** der Wert
  **GitHub Actions** gewählt sein. Bei einem kostenlosen GitHub-Konto muss das Repository dafür öffentlich sein.

## Steuerung

| Taste                      | Aktion                                  |
| -------------------------- | --------------------------------------- |
| WASD oder Pfeiltasten      | Bewegen                                 |
| Esc oder P                 | Pause (Weiter, Optionen, Lauf abbrechen); in Menüs zurück; bei der Klassenwahl und am Ende der Nacht zum Startbildschirm |
| M                          | Ton an oder aus                         |
| 1, 2, 3 oder Pfeile, Enter | Klasse und Stärkungen wählen, Bestätigen |
| U                          | Steigerungen öffnen (bei der Klassenwahl und am Ende der Nacht) |

Im Menü der Steigerungen wählen Auf und Ab (W, S oder Pfeile) die Steigerung, Links und Rechts (oder 1, 2, 3) die Klasse,
Enter kauft den nächsten Rang, Esc oder U führen zurück.

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
  core/               Eingabe, deterministischer Zufall, Raumgitter, Einstellungen (Ton, Stelle der Lebensgruppe), Spielstand (Gold, Steigerungen)
  audio/              Ton und Musik: Engine, Ereignisnamen, Lesen von audio.json
  game/               Spiellogik und Darstellung (siehe unten)
  ui/                 hud.ts: Anzeigen, Auswahlkarten, Ende; menus.ts: Startbildschirm, Pause, Optionen, Anleitung, Rückfragen
  tools/              Entwicklungswerkzeuge: Messlauf und Modell-Prüfer
tools/                Skripte außerhalb des Spiels (Blender: Modelle verkleinern, Priester und Mantelträger animieren; Python: Klänge erzeugen, Sor-Symbol und Favicon aufbereiten)
.github/workflows/    GitHub Actions: Veröffentlichung auf GitHub Pages (pages.yml)
```

Wichtige Teile von `src/game/`:

| Datei                          | Inhalt                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| `game.ts`                      | Hauptschleife und Phasen (Laden, Startbildschirm, Klassenwahl, Spiel, Pause, Ende) |
| `classes.ts`                   | Die drei Klassen mit Werten, Modell und Ausrüstung                      |
| `weapons.ts`, `arsenal.ts`     | Alle Angriffe als Daten und ihre Ausführung                             |
| `effects.ts`, `strips.ts`, `particles.ts`, `props.ts` | Wie die Angriffe aussehen                        |
| `enemies.ts`, `boss.ts`, `threats.ts` | Horde, Verschlinger und die Zauber der Gegner                    |
| `progression.ts`               | Stufen, Stärkungen und die Segen der Höheren Mächte                     |
| `steigerung.ts`, `coins.ts`    | Dauerhafte Steigerungen der Klassen und die Münzen, die das Gold bringen |
| `zones.ts`, `darkness.ts`, `dust.ts` | Lichtinseln, Finsternis und Verstaubung                           |
| `world.ts`, `ground.ts`, `scenery.ts` | Welt, Boden und Kulisse                                          |
| `models.ts`                    | Lädt GLB-Dateien und bringt sie auf die Maße, die das Spiel braucht     |

## Menüs und Oberfläche

**Startbildschirm** (nach dem Laden): *Neues Spiel*, *Spiel fortsetzen*, *Optionen* und *Anleitung*. „Spiel fortsetzen“ erscheint nur, wenn es einen
Spielstand gibt (Gold in der Börse oder gekaufte Ränge) und führt zur Klassenwahl. „Neues Spiel“ setzt den dauerhaften Fortschritt zurück
(Gold und Steigerungen aller Klassen; die Optionen bleiben). Gibt es einen Fortschritt, warnt davor eine Rückfrage, die nennt, was verloren ginge
(vorgewählt ist „Abbrechen“); ohne Fortschritt geht es sofort weiter. Von der Klassenwahl und vom Ende der Nacht führt **Esc** (oder der Knopf
„Hauptmenü“) zurück zum Startbildschirm. Die **Anleitung** erklärt Ziel, Steuerung, Licht und Finsternis, Stufen, Gold und die Klassen
(Text in `index.html`).

**Pause** (Esc oder P): *Weiter*, *Optionen* und *Lauf abbrechen*. Wer den Lauf abbricht, bestätigt zuerst eine Rückfrage; die Nacht endet dann
wie bei einem Sturz (Ertrag nach `CONFIG.gold.deathKeep`) mit der Endanzeige „Lauf abgebrochen“.

**Optionen** haben zwei Gruppen: *Ton* (Regler und „Ton aus“) und *Oberfläche* mit **Lebensbalken platzieren**. Gewählt wird die Stelle der
Lebensgruppe (Stufe im Kreis, Lebensbalken, Gold im Geldbeutel): oben links, oben rechts, unten links, unten Mitte oder unten rechts. Die Gruppe
wandert als Ganzes; was dort sonst stünde (Hinweis, Tonmeldung, Feuer entzünden), weicht aus. Bedienung mit der Maus oder mit den Tasten
(Auf und Ab wählen die Zeile, Links und Rechts ändern, Enter schaltet um, Esc geht zurück).

Alle Einstellungen bleiben erhalten (`localStorage`, Schlüssel `dao-survivor.einstellungen`, siehe `src/core/settings.ts`); Stände ohne die Stelle der
Lebensgruppe gelten als „oben links“. Die Menüs stehen in `index.html`, bedient werden sie von `src/ui/menus.ts`; was ein Knopf bewirkt,
entscheidet `Game.onMenuCommand`.

## Gold und Steigerungen

Jede Nacht bringt Gold ein. Damit steigert man zwischen den Nächten die Klassen. Das Gold gehört allen Klassen gemeinsam
(eine Geldbörse), die Ränge der Steigerungen zählen aber **je Klasse einzeln**: Wer den Magier steigert, hat davon beim Kämpfer nichts.

**Woher das Gold kommt.** Alle Zahlen stehen in `CONFIG.gold` und bei den Gegnerarten (`gold`) in `src/config.ts`:

- *Münzen aus Gegnern.* Jede Gegnerart lässt mit einer Wahrscheinlichkeit eine Münze fallen (der Schänder oft für 1 Gold, der Troll
  meist für 5). Die Münzen fliegen wie die Edelsteine zur Figur, sobald sie im Sammelradius liegen. Kupfer, Silber und Gold der Münze
  sagen nur, wie viel sie wert ist (ab 5 und ab 25 Gold).
- *Der Verschlinger* lässt beim Sturz einen Kranz von Münzen fallen.
- *Sold:* Gold für jede volle Minute, die man überlebt hat.
- *Prämie* bei Sonnenaufgang.
- *Tod:* Wer fällt, behält den Anteil `deathKeep` des Ertrags. Jetzt ist er 1: Wer fällt, behält alles. Ein kleinerer Wert macht aus
  dem Tod einen Abzug.

Gutgeschrieben wird am Ende der Nacht (Sold und Prämie werden dann erst gerechnet); wer die Seite mitten in der Nacht schließt,
verliert das Gold dieser Nacht. Die Endanzeige schlüsselt den Ertrag auf.

**Was man kauft.** Die Steigerungen sind Daten in `src/game/steigerung.ts` (`STEIGERUNGEN`): Sammelradius, Erfahrung, Gold, Schaden,
Angriffstempo, Lauftempo, Chance auf doppelten Schaden, Reichweite, Leben, Rüstung, Staubfestigkeit und Lichtschein. Jeder Eintrag
nennt Wirkung je Rang, Höchstrang und Preis des ersten Rangs; jeder weitere Rang kostet `CONFIG.gold.upgradeGrowth`-mal so viel.
Eine neue Steigerung ist ein weiterer Eintrag. Beim Start einer Nacht wirken die Ränge der gewählten Klasse auf die Werte der Figur
(`Progression.reset`); die Stärkungen und Segen der Nacht kommen obendrauf.

**Menü.** Bei der Klassenwahl und am Ende der Nacht öffnet die Taste **U** (oder der Knopf) das Menü der Steigerungen für die gewählte
bzw. gerade gespielte Klasse.

**Speicherung.** Gold und Ränge liegen im Browser (`localStorage`, Schlüssel `dao-survivor.spielstand`) als JSON mit Versionsnummer
(`version`, jetzt 1). Der Zugriff steckt hinter `TextStore` in `src/core/storage.ts` und `src/core/savegame.ts`; wo `localStorage` fehlt oder
gesperrt ist, gilt der Stand nur für die Sitzung. Eine Desktop-Fassung kann mit `useSavegameStore` eine Datei an die Stelle setzen.
Ein unlesbarer Stand beginnt bei null; was das Spiel nicht kennt (etwa eine entfernte Steigerung), bleibt beim Speichern erhalten.
Zurücksetzen lässt sich der Stand mit „Neues Spiel“ im Startbildschirm (mit Rückfrage); in den Entwicklerwerkzeugen genügt auch `localStorage.removeItem('dao-survivor.spielstand')`.

**Gleichgewicht.** Der Messlauf rechnet standardmäßig ohne Steigerungen (so bleiben die Zahlen vergleichbar) und schreibt das Gold jeder Nacht
mit (`gold`). `__messlauf.start({ steigerung: 'max' })` lässt alle Klassen voll gesteigert antreten, `{ steigerung: 3 }` auf Rang 3. Der
echte Spielstand wird dabei weder gelesen noch verändert.

Abweichungen von der Lore: Die Währung der Spielwelt sind Kupferpfennig, Silbermark und Goldkrone (100 Pfennig = 1 Mark, 100 Mark = 1 Krone).
Im Spiel heißt sie schlicht Gold, und die drei Münzfarben stehen für kleine, mittlere und große Beträge im Verhältnis 1 zu 5 zu 25,
sonst gäbe es keine Goldkronen zu sehen. Auch dass man mit Gold Werte steigert, ist eine Spielvereinfachung: In der Lore kaufen
Spielende Steigerungen mit Charakterpunkten (`Steigerungskosten`), nicht mit Geld; die steigenden Preise je Rang stammen von dort.

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

In den Optionen (Pause: Esc oder P, dann **Optionen**) stehen drei Regler: Gesamt, Effekte, Musik, dazu das Häkchen „Ton aus“. Die Taste **M** schaltet den Ton überall an oder aus, auch im Menü; ein
Hinweis unten rechts erinnert daran, solange er aus ist. Die Einstellung bleibt erhalten (`localStorage`, mit Rückfall auf den Speicher der Sitzung).
Browser spielen erst nach der ersten Eingabe Ton ab: Bis zur ersten Taste oder dem ersten Klick bleibt der Startbildschirm still.

### Wie der Ton abgemischt wird

- Töne mit Ort (Treffer, Gegner, Feuerschalen, Boss) werden mit der Entfernung zur Spielfigur leiser und liegen links oder rechts, je nachdem, wo sie sind.
- **In der Finsternis werden Geräusche gedämpft**, so wie es `finsternis.md` beschreibt („Schritte werden zu Flüstern und Rufe verhallen nach wenigen Metern“):
  In einer Schwade sinkt die Grenzfrequenz, die Lautstärke und die Reichweite; auch die Musik wird dumpf, und ein tiefes Brummen setzt ein.
  Töne, die in einer Schwade entstehen, klingen auch von außen dumpf.
- Die Musik folgt dem Spiel: Startbildschirm und Klassenwahl, Nacht, dichtere Nacht ab der 8. Minute, Verschlinger, danach ein kurzes Stück für Sieg oder Niederlage.
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
  spielt Nächte im Zeitraffer und zeigt grobe Schieflagen im Gleichgewicht, auch beim Gold. Beispiele stehen im Kopf der Datei.
- **Ton**: Im Dev-Modus steht `__audio` in der Konsole. `__audio.played` zählt, wie oft jedes Ereignis erklang, `__audio.dropped`, wie viele
  Töne bei Andrang verworfen wurden. Der Messlauf schaltet den Ton für die Dauer des Laufs ab.
- **Modell-Prüfer**: `http://localhost:5173/modell.html` zeigt eine GLB-Datei im Licht und aus der Kamera des Spiels
  und misst sie an den Vorgaben für Gegner und Figuren.
- **Modelle verkleinern**: `tools/modelle-verkleinern.py` macht aus schweren Meshy-Exporten spielfertige Kopien.
  Es läuft in Blender (`blender --background --factory-startup --python tools/modelle-verkleinern.py`). Die schweren
  Originale liegen im Ordner `modelle-original/`, der wegen seiner Größe nicht im Repository ist (siehe `.gitignore`).
- **Sor-Symbol und Favicon**: Das Symbol (`public/sor-symbol.png`, durchsichtiger Hintergrund) steht über dem Titel des Startbildschirms.
  `tools/symbol-erzeugen.py` schneidet es zu und erzeugt daraus `public/favicon.ico` (16, 32 und 48 Pixel); es braucht Python mit Pillow
  (`python tools/symbol-erzeugen.py`, oder mit dem Pfad eines neuen Quellbilds als Argument).
- **Priester animieren**: Die Datei des Priesters kam ohne Animationen aus Meshy. `tools/priester-animieren.py` legt in Blender
  „Schweben“ (Schleife) und „Zaubern“ (einmalig) an seinem Skelett an und schreibt `public/models/priester.glb`
  (`blender --background --factory-startup --python tools/priester-animieren.py -- modelle-original/priester.glb public/models/priester.glb`).
  Die Bewegung steht als Zahlen im Skript. Das Spiel spielt „Schweben“ nach der Zeit und „Zaubern“ gedehnt über `cast.windup`.
- **Mantelträger animieren**: Auch das Modell des Mantelträgers kam ohne Animationen. `tools/manteltraeger-animieren.py` legt in
  Blender „Laufen“ (Schleife, Fußsohlen bleiben beim Schritt am Boden) und „Krallenhieb“ (einmalig) an und schreibt
  `public/models/manteltraeger.glb`; Netz und Texturen bleiben unverändert
  (`blender --background --factory-startup --python tools/manteltraeger-animieren.py -- modelle-original/manteltraeger.glb public/models/manteltraeger.glb`).
  Das Spiel spielt „Laufen“ nach der zurückgelegten Strecke (`stride`) und „Krallenhieb“ in Echtzeit: Der Gegner holt aus, am
  Boden erscheint die Warnfläche, und der Treffer fällt `strike.hitAt` Sekunden nach Beginn des Hiebs. Wer ausweicht, bleibt unverletzt.

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
Dieselben relativen Pfade tragen auch die Seite auf GitHub Pages, die unter dem Unterpfad `/dao-survivor/` liegt.

## Mitarbeit

Jede Änderung entsteht auf einem eigenen Branch und kommt als Pull Request an Fabian. Auf `main` wird nicht direkt
gearbeitet. Die Arbeitsregeln für Claude stehen in [`CLAUDE.md`](CLAUDE.md).
