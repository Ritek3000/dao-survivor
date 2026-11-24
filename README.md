# Survivor-like in der Welt Ghen

Ein 3D-Survivor-like in der Spielwelt von **Die Alte Ordnung** (DAO). Eine Nacht dauert 15 Minuten:
Von der Abendglocke bis zum Sonnenaufgang hält sich die Spielfigur im Licht, entzündet Feuerschalen,
wehrt die Horde ab und widersteht dem Staub und der Finsternis. Nach fünf Minuten erscheint der Stachelträger, gegen Ende der Nacht der Verschlinger.
Wer bis zum Sonnenaufgang überlebt, gewinnt.

Das Spiel ist ein früher Prototyp. Es gibt drei Klassen (Kämpfer, Wildnisläufer, Magier) mit je sieben Fertigkeiten
und deren Evolutionen, Stufenaufstiege mit Stärkungen, Segen der Höheren Mächte, eine Gegnerhorde, Feuerschalen als Lichtinseln und zwei
Bosse. Das Gold, das eine Nacht einbringt, kauft zwischen den Nächten beim Händler im Lager Gegenstände für die Klassen
(siehe [Gold](#gold) und [Gegenstände](#gegenstände)); ein legendärer Ring schaltet die Evolution einer Fertigkeit frei (siehe [Evolutionen](#evolutionen)). Die Zielplattform (Browser oder Desktop) ist noch offen;
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
  (Strg + F5), weil der Browser alte Dateien behalten kann. Ob der neue Stand läuft, zeigt die Versionsnummer unten rechts auf dem
  Startbildschirm (siehe [Mitarbeit](#mitarbeit)).
- Die Modelle sind zusammen etwa 107 MB groß. Beim ersten Aufruf lädt das Spiel deshalb eine Weile; spätere Aufrufe kommen aus dem Browser-Cache.
- Einmalig muss in den Repository-Einstellungen unter **Settings → Pages → Build and deployment → Source** der Wert
  **GitHub Actions** gewählt sein. Bei einem kostenlosen GitHub-Konto muss das Repository dafür öffentlich sein.

## Steuerung

| Taste                      | Aktion                                  |
| -------------------------- | --------------------------------------- |
| WASD oder Pfeiltasten      | Bewegen                                 |
| Esc oder P                 | Pause (Weiter, Optionen, Lauf abbrechen); in Menüs zurück; bei der Klassenwahl und am Ende der Nacht zum Startbildschirm |
| M                          | Ton an oder aus                         |
| 1, 2, 3 oder Pfeile, Enter (auch Leertaste) | Klasse und Stärkungen wählen, Bestätigen; beim Startangriff gelten 1 bis 7; in der Anleitung blättern Auf und Ab |
| 1 bis 4 (bei der Nachtart) | Nachtart wählen; Esc führt jeweils einen Schritt zurück |
| Pfeil hoch und runter, W und S oder + und − (bei der Nachtart) | Grad der gewählten Nachtart ändern, sobald man sie einmal geschafft hat (siehe [Grade der Nächte](#grade-der-nächte)) |
| R, X (beim Stufenaufstieg) | Karten neu würfeln; eine Karte verbannen (danach die Karte wählen, X oder Esc bricht ab) |
| L oder U                   | Lager öffnen: Ausrüstung, Truhe und Händler (bei der Klassenwahl und am Ende der Nacht; sobald es Gegenstände oder Gold gibt, siehe [Gegenstände](#gegenstände)). U war die Taste der entfallenen Steigerungen |
| Tab, E (im Lager)          | Ansicht wechseln (Ausrüstung, Truhe, Händler); Gegenstand gleich anlegen, umräumen, beim Händler kaufen oder verkaufen |

Die Eingabe läuft über Aktionen (`src/core/input.ts`), damit später ein Gamepad ohne Eingriff in die
Spiellogik dazukommen kann.

## Technik

- **Three.js** für die 3D-Darstellung, **TypeScript** (strikt) und **Vite** als Entwicklungsserver und Bündler.
- Keine Spiel-Engine und kein UI-Framework: Das HUD ist einfaches HTML aus `index.html`, gesteuert von `src/ui/hud.ts`.
- Modelle sind GLB-Dateien in `public/models`. Fehlt ein Modell, steht stattdessen ein Platzhalter da.
- Ton und Musik kommen aus Dateien in `public/audio`, die `public/audio/audio.json` den Ereignissen zuordnet (Web Audio, ohne Bibliothek).
- Der Boden, die Effekte und die Finsternis entstehen zur Laufzeit aus Shadern und Texturen, nicht aus Dateien.
- Gegner laufen mit gebackener Bewegung (Vertex-Animation-Textur, `src/game/vat.ts`), damit die Horde flüssig bleibt.
- **Lauf-Seed.** Die Welt ist fest (`CONFIG.world.seed`), jeder Lauf aber bekommt beim Start einen eigenen Seed aus der Uhrzeit
  (`src/core/runSeed.ts`). Aus ihm leitet `deriveSeed` je einen Zufallsstrom für die Gegner (Art, Ort, Zeitpunkt), die Schwaden der Finsternis,
  die Beute und das, was Angebote, Boss und Angriffe würfeln, so dass die Ströme einander nicht gleichen. Der Seed steht im Endbild
  („Lauf-Seed: 1Z141Z3“, sieben Zeichen zur Basis 36). Mit `?seed=1Z141Z3` hinter der Adresse beginnt der erste Lauf mit diesem Seed:
  Gegner, Schwaden, Beute und Angebote kommen in derselben Folge, auch wenn die Figur andere Wege geht. Rein Optisches und Hörbares
  (Teilchen, Tonhöhe) würfelt weiter mit `Math.random`. Der Seed wird nicht gespeichert und nicht in die Statistik geschrieben.

## Aufbau des Projekts

```
index.html            Seite des Spiels mit allen HUD-Elementen
modell.html           Modell-Prüfer (nur für die Entwicklung, nicht Teil des Spiels)
statistik-global.html Die Statistik aller Spieler (nicht verlinkt, braucht den Schlüssel im Link, siehe „Sammelstelle“)
finsternis.md         Lore-Quelle: Staub und Finsternis
magie_mystik/         Lore-Quelle: Katalog von Magie und Mystik, geordnet nach Domänen und Mächten
public/models/        Spielfertige GLB-Modelle (Figuren, Gegner, Kulisse unter welt/, Ausrüstung wie der Schild unter ausruestung/)
public/audio/         Klänge und Musik (sfx/, schleifen/, musik/) und audio.json, die Zuordnung Ereignis → Datei
public/icons/items/   Bilder der Gegenstände im Lager: 27 WebP-Dateien, neun Plätze mal drei Klassen (`<platz>-<klasse>.webp`)
src/
  main.ts             Einstieg: baut das Spiel und hängt Entwicklungswerkzeuge nur im Dev-Modus an
  statistikGlobal.ts  Einstieg der globalen Statistik (statistik-global.html, nicht verlinkt)
  config.ts           Zentrale Stellschrauben: Nachtdauer, Welt, Gegnerarten, Kulisse
  core/               Eingabe, deterministischer Zufall, Seed des Laufs (`runSeed.ts`), Raumgitter, Einstellungen (Ton, Stelle der Lebensgruppe), Spielstand (Gold, Gegenstände) und seine Sicherungsdatei, Zugriff auf Dateien (`dateien.ts`), Protokoll der Nächte und seine Auswertung (Statistik), Sammelstelle (Senden und Lesen über Supabase)
  audio/              Ton und Musik: Engine, Ereignisnamen, Lesen von audio.json
  game/               Spiellogik und Darstellung (siehe unten)
  ui/                 hud.ts: Anzeigen, Auswahlkarten, Ende; menus.ts: Startbildschirm, Pause, Optionen, Statistik, Anleitung, Rückfragen; statistikView.ts und statistik.css: die Anzeige der Statistik; lagerView.ts und lager.css: Lager (Ausrüstung, Truhe und Händler)
  tools/              Entwicklungswerkzeuge: Messlauf, Gegenstände (`__items`), Fertigkeiten-Unterbau (`__skills`) und Modell-Prüfer
tools/                Skripte außerhalb des Spiels (Blender: Modelle verkleinern, Priester und Mantelträger animieren, Stachelschwein riggen und animieren, Schild erzeugen; Python: Klänge erzeugen, Sor-Symbol und Favicon aufbereiten, Gegenstandsbilder freistellen; SQL: die Sammelstelle der Statistik in Supabase einrichten, `supabase/statistik.sql`)
.github/workflows/    GitHub Actions: Veröffentlichung auf GitHub Pages (pages.yml)
```

Wichtige Teile von `src/game/`:

| Datei                          | Inhalt                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| `game.ts`                      | Hauptschleife und Phasen (Laden, Startbildschirm, Klassenwahl, Spiel, Pause, Ende) |
| `classes.ts`, `gear.ts`        | Die drei Klassen mit Werten, Modell und Ausrüstung; die Ausrüstung in den Händen (Axt, Bogen, Buch, Schild des Kämpfers) |
| `weapons.ts`, `arsenal.ts`     | Alle Angriffe als Daten (mit Rangregeln) und ihre Ausführung; die Fertigkeiten der drei Klassen (siehe [Kämpfer](#fertigkeiten-des-kämpfers), [Wildnisläufer](#fertigkeiten-des-wildnisläufers), [Magier](#fertigkeiten-des-magiers)) |
| `evolutions.ts`, `evolutionsLaeufer.ts`, `evolutionsMagier.ts` (und `evolutionEffects*.ts`, `crowd.ts`) | Die Evolutionen (Rang 6) der drei Klassen, ihre Bilder und die Suche nach Gruppen (siehe [Evolutionen](#evolutionen)) |
| `status.ts`, `events.ts`, `fields.ts`, `buffs.ts` | Unterbau der Fertigkeiten: Zustände der Gegner, Ereignisse mit Urheber, Bodenfelder, zeitweilige Werte (siehe [Fertigkeiten](#fertigkeiten-der-unterbau)) |
| `effects.ts`, `strips.ts`, `particles.ts`, `props.ts` | Wie die Angriffe aussehen                        |
| `enemies.ts`, `boss.ts`, `threats.ts` | Horde, Verschlinger und die Zauber der Gegner                    |
| `stachelboss.ts`, `quills.ts`  | Der Stachelträger (zweiter Boss, siehe [Der Stachelträger](#der-stachelträger)) und seine Stacheln |
| `progression.ts`               | Stufen, Stärkungen und die Segen der Höheren Mächte                     |
| `boerse.ts`, `coins.ts`        | Die Börse (das Gold im Spielstand) und die Münzen, die das Gold bringen |
| `nights.ts`, `grade.ts`        | Die Nachtarten mit ihren Regeln; die Grade der Nächte (siehe [Nachtarten](#nachtarten)) |
| `items.ts`, `ausruestung.ts`, `truhe.ts`, `haendler.ts`, `lager.ts` | Gegenstände (Eigenschaften, Würfeln), die Gegenstände jeder Klasse samt Truhe, das Angebot des Händlers und das Menü des Lagers |
| `beute.ts`, `drops.ts`         | Beute: was aus Gegnern und der Kiste des Verschlingers fällt, der Beutel der Nacht, die Gegenstände am Boden und die Kiste |
| `zones.ts`, `darkness.ts`, `dust.ts` | Lichtinseln, Finsternis und Verstaubung                           |
| `world.ts`, `ground.ts`, `scenery.ts` | Welt, Boden und Kulisse                                          |
| `models.ts`                    | Lädt GLB-Dateien und bringt sie auf die Maße, die das Spiel braucht     |

## Menüs und Oberfläche

**Startbildschirm** (nach dem Laden): *Neues Spiel*, *Spiel fortsetzen*, *Optionen*, *Statistik* und *Anleitung*. „Spiel fortsetzen“ erscheint nur, wenn es einen
Spielstand gibt (Gold in der Börse oder Gegenstände) und führt zur Klassenwahl. „Neues Spiel“ setzt den dauerhaften Fortschritt zurück
(Gold, Gegenstände, Truhe und die Grade der Nächte; die Optionen und die Statistik bleiben). Gibt es einen Fortschritt, warnt davor eine Rückfrage, die nennt, was verloren ginge
(vorgewählt ist „Abbrechen“); ohne Fortschritt geht es sofort weiter. Von der Klassenwahl und vom Ende der Nacht führt **Esc** (oder der Knopf
„Hauptmenü“) zurück zum Startbildschirm. Die **Anleitung** erklärt Ziel, Steuerung, Licht und Finsternis, Stufen und Segen, die Klassen mit ihren Angriffen, die Evolutionen, Gold,
Gegenstände, Beute und das Lager (Text in `index.html`; sie ist länger als mancher Bildschirm, darum blättern Auf und Ab, siehe `Menus.scrollPage`).

**Pause** (Esc oder P): *Weiter*, *Optionen* und *Lauf abbrechen*. Wer den Lauf abbricht, bestätigt zuerst eine Rückfrage; die Nacht endet dann
wie bei einem Sturz (Ertrag nach `CONFIG.gold.deathKeep`) mit der Endanzeige „Lauf abgebrochen“.

**Optionen** haben vier Gruppen: *Ton* (Regler und „Ton aus“), *Oberfläche* mit **Lebensbalken platzieren**, *Spielstand* (als Datei sichern und laden, siehe unten) und *Daten*. Gewählt wird die Stelle der
Lebensgruppe (Stufe im Kreis, Lebensbalken, Gold im Geldbeutel): oben links, oben rechts, unten links, unten Mitte oder unten rechts. Die Gruppe
wandert als Ganzes; was dort sonst stünde (Hinweis, Tonmeldung, Feuer entzünden), weicht aus. Bedienung mit der Maus oder mit den Tasten
(Auf und Ab wählen die Zeile, Links und Rechts ändern, Enter schaltet um, Esc geht zurück).

**Statistik** (Startbildschirm): zeigt die eigenen Nächte in Reitern, einer Übersicht, je einer Seite für jede Klasse und einer Seite *Nachtarten*. Die Übersicht nennt, wie oft jede
Klasse gespielt wurde (Zahl und Anteil), mit Siegen und mittlerer überlebter Zeit. Die Seite einer Klasse zeigt ihre Nächte (gespielt, Siege, Gefallen,
Abgebrochen, Ø überlebt), den Rang jeder Fertigkeit am Ende der Nacht, die erreichten Stufen, die gewählten Stärkungen und die gewährten Segen, jeweils mit Zahl
und Anteil. Die Seite *Nachtarten* führt jede Nachtart und darunter jeden gespielten Grad in einer Tabelle (Nächte, Anteil, Siege, Siegquote, Ø überlebt, Ø Stufe); ein Klick auf eine Zeile zeigt darunter
Nächte, erreichte Stufen, Stärkungen und Segen dieser Nachtart bzw. dieses Grads (ohne Fertigkeiten, die gehören einer Klasse). Links und Rechts wechseln den Reiter, Auf und Ab blättern (`Menus.showStats`, `Menus.scrollPage`). Siehe [Statistik](#statistik). Die *Optionen* haben die Gruppe *Daten* (Häkchen „Statistik anonym senden“).

Alle Einstellungen bleiben erhalten (`localStorage`, Schlüssel `dao-survivor.einstellungen`, siehe `src/core/settings.ts`); Stände ohne die Stelle der
Lebensgruppe gelten als „oben links“. Die Menüs stehen in `index.html`, bedient werden sie von `src/ui/menus.ts`; was ein Knopf bewirkt,
entscheidet `Game.onMenuCommand`.

## Stufenaufstieg und Startangriff

**Startangriff.** Nach der Klasse folgt eine zweite Wahl: Alle sieben Angriffe der Klasse stehen offen, einer beginnt die Nacht auf Rang 1 (`Game.openStart`, `Arsenal.reset(..., startId)`).
Vorgewählt ist der, mit dem die Klasse in dieser Sitzung zuletzt begann, sonst ihr üblicher erster (`ClassDef.weapons[0]`); Enter bestätigt ihn also gleich. Esc führt zurück zur Klassenwahl.
Die Wahl wird nicht gespeichert (kein Eingriff in den Spielstand). Wer nicht mit dem ersten beginnt, bekommt ihn beim Stufenaufstieg wie jeden anderen angeboten. Der Messlauf nimmt immer den üblichen.

**Neu würfeln und Verbannen.** Beim Stufenaufstieg und bei der Wahl eines Segens stehen unter den drei Karten zwei Knöpfe (Tasten R und X). Beide haben einen Vorrat je Nacht
(`CONFIG.run.rerolls` und `CONFIG.run.banishes`, beide 2; später könnten Gegenstände ihn erhöhen) und sind gesperrt, wenn der Vorrat leer ist oder es keine anderen Karten gibt, die an die Stelle der gezeigten träten.
- *Neu würfeln* ersetzt alle Karten durch andere aus dem Vorrat; nur wenn der Vorrat nicht für drei reicht, kehren gezeigte Karten wieder.
- *Verbannen* wartet auf die Wahl einer Karte (rot gerahmt; X oder Esc bricht ab): Sie kommt bis zum Morgen nicht mehr ins Angebot, eine andere nimmt ihren Platz ein. Verbannt wird, was das Spiel als Karte kennt:
  ein Angriff (neu oder höherer Rang), eine Stärkung oder ein Segen (`Offer.key`, etwa `staerkung:harte-hand`).
- Der Zufall dafür kommt aus dem Strom des Laufs (siehe [Lauf-Seed](#technik)); derselbe Seed und dieselben Wahlen ergeben dieselben Karten.

## Nachtarten

Nach dem Startangriff wählt man die **Nachtart** (neue Phase `'night'`, `Game.openNight`). Jede hat eine Regel, ein Risiko und einen Lohn; schwerere Nächte zahlen besser, so dass die Schwierigkeit eine Entscheidung ist
und kein Pech. Vorgewählt ist die zuletzt gewählte der Sitzung (nicht gespeichert), sonst die gewöhnliche. Eine besondere Nacht nennt sich im Bild und über der Uhr („Rotnacht · Sonnenaufgang in“) und im Endbild.

| Nachtart | Anlass (Wiki) | Regel | Lohn |
| -------- | ------------- | ----- | ---- |
| Gewöhnliche Nacht | – | unverändert | wie gewohnt |
| Rotnacht | Kalender: Dundar steht voll am Himmel | Gegner 20 % schneller, du schlägst 10 % schneller zu (Abklingzeit × 1/1,1), die Rast im Licht heilt nur halb | Gold × 1,3 |
| Blaunacht | Kalender: Branjur steht voll am Himmel | Gegner 20 % seltener (Rate × 0,8), mit 50 % mehr Leben; Dhargass-Priester ab 120 s statt 240 s | Erfahrung × 1,3 |
| Regenlicht | Wetter: nach kräftigem Regen ist der Himmel heller | Verstaubung halb so schnell, vier statt sieben Schwaden, Gegner mit 20 % mehr Leben | Gold × 0,9 |

**Abweichung von der Lore, Vorschläge.** Im Wiki bestimmt der Kalender, wann Rot- und Blaunacht sind; im Spiel wählt man die Nacht. Die Wirkungen und Zahlen sind Vorschläge und Startwerte für den Messlauf, nicht aus dem Wiki.

**Aufbau.** Eine Nachtart ist ein Eintrag in `NIGHTS` (`src/game/nights.ts`): Name, Text für die Karte und `NightRules`. Die Regeln lesen die Gegner (`Enemies.reset(seed, rules)`: Tempo, Leben, Rate, früheres Erscheinen einer Art),
die Zonen (`Zones.reset(seed, clouds)`: Zahl der Schwaden) und die Figur (`applyNightStats` auf `Progression.reset`: Faktoren auf `cooldown`, `restHeal`, `verstaubung`, `xp` und `gold`). `CONFIG` bleibt unverändert; eine neue
Nachtart braucht, solange sie nur diese Faktoren verlangt, nur einen weiteren Eintrag. `__messlauf.start({ nacht: 'rotnacht' })` misst eine Nachtart; ohne Angabe spielt der Messlauf die gewöhnliche.

**Statistik.** Seit 0.25.0 steht die Nachtart (`RunRecord.night`) im Protokoll der Nächte und geht an die Sammelstelle (Spalte `night_id`); die Statistik zählt sie auf der Seite *Nachtarten* getrennt. Nächte aus den Fassungen 0.21 bis 0.24
kennen ihre Nachtart nicht (sie wurde nicht festgehalten) und zählen dort nicht mit; Nächte aus Fassungen vor 0.21.0 waren gewöhnliche Nächte und werden so gelesen.

### Grade der Nächte

Wer eine Nachtart geschafft hat (die Sonne geht auf), darf sie beim nächsten Mal einen **Grad** höher wählen. Jede Nachtart beginnt bei Grad 0 und zählt für sich; der Stand gilt für alle Klassen gemeinsam.
Nach dem ersten Sieg in einer Nachtart zeigt ihre Karte einen Zähler `− Grad 2 +`, darunter was der Grad ändert und wie weit man sie geschafft hat; vorher sieht die Karte aus wie bisher. Vorgewählt ist immer der höchste Grad,
den man wählen darf: der höchste geschaffte plus 1 (`Grade.highest`, höchstens `CONFIG.grade.max` = 99). Niedrigere Grade bleiben jederzeit wählbar. Verstellt wird er mit den Knöpfen, mit Pfeil hoch und runter (W und S)
oder mit + und −; die Aktionen `gradeUp` und `gradeDown` in `src/core/input.ts` hängen am Zeichen und nicht an einer Taste, damit es auf jeder Tastatur geht. Ein Klick auf einen Knopf wählt die Karte mit.
Nur ein Sieg schaltet frei: Fallen und Abbrechen ändern nichts, ebenso ein Sieg in einem Grad unter dem höchsten geschafften. Das Endbild nennt, was ein Sieg freigeschaltet hat; in der Nacht steht der Grad im Bild und über der Uhr
(„Rotnacht · Grad 2 · Sonnenaufgang in“).

**Wirkung.** Jeder Grad macht die Gegner stärker, und zwar additiv (Grad 10 ist +50 % Leben und +25 % Schaden, nicht 1,05 hoch 10): Das **Leben** der Gegner und der Bosse wächst um 5 % je Grad (`CONFIG.grade.enemyHp`) und der **Schaden**, den die Figur erleidet,
um 2,5 % je Grad (`CONFIG.grade.enemyDamage`, als Faktor `Stats.taken`; das gilt für Berührung, Hieb, den Schwarzen Sog und die Angriffe der Bosse, nicht für die Verstaubung durch die Finsternis). Die Zuschläge kommen auf die Regeln der
Nachtart obendrauf (`rulesAt` in `nights.ts`; Blaunacht, Grad 2: Leben × 1,5 × 1,1). Tempo und Zahl der Gegner bleiben unberührt: Läufer (4,3 m/s) wären schon ab Grad 3 schneller als die Figur (5,5 m/s), und bei 350 gleichzeitigen
Gegnern ist ohnehin Schluss. Der Lohn ändert sich mit dem Grad nicht. Das sind Vorschläge und Startwerte, keine Lore; die Zahlen stehen in `CONFIG.grade`.

**Speicherung.** Die Grade liegen im Spielstand (Fassung 8, Feld `grades`: Nachtart → höchster geschaffter Grad; fehlt die Nachtart, wurde sie nie geschafft). Darum nehmen *Spielstand als Datei sichern* und *aus Datei laden* sie mit,
und „Neues Spiel“ löscht sie (die Rückfrage nennt sie). `Grade` (`src/game/grade.ts`) folgt dem Muster der Börse: Sie liest vor jeder Änderung den gespeicherten Stand neu und schreibt nichts, solange `persist` aus ist (der Messlauf).

**Messlauf.** `__messlauf.start({ nacht: 'blaunacht', grad: 3 })` spielt alle Nächte der Messung im Grad 3; der Grad muss nicht freigeschaltet sein und verändert den echten Spielstand nicht. Jedes Ergebnis trägt den Grad (`grad`).

**Statistik.** Wie die Nachtart steht auch der gewählte Grad seit 0.25.0 im Protokoll (`RunRecord.grade`, Spalte `grade` in der Sammelstelle). Die Seite *Nachtarten* der Statistik zählt jede Nachtart und jeden ihrer Grade getrennt.

## Der Stachelträger

Der zweite Boss erscheint nach fünf Minuten (Sekunde 300, `CONFIG.stachelboss.from`) am Rand des Bildes, der Verschlinger erst in den letzten vier. Er ist ein Fernkämpfer: Er geht auf die Figur zu, bis sie
näher ist als 5,5 m (`stand`), und greift an, sobald sie näher ist als 10 m (`range`) und er sie ansieht (wer hinter ihm läuft, hat Zeit). Die Kamera zeigt nach vorn etwa 13 m; die Lebensleiste des Bosses
verdeckt den oberen Rand, darum steht er so nah. Wie der Verschlinger ist er für die Angriffe der Figur ein Gegner wie jeder andere; er lässt sich verlangsamen (bis 70 % Tempo, `CONFIG.boss.slowFloor`), aber nicht festhalten.

| Angriff | Ablauf | Zahlen (`CONFIG.stachelboss`) |
| ------- | ------ | ----------------------------- |
| **Stachelwurf** (Standardangriff) | Er greift mit einer Hand in den Rücken (die Hände wechseln sich ab, die Hand hält den Stachel sichtbar) und wirft ihn auf die Stelle, an der die Figur beim Loslassen steht. Wer sich seitlich bewegt, weicht aus. | alle 0,9 s, 4 Schaden, 12 m/s, trifft innerhalb von 0,6 m um die Mitte der Figur |
| **Stachelsalve** | Er schüttelt den Rücken. Zehn Stacheln fliegen gestaffelt im hohen Bogen auf eine vorher angekündigte Fläche von 12 m Durchmesser (orangefarbener Rand, ein Ring zieht sich zusammen), die dort liegt, wo die Figur beim Beginn stand. Wen ein Stachel trifft, der ist bewegungsunfähig (Laufen nicht, Kämpfen wohl) und danach kurz gefeit. | alle 5 s, je Stachel 4 Schaden in 1,7 m um den Einschlag, 1,6 s festgesetzt, danach 1,5 s gefeit; die Stacheln stecken noch 1,4 s im Boden; der letzte schlägt rund 2,7 s nach dem Beginn ein |
| **Aura** | Alle 6 s umgibt ihn 3 s lang eine Aura von 5 m Durchmesser (türkiser, laufender Ring am Boden; die erste steht 3 s nach seinem Erscheinen). Solange sie steht, erleidet er von außerhalb nur ein Viertel des Schadens (75 % weniger). Steht die Spielfigur in der Aura, richtet sie vollen Schaden an. | `aura: { first: 3, interval: 6, duration: 3, radius: 2.5, outside: 0.25 }` |
| **Rage** | Unter 30 % seines Lebens schlägt er schneller zu: Tempo der Angriffe ×1,25 (Animation und Takt) und die Salve kommt nach 3,75 s statt 5 s. Er pulsiert dabei rötlich. | `rage: { below: 0.3, speed: 1.25, cooldown: 0.75, pulse: 0.9 }` |

Alle Zahlen sind **Vorschläge und Startwerte**, keine Lore (die Quellen kennen dieses Wesen nicht; Name, Ablauf und Belohnung sind erfunden). Drei Auslegungen des Auftrags: Die Rage „steigert die Abklingzeit um 25 %“ wird als *kürzere* Wartezeit
gelesen (sonst wäre sie keine Rage), die Salve zielt auf die Stelle der Figur beim Beginn, damit sie sich vor dem Einschlag aus der Fläche bewegen kann, und für die Aura zählt, wo die Mitte der Figur im Augenblick des Schadens steht (näher als 2,5 m an der Mitte des Bosses), gleich ob der Schaden von einem Hieb, einem Geschoss oder einem Bodenfeld kommt. Der Kollisionskreis des Bosses lässt die Figur bis auf 2,2 m heran, wer ihm im Nahkampf an den Füßen steht, ist also in der Aura.

**Leben:** 1800 (der Verschlinger hat 4500); es wächst wie das des Verschlingers mit dem Grad der Nacht (`bossHp`). **Beute:** 8 Edelsteine (60 Erfahrung), 6 Münzen zu je 8 Gold und ein Segen; anders als der Verschlinger lässt er keine Kiste fallen.

**Wie die Zahlen entstanden.** In einem gestellten Zweikampf (Sekunde 300, ohne Horde, Figur der Stufe 9 oder 10 mit zufällig gewählten Angeboten, Boss mit 1800 Leben, Aura wie oben) schlug der Wildnisläufer ihn aus 7 m, also von außerhalb der Aura, in 32 s,
ohne Schaden zu nehmen (ohne Aura waren es 21 s: Die Aura streckt den Kampf der Fernkämpfer um die Hälfte). Der Kämpfer kommt im Nahkampf nur durch, wenn er den Salven ausweicht und in der Aura bleibt: Dann hatte er den Boss nach 105 s auf 6 % gebracht
und war bei 0 von 120 Leben; wer in der Fläche der Salve stehen bleibt, wird in jeder Salve festgesetzt und fällt nach etwa 54 s (der Boss hat dann noch 19 %). Der Boss ist also für Fernkämpfer leicht und für den Kämpfer knapp (dessen zufällige Angebote waren hier schwach:
rund 26 Schaden je Sekunde gegen rund 85 beim Wildnisläufer). Die ersten Stellschrauben sind `hp`, `wurf.damage`, `salve.root` und `aura.outside`. Der Messlauf (`__messlauf`) taugt dafür wenig: Seine Automatik-Figur meidet den Boss; bei den ersten Werten (2400 Leben, 7 Schaden, noch ohne Aura)
hatte er ihn in 220 s nur beim Kämpfer auf 67 %, bei den anderen Klassen kaum unter 95 % gebracht und erlitt fast keinen Schaden von ihm. Er trägt die Felder `stachelboss`, `stachelbossFall`, `stachelbossSchaden` und `festgesetzt` ins Ergebnis ein.

**Tests und Ausbau.** Das Modell, seine Animationen („Stehen“, „Laufen“, „Stachelwurf“, „Stachelwurf2“, „Stachelsalve“, „Tod“) und deren Zeiten stehen in `public/models/stachelschwein.glb` und `CONFIG.stachelboss`; die Stacheln liegen in einem festen Vorrat von 80 Instanzen
(`quills.ts`), im Kampf entsteht nichts Neues. Die Töne sind vorerst die vorhandenen Dateien unter neuen Ereignisnamen (`stachelboss.erscheint`, `.wurf`, `.salve`, `.einschlag`, `.festgesetzt`, `.rage`, `.faellt`; sie lassen sich in `audio.json` austauschen).

## Statistik

Jede Nacht, die endet, hinterlässt einen kleinen Datensatz (`RunRecord` in `src/core/statistik.ts`): Klasse, Nachtart und Grad, Ausgang (Sonnenaufgang, gefallen oder abgebrochen),
überlebte Sekunden, erreichte Stufe, gewählte Stärkungen (Kennung → Rang), gewährte Segen und der Rang jeder Fertigkeit am Ende (6 ist die Evolution), dazu eine
zufällige Kennung, der Zeitpunkt und die Fassung des Spiels (im Dev-Modus mit Endung `-dev`). Es gibt keinen Namen und keine Angabe zur Person. `Game.recordNight` schreibt ihn beim Ende der Nacht.
Ein Lauf, den man vor `CONFIG.items.shop.minNightSeconds` (60 Sekunden) abbricht, fehlt, so wie er für den Händler nicht als gespielte Nacht zählt.

- **Speicher.** Das Protokoll liegt unter dem Schlüssel `dao-survivor.statistik` (`localStorage`) als JSON mit Versionsnummer (`STATISTIK_VERSION`, jetzt 2: Fassung 1 kannte weder Nachtart noch Grad, `parseRun` hebt solche Einträge an), hinter
  `TextStore` wie Spielstand und Einstellungen; eine Desktop-Fassung setzt mit `useStatistikStore` eine Datei an die Stelle. Es ist bewusst vom Spielstand getrennt: Es wächst
  mit jeder Nacht (höchstens `MAX_RUNS` = 2000, die ältesten fallen heraus, etwa 700 KB), würde den Spielstand bei jedem Handel mitschreiben lassen und soll
  „Neues Spiel“ überstehen. Ein unlesbarer Stand beginnt leer; unbrauchbare Einträge werden beim Lesen übersprungen.
- **Auswertung.** `evaluate` in `src/core/auswertung.ts` zählt die Nächte zusammen (insgesamt, je Klasse, je Nachtart `byNight` und je Nachtart und Grad `byNightGrade`): Nächte, Siege, Gefallen, Abgebrochen, Summe der Sekunden, Nächte je
  Stufe, Wahlen je Stärkung und Segen, Nächte je Rang und Fertigkeit. Die Zähler lassen sich addieren. Anteile und Namen rechnet erst die Anzeige.
- **Anzeige.** `src/ui/statistikView.ts` zeigt eine fertige `Auswertung`; sie liest nichts selbst und kennt keine Spielregeln. Das Menü *Statistik* im Startbildschirm bindet sie
  ein (`Menus.showStats`).
- **Nachtarten und Grade.** Eine Nacht, deren Nachtart unbekannt ist (`night` leer; Fassungen 0.21 bis 0.24), zählt nur insgesamt und bei ihrer Klasse; die Seite *Nachtarten* nennt, wie viele es sind. Der Anteil in ihrer Tabelle bezieht sich auf alle Nächte mit
  bekannter Nachtart.
- **Anteile.** Bei den Klassen, den Fertigkeiten und den Stufen ist es der Anteil an allen Nächten der Klasse (bzw. aller Klassen). Bei Stärkungen und Segen ist es der Anteil an allen
  Wahlen dieser Art. „Steigerungen“ meint hier, was beim Stufenaufstieg gewählt wird: Stärkungen und Segen (die Fertigkeiten haben ihre eigene Tabelle).
- **Messlauf.** Er schaltet das Protokoll ab (`Game.recordStats`), damit seine Probenächte die Statistik nicht verfälschen.
- **Zurücksetzen.** In den Entwicklerwerkzeugen genügt `localStorage.removeItem('dao-survivor.statistik')`.

### Sammelstelle: die Statistik aller Spieler

Das Spiel meldet jede Nacht zusätzlich anonym an eine Sammelstelle (Supabase, eine Postgres-Datenbank mit REST-Schnittstelle). Die **globale Seite**
`statistik-global.html` zeigt daraus dieselbe Statistik wie im Spiel, nur für alle Nächte aller Spieler. Das Spiel verlinkt sie nirgends.

- **Abschalten statt Zustimmung.** Das Senden ist standardmäßig an und kommt ohne Rückfrage (seit 0.17.1; in 0.17.0 fragte das Spiel beim ersten Start). Wer nicht möchte, nimmt in den **Optionen** unter *Daten*
  das Häkchen „Statistik anonym senden“ heraus (`Settings.data.share`, `true` oder `false`; `src/core/settings.ts`). Eine früher gespeicherte Entscheidung „Nicht senden“ (`false`) bleibt erhalten,
  ein offenes `null` aus 0.17.0 zählt wie nicht gespeichert, also ja. Der Text in den Optionen nennt offen, was gesendet wird und dass der Dienst beim Übertragen wie bei jeder Webanfrage die IP-Adresse sieht; in der Tabelle steht sie nicht.
- **Hinweis beim Start.** Einmal je Spieler (Merker `Settings.data.noticeSeen`, auch bei Spielern, die schon mit 0.17.0 gespielt haben) blendet das Spiel nach dem Laden „Anonyme Statistik“ ein: was gemeldet wird,
  dass es keinen Namen und keine Gerätekennung gibt, dass der Dienst die IP-Adresse sieht, und wo man es abschaltet. Wer das Senden eingeschaltet hat, bestätigt mit „Verstanden“ (Esc zählt auch). Wer in 0.17.0 „Nicht senden“
  gewählt hatte, **bleibt abgeschaltet**: Der Hinweis fragt ihn einmal, ob er jetzt senden will („Weiter nicht senden“ ist vorgewählt, Esc zählt wie dieser Knopf). Eine ausdrückliche Absage wird nie übergangen
  (`Game.showDataNotice`).
- **Was gesendet wird.** Der Datensatz der Nacht (siehe oben) ohne den Zeitpunkt: Kennung der Nacht, Fassung, Klasse, Nachtart, Grad, Ausgang, Sekunden, Stufe, Stärkungen, Segen, Ränge der Fertigkeiten.
  Keine Kennung des Spielers oder Geräts, nichts vom Spielstand. Die Kennung der Nacht verhindert nur Doppelte. `Game.recordNight` ruft `sendRun` (`src/core/sammelstelle.ts`) auf, `fetch` ohne Bibliothek;
  Fehler stehen nur in der Konsole, das Spiel läuft weiter, die Nacht fehlt dann in der Statistik aller. Im Dev-Modus (`npm run dev`) wird nichts gesendet; die Fassung trägt dort die Endung `-dev` (`vite.config.ts`), und solche Nächte zählt die Auswertung ohnehin nicht.
- **Die Datenbank.** `tools/supabase/statistik.sql` legt alles an und ist wiederholbar: die Tabelle `runs` (mit Prüfregeln für die Werte), Zeilensicherheit (RLS) und die Funktion
  `stats_overview(token)` (seit 0.25.0 mit den Spalten `night_id` und `grade`). Das Spiel darf mit dem öffentlichen Schlüssel (`CONFIG.sammelstelle`, ein „publishable key“, der dafür gemacht ist, im Spiel zu stehen) nur **neue Zeilen eintragen**;
  Lesen, Ändern und Löschen einzelner Zeilen darf niemand über die Schnittstelle. Die globale Seite liest keine Zeilen, sondern nur die **Zähler** aus `stats_overview`, in der Form von `Auswertung`
  (`src/core/auswertung.ts`; die Funktion rechnet dasselbe wie `evaluate`, nach `tallyRun` in SQL, auch je Nachtart und je Nachtart und Grad).
- **Der Link.** Die Funktion verlangt einen Schlüssel, den das Skript einmal zufällig erzeugt (Tabelle `stats_config`); er steht nicht im Repository. Die Seite liest ihn aus dem Teil der Adresse hinter dem `#`
  (der geht nur an die Sammelstelle, nie an den Server der Seite). Ohne Schlüssel oder mit einem falschen zeigt die Seite nichts außer einem Hinweis. Die Adresse lautet also
  `https://ritek3000.github.io/dao-survivor/statistik-global.html#<Schlüssel>`; die Seite trägt `noindex`. Das ist ein Zugangsschlüssel im Link, kein Passwort-Schutz: Wer den Link hat, sieht die Zähler.
  Einen neuen Schlüssel setzt `update public.stats_config set value = '…' where key = 'token';` im SQL-Editor.
- **Einrichten (einmalig).** Im Supabase-Dashboard unter *SQL Editor* den Inhalt von `tools/supabase/statistik.sql` einfügen und ausführen; die letzte Zeile des Ergebnisses (`link_ende`) ist der Rest des Links.
  Alle gesammelten Nächte löscht `delete from public.runs;`.
- **Aktualisieren.** Ändert sich `tools/supabase/statistik.sql` (zuletzt mit 0.25.0: Spalten `night_id` und `grade`, `byNight` und `byNightGrade` in `stats_overview`), führt man die Datei noch einmal aus; sie ist wiederholbar, der Schlüssel und die
  gesammelten Nächte bleiben. **Die Datenbank kommt vor dem Spiel:** Ein Spiel, das die neuen Felder sendet, wird von einer älteren Datenbank abgewiesen (Fehler 400, die Nacht fehlt dann in der Statistik aller); umgekehrt arbeitet ein älteres Spiel
  mit der neuen Datenbank weiter. Darum die Datei ausführen, bevor der Pull Request mit der neuen Fassung zusammengeführt wird (der Stand von `main` läuft sofort auf GitHub Pages). Nächte vor 0.21.0 trägt das Skript als gewöhnliche Nacht im Grad 0 nach;
  Nächte aus 0.21 bis 0.24 bleiben ohne Nachtart.
- **Grenzen.** Die Werte kommen vom Spiel im Browser des Spielers und lassen sich fälschen; sie sind Richtwerte, kein Beweis. Jeder mit dem öffentlichen Schlüssel kann Nächte eintragen (die Prüfregeln
  begrenzen nur, was als Nacht durchgeht). Der Hinweistext im Spiel ist ein ehrlicher Hinweis, keine Rechtsberatung; wer das Spiel öffentlich anbietet, prüft, ob eine Datenschutzerklärung nötig ist
  und ob das Supabase-Projekt in einer EU-Region liegt.

## Gold

Jede Nacht bringt Gold ein. Damit kauft man zwischen den Nächten beim Händler im Lager Gegenstände (siehe [Gegenstände](#gegenstände)).
Das Gold gehört allen Klassen gemeinsam (eine Geldbörse). Gegenstände gehören je einer Klasse; die Truhe teilen sich alle.

**Woher das Gold kommt.** Alle Zahlen stehen in `CONFIG.gold` und bei den Gegnerarten (`gold`) in `src/config.ts`:

- *Münzen aus Gegnern.* Jede Gegnerart lässt mit einer Wahrscheinlichkeit eine Münze fallen (der Schänder oft für 1 Gold, der Troll
  meist für 5). Die Münzen fliegen wie die Edelsteine zur Figur, sobald sie im Sammelradius liegen. Kupfer, Silber und Gold der Münze
  sagen nur, wie viel sie wert ist (ab 5 und ab 25 Gold).
- *Der Verschlinger* lässt beim Sturz einen Kranz von Münzen fallen, *der Stachelträger* einen kleineren (`CONFIG.stachelboss.coins` Münzen zu je `coinValue` Gold).
- *Sold:* Gold für jede volle Minute, die man überlebt hat.
- *Prämie* bei Sonnenaufgang.
- *Tod:* Wer fällt, behält den Anteil `deathKeep` des Ertrags. Jetzt ist er 1: Wer fällt, behält alles. Ein kleinerer Wert macht aus
  dem Tod einen Abzug.

Gutgeschrieben wird am Ende der Nacht (Sold und Prämie werden dann erst gerechnet); wer die Seite mitten in der Nacht schließt,
verliert das Gold dieser Nacht. Die Endanzeige schlüsselt den Ertrag auf.

**Wofür es gut ist.** Gold zahlt den Händler (Gegenstände kaufen, sein Angebot erneuern) und weitere Reiter der Truhe; verkaufte Gegenstände bringen
Gold zurück. Es gibt keine dauerhaften Steigerungen mehr: Die Werte der Figur kommen aus den Gegenständen, den Stärkungen und den Segen der Nacht.

**Speicherung.** Gold und Gegenstände liegen im Browser (`localStorage`, Schlüssel `dao-survivor.spielstand`) als JSON mit Versionsnummer
(`version`, jetzt 7). Der Zugriff steckt hinter `TextStore` in `src/core/storage.ts` und `src/core/savegame.ts`; wo `localStorage` fehlt oder
gesperrt ist, gilt der Stand nur für die Sitzung. Eine Desktop-Fassung kann mit `useSavegameStore` eine Datei an die Stelle setzen (und als zweiten Speicher
eine für die Sicherung). Ein unlesbarer Stand beginnt bei null; was das Spiel nicht kennt (etwa die Gegenstände einer neueren Fassung), bleibt beim Speichern erhalten.
**Sichern und Laden als Datei.** Die *Optionen* haben die Gruppe *Spielstand* mit zwei Knöpfen. *Spielstand als Datei sichern* lädt `dao-survivor-spielstand-<Datum>_<Uhrzeit>.json` herunter;
darin liegt der Spielstand (Gold, Gegenstände jeder Klasse, Truhe, Händler, Grade der Nächte) in einem Umschlag mit Kennung (`datei`), Fassung des Spiels (`spielversion`) und Zeitpunkt (`gesichert`).
Die Optionen und das Protokoll der Statistik sind nicht enthalten. *Spielstand aus Datei laden* gibt es nur im Hauptmenü (mitten in der Nacht würde der laufende Lauf später über den
geladenen Stand schreiben): Das Spiel prüft die Datei (`readSavegameFile`; auch ältere Fassungen werden gehoben, ein nackter Spielstand ohne Umschlag wird genommen, alles andere abgelehnt,
Dateien über 8 MB nicht gelesen), zeigt in einer Rückfrage, was in der Datei steht und was der jetzige Stand hat, und ersetzt ihn erst nach „Stand ersetzen“. Ein leerer Stand wird nicht gesichert.
Gesichert wird, was im Speicher liegt; das Gold der laufenden Nacht kommt erst am Ende der Nacht dazu. Der Zugriff auf Dateien steckt hinter `FileAccess` in `src/core/dateien.ts`
(Download-Link und Dateiwähler im Browser); eine Desktop-Fassung setzt mit `useFileAccess` eigene Dialoge ein.

Zurücksetzen lässt sich der Stand mit „Neues Spiel“ im Startbildschirm (mit Rückfrage); in den Entwicklerwerkzeugen genügt auch `localStorage.removeItem('dao-survivor.spielstand')`.

**Umstellung von Fassung 5 auf 6 (entfallene Steigerungen).** Wer vor Version 0.7.0 Ränge gekauft hatte, bekommt das Gold dafür zurück: `von5auf6` in `src/core/savegame.ts`
rechnet für jeden gekauften Rang nach, was er gekostet hat (`RETIRED_UPGRADES`, die alten Preise und die Steigerung der Preise je Rang) und schreibt die Summe der Börse gut.
Die Klassenwahl nennt es einmal („Die Steigerungen sind entfallen: …“). Bevor ein älterer Stand gehoben wird, legt `loadSavegame` seinen Text unverändert unter
`dao-survivor.spielstand.sicherung` ab. Zurückholen lässt sich der alte Stand in der Browser-Konsole mit
`localStorage.setItem('dao-survivor.spielstand', localStorage.getItem('dao-survivor.spielstand.sicherung'))` und einem Neuladen mit der älteren Fassung des Spiels.

**Gleichgewicht.** Der Messlauf rechnet ohne Gegenstände (so bleiben die Zahlen vergleichbar) und schreibt das Gold jeder Nacht
mit (`gold`). Der echte Spielstand wird dabei weder gelesen noch verändert.

Abweichungen von der Lore: Die Währung der Spielwelt sind Kupferpfennig, Silbermark und Goldkrone (100 Pfennig = 1 Mark, 100 Mark = 1 Krone).
Im Spiel heißt sie schlicht Gold, und die drei Münzfarben stehen für kleine, mittlere und große Beträge im Verhältnis 1 zu 5 zu 25,
sonst gäbe es keine Goldkronen zu sehen. Die Steigerungen mit Gold, die es bis Version 0.6.0 gab, waren selbst eine Abweichung (in der Lore kaufen
Spielende Steigerungen mit Charakterpunkten, nicht mit Geld); mit den Gegenständen ist sie entfallen.

## Gegenstände

Zwischen den Nächten legen die Klassen Gegenstände an: Fackel, Helm, Gürtel, Waffe, Handschuh, Schuh, Ring, Brustrüstung und Amulett. Sie ersetzen
die früheren Steigerungen; das System entstand in Paketen (Entwurf: „Item-, Loot- und Händlersystem“). **Stand: Grundlage, Beute, Truhe, Händler und die Evolutionen über den legendären Ring; die Steigerungen sind entfallen.**
Das Lager (Ausrüstung, Truhe und Händler) bleibt verborgen, solange kein Gegenstand im Spielstand liegt und kein Gold in der Börse; der erste Fund oder die erste Münze schaltet es frei.
Im Entwicklungsmodus (`npm run dev`) ist es immer da, und die Browser-Konsole erzeugt Gegenstände, Beute und Gold zum Ausprobieren
(`__items.fuellen()`, `__items.geben(0, 'ring', 'rar')`, `__items.fallen('rar')`, `__items.kiste()`, `__items.truhe(30)`, `__items.gold(5000)`, `__items.leeren()`; Beschreibung in `src/tools/items.ts`).

**Aufbau.** Ein Gegenstand trägt je nach Seltenheit eine (Normal), zwei (Selten) oder drei (Rar) Eigenschaften; Legendär trägt drei und
die Evolution einer Fertigkeit (siehe [Evolutionen](#evolutionen)), und gibt es nur als Ring (`LEGENDARY_SLOTS`). Jede Eigenschaft würfelt ihren Wert einmal beim Entstehen
aus einem Bereich, der von der Eigenschaft und vom Platz abhängt; ein Kernplatz hebt ihn an (Schaden auf der Waffe, Leben und Rüstung auf der
Brust, Lauftempo am Schuh, Sammelradius am Handschuh, Lichtschein an der Fackel). Es gibt 17 Eigenschaften (die zwölf der früheren Steigerungen plus
Krit-Schaden, Schonfrist, Rastheilung, Brenndauer und Zündtempo); welche auf welchem Platz vorkommen kann, steht als Daten in `src/game/items.ts`
(`PROPERTIES`), die Zahlen und Höchstwerte in `CONFIG.items` (`src/config.ts`). Fackel, Waffe und legendäre Gegenstände gehören zu einer Klasse und
lassen sich nur von ihr anlegen; für den Magier heißt die Fackel „Kerzenwort“. Gegenstände ändern nur Werte, nicht das Aussehen der Figur.

**Wirkung.** Beim Start einer Nacht werden die Eigenschaften der angelegten Gegenstände je Eigenschaft summiert (nach oben auf `cap` begrenzt) und
auf die Werte der Figur gesetzt (`Progression.reset`); die Stärkungen und Segen der Nacht kommen obendrauf. Angelegt wird nur
zwischen den Nächten. Zwei Werte sind neu: `critDamage` (bisher fest doppelter Schaden bei einem kritischen Treffer) und `restHeal` (Heilung bei
der Rast im Licht).

**Mindestschaden.** Rüstung nimmt von einem Treffer nicht mehr alles weg: Mindestens ein Viertel (`CONFIG.player.minDamageShare`), mindestens 1 Schaden
kommt durch. Sonst machte Rüstung aus Stärkungen und Gegenständen zusammen die Figur gegen die Horde unverwundbar.

**Lager.** Bei der Klassenwahl und am Ende der Nacht öffnet **L** (oder der Knopf) das Lager, mit der gewählten bzw. gerade gespielten Klasse. Es hat drei
Ansichten, die man mit **Tab** oder den Knöpfen oben wechselt:
- *Ausrüstung:* links die neun angelegten Gegenstände, daneben das Inventar (25 Plätze je Klasse), rechts die Karte des markierten Gegenstands mit Wurf
  im Bereich und Vergleich mit dem angelegten, darunter die Summe aller angelegten.
- *Truhe:* links das Inventar der Klasse, daneben die Truhe, eine für alle Klassen, in Reitern zu je 25 Plätzen (siehe unten).
- *Händler:* links sein Angebot und der Rückkauf, rechts der eigene Besitz (siehe unten).

**Gestaltung des Lagers.** Jedes Feld (Angelegt, Inventar, Truhe, Händler) hat denselben Aufbau: Kopf, eine Zeile für Füllstand oder Reiter, darunter das Raster.
Ein Platz misst 64 px (in niedrigen oder schmalen Fenstern weniger) und alle Breiten und Höhen folgen daraus (Maße am Anfang von `src/ui/lager.css`), also stehen
die Raster beim Wechsel der Ansicht am selben Ort, und beim Händler stehen Angebot, Befehle und Rückkauf den fünf Zeilen des eigenen Besitzes gegenüber. Die Seltenheit
zeigen Rand, Glanz und Rauten in der Ecke des Platzes (Selten eine, Rar zwei, Legendär drei; so ist sie auch ohne Farbunterscheidung zu lesen), der Zeiger ist ein
weißer Ring ohne Seltenheitsfarbe. Preise stehen mit Münze am Platz, reicht das Gold nicht, in Rot und auf der Karte auch im Text. **Nichts darf wandern**, wenn der
Zeiger über die Plätze läuft: Der Ring liegt in einem Pseudoelement, die Karte steht in einer eigenen Spalte neben den Feldern und die Summe der Ausrüstung unter ihnen
(Begründung und Regeln im Kommentar am Anfang von `src/ui/lager.css`). Wer die Oberfläche ändert, lässt den Zeiger durch alle Plätze der drei Ansichten
laufen und prüft, dass sich kein Feld bewegt.

**Gegenstände bewegen.** Enter oder Klick *nimmt einen Gegenstand auf*, der nächste Druck legt ihn auf einen anderen Platz (liegt dort einer, tauschen beide).
Ziehen mit der Maus oder dem Finger tut dasselbe in einem Zug. Aufgenommen ist ein Gegenstand nur gemerkt: Erst das Ablegen ändert etwas, Esc legt ihn
zurück, und ein Neuladen mitten im Zug verliert nichts. Die Aufnahme bleibt beim Wechsel der Ansicht und der Klasse bestehen; so wandert ein Gegenstand
von einer Klasse zur anderen, und aus der Ausrüstung in die Truhe. Ein Platz der Ausrüstung nimmt nur den passenden Gegenstand an (Platz, Klasse); sonst sagt
das Spiel unten, warum nicht. **E** erledigt das Häufige gleich ohne Aufnehmen: Es legt an, was die gezeigte Klasse tragen kann (der getragene nimmt den Platz), nimmt Angelegtes
ab und räumt alles andere zwischen Inventar und Truhe um; beim Händler kauft E, was im Angebot oder Rückkauf liegt, und verkauft, was man besitzt. Pfeile bewegen den Zeiger, 1, 2, 3 wechseln die Klasse, Esc oder L führen zurück. Alles geht
mit Maus und Tastatur gleichwertig (`src/core/input.ts`: die Aktionen `use` und `switch`; ein späteres Gamepad belegt sie mit Knöpfen).

**Truhe.** Alle Zahlen stehen in `CONFIG.items.truhe`. Ein neuer Spielstand beginnt mit einem Reiter; **Reiter** lassen sich anlegen (bis 16), umbenennen
(höchstens 16 Zeichen), mit einer von acht Farben markieren und löschen. Die ersten fünf Reiter sind gratis, jeder weitere kostet 500 Gold mal seiner Nummer über
fünf (der sechste 500, der siebte 1.000, …; mit `tabPrice: 0` sind alle gratis). Das Gold für einen Reiter geht über `Ausruestung.buyTab` aus der Börse des Spielstands. Ein Reiter mit Gegenständen wird nie einfach gelöscht: Das Spiel fragt, und die Gegenstände ziehen
dann in die anderen Reiter um; reicht dort der Platz nicht, bleibt alles, wie es ist. Der letzte Reiter bleibt immer. Mit der Tastatur geht es
aus der obersten Reihe der Truhe nach oben in die Leiste der Reiter und Befehle (Links und Rechts wählen, ein Reiter öffnet sich beim Hinzeigen, Enter führt einen Befehl aus;
mit einem Gegenstand in der Hand legt Enter ihn in den Reiter). Der Name eines Reiters lässt sich tippen: `core/input.ts` ignoriert die Tasten, solange ein
Textfeld den Fokus hat. Die Truhe ist `src/game/truhe.ts` (Form, Namen, Preise) und `Ausruestung` (Speicherung, `move`); das Menü
`src/game/lager.ts` (Bedienung) und `src/ui/lagerView.ts` (Oberfläche); die Zeichen der Gegenstände sind selbst gezeichnete Platzhalter
(`src/ui/itemIcons.ts`; die kleinen Zeichen der Oberfläche in `src/ui/glyphs.ts`).

**Händler.** Alle Zahlen stehen in `CONFIG.items.shop` und `CONFIG.items.price`; Form und Würfeln des Angebots stehen in `src/game/haendler.ts`, der Handel selbst
in `Ausruestung` (er ändert Gold, Gegenstände und Angebot in einem Zug), die Bedienung in `lager.ts`.
- *Preise:* Der Händler verkauft zum vollen Wert eines Gegenstands (Normal 100, Selten 400, Rar 1.600, Legendär 6.400 Gold, mal 0,75 bis 1,25 je nach Güte des Wurfs)
  und kauft für ein Viertel davon; das Verhältnis 4 zu 1 verhindert eine Schleife aus Kaufen und Verkaufen. Auf jedem Gegenstand und in seiner Karte steht der Preis, rot,
  wenn das Gold nicht reicht.
- *Angebot:* Zehn Plätze: im Schnitt 6,6 Normal, 2,8 Selten und höchstens ein Rarer (in etwa 57 von 100 Angeboten); je Platz fällt mit 0,1 % ein legendärer Ring
  einer zufälligen Klasse. Ist das Angebot leergekauft, bleibt es leer, bis eine Nacht gespielt ist: Danach würfelt der Händler neu, sobald man ihn ansieht.
  Ein Lauf, den man vor 60 Sekunden abbricht, zählt nicht als gespielte Nacht (sonst gäbe es das Angebot gratis neu). Das Angebot liegt im Spielstand,
  ein Neuladen würfelt es also nicht neu.
- *Angebot erneuern:* Der Befehl „Erneuern“ würfelt alle zehn Plätze neu (der Rückkauf bleibt). Das erste Mal in einer Nacht ist es gratis, dann kostet es 25 Gold, jedes weitere Mal das Doppelte
  (25, 50, 100, 200, …); mit jeder gespielten Nacht beginnt es wieder bei gratis.
- *Rückkauf:* Die letzten zehn verkauften Gegenstände (der jüngste zuerst) lassen sich für denselben Preis zurückkaufen, für den sie gingen. Sie bleiben über Nächte erhalten.
- *Kaufen und Verkaufen:* Enter auf einem Gegenstand im Angebot kauft ihn (er kommt ins Inventar der gezeigten Klasse, sonst in die Truhe); ein Gegenstand lässt sich auch
  auf einen freien Platz oder einen Reiter des eigenen Besitzes ziehen. Verkaufen geht mit E auf dem eigenen Gegenstand, mit dem Gegenstand in der Hand und Enter auf dem Angebot oder dem Rückkauf,
  oder indem man ihn auf den Händler zieht. Ab Rar fragt das Spiel vorher nach (Esc oder „Abbrechen“ lässt alles, wie es ist). Der eigene Besitz rechts zeigt das Inventar
  der Klasse als ersten Reiter, dahinter die Reiter der Truhe; „Normale verkaufen“ verkauft alle normalen Gegenstände des gezeigten Inventars oder Reiters nach einer Rückfrage mit der Summe
  (bei mehr als zehn bleiben nur die letzten zehn im Rückkauf). Angelegtes verkauft man nicht; es muss erst abgelegt werden.

**Beute.** Alle Zahlen stehen in `CONFIG.loot` und bei den Gegnerarten (`loot`) in `src/config.ts`; gewürfelt wird in `src/game/beute.ts`.

- *Aus Gegnern:* Jeder erschlagene Gegner lässt mit kleiner Wahrscheinlichkeit einen Gegenstand fallen (Schänder und Behemoth 0,08 %, Troll 0,8 %,
  Dhargass-Priester 1,2 %, Mantelträger 2 %). Bei einer vollen Nacht sind das im Schnitt 4 bis 5 Gegenstände, nach acht Minuten 1 bis 2. Starke Gegner
  würfeln bessere Gegenstände (Schänder und Behemoth: 72 % Normal, 22 % Selten, 5,5 % Rar, 0,5 % Legendär; die übrigen: 55 / 30 / 13,5 / 1,5 %).
  Der Platz ist gleich verteilt (je ein Neuntel). Fackel und Waffe gehören zur gespielten Klasse, alle anderen Plätze sind klassenneutral;
  Legendäres ist immer ein Ring der gespielten Klasse.
- *Die Kiste des Verschlingers:* Wer ihn erschlägt, bekommt eine Kiste mit 3 Gegenständen (kein Normal: 45 % Selten, 42 % Rar, 13 % Legendär).
  Der **Pech-Schutz** hebt die Chance auf Legendäres in der nächsten Kiste um 5 Prozentpunkte je Gegenstand, für jede Kiste, die ohne Legendäres
  blieb (zu Lasten von Selten); nach einem Legendären fällt sie auf 13 % zurück. Im Schnitt kommt so nach gut zwei Kisten ein Legendäres. Der Zähler
  liegt im Spielstand (`items.pity`), damit ein Neuladen die Kiste nicht neu würfelt. Es gibt noch kein Modell für die Kiste; sie ist ein Platzhalter aus Quadern.
- *Zur Figur:* Gefallene Gegenstände liegen einen Augenblick unter einem Lichtstrahl in der Farbe der Seltenheit (mit eigenem Klang) und fliegen
  dann der Figur zu, wo sie auch steht; so geht auch der Fund kurz vor Sonnenaufgang nicht verloren. Rare und legendäre Funde meldet das Spiel im Bild.
  Neben dem Geldbeutel zählt ein Stein in der Farbe des besten Funds die Gegenstände dieser Nacht.
- *Am Ende der Nacht:* Der Beutel wandert ins Inventar der gespielten Klasse, die wertvollsten Gegenstände zuerst. Was nicht mehr hineinpasst, kommt auf
  den ersten freien Platz der Truhe; findet er auch dort keinen, wird er zum Verkaufspreis verkauft (ein Viertel des Werts; `CONFIG.items.price`) und
  der Börse gutgeschrieben. Die Endanzeige nennt jeden Gegenstand und wohin er kam. Die Beute bleibt auch bei einem Sturz oder Abbruch erhalten.
- *Zufall:* Die Beute hat einen eigenen Zufallsstrom aus dem Seed des Laufs (siehe [Lauf-Seed](#technik); nicht aus dem Seed der Welt, sonst fielen nach
  jedem Neustart dieselben Gegenstände). Der Messlauf gibt jeder Nacht einen festen, weitergezählten Seed vor und schreibt die gefallenen Gegenstände je Nacht mit (`beute`).
- *Legendäre Ringe:* Jeder trägt die Evolution einer Fertigkeit seiner Klasse (siehe [Evolutionen](#evolutionen)). Welche, entscheidet der Wurf; Angriffe, die in
  der laufenden Nacht schon Rang 3 erreicht haben, werden dreimal so häufig gewürfelt (`CONFIG.skills.evolution.lootRank` und `lootWeight`), eine Hilfe und kein Zwang.

**Speicherung.** Die Gegenstände liegen im selben Spielstand wie das Gold (Feld `items`; `src/game/ausruestung.ts`), Fassung 8 (neu: die Grade der Nächte im Feld `grades`, siehe [Grade der Nächte](#grade-der-nächte); ältere Stände bekommen leere Grade; Fassung 7: ein legendärer Ring trägt die Evolution einer Fertigkeit; Ringe aus Fassung 6 bekommen beim Lesen eine, ohne dass etwas verloren geht, und
die Sicherung aus Fassung 6 bleibt dabei unberührt; Fassung 6 erstattete die Ränge der entfallenen Steigerungen als Gold und legte den alten Stand als Sicherung bereit, siehe [Gold](#gold); Fassung 5 brachte den Stand des Händlers mit Angebot, Rückkauf und Zähler der Erneuerungen, Fassung 4 die Truhe,
Fassung 3 den Pech-Schutz). Ältere Stände (Fassung 1 bis 7) werden Schritt für Schritt gehoben; Gold und Gegenstände bleiben unverändert. Was im Spielstand nicht zum Spiel passt (unbekannter Platz oder
Name, unmögliche Eigenschaft), wird beim Lesen verworfen, Werte außerhalb des heutigen Bereichs rücken an dessen Rand.

**Gleichgewicht.** `__items.verteilung('stark')`, `__items.kisten()` und `__items.angebote()` würfeln die Seltenheiten, den Pech-Schutz und das Angebot des Händlers in der Konsole tausendfach nach
und zählen. `__messlauf.start({ ausruestung: 'rar' })` belegt alle neun Plätze jeder Klasse mit rar gewürfelten Gegenständen
(`'normal'`, `'selten'` oder `'rar'`); ohne Angabe ist nichts angelegt. Auch das schreibt nichts in den echten Spielstand.

## Fertigkeiten: der Unterbau

Die Fertigkeiten der Klassen kamen in eigenen Paketen (Kämpfer, Wildnisläufer, Magier) und bauen alle auf diesen Bausteinen auf. Das Paket, das sie legte (Version 0.8.0), hatte **keine
sichtbare Wirkung** im Spiel, außer dass festgehaltene Gegner wie bisher fahl dastehen: Die Angriffe von damals liefen über die neuen Bausteine und verhielten sich genau wie vorher
(in einem festgelegten Lauf über zwölf Minuten Spielzeit stimmten Gegner, Erschlagene, Leben der Horde, Ort der Figur und Ränge der Angriffe bei allen drei Klassen mit dem Stand vor dem Umbau überein).

- **Zustände der Gegner** (`status.ts`): festgehalten (`hold`), verlangsamt (`slow`), im Nachteil (`weak`), blutend (`bleed`), brennend (`burn`), markiert (`mark`), in Furcht (`fear`),
  geblendet (`blind`), geschwächt (`feeble`) und ohne Zauber (`silence`). Jeder Gegner trägt einen festen Satz davon (Restzeit, Stärke, Urheber); es entsteht nie etwas Neues.
  Wirkt ein Zustand schon, gilt die längere Dauer und die stärkere Stärke; ein schwächerer Wert verlängert einen stärkeren nicht. Die Stärke bedeutet je nach Zustand etwas anderes
  (Kopf der Datei): bei `slow` der Anteil des Tempos, der wegfällt, bei `bleed` und `burn` der Schaden je Sekunde, bei `mark` die Kritchance, die gegen den Gegner dazukommt. Wer sich
  fürchtet, läuft von der Figur weg und greift nicht an; wer geblendet oder geschwächt ist, richtet weniger Schaden an (Geschwächte laden zudem langsamer nach); wer verstummt ist, wirkt keinen Zauber
  (der Priester). Standardstärken stehen in `CONFIG.skills.status`.
- **Ereignisse mit Urheber** (`events.ts`): Jeder Treffer, Tod und jede Verletzung der Figur wird mit seinem Urheber gemeldet (`Source`, etwa die Kennung des Angriffs). Fertigkeiten, die
  auf einen Treffer, einen Tod oder einen eingesteckten Schlag reagieren, hängen sich als `CombatListener` an. Schaden über Zeit (Blutung, Brennen, Felder) meldet sich getrennt (`dot`).
- **Bodenfelder** (`fields.ts`): ein Ort, eine Form (Kreis, Streifen oder Ring), eine Dauer und eine Wirkung je Takt: Schaden und Zustände für Gegner, Leben und zeitweilige Werte für die Figur,
  Zug zur Mitte, ein Haken beim Tod eines Gegners darin (`onKill`) und beim Ende (`onEnd`). Banner, Sporenwolke, Köderpuppe, Netz, Glutlinie, Erdring und Dornen-Aura sind später alle
  ein solches Feld. Höchstens `CONFIG.skills.maxFields` liegen zugleich; ein neues ersetzt das älteste. Ein Kreisfeld kann ein **Köder** sein (`FieldDef.lure`, siehe Köderpuppe): Es meldet sich
  in jedem Bild bei der Horde (`Enemies.lure`), Gegner in seiner Reichweite laufen dann auf seine Mitte zu statt auf die Figur.
- **Zeitweilige Werte** (`buffs.ts`): Tempo-Schübe, Vorteil im Nahkampf, weniger erlittener Schaden. Sie liegen als auslaufende Schicht über den dauerhaften Werten: `Progression.base` hält,
  was Klasse, Gegenstände, Stärkungen und Segen ergeben, `Progression.stats` ist das Ergebnis, das alle anderen Teile lesen (dasselbe Objekt wie bisher). Derselbe Wert mit derselben Kennung
  frischt Dauer und Stapel auf; gerechnet wird erst addiert, dann multipliziert, beides je Stapel (`CONFIG.skills.maxBuffs` Plätze). Neu ist der Wert `Stats.taken`, ein Faktor auf den erlittenen Schaden.
- **Rangregeln als Daten** (`weapons.ts`, `WeaponDef.ranks`): Ein Angriff darf je Rang aufschreiben, was vom Einheitsrang abweicht (Schaden, Abklingzeit, Reichweite, Fläche, Winkel, Zahl der
  Geschosse, Durchschlag, Rückstoß, Zustände, Schalter für Besonderheiten). Was ein Rang nennt, gilt auch für die folgenden; was nie genannt wird, folgt den alten Regeln (+25 % Schaden und
  ×0,94 Abklingzeit je Rang). `resolveRank` liefert die fertige Zeile.
- **Kleine Änderung im Boss:** Die Grenze, bis zu der sich der Verschlinger bremsen lässt (70 % Tempo), steht jetzt als `CONFIG.boss.slowFloor` in der Konfiguration; der Wert ist derselbe.

**Ausprobieren.** Im Dev-Modus steht `__skills` in der Konsole (Beschreibung in `src/tools/skills.ts`), mitten in einer Nacht: `__skills.zustand('bleed', 4, 6)` bringt allen Gegnern im Umkreis einen Zustand an,
`__skills.feld({ shape: 'circle', radius: 4, damage: 5, pull: 2 })` stellt ein Bodenfeld auf, `__skills.wert('speed', 'mul', 1.5, 6)` setzt einen zeitweiligen Wert, `__skills.hoeren()` und
`__skills.ereignisse()` zählen Treffer, Tode und Verletzungen mit Urheber, `__skills.raenge('wirbelschlag')` zeigt die aufgelösten Ränge und `__skills.stand()` das, was gerade wirkt.

## Fertigkeiten des Kämpfers

Der Kämpfer hat sieben Fertigkeiten (Vorlage: „Klassen, Fertigkeiten & Evolutionen“, Abschnitt Kämpfer), je fünf Ränge. Alle sind **Daten** in `weapons.ts`; die Zahlen, die man beim Balancing anfasst,
stehen in `CONFIG.skills.kaempfer`. Jeder Rang bringt auf der Auswahlkarte einen eigenen Satz (`WeaponDef.rankText`), der sagt, was der **nächste** Rang tut. Was die Tabelle eines Rangs nicht nennt,
folgt den alten Regeln (+25 % Schaden je Rang). Die **Evolutionen** (Rang 6) stehen im Abschnitt [Evolutionen](#evolutionen).

| Fertigkeit    | Art                    | Was die Ränge bringen                                                                                                                  |
| ------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Axthieb       | Hieb im Bogen          | 2: +25 % Reichweite, +30 % gegen Gegner, auf die man zuläuft · 3: Blutung und Verlangsamung · 4: kürzere Abklingzeit, Rückhand-Hieb · 5: Nachteil und Markierung |
| Banner        | Bodenfeld, 12 s Pause  | 1: 6 s Schaden im Kreis · 2: +30 % Radius · 3: jeder zehnte Tote im Banner lässt einen Lebenssplitter fallen · 4: 8 s, Gegner richten 20 % weniger Schaden an · 5: zieht Edelsteine heran |
| Wurfaxt       | Geschoss               | 1: bleibt kurz im Ziel stecken · 2: durchschlägt zwei · 3: zwei Äxte · 4: Staubspur verlangsamt · 5: Äxte kehren zurück                  |
| Wirbelschlag  | Rundumschlag           | 2: +30 % Radius · 3: zweiter Wirbel, mehr Tempo · 4: Treffer verkürzen die Abklingzeit, weiter Rückstoß · 5: 30 % weniger erlittener Schaden im Wirbel, doppelter Schaden gegen Umzingelnde |
| Wuchthieb     | Hieb mit Ausholen      | 2: kürzeres Ausholen, dabei 30 % weniger erlittener Schaden · 3: Blendung und Betäubung · 4: +40 % Radius, Rückstoß · 5: fünf Treffer laden den nächsten Schlag (sicherer Krit) fast sofort |
| Kriegsschrei  | Druckwelle             | 1: Furcht, kein Schaden · 2: +35 % Radius, Schaden an Schwachen · 3: 4 s Vorteil (Tempo der Hiebe, Kritchance) · 4: Nachteil 20 % · 5: kürzere Pause, Echo nach 1,5 s |
| Dornenschild  | Passiv (`kind: 'thorns'`) | Wer die Figur im Nahkampf trifft, wird gestochen (auch bei einem abgefangenen Treffer) · 2: +30 %, Blutung · 3: Rammbock, ×2 gegen frontale Angreifer · 4: jeder dritte Treffer schleudert drei Eisensplitter · 5: Verlangsamung |

Wie das gebaut ist:

- **Rangregeln mit Schaltern.** Zahlen je Rang (Schaden, Abklingzeit, Reichweite, Fläche, Zustände) stehen in `WeaponDef.ranks`; Besonderheiten sind benannte Schalter (`flags`, etwa `zulaufen`, `rueckhand`, `splitter`,
  `schutz`, `umzingelt`, `kette`, `echo`, `ramm`), die `arsenal.ts` mit `hasFlag` abfragt. `RankRule.lead` verkürzt das Ausholen (Wuchthieb, Rang 2).
- **Der Banner ist ein Bodenfeld** (`fields.ts`): Es wird dort gesetzt, wo die Figur steht, sobald ein Gegner innerhalb von 7 m ist. Jeder Takt (0,5 s) schadet und schwächt (`feeble`); der Haken `onKill` lässt die
  Lebenssplitter fallen, der neue Haken `onTick` zieht die Edelsteine heran. Lebenssplitter sind eine zweite, kleine Liste in `pickups.ts` (feste Plätze, wie die Edelsteine); ihr Heilwert wird einmal je Frame an die Figur gegeben.
- **Das Dornenschild hört zu**: Es ist ein `CombatListener` (`Arsenal.listener`) auf das Ereignis `hurt`, das jetzt den Angreifer mitliefert; das Spiel meldet ihn zu Beginn jeder Nacht an. Der Stich läuft wie jeder
  andere Treffer über `Arsenal.hit` und trägt den Urheber `dornenschild`.
- **Äxte der Wurfaxt** können stecken bleiben, eine Staubspur ziehen und zurückkehren (`Projectiles`, Optionen je Rang, einmal angelegt); nichts davon erzeugt Objekte im Kampf.
- **Folgeschläge** (Rückhand, zweiter Wirbel, Echo des Kriegsschreis) liegen in einem kleinen festen Pool (`FollowUp`) und laufen über denselben Weg wie der Hauptschlag.
- Klänge: `angriff.banner` und `angriff.dornenschild` sind neu in `audio.json` (erzeugt von `tools/audio-erzeugen.py`).

**Abweichungen von der Vorlage** (die Vorlage ist ein Leitfaden, siehe [Lore](#lore)):

- „Rüstungsverlust“ ist im Spiel ein **Nachteil** (`weak`): Der Gegner erleidet mehr Schaden. Das Spiel hat keine Rüstung der Gegner.
- Wirbelschlag, Rang 5: „immun gegen Verlangsamung“ wird zu **30 % weniger erlittenem Schaden** während des Wirbels; die Figur wird ohnehin nicht verlangsamt, ein Schutz davor wäre ohne Wirkung.
- Dornenschild, Rang 4: Die Eisensplitter fliegen auf den **Angreifer** statt „nach vorn“, sonst träfen sie kaum je.
- Kriegsschrei: Der Schaden aus Rang 2 trifft nur kleine Gegner (nicht den Troll und den Verschlinger, also kein Großwild; Schalter `schwache`), damit der Schrei kein zweiter Flächenangriff wird. Wurfaxt, Rang 1: Die Axt trifft **einen** Gegner und bleibt stecken (vorher
  durchschlug sie alle); das Durchschlagen kommt mit Rang 2.
- Banner, Rang 5: Das Banner holt **Edelsteine** heran (nicht die Beute der Gegner); sie fliegen von allein zur Figur.

## Fertigkeiten des Wildnisläufers

Auch der Wildnisläufer hat sieben Fertigkeiten mit je fünf Rängen (Vorlage: „Klassen, Fertigkeiten & Evolutionen“, Abschnitt Wildnisläufer), und auch sie sind **Daten** in `weapons.ts`. Die Zahlen für Balancing
stehen in `CONFIG.skills.laeufer`. Die Auswahlkarte nennt wie beim Kämpfer, was der **nächste** Rang tut (`WeaponDef.rankText`). Die **Evolutionen** (Rang 6) stehen im Abschnitt [Evolutionen](#evolutionen).

| Fertigkeit       | Art                       | Was die Ränge bringen                                                                                                                         |
| ---------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Bogenschuss      | Geschoss                  | 1: schwerer Pfeil, stößt kleine Gegner zurück · 2: durchbohrt das erste Ziel, zweites mit 40 % weniger Schaden · 3: Nachladezeit −0,3 s, Treffer verlangsamen 1,5 s um 15 % · 4: zwei Pfeile, Vorteil · 5: mehr Reichweite und Tempo, das erste Ziel erleidet 3 s lang 15 % mehr Schaden |
| Pfeilhagel       | Salve mit Verzögerung     | 1: 6 Pfeile · 2: 9 Pfeile (1,5 × Schaden), Radius +20 % · 3: Verlangsamung im Zielgebiet, 1,75 × Schaden · 4: kürzere Abklingzeit, Blutung, 2,25 × Schaden · 5: folgt der Gruppe, 25 % mehr Schaden im Zentrum, 2,5 × Schaden |
| Fangeisen        | Falle (`kind: 'trap'`)    | 1: Schaden, 1,5 s festgehalten · 2: zwei Eisen zugleich · 3: kürzere Abklingzeit, Blutung · 4: Nachteil und Markierung der Gefangenen · 5: Stirbt ein Gefangener im Eisen, fliegen Splitter auf Gegner ringsum |
| Wurfmesser-Fächer | Geschoss, Fächer         | 1: drei Messer, jedes trifft sein erstes Ziel · 2: vier Messer, breiter · 3: kürzere Abklingzeit, Blutung · 4: fünf Messer, Vorteil · 5: Messer durchschlagen ein Ziel |
| Sporenfalle      | Kapsel (`kind: 'pod'`) → Bodenfeld | 1: Kapsel platzt bei Annäherung, Wolke 3,5 s (Schaden, 20 % langsamer) · 2: Radius +30 %, 1 s länger · 3: kürzere Abklingzeit, Fernkämpfer ohne Zauber, Gegner greifen langsamer an · 4: zwei Kapseln, mehr Schaden über Zeit · 5: Wer in der Wolke stirbt, lässt eine frische Wolke zurück |
| Köderpuppe       | Bodenfeld, 8,5 s Pause    | 1: Gegner im Umkreis laufen auf die Puppe zu statt auf dich, sind 20 % langsamer und träger · 2: Bereich +30 %, steht 5 s · 3: kürzere Abklingzeit, kleine Gegner im Schatten fürchten sich · 4: nahe der Puppe 40 % weniger Schaden aus Fernangriffen · 5: beim Auflösen eine Schadenswelle mit Rückstoß |
| Netz             | Fläche (`kind: 'root'`)   | 1: Schaden, 2,5 s um 40 % langsamer · 2: Radius +30 %, 50 % · 3: kürzere Abklingzeit, zieht Getroffene zusammen · 4: Blutung und Nachteil · 5: Staub macht kleine Gegner 1,5 s bewegungsunfähig und stört Fernkämpfer |

Wie das gebaut ist:

- **Neue Schalter und Zahlen je Rang** (`RankRule`, `ResolvedRank`): `speed` und `spread` (Faktoren auf Pfeiltempo und Streuung), `duration` (Sekunden, etwa die Haltezeit einer Wolke) und die Schalter `abfall`, `vorteil`, `ruestung`, `folgen`,
  `mitte`, `splitter`, `platzen`, `furcht`, `schleier`, `knall`, `zug`, `staub`; `arsenal.ts` fragt sie mit `hasFlag` ab. `abfall` lässt Durchschlag-Ziele nach dem ersten nur `pierceFalloff` (60 %) des Schadens erleiden;
  `vorteil` gibt gegen Gegner im Nachteil, verlangsamt oder blutend `advantageCrit` (+30 %) Kritchance, ohne dass ein Zustand dafür verbraucht wird.
- **Die Sporenfalle ist Kapsel und Feld**: Eine Kapsel (`kind: 'pod'`, höchstens vier liegen) bleibt, bis ein Gegner in ihre Nähe kommt, und öffnet sich dann in ein Bodenfeld mit Schaden je Takt und den Zuständen des Rangs
  (`fields.ts`). Das Feld von Rang 5 meldet sich in `onKill`: Wer darin stirbt, lässt eine kleine zweite Wolke zurück (nie mehr als 14 Felder, nicht auf einer bestehenden Wolke).
- **Die Köderpuppe ist ein Bodenfeld** an der Figur und ein **Köder**: Gegner bis zum Dreifachen ihres Radius (`CONFIG.skills.laeufer.decoyLure`: 7,8 m auf Rang 1, 10,1 m ab Rang 2) richten sich nach ihr statt nach der Figur.
  Sie laufen auf die Puppe zu, bleiben an ihrem Rand stehen (`CONFIG.enemies.lureStand`) und drängen sich dort; ihre Zauber (Schwarzer Sog) und Hiebe gelten der Puppe, die Figur trifft nur, wer ihr dabei in den Weg gerät.
  Wer sich fürchtet, folgt dem Köder nicht (er läuft wie bisher von der Figur weg), der vom Boss geführte Verschlinger auch nicht. Die Puppe schickt 1,5 s nach dem Aufstellen kleine Gegner in Furcht (`furcht`), schützt die Figur
  hinter einem Schleier (`schleier`: ein zeitweiliger Wert `rangedTaken`, siehe unten) und löst sich mit `onEnd` in eine Schadenswelle (`knall`). Das Netz fängt über `kind: 'root'` die Gruppe um den nächsten Gegner, zieht sie zusammen (`zug`) und betäubt kleine Gegner (`staub`, Zustand `hold`).
- **Pfeilhagel**: Die Salve schlägt verzögert ein; mit `folgen` rutscht ihre Mitte bis zu 1,4 m zur Gruppe, mit `mitte` trifft das Zentrum 25 % härter. **Fangeisen**: Der Haken `listener.kill` sieht, wenn ein Gefangener im Eisen stirbt (`splitter`).
- **`Stats.rangedTaken`** ist neu: ein Faktor auf Schaden aus Fernangriffen (heute nur der Schwarze Sog), den die Köderpuppe über einen zeitweiligen Wert senkt. `Player.hurt` hat dafür den Parameter `ranged`.
- Klänge: `angriff.sporenfalle`, `einschlag.sporenfalle`, `angriff.koederpuppe`, `einschlag.koederpuppe` und `angriff.netz` sind neu in `audio.json` (erzeugt von `tools/audio-erzeugen.py`).
- Zwei neue Bilder: das Gestell der Köderpuppe und die Pilzkapsel (`props.ts`, `effects.ts`), beide aus Rechnung und mit festem Pool; das Netz ist ein Gitter aus Strichen, kein neues Modell.

**Abweichungen von der Vorlage** (die Vorlage ist ein Leitfaden, siehe [Lore](#lore)):

- „Rüstungsverlust“ und „Nachteil“ sind im Spiel ein **Nachteil** (`weak`) für *jeden* Urheber, nicht nur für Pfeile und Messer: Der Gegner erleidet mehr Schaden. Das Spiel hat keine Rüstung der Gegner.
- Bogenschuss: Die Grundwerte sind **1 s Abklingzeit und 36 Schaden** (vorher 0,65 s und 16), damit „−0,3 s“ aus Rang 3 etwas bedeutet. Bogenschuss und Wurfmesser durchschlagen auf Rang 1 nichts mehr (vorher durchschlugen beide ein weiteres Ziel);
  das kommt mit Rang 2 bzw. 5. Die Wurfmesser haben 3 / 4 / 5 Messer (vorher 3 / 5 / 7), Rang 5 bringt den Durchschlag statt zweier Messer mehr. Weil Rang 1 jetzt nur ein Ziel trifft, ist der Schaden höher (Bogenschuss 36 statt 16, Wurfmesser 12 statt 9). Im Messlauf (zwölf Nächte, zwei Saatwerte) überlebt die Automatik-Figur damit im Mittel etwa so lange wie vorher (431 s gegen 470 s; die Streuung liegt bei rund 40 s).
- Fangeisen: Die Haltezeit ist **1,5 s** (vorher 2,5 s); Rang 5 schleudert die Splitter **ohne Zustände**, sonst würde jede Kette neue Gefangene machen.
- Pfeilhagel: Der Schaden steigt mit der Zahl der Pfeile (1,5 × bei neun), weil die Vorlage mehr Pfeile, nicht mehr Fläche meint. Ab Rang 3 steigt er weiter (1,75 / 2,25 / 2,5 ×), die Grundwerte sind **3,4 s Abklingzeit, 24 Schaden, 3,8 m Radius und 0,45 s Verzögerung**
  (vorher 4,5 s, 16, 3 m, 0,6 s). Das weicht von der Vorlage ab, die für Rang 3 bis 5 keinen Schadensanstieg nennt: Die Salve traf im Messlauf im Schnitt nur drei Gegner und kam auf 18 Schaden pro Sekunde (Bogenschuss, Banner und Sorlanze auf 72 bis 79),
  und Schaden allein half kaum (bis 708 s statt 630 s). Mit den neuen Werten überlebt die Automatik-Figur mit dem Hagel auf Rang 5 im Mittel 730 s statt 630 s, mit der Evolution 861 s statt 750 s (Siege 80 % statt 30 %; je 20 Nächte, gleiche Saatwerte; die Streuung liegt bei rund 20 s).
- Banner: Die Grundwerte sind **12 s Abklingzeit und 4,5 Schaden je Takt** (vorher 11 s und 5). Das ist ein Eingriff ins Gleichgewicht, keine Abweichung von der Lore (die Vorlage nennt keine Zahlen).
  Im Messlauf (je 40 Nächte, gleiche Saatwerte) überlebt die Automatik-Figur mit dem Banner auf Rang 5 im Mittel 838 s statt 831 s (Siege 65 % statt 68 %, das liegt innerhalb der Streuung), erschlägt den Boss aber nur noch in 42 % statt 60 %;
  mit der Evolution sind es 895 s statt 884 s bei 95 % Siegen und Boss in 62 % statt 70 %. Der Kämpfer im Normalspiel hält 528 s statt 579 s. Die Evolution bleibt damit die stärkste; ein weiterer Eingriff dort (Faktor 1,8 statt 3 oder Radius 1,2 m statt 1,4 m auf Rang 6) wäre ein eigener Schritt.
- Sorlanze, Evolution (Speer der Verschwundenen Sonne): Die Zahlen sind **stärker als zuerst gesetzt** (Abklingzeitfaktor 0,6 statt 0,8, Schaden ×4 statt ×3, Einschlag ×3,2 statt ×2,4 im Radius 2,8 m statt 1,8 m, Strahlen 11 m lang und 1,6 m breit statt 8 m und 1,1 m).
  Das ist ein Eingriff ins Gleichgewicht, keine Abweichung von der Lore (die Vorlage nennt keine Zahlen). Mit den alten Werten war die Evolution ein Rückschritt: Die Automatik-Figur überlebte mit ihr im Mittel 773 s bei 39 % Siegen, mit Rang 5 aber 833 s bei 77 %.
  Mit den neuen Werten sind es 831 s bei 80 % Siegen, und der Boss fällt in 81 % statt 39 % der Nächte: Die Evolution liegt damit auf der Höhe von Rang 5 und nicht mehr darunter (je 120 Nächte, drei Saatwerte, Stand 0.15.4; die Streuung liegt bei rund 15 s).
  In einer früheren Messreihe reichten Abklingzeit und Schaden allein (772 s, 55 %) oder mehr Fläche und Länge allein (783 s, 60 %) nicht; erst beides zusammen hob die Evolution über Rang 5, und noch mehr (Abklingzeit 0,5, Schaden ×5, Radius 3,2 m, Strahlen 12 m und 2 m) brachte nichts dazu.
- Sporenfalle, Köderpuppe und Netz: „Fernkämpfer können nicht zielen“ ist im Spiel **ohne Zauber** (`silence`), denn nur der Priester wirkt aus der Ferne. Das gilt gleich für die Betäubung in Rang 5 des Netzes.
- Köderpuppe: „Ausweichchance“ aus Rang 4 ist **40 % weniger Schaden aus Fernangriffen** (`rangedTaken`, 0,6 für 0,8 s, solange man nahe der Puppe steht); das Spiel kennt kein Ausweichen, und der Schwarze Sog ist der einzige Fernangriff.
  „Köderpuppe zerschlagen“ gibt es nicht: Gegner laufen auf die Puppe zu und drängen sich um sie, greifen sie aber nicht an; sie löst sich nach ihrer Dauer auf.
  Das Gestell steht an der Figur (nicht beim Gegner), sobald ein Gegner innerhalb von 9 m ist; das Netz fällt auf die nächste Gruppe.
- Sporenfalle, Rang 5: Die kleinen Wolken sind begrenzt (höchstens 14 Felder, keine Überlagerung), damit die Kette bei einer dichten Horde die Felder nicht aufbraucht.
- Kein Savegame- und kein Plattform-Eingriff: `SAVEGAME_VERSION` bleibt, Pfade und Eingabe sind unverändert.

## Fertigkeiten des Magiers

Auch der Magier hat sieben Fertigkeiten mit je fünf Rängen (Vorlage: „Klassen, Fertigkeiten & Evolutionen“, Abschnitt Magier), und auch sie sind **Daten** in `weapons.ts`. Die Zahlen für das Balancing stehen in
`CONFIG.skills.magier`. Die Auswahlkarte nennt wie bei den anderen Klassen, was der **nächste** Rang tut (`WeaponDef.rankText`). Die **Evolutionen** (Rang 6) stehen im Abschnitt [Evolutionen](#evolutionen).

| Fertigkeit    | Art                          | Was die Ränge bringen                                                                                                                                  |
| ------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hitze werfen  | Hitzestoß in einer Linie     | 1: durchdringt alle Gegner in der Linie, entzündet 2 s · 2: +25 % Reichweite und Breite, Entzündete im Nachteil · 3: kürzere Abklingzeit, Verlangsamung · 4: breiter Kegel · 5: glühende Aschelinie am Ende der Reichweite |
| Sorlanze      | Lichtspeer (`kind: 'beam'`)  | 1: durchbohrt drei, jeder weitere schwächer · 2: alle auf der ganzen, längeren Bahn ohne Verlust · 3: kürzere Abklingzeit, Blendung · 4: Glutspur brennt und bremst · 5: zwei versetzte Lanzen, sicherer Krit gegen Brennende und Gegner im Nachteil |
| Glut formen   | Aura                         | 1: Glutkreis um die Figur · 2: +30 % Radius, mehr Schaden · 3: Gegner im Kreis greifen 15 % langsamer an · 4: wer über 2 s im Kreis steht, brennt weiter · 5: alle 4 s ein Puls mit doppeltem Schaden, der kleine Nahkämpfer an den Rand stößt |
| Erdstoß       | Druckwelle                   | 1: Schaden, Rückstoß · 2: +30 % Radius, stärkerer Rückstoß · 3: kürzere Abklingzeit, Verlangsamung · 4: zweite, engere Welle betäubt, wer standgehalten hat · 5: Ring aus Erde am Rand der Welle bremst 2,5 s |
| Wurzelgriff   | Fläche (`kind: 'root'`)      | 1: hält bis zu fünf Gegner 1,8 s fest · 2: +30 % Radius, 2,2 s · 3: kürzere Abklingzeit, Gefesselte bluten · 4: Nachteil, 20 % mehr Schaden durch Feuer und Licht · 5: Stirbt ein Gefesselter, packt eine neue Wurzel den nächsten freien Gegner |
| Sturmböe      | Windschneise (`kind: 'arc'`) | 1: Schnitt und Rückstoß nach vorn · 2: danach 2 s lang 30 % mehr Tempo · 3: kürzere Abklingzeit, stört Zauberer · 4: +30 % Breite und Reichweite, bremst · 5: Staubspur hinter der Figur bremst und schwächt Verfolger |
| Schild        | Schutz (`kind: 'shield'`)    | 1: fängt einen Treffer ganz ab, 10 s Neubildung · 2: 1,5 s kürzer · 3: zwei Ladungen · 4: beim Bruch ein Impuls, der Angreifer blendet und bremst · 5: fünf Zaubertode oder zehn Treffer an einem Großen verkürzen die Neubildung |

Wie das gebaut ist:

- **Neue Schalter** (`flags`, mit `hasFlag` abgefragt): `asche`, `glutspur`, `doppel`, `treffsicher`, `entzuenden`, `puls`, `welle`, `ring`, `trocken`, `nachwuchs`, `schub`, `zerstreuen`, `spur`, `impuls`, `staub`. Neu ist auch die Rangzahl
  `count` (Ladungen des Schilds). Alles übrige sind Tabellenwerte der Ränge wie bisher.
- **Hitze werfen und Sorlanze:** Der Hitzestoß ist ein schmaler Bogen (`arc`), den Rang 4 zum Kegel weitet; die Aschelinie von Rang 5 steht senkrecht zur Blickrichtung am Ende der Reichweite (ein Streifenfeld, höchstens 7 m lang).
  Die Sorlanze trifft nur die ersten `pierce + 1` Gegner auf ihrer Bahn (über einen festen Satz Plätze sortiert, nichts Neues im Kampf); `abfall` lässt jeden weiteren `lanceFalloff` (70 %) des Vorgängers erleiden.
  Glutspur und zweite Lanze sind ein Streifenfeld bzw. ein `FollowUp` (`'lanze'`); `treffsicher` setzt die Kritchance gegen Gegner im Nachteil oder in Flammen auf 100 %.
- **Glut formen:** Die Aura trifft den ganzen Kreis. Für Rang 4 trägt jeder Gegner eine kleine Uhr (`Enemy.scorch`, `scorchAt`): Wer länger als `scorchAfter` (2 s) im Kreis steht, fängt Feuer; wer den Kreis verlässt, beginnt nach 0,8 s von vorn.
  Rang 5 zählt die Schläge und macht jeden achten zum Puls (doppelter Schaden, kleine Nahkämpfer ohne Zauber werden bis zu 3 m an den Rand geschoben).
- **Erdstoß:** Die zweite Welle ist ein `FollowUp` (`'welle'`, 0,35 s später, 70 % des Radius und des Schadens, betäubt kurz). Der Ring aus Erde ist eine **neue Feldform `ring`** in `fields.ts` (Kreisring um einen Mittelpunkt,
  Breite und Radius frei); ein Gegner darin wird gebremst. Das Bild (`effects.ts`, `earthRing`) steht als Palisade aus Zacken auf einem Band aus Staub.
- **Wurzelgriff:** Das Arsenal merkt sich den Wurzelgriff (`rooter`). Rang 4 erhöht den Schaden von Feuer- und Lichtzaubern (`strikeKind` `brand` und `glut`) gegen Gegner, die dieser Wurzelgriff festhält. Rang 5 hört auf `kill`: Stirbt ein
  Gefesselter, sucht die neue Wurzel im Umkreis von 6 m den nächsten Gegner, der weder festsitzt noch vom Verschlinger geführt wird (`regrowPick`).
- **Sturmböe:** Neues Bild `gustLane` (Windfahnen entlang der Schneise). Der Schub ist ein zeitweiliger Wert (`Progression.addBuff`, Tempo ×1,3 für 2 s); Rang 5 setzt währenddessen alle 0,35 s ein Kreisfeld mit Staub
  (`updateTrail`), das Verfolger verlangsamt und schwächt. Die Felder liegen im festen Pool.
- **Schild:** `Player.shieldCharges` (Zahl) ersetzt den Wahrheitswert; `Player.shield` bleibt als Leseeigenschaft. Der letzte abgefangene Treffer meldet sich über `CombatEvents.hurt` (`absorbed`) und löst bei Rang 4 den Impuls aus.
  Rang 5 hört auf `kill` und `hit`: Fünf Tode durch einen Zauber (`SPELLS`: alle sechs Angriffszauber des Magiers) oder zehn Treffer eines Zaubers an einem Großen (Troll, Verschlinger; Schaden über Zeit zählt nicht) ziehen ein Viertel der Neubildungszeit ab,
  solange der Schild lädt. Die Neubildung beginnt erst, wenn die letzte Ladung verbraucht ist.
- Neue Bilder: Glutlinie (`strips.ts`, Aussehen `glutlinie`), Windschneise, Glutpuls, Staubspur, Impuls und Treffer des Schilds (`effects.ts`: `gustLane`, `glowLine`, `emberBurst`, `dustTrail`, `dustPulse`, `shieldHit`). Der alte Strahlenkranz der Sturmböe ist entfallen.
  Für die Angriffe der Sturmböe, des Wurzelgriffs und des Schilds gibt es bereits Klänge in `audio.json`; neue sind nicht nötig.

**Abweichungen von der Vorlage** (die Vorlage ist ein Leitfaden, siehe [Lore](#lore)):

- Wo die Vorlage „Abklingzeit verringert“ ohne Zahl nennt, ist es im Spiel der Faktor **0,8**; „−x Sekunden“ ist ein Faktor auf die Grundzeit (etwa Erdstoß, Rang 3: −0,7 s ≙ ×0,82 von 3,8 s).
- Hitze werfen und Sorlanze: „Rüstung wird spröde“ und „Nachteil“ sind ein **Nachteil** (`weak`): Der Gegner erleidet 20 % mehr Schaden. Sorlanze, Rang 1: Die Vorlage nennt keinen Schadensverlust beim zweiten und dritten Treffer; im Spiel sind es **70 %** je weiterem Ziel.
  Rang 2: „bis zum Bildschirmrand“ ist eine **um 30 % längere Bahn** (19,5 m).
- Gegner mit Fernangriff gibt es im Spiel nur als Priester (Schwarzer Sog, ein Bodenzauber, kein Geschoss). Darum werden aus „Geschosse ablenken/abfangen“: Erdstoß, Rang 5: der Ring **bremst** nur, er hält nichts auf; Sturmböe, Rang 3:
  die Böe **stört Zauberer** (`silence`, 1,5 s); Sturmböe, Rang 5: die Staubspur senkt statt der „Treffergenauigkeit“ den **Schaden der Verfolger** (`feeble`) und bremst sie; Schild: Der Impuls aus Rang 4 trifft Angreifer in 3,5 m.
- Glut formen, Rang 3: „Angriffsgeschwindigkeit −15 %“ ist **Schwäche** (`feeble`, 15 %): Die Gegner schlagen seltener und schwächer zu.
- Erdstoß, Rang 2: „mehr Rückstoß gegen Schwache“ gilt für alle (×1,4); große Gegner lassen sich ohnehin schwerer stoßen (der Rückstoß teilt sich durch die Größe). Rang 4: „betäubt“ ist `hold` für 0,8 s.
- Wurzelgriff, Rang 3: „kontinuierlicher Schaden“ ist **Blutung** (3 je Sekunde, solange der Gegner festsitzt); Rang 4: die 20 % mehr gelten für Treffer von Feuer- und Lichtzaubern auf Gefesselte *dieses* Wurzelgriffs (Hitze werfen, Glut formen, Sorlanze).
- Schild: „fängt den nächsten Treffer ab“ gilt für jeden Treffer eines Gegners, auch den eines Fernangriffs. Rang 5: „Zauber“ sind die sechs Angriffszauber des Magiers; „Elite oder Boss“ ist Großwild (Gegner ab Größe 1,5, also Troll und Verschlinger).
- Die Grundwerte folgen den Rangtabellen der Vorlage und weichen von den alten ab: Hitze werfen 1,2 s statt 0,95 s; Sorlanze 2,5 s und 26 Schaden statt 2,4 s und 22; Erdstoß 3,8 s statt 5 s, dafür kein Festhalten mehr, nur Rückstoß;
  Wurzelgriff 3,8 s statt 4,5 s, Rang 1 hält 1,8 s statt 3 s; Schild 10 s statt 12 s. Aus der Sturmböe, früher ein Rundumstoß alle 6 s, ist eine Windschneise nach vorn alle 2,2 s geworden (Schaden 14, Rückstoß, Tempo-Schub ab Rang 2). Der Grundschaden war zuerst 6; damit kam die Böe im Messlauf auf rund 14 Schaden pro Sekunde und trug nichts bei.
  Mit 14 überlebt die Automatik-Figur mit der Böe auf Rang 5 im Mittel 746 s statt 644 s, die Evolution bekommt zusätzlich den Faktor 4,2 statt des Standardanstiegs (×2,25) und kommt auf 842 s statt 737 s (Siege 72 % statt 28 %; je 40 Nächte, gleiche Saatwerte; die Streuung liegt bei rund 20 s).
  Mehr Schaden als etwa 14 hilft auf Rang 5 nicht mehr, kürzere Abklingzeit, weniger Rückstoß und ein breiterer Kegel brachten im Messlauf nichts Messbares.
  Im Messlauf (zwölf Nächte, zwei Saatwerte, 24 Läufe je Stand) überlebt die Automatik-Figur des Magiers damit im Mittel 450 s gegen 384 s vorher (die Streuung liegt bei 130 bis 190 s); eine Feinjustierung der Zahlen war nicht nötig.
- Kein Savegame- und kein Plattform-Eingriff: `SAVEGAME_VERSION` bleibt, Pfade und Eingabe sind unverändert.

## Evolutionen

Jede Fertigkeit hat eine **Evolution**: einen sechsten Rang, der aus dem Angriff etwas Neues macht (Vorlage: „Klassen, Fertigkeiten & Evolutionen“). Das Paket kam in drei Teilen; **mit dem Magier (je sieben für Kämpfer, Wildnisläufer und Magier) ist es vollständig**.

**Wie man sie bekommt.** Die Vorlage verlangt den Angriff auf Rang 5 und ein passives Item. Das Spiel hat keine passiven Gegenstände (das Talentbaum-Paket entfällt), also trägt der **legendäre Ring** die Evolution:
Jeder legendäre Ring gehört zu einer Fertigkeit seiner Klasse (Feld `evolution` am Gegenstand; die Karte nennt Namen und Wirkung, und der Ring trägt den Gegenstandsnamen der Vorlage: beim Kämpfer Henkerswerk, Nimmersatt, Sturmklinge, Wirbelsturm,
Weltenspalter, Donneraxt, Stachelbeil; beim Wildnisläufer Pfauenfeder, Schatten der Tausend, Der Eiserne Kiefer, Tausend Schnitte, Herz des Myzels, Der Falsche König, Arachnes Zorn; beim Magier Foliant der Glut, Zorn der Sonne, Zorn des Phönix, Herz des Berges, Zorn des Tiefwalds, Zorn des Nordwinds, Das Arkane Herz). Eine Klasse trägt nur einen Ring, also zugleich nur eine Evolution. Ist der Ring angelegt, wird der Angriff beim Schritt auf Rang 5 sofort zur Evolution (Rang 6); die Karte für Rang 5 sagt schon, wozu er wird. Die Evolution ersetzt die Fertigkeit und ist kein zusätzlicher
Angriff, und was Rang 5 brachte, bleibt. Ohne Ring bleibt Rang 5 der letzte Rang, und das Spiel verhält sich wie vor diesem Paket.

**Gebaut** ist es als ein weiterer Rang derselben `WeaponDef` (`EVOLUTION_RANK = 6`, `WeaponDef.evolution` mit Name, Gegenstand und Text; die Zeile für Rang 6 trägt Schalter wie `sichel` oder `bollwerk`, die einen Rang
vollständig ersetzen, alles andere folgt dem Rang davor). `Arsenal.unlockEvolutions` bekommt beim Start der Nacht die Evolutionen der angelegten Ringe (`Ausruestung.evolutionsOf`); `Arsenal.take` macht aus Rang 5 dann Rang 6.
Das Verhalten steht in `src/game/evolutions.ts` (Kämpfer), `src/game/evolutionsLaeufer.ts` (Wildnisläufer) und `src/game/evolutionsMagier.ts` (Magier; der Treffer läuft weiter über `Arsenal.hit`, also mit Krits, Zuständen und Gegenständen), die Bilder in
`src/game/evolutionEffects.ts`, `src/game/evolutionEffectsLaeufer.ts` und `src/game/evolutionEffectsMagier.ts`. Läufer und Magier teilen sich die Suche nach Gruppen (`src/game/crowd.ts`). Alle Zahlen stehen in `CONFIG.skills.evolution` (`laeufer` für den Wildnisläufer, `magier` für den Magier). Die Evolutionen benutzen die Bausteine des Unterbaus (Bodenfelder, zeitweilige Werte, Zustände, Ereignisse mit Urheber) und legen im Kampf nichts Neues an.

| Angriff       | Evolution                          | Was sie tut                                                                                                                                           |
| ------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Axthieb       | Henkersbeil der Alten Ordnung      | Jeder vierte Hieb entlädt eine Sichel aus Staub (14 m lang, ×3 Schaden), die die ganze Linie durchschneidet; wer darin unter 25 % seines Lebens fällt, wird hingerichtet (nicht der Verschlinger) |
| Banner        | Reliquie der Nimmersatten          | Das Banner folgt der Figur und bleibt; jeder Gegner im Umkreis gibt einen Stapel (bis 10): −3 % Abklingzeit und +1,5 % Lauftempo je Stapel                             |
| Wurfaxt       | Sturm der Klingen                  | Sechs Äxte kreisen 1,1 s um die Figur (sie stoßen Gegner an), dann fliegen sie auf die lebenskräftigsten Gegner in Sichtweite, sonst nach außen                        |
| Wirbelschlag  | Mahlstrom aus Staub und Eisen      | Die Figur dreht sich 4 s und läuft dabei frei; ein Tornado zieht Gegner heran und schneidet sie, am Ende schleudert eine Druckwelle sie nach außen (doppelter Schaden); beim Drehen 30 % weniger erlittener Schaden |
| Wuchthieb     | Spalter von Ghen                   | Beim Ausholen zieht die Axt Gegner zum Einschlagpunkt; der Niederschlag spaltet den Boden 13 m weit (×2,4 Schaden) und betäubt die Kleinen kurz                         |
| Kriegsschrei  | Donner der Alten Ordnung           | Der Schrei fährt als Kegel in Blickrichtung mit doppelter Reichweite; Getroffene werden 1,5 s um 30 % verlangsamt und erleiden 4 s lang 15 % mehr Schaden aus deinen Nahkampfangriffen |
| Dornenschild  | Bollwerk der Stacheln              | Eine dauerhafte, enge Dornen-Aura vor der Figur (2,6 m lang): Wer sie berührt, wird alle 0,3 s gestochen und leicht zurückgedrängt; der Stich bei Treffern auf die Figur bleibt |
| Bogenschuss   | Pfeilfächer der Alten Ordnung      | Ein Fächer aus fünf schweren Eisenpfeilen (mit Abfall, Vorteil und Rüstungsverlust des Rangs 5); jeder dritte Schuss trägt einen Staub-Pfeil: Beim ersten Aufprall bleibt eine Staubwolke (2,6 m, 4,5 s, höchstens drei), in der nachfolgende Pfeile auf Ziele im Inneren abbiegen |
| Pfeilhagel    | Sturm der Aschenfedern             | Der Hagel geht 2,5 s lang als Schauer nieder (alle 0,25 s ein Takt mit 30 % des Schadens, er folgt der Mitte der Gruppe und trifft dort härter); Getroffene sind blind und verstummen (Fernkämpfer zaubern nicht), danach bleibt ein Staubfeld, das 5 s verlangsamt |
| Fangeisen     | Kiefer der Ödnis                   | Ein Bündel aus drei verketteten Riesen-Fangeisen fliegt auf die größte Gruppe in 12 m und liegt, bis ein Eisen berührt wird (höchstens drei Bündel); dann schnappt es zu (×1,4), und die Ketten reißen bis zu drei weitere Gegner in die Mitte, die 2,5 s festgehalten und zerrissen werden (nicht das Großwild) |
| Wurfmesser    | Klingen-Fächer der Ödnis           | Zwei Wellen aus je sieben Messern fliegen 0,16 s nacheinander im weiten Halbkreis, die zweite um eine halbe Lücke versetzt; die äußeren Messer wirbeln Staub auf und knicken nach 0,16 s nach innen ab, um die Flanken zu fangen |
| Sporenfalle   | Atem der Schattenpilze             | Dicke Sporenbeutel fliegen in die dichteste Gruppe in 11 m; beim Aufprall steht eine Nebelwand quer zur Wurfrichtung, die mit 0,7 m/s weiterzieht, Gegner blind, verlangsamt und schwach macht und 1,6-mal so hart zuschlägt wie eine Kapsel (höchstens zwei Wände); wer darin stirbt, platzt weiter |
| Köderpuppe    | Vollstrecker der Ödnis             | Ein riesiges Staub-Phantom (2facher Radius, 6 s) steigt über der dichtesten Gruppe auf, lockt Gegner bis zum 2,5fachen seines Radius (13 m) auf sich zu, zieht sie in seinem Kreis mit 2,2 m/s an und versetzt die Kleinen in Furcht; am Ende zerspringt es in einer Schockwelle (1,5facher Radius, ×1,8 Schaden), Verlangsamte und Gefesselte erleiden 15 % mehr |
| Netz          | Schlinge der Alten Ordnung         | Ein Schleppnetz (4,4 m breit) fegt mit 15 m/s 11 m weit über den Boden, nimmt bis zu 18 kleine und mittlere Gegner mit und schnürt sie am Ende zu einem Bündel; dort halten Eisengewichte sie 3 s fest und zerquetschen sie alle 0,5 s |
| Hitze werfen  | Atem der Verblassenden Sor         | Der Hitzestoß bricht im weiten Halbkreis (2,4 rad) durch den Staub, ×2,9 Schaden; Getroffene brennen, sind im Nachteil, verlangsamt und 1,5 s geblendet; wer brennend durch diesen Angriff stirbt, entzündet den Staub: ein Glutfeld (1,7 m, 2,2 s, höchstens 14) versengt und entzündet, wer hineinläuft |
| Sorlanze      | Speer der Verschwundenen Sonne     | Ein Lichtspeer fällt nach 0,5 s Vorwarnung auf die dichteste Gruppe in 13 m (höchstens zwei zugleich) und schlägt mit ×3,2 ein; beim Aufprall fegen vier Strahlen (11 m, ×1) sternförmig über den Boden, brennen 3 s und blenden |
| Glut formen   | Krone der Erloschenen Sor          | Das Feld wächst auf Radius ×1,7; der Hitzeschaden steigt je Sekunde im Kreis um 25 % (bis 4 s), Getroffene verlieren die Rüstung und sind geschwächt; wer im Kreis stirbt, löst eine Hitzewelle (2,4 m, ×1) aus, die versengt (höchstens vier Wellen je Bild) |
| Erdstoß       | Beben der Alten Ordnung            | Drei Ringe (bis 50 %, 78 %, 100 % des Radius ×2, Schaden ×1, ×1, ×1,3) rollen mit 20 m/s hinaus und schleudern 6 m zurück (Großwild 4 m); danach liegt 4 s ein Trümmerfeld, das um 35 % verlangsamt und im Nachteil hält |
| Wurzelgriff   | Griff der Alten Tiefe              | Eine Bahn (11 × 5 m) aus Wurzeln zieht bis zu 14 kleine und mittlere Gegner binnen 0,4 s in die Mitte; dort halten sie 2,5 s fest, bluten, sind im Nachteil und geblendet, und das Geflecht zehrt sie alle 0,5 s aus |
| Sturmböe      | Orkan der Alten Ordnung            | Ein dauerhafter Luftstrom macht die Figur 15 % schneller; alle 2 s folgt auf die Böe eine zweite (0,24 s später, ×0,85; Rückstoß ×1,8), beide zerreiben feindliche Zauber (Schwarzer Sog) im Umkreis von 7 m; Getroffene sind verlangsamt und geblendet |
| Schild        | Kuppel der Alten Ordnung           | Statt des Schilds kreisen drei Runen um die Figur; solange eine steht, zerreibt die Kuppel (2,4 m) feindliche Zauber. Zerbricht eine Rune, fährt eine Staub-Druckwelle (6,5 m, 28 Schaden, Rückstoß, Blendung) in Blickrichtung |

**Dev-Werkzeuge.** `__skills.entwickeln('axthieb')` schaltet die Evolution mitten in einer Nacht frei und hebt den Angriff auf Rang 6; `__skills.raenge('axthieb')` zeigt nun sechs Ränge. `__items.geben(0, 'ring', 'legendaer', 'wuchthieb')` legt einen
legendären Ring mit der genannten Evolution ins Inventar. `__messlauf.start({ evolution: 'axthieb', classes: [0] })` (Wildnisläufer: `{ evolution: 'bogenschuss', classes: [1] }`, Magier: `{ evolution: 'hitze-werfen', classes: [2] }`) lässt die Figur den Ring tragen und die Nacht mit dem Angriff auf Rang 4 beginnen (er erreicht sonst selten Rang 5); `fokus: 'axthieb'` tut dasselbe ohne Ring und liefert
den Vergleichswert, so lässt sich messen, was eine Evolution leistet. Neue Klänge: `evolution` (die Wandlung) sowie `evolution.sichel`, `evolution.sturm`, `evolution.mahlstrom`, `evolution.mahlstrom-ende`, `evolution.spalter`, `evolution.donner` (Kämpfer) und `evolution.faecher`,
`evolution.aschesturm`, `evolution.kiefer-wurf`, `evolution.kiefer`, `evolution.nebel`, `evolution.phantom`, `evolution.schlinge` (Wildnisläufer) und `evolution.sonnenstich`, `evolution.speer`, `evolution.krone`, `evolution.beben`, `evolution.griff`, `evolution.orkan`, `evolution.kuppel` (Magier; `audio.json`, erzeugt von `tools/audio-erzeugen.py`).

**Abweichungen von der Vorlage** (die Vorlage ist ein Leitfaden, siehe [Lore](#lore)):

- Der **Ring trägt die Evolution** statt eines passiven Gegenstands (siehe oben); den Namen des Gegenstands der Vorlage trägt der Ring.
- Henkersbeil: „geschwächte Feinde“ sind im Spiel Gegner im Zustand `weak` oder `feeble`. Der Hieb der Sichel setzt `weak` selbst (Rang 5), also fällt in der Linie jeder unter 25 %. Der Verschlinger wird geführt und nie hingerichtet.
- Reliquie: „langsam ausgesaugt“ ist ein Banner-Feld, das mit der Figur wandert, und ein paar Staubpunkte, die von den Gegnern zur Figur fliegen. Die Stapel zählen die Gegner im Umkreis und verfallen mit ihnen. Das Feld wird von allein neu gesetzt,
  wenn der Vorrat der Felder es verdrängt hat.
- Sturm der Klingen: „stärkste Ziele“ sind die Gegner mit dem meisten Leben in Sichtweite (das 1,3fache der Reichweite des Angriffs); ohne Ziele fliegen die Äxte nach außen.
- Mahlstrom: Statt „immun gegen Verlangsamung“ (die Figur wird ohnehin nicht verlangsamt) gilt ein Schutz von 30 % weniger erlittenem Schaden, solange sie sich dreht.
- Donner: Das Plus von 15 % gilt nur für **Nahkampf** (Axthieb, Wirbelschlag, Wuchthieb, Kriegsschrei, Dornenschild) und wirkt **4 s** (die Vorlage nennt keine Dauer); Fernkämpfer und Zauber profitieren nicht.
- Spalter: Die Linie betäubt nur Kleine, nicht das Großwild und nicht den Verschlinger; sie zieht auch den Verschlinger nicht heran.
- Bollwerk: Die Eisenstangen sind eine gerade Aura vor der Figur (kein Kreis), damit sie sich vom Dornenschild unterscheiden; die Stiche tragen die Kennung des Dornenschilds.
- Pfeilfächer: Der Staub-Pfeil lenkt nur Pfeile, die in der Wolke fliegen, mit einer festen Drehgeschwindigkeit (9 rad/s); höchstens drei Wolken zugleich, die älteste weicht.
- Sturm der Aschenfedern: „nimmt die Sicht“ ist der Zustand `blind`, „können nicht zaubern“ der Zustand `silence`. Der Schauer fällt erst nach der Vorwarnung des Hagels (0,6 s), damit man das Zeichen am Boden sieht; der Schaden kommt aus den Takten, die fallenden Pfeile sind Zierde.
- Kiefer: Das Bündel bleibt liegen, bis ein Gegner ein Eisen berührt (statt ein festes Ziel zu treffen), und es liegen höchstens drei Bündel zugleich. „Bis zu drei weitere Gegner“ sind die nächsten im Umkreis von 7 m; das Großwild und der Verschlinger werden nicht gezogen.
- Klingen-Fächer: Die äußeren Messer knicken nicht erst am Ende der Bahn ab, sondern biegen nach 0,16 s im Flug langsam nach innen (2,6 rad/s); ein hartes Abknicken am Ende ließe sich nicht lesen. Die Messer sehen aus wie die gewöhnlichen (die „geschwärzte“ Optik der Vorlage ist nicht umgesetzt).
- Atem der Schattenpilze: Ein „Wind“ gibt es im Spiel nicht, die Nebelwand zieht in Wurfrichtung weiter. „Zersetzt die Rüstung“ ist der Zustand `weak` (wie beim „Rüstungsverlust“ des Bogens). Der Schlag der Wand ist 1,6-fach (`fogDamage`), weil die Evolution im Messlauf sonst kaum stärker war als Rang 5.
- Vollstrecker: Das Phantom steht über der dichtesten Gruppe in Sichtweite und nicht über der Figur (sonst zöge es die Horde auf sie zu). Furcht trifft nur Kleine; „gefesselt“ ist der Zustand `hold`.
- Schlinge: Das Netz zielt auf die dichteste Gruppe, sonst auf den nächsten Gegner; es nimmt nur kleine und mittlere Gegner mit (höchstens 18), nie das Großwild und den Verschlinger.
- Atem der Verblassenden Sor: Der „weite Halbkreis“ ist der Kegel des Angriffs selbst (2,4 rad). Das Glutfeld entsteht nur, wenn ein Gegner stirbt, der **durch diesen Angriff** brennt (nicht jedes Brennenden); wer im ersten Treffer stirbt, hat noch nicht gebrannt, weil die Zustände nach dem Schaden greifen. Mehr als 14 Felder gibt es nicht. Der Schaden ist ×2,9 statt der +25 % je Rang (×2,25), weil die Evolution im Messlauf sonst nicht stärker war als Rang 5.
- Speer der Verschwundenen Sonne: „Dichteste Gruppe“ ist die mit den meisten Gegnern im Umkreis von 3 m in Reichweite; es gibt eine halbe Sekunde Vorwarnung (ein Ring am Boden), damit der Einschlag lesbar bleibt. Die Abklingzeit bleibt die von Rang 3 (Faktor 0,8), der Schaden ist ×3 statt ×2,25 (die zwei Lanzen von Rang 5 waren im Messlauf sonst ebenbürtig).
- Krone: „Verlieren ihre Rüstung“ ist der Zustand `weak`, „kontinuierlich steigender Hitzeschaden“ ein Anteil je Sekunde im Kreis. Die Wellen stehen in einer Warteschlange (höchstens acht, vier je Bild), damit ein Massensterben das Bild nicht sprengt.
- Beben: Jeder Ring trifft, was er erreicht; wer innen steht, wird also bis zu dreimal getroffen. „Elitäre Widersacher“ fliegen kürzer als Kleine (das Großwild 4 m statt 6 m), der Verschlinger gar nicht. „Gleichgewicht verlieren“ ist `weak` im Trümmerfeld.
- Griff der Alten Tiefe: Die Wurzeln fangen nur kleine und mittlere Gegner (höchstens 14), nie das Großwild und den Verschlinger; die Bahn liegt auf der dichtesten Gruppe in Blickrichtung.
- Orkan: Ein „dauerhafter Luftstrom“ ist der Tempo-Zuwachs der Figur und die zweite Böe, solange der Angriff läuft (kein Dauerfeld). Als feindlicher „Zauber“ gilt im Spiel allein der Schwarze Sog der Priester (der des Verschlingers nicht); die zweite Böe zielt auf den nächsten Gegner, nicht in Blickrichtung.
- Kuppel: Die Runen sind die Ladungen des Schilds (drei). Die Welle beim Zerbrechen hat festen Schaden (28, mit Schadenswerten der Figur) und fährt als Kegel in Blickrichtung; der Sog wird nur zerrieben, solange noch eine Rune steht.
- Kein Plattform- und kein Savegame-Eingriff in diesem Teil: `SAVEGAME_VERSION` bleibt 7, Pfade, Eingabe und Speicherschicht sind unverändert. Ringe aus Fassung 6 bekommen beim Lesen eine Evolution (siehe oben), auch beim Wildnisläufer.
- Kein Plattform-Eingriff: Pfade, Eingabe und Speicherschicht bleiben; neu ist nur das Format des Spielstands (Fassung 7), das `parseSavegame` aus Fassung 6 hebt.

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
- Die Musik folgt dem Spiel: Startbildschirm und Klassenwahl, Nacht, dichtere Nacht ab der 8. Minute, Boss (solange der Stachelträger oder der Verschlinger lebt), danach ein kurzes Stück für Sieg oder Niederlage.
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
  Jede Nacht bekommt einen festen Lauf-Seed (`seed` + 4242, je Nacht um eins weiter, siehe [Lauf-Seed](#technik)), damit der Zufall für alle
  verglichenen Varianten derselbe ist.
- **Gegenstände und Fertigkeiten**: `__items` (`src/tools/items.ts`) füllt Ausrüstung, Truhe und Börse und würfelt Beute nach; `__skills` (`src/tools/skills.ts`) bringt Zustände, Bodenfelder und
  zeitweilige Werte an und zählt Ereignisse mit Urheber (siehe [Fertigkeiten](#fertigkeiten-der-unterbau)); `__skills.entwickeln(id)` und `__messlauf.start({ evolution })` probieren die Evolutionen
  aus (siehe [Evolutionen](#evolutionen)).
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
  `public/apple-touch-icon.png` (Home-Bildschirm von Apple-Geräten, 180 × 180 auf dunklem Grund) ist von Hand gemacht; das Skript erzeugt es nicht.
- **Gegenstandsbilder**: Die Bilder im Lager (`public/icons/items`) stammen von einem Bildmodell; ihre Herkunft steht in
  `public/icons/items/HERKUNFT.md`. Die Prompts und die Schritte zum Freistellen und Verkleinern liegen in `tools/item-icons/`
  (`prompts.py`, `freistellen.py`, `webp-erzeugen.py`; Python mit Pillow, numpy und scipy). Ein Bild lässt sich ersetzen, indem man eine
  Datei mit demselben Namen hineinlegt (256 × 256, durchsichtiger Grund). Fehlt eine Datei, zeigt das Lager das Umrisszeichen aus `src/ui/itemIcons.ts`.
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
- **Stachelschwein riggen und animieren**: Das Meshy-Modell des Stachelträgers hatte das Rigging eines Vierbeiners: Die Arme besaßen keine eigenen Knochen,
  ihr Oberarm hing an den Vorderbeinen und zog beim Gehen mit. `tools/stachelschwein-rig.py` legt je Arm vier Knochen an (Schulter, Oberarm, Unterarm, Hand),
  hängt Arme und Vorderbeine an die Brust und rechnet die Gewichte neu; `tools/stachelschwein-animieren.py` legt darauf „Stehen“, „Laufen“, „Stachelwurf“ und
  „Stachelwurf2“ (je ein Arm), „Stachelsalve“ und „Tod“ an und schreibt `public/models/stachelschwein.glb`. Beide laufen in Blender ohne Fenster
  (`blender --background --factory-startup --python tools/stachelschwein-rig.py -- quelle.glb ziel.glb`, danach dasselbe mit `stachelschwein-animieren.py`; mit dem Python-Modul
  `bpy` geht es ebenso). Die Bewegung steht als Zahlen im Skript; Zeiten wie der Augenblick, in dem der Stachel die Hand verlässt, stehen oben im Skript und in `CONFIG.stachelboss`
  und müssen zusammenpassen.
- **Schild erzeugen**: Der Schild in der linken Hand des Kämpfers (`public/models/ausruestung/schild.glb`) entsteht ganz aus Rechnung:
  `tools/schild-erzeugen.py` baut in Blender einen Rundschild aus Brettern mit Eisenrand, Buckel und Messingnieten und backt Holz und
  Eisen in eine Textur (`blender --background --factory-startup --python tools/schild-erzeugen.py`, optional mit `-- ziel.glb`).
  Das Sor-Symbol auf der Fläche ist ein Vorschlag und lässt sich im Skript mit `EMBLEM = False` abschalten. Sitz und Haltung stehen im
  Eintrag `offhand` des Kämpfers in `classes.ts`: Der Schild hängt am Handknochen, hält seine Ausrichtung aber im Raum der Figur
  (`steady`), damit er im Lauf nicht mitwackelt und nicht im Körper steckt; eine Leine (`leash`) hält ihn beim Ausholen
  (Wirbelschlag, Wuchthieb) nah am Körper.

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

**Versionsnummer.** Jeder Pull Request erhöht die Version des Spiels (`MAJOR.MINOR.PATCH`, vorerst `0.x`) und nennt sie im Titel,
etwa `v0.3.0: …`. Die Nummer steht nur in `package.json` und erscheint unten rechts auf dem Startbildschirm; erhöht wird mit
`npm version minor --no-git-tag-version` (neue Funktion oder neuer Inhalt) bzw. `npm version patch --no-git-tag-version`
(Korrektur, Kleinigkeit, Dokumentation). Die genauen Regeln stehen in `CLAUDE.md`. Die Version des Spielstands
(`SAVEGAME_VERSION`) ist davon unabhängig.
