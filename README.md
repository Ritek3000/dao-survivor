# Survivor-like in der Welt Ghen

Ein 3D-Survivor-like in der Spielwelt von **Die Alte Ordnung** (DAO). Eine Nacht dauert 15 Minuten:
Von der Abendglocke bis zum Sonnenaufgang hält sich die Spielfigur im Licht, entzündet Feuerschalen,
wehrt die Horde ab und widersteht dem Staub und der Finsternis. Gegen Ende der Nacht erscheint der Verschlinger.
Wer bis zum Sonnenaufgang überlebt, gewinnt.

Das Spiel ist ein früher Prototyp. Es gibt drei Klassen (Kämpfer, Wildnisläufer, Magier), Stufenaufstiege
mit Stärkungen, Segen der Höheren Mächte, eine Gegnerhorde, Feuerschalen als Lichtinseln und einen
Endgegner. Das Gold, das eine Nacht einbringt, kauft zwischen den Nächten beim Händler im Lager Gegenstände für die Klassen
(siehe [Gold](#gold) und [Gegenstände](#gegenstände)). Die Zielplattform (Browser oder Desktop) ist noch offen;
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
| 1, 2, 3 oder Pfeile, Enter | Klasse und Stärkungen wählen, Bestätigen |
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

## Aufbau des Projekts

```
index.html            Seite des Spiels mit allen HUD-Elementen
modell.html           Modell-Prüfer (nur für die Entwicklung, nicht Teil des Spiels)
finsternis.md         Lore-Quelle: Staub und Finsternis
magie_mystik/         Lore-Quelle: Katalog von Magie und Mystik, geordnet nach Domänen und Mächten
public/models/        Spielfertige GLB-Modelle (Figuren, Gegner, Kulisse unter welt/, Ausrüstung wie der Schild unter ausruestung/)
public/audio/         Klänge und Musik (sfx/, schleifen/, musik/) und audio.json, die Zuordnung Ereignis → Datei
public/icons/items/   Bilder der Gegenstände im Lager: 27 WebP-Dateien, neun Plätze mal drei Klassen (`<platz>-<klasse>.webp`)
src/
  main.ts             Einstieg: baut das Spiel und hängt Entwicklungswerkzeuge nur im Dev-Modus an
  config.ts           Zentrale Stellschrauben: Nachtdauer, Welt, Gegnerarten, Kulisse
  core/               Eingabe, deterministischer Zufall, Raumgitter, Einstellungen (Ton, Stelle der Lebensgruppe), Spielstand (Gold, Gegenstände)
  audio/              Ton und Musik: Engine, Ereignisnamen, Lesen von audio.json
  game/               Spiellogik und Darstellung (siehe unten)
  ui/                 hud.ts: Anzeigen, Auswahlkarten, Ende; menus.ts: Startbildschirm, Pause, Optionen, Anleitung, Rückfragen; lagerView.ts: Lager (Ausrüstung, Truhe und Händler)
  tools/              Entwicklungswerkzeuge: Messlauf, Gegenstände (`__items`), Fertigkeiten-Unterbau (`__skills`) und Modell-Prüfer
tools/                Skripte außerhalb des Spiels (Blender: Modelle verkleinern, Priester und Mantelträger animieren, Schild erzeugen; Python: Klänge erzeugen, Sor-Symbol und Favicon aufbereiten, Gegenstandsbilder freistellen)
.github/workflows/    GitHub Actions: Veröffentlichung auf GitHub Pages (pages.yml)
```

Wichtige Teile von `src/game/`:

| Datei                          | Inhalt                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| `game.ts`                      | Hauptschleife und Phasen (Laden, Startbildschirm, Klassenwahl, Spiel, Pause, Ende) |
| `classes.ts`, `gear.ts`        | Die drei Klassen mit Werten, Modell und Ausrüstung; die Ausrüstung in den Händen (Axt, Bogen, Buch, Schild des Kämpfers) |
| `weapons.ts`, `arsenal.ts`     | Alle Angriffe als Daten (mit Rangregeln) und ihre Ausführung; die Fertigkeiten des Kämpfers und des Wildnisläufers (siehe [Kämpfer](#fertigkeiten-des-kämpfers), [Wildnisläufer](#fertigkeiten-des-wildnisläufers)) |
| `status.ts`, `events.ts`, `fields.ts`, `buffs.ts` | Unterbau der Fertigkeiten: Zustände der Gegner, Ereignisse mit Urheber, Bodenfelder, zeitweilige Werte (siehe [Fertigkeiten](#fertigkeiten-der-unterbau)) |
| `effects.ts`, `strips.ts`, `particles.ts`, `props.ts` | Wie die Angriffe aussehen                        |
| `enemies.ts`, `boss.ts`, `threats.ts` | Horde, Verschlinger und die Zauber der Gegner                    |
| `progression.ts`               | Stufen, Stärkungen und die Segen der Höheren Mächte                     |
| `boerse.ts`, `coins.ts`        | Die Börse (das Gold im Spielstand) und die Münzen, die das Gold bringen |
| `items.ts`, `ausruestung.ts`, `truhe.ts`, `haendler.ts`, `lager.ts` | Gegenstände (Eigenschaften, Würfeln), die Gegenstände jeder Klasse samt Truhe, das Angebot des Händlers und das Menü des Lagers |
| `beute.ts`, `drops.ts`         | Beute: was aus Gegnern und der Kiste des Verschlingers fällt, der Beutel der Nacht, die Gegenstände am Boden und die Kiste |
| `zones.ts`, `darkness.ts`, `dust.ts` | Lichtinseln, Finsternis und Verstaubung                           |
| `world.ts`, `ground.ts`, `scenery.ts` | Welt, Boden und Kulisse                                          |
| `models.ts`                    | Lädt GLB-Dateien und bringt sie auf die Maße, die das Spiel braucht     |

## Menüs und Oberfläche

**Startbildschirm** (nach dem Laden): *Neues Spiel*, *Spiel fortsetzen*, *Optionen* und *Anleitung*. „Spiel fortsetzen“ erscheint nur, wenn es einen
Spielstand gibt (Gold in der Börse oder Gegenstände) und führt zur Klassenwahl. „Neues Spiel“ setzt den dauerhaften Fortschritt zurück
(Gold, Gegenstände und Truhe; die Optionen bleiben). Gibt es einen Fortschritt, warnt davor eine Rückfrage, die nennt, was verloren ginge
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

## Gold

Jede Nacht bringt Gold ein. Damit kauft man zwischen den Nächten beim Händler im Lager Gegenstände (siehe [Gegenstände](#gegenstände)).
Das Gold gehört allen Klassen gemeinsam (eine Geldbörse). Gegenstände gehören je einer Klasse; die Truhe teilen sich alle.

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

**Wofür es gut ist.** Gold zahlt den Händler (Gegenstände kaufen, sein Angebot erneuern) und weitere Reiter der Truhe; verkaufte Gegenstände bringen
Gold zurück. Es gibt keine dauerhaften Steigerungen mehr: Die Werte der Figur kommen aus den Gegenständen, den Stärkungen und den Segen der Nacht.

**Speicherung.** Gold und Gegenstände liegen im Browser (`localStorage`, Schlüssel `dao-survivor.spielstand`) als JSON mit Versionsnummer
(`version`, jetzt 6). Der Zugriff steckt hinter `TextStore` in `src/core/storage.ts` und `src/core/savegame.ts`; wo `localStorage` fehlt oder
gesperrt ist, gilt der Stand nur für die Sitzung. Eine Desktop-Fassung kann mit `useSavegameStore` eine Datei an die Stelle setzen (und als zweiten Speicher
eine für die Sicherung). Ein unlesbarer Stand beginnt bei null; was das Spiel nicht kennt (etwa die Gegenstände einer neueren Fassung), bleibt beim Speichern erhalten.
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
die früheren Steigerungen; das System entsteht in Paketen (Entwurf: „Item-, Loot- und Händlersystem“). **Stand: Grundlage, Beute, Truhe, Händler; die Steigerungen sind entfallen.**
Das Lager (Ausrüstung, Truhe und Händler) bleibt verborgen, solange kein Gegenstand im Spielstand liegt und kein Gold in der Börse; der erste Fund oder die erste Münze schaltet es frei.
Im Entwicklungsmodus (`npm run dev`) ist es immer da, und die Browser-Konsole erzeugt Gegenstände, Beute und Gold zum Ausprobieren
(`__items.fuellen()`, `__items.geben(0, 'ring', 'rar')`, `__items.fallen('rar')`, `__items.kiste()`, `__items.truhe(30)`, `__items.gold(5000)`, `__items.leeren()`; Beschreibung in `src/tools/items.ts`).

**Aufbau.** Ein Gegenstand trägt je nach Seltenheit eine (Normal), zwei (Selten) oder drei (Rar) Eigenschaften; Legendär trägt drei und später
die Evolution einer Fertigkeit, und gibt es vorerst nur als Ring (`LEGENDARY_SLOTS`). Jede Eigenschaft würfelt ihren Wert einmal beim Entstehen
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
(`src/ui/itemIcons.ts`).

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
- *Zufall:* Die Beute hat einen eigenen Zufallsstrom, der mit der Uhrzeit des Nachtbeginns beginnt (nicht mit dem Seed der Welt, sonst fielen nach
  jedem Neustart dieselben Gegenstände). Der Messlauf legt einen festen Anfang fest und schreibt die gefallenen Gegenstände je Nacht mit (`beute`).
- Noch nicht umgesetzt: Die Evolution der legendären Ringe und die Zielhilfe bei ihrer Wahl (Paket „Evolutionen“); der legendäre Ring ist bis dahin
  ein Ring mit drei Eigenschaften.

**Speicherung.** Die Gegenstände liegen im selben Spielstand wie das Gold (Feld `items`; `src/game/ausruestung.ts`), Fassung 6 (neu: die Ränge der entfallenen Steigerungen sind
als Gold erstattet und der alte Stand liegt als Sicherung bereit, siehe [Gold](#gold); Fassung 5 brachte den Stand des Händlers mit Angebot, Rückkauf und Zähler der Erneuerungen, Fassung 4 die Truhe,
Fassung 3 den Pech-Schutz). Ältere Stände (Fassung 1 bis 5) werden Schritt für Schritt gehoben; Gold und Gegenstände bleiben unverändert. Was im Spielstand nicht zum Spiel passt (unbekannter Platz oder
Name, unmögliche Eigenschaft), wird beim Lesen verworfen, Werte außerhalb des heutigen Bereichs rücken an dessen Rand.

**Gleichgewicht.** `__items.verteilung('stark')`, `__items.kisten()` und `__items.angebote()` würfeln die Seltenheiten, den Pech-Schutz und das Angebot des Händlers in der Konsole tausendfach nach
und zählen. `__messlauf.start({ ausruestung: 'rar' })` belegt alle neun Plätze jeder Klasse mit rar gewürfelten Gegenständen
(`'normal'`, `'selten'` oder `'rar'`); ohne Angabe ist nichts angelegt. Auch das schreibt nichts in den echten Spielstand.

## Fertigkeiten: der Unterbau

Die Fertigkeiten der Klassen kommen in eigenen Paketen (Kämpfer, Wildnisläufer, Magier). Dieses Paket legt nur die Bausteine, die sie gemeinsam brauchen; es hat **keine
sichtbare Wirkung** im Spiel, außer dass festgehaltene Gegner wie bisher fahl dastehen. Die Angriffe von heute laufen schon über die neuen Bausteine und verhalten sich genau wie vorher
(in einem festgelegten Lauf über zwölf Minuten Spielzeit stimmen Gegner, Erschlagene, Leben der Horde, Ort der Figur und Ränge der Angriffe bei allen drei Klassen mit dem Stand vor dem Umbau überein).

- **Zustände der Gegner** (`status.ts`): festgehalten (`hold`), verlangsamt (`slow`), im Nachteil (`weak`), blutend (`bleed`), brennend (`burn`), markiert (`mark`), in Furcht (`fear`),
  geblendet (`blind`), geschwächt (`feeble`) und ohne Zauber (`silence`). Jeder Gegner trägt einen festen Satz davon (Restzeit, Stärke, Urheber); es entsteht nie etwas Neues.
  Wirkt ein Zustand schon, gilt die längere Dauer und die stärkere Stärke; ein schwächerer Wert verlängert einen stärkeren nicht. Die Stärke bedeutet je nach Zustand etwas anderes
  (Kopf der Datei): bei `slow` der Anteil des Tempos, der wegfällt, bei `bleed` und `burn` der Schaden je Sekunde, bei `mark` die Kritchance, die gegen den Gegner dazukommt. Wer sich
  fürchtet, läuft von der Figur weg und greift nicht an; wer geblendet oder geschwächt ist, richtet weniger Schaden an (Geschwächte laden zudem langsamer nach); wer verstummt ist, wirkt keinen Zauber
  (der Priester). Standardstärken stehen in `CONFIG.skills.status`.
- **Ereignisse mit Urheber** (`events.ts`): Jeder Treffer, Tod und jede Verletzung der Figur wird mit seinem Urheber gemeldet (`Source`, etwa die Kennung des Angriffs). Fertigkeiten, die
  auf einen Treffer, einen Tod oder einen eingesteckten Schlag reagieren, hängen sich als `CombatListener` an. Schaden über Zeit (Blutung, Brennen, Felder) meldet sich getrennt (`dot`).
- **Bodenfelder** (`fields.ts`): ein Ort, eine Form (Kreis oder Streifen), eine Dauer und eine Wirkung je Takt: Schaden und Zustände für Gegner, Leben und zeitweilige Werte für die Figur,
  Zug zur Mitte, ein Haken beim Tod eines Gegners darin (`onKill`) und beim Ende (`onEnd`). Banner, Sporenwolke, Köderpuppe, Netz, Glutlinie, Erdring und Dornen-Aura sind später alle
  ein solches Feld. Höchstens `CONFIG.skills.maxFields` liegen zugleich; ein neues ersetzt das älteste.
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
folgt den alten Regeln (+25 % Schaden je Rang). Die **Evolutionen** (Rang 6) sind ein eigenes Paket und noch nicht dabei.

| Fertigkeit    | Art                    | Was die Ränge bringen                                                                                                                  |
| ------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Axthieb       | Hieb im Bogen          | 2: +25 % Reichweite, +30 % gegen Gegner, auf die man zuläuft · 3: Blutung und Verlangsamung · 4: kürzere Abklingzeit, Rückhand-Hieb · 5: Nachteil und Markierung |
| Banner        | Bodenfeld, 11 s Pause  | 1: 6 s Schaden im Kreis · 2: +30 % Radius · 3: jeder zehnte Tote im Banner lässt einen Lebenssplitter fallen · 4: 8 s, Gegner richten 20 % weniger Schaden an · 5: zieht Edelsteine heran |
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
stehen in `CONFIG.skills.laeufer`. Die Auswahlkarte nennt wie beim Kämpfer, was der **nächste** Rang tut (`WeaponDef.rankText`). Die **Evolutionen** (Rang 6) kommen in einem eigenen Paket.

| Fertigkeit       | Art                       | Was die Ränge bringen                                                                                                                         |
| ---------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Bogenschuss      | Geschoss                  | 1: schwerer Pfeil, stößt kleine Gegner zurück · 2: durchbohrt das erste Ziel, zweites mit 40 % weniger Schaden · 3: Nachladezeit −0,3 s, Treffer verlangsamen 1,5 s um 15 % · 4: zwei Pfeile, Vorteil · 5: mehr Reichweite und Tempo, das erste Ziel erleidet 3 s lang 15 % mehr Schaden |
| Pfeilhagel       | Salve mit Verzögerung     | 1: 6 Pfeile · 2: 9 Pfeile (1,5 × Schaden), Radius +20 % · 3: Verlangsamung im Zielgebiet · 4: kürzere Abklingzeit, Blutung · 5: folgt der Gruppe, 25 % mehr Schaden im Zentrum |
| Fangeisen        | Falle (`kind: 'trap'`)    | 1: Schaden, 1,5 s festgehalten · 2: zwei Eisen zugleich · 3: kürzere Abklingzeit, Blutung · 4: Nachteil und Markierung der Gefangenen · 5: Stirbt ein Gefangener im Eisen, fliegen Splitter auf Gegner ringsum |
| Wurfmesser-Fächer | Geschoss, Fächer         | 1: drei Messer, jedes trifft sein erstes Ziel · 2: vier Messer, breiter · 3: kürzere Abklingzeit, Blutung · 4: fünf Messer, Vorteil · 5: Messer durchschlagen ein Ziel |
| Sporenfalle      | Kapsel (`kind: 'pod'`) → Bodenfeld | 1: Kapsel platzt bei Annäherung, Wolke 3,5 s (Schaden, 20 % langsamer) · 2: Radius +30 %, 1 s länger · 3: kürzere Abklingzeit, Fernkämpfer ohne Zauber, Gegner greifen langsamer an · 4: zwei Kapseln, mehr Schaden über Zeit · 5: Wer in der Wolke stirbt, lässt eine frische Wolke zurück |
| Köderpuppe       | Bodenfeld, 8,5 s Pause    | 1: Gegner in der Nähe 20 % langsamer und träger · 2: Bereich +30 %, steht 5 s · 3: kürzere Abklingzeit, kleine Gegner im Schatten fürchten sich · 4: nahe der Puppe 40 % weniger Schaden aus Fernangriffen · 5: beim Auflösen eine Schadenswelle mit Rückstoß |
| Netz             | Fläche (`kind: 'root'`)   | 1: Schaden, 2,5 s um 40 % langsamer · 2: Radius +30 %, 50 % · 3: kürzere Abklingzeit, zieht Getroffene zusammen · 4: Blutung und Nachteil · 5: Staub macht kleine Gegner 1,5 s bewegungsunfähig und stört Fernkämpfer |

Wie das gebaut ist:

- **Neue Schalter und Zahlen je Rang** (`RankRule`, `ResolvedRank`): `speed` und `spread` (Faktoren auf Pfeiltempo und Streuung), `duration` (Sekunden, etwa die Haltezeit einer Wolke) und die Schalter `abfall`, `vorteil`, `ruestung`, `folgen`,
  `mitte`, `splitter`, `platzen`, `furcht`, `schleier`, `knall`, `zug`, `staub`; `arsenal.ts` fragt sie mit `hasFlag` ab. `abfall` lässt Durchschlag-Ziele nach dem ersten nur `pierceFalloff` (60 %) des Schadens erleiden;
  `vorteil` gibt gegen Gegner im Nachteil, verlangsamt oder blutend `advantageCrit` (+30 %) Kritchance, ohne dass ein Zustand dafür verbraucht wird.
- **Die Sporenfalle ist Kapsel und Feld**: Eine Kapsel (`kind: 'pod'`, höchstens vier liegen) bleibt, bis ein Gegner in ihre Nähe kommt, und öffnet sich dann in ein Bodenfeld mit Schaden je Takt und den Zuständen des Rangs
  (`fields.ts`). Das Feld von Rang 5 meldet sich in `onKill`: Wer darin stirbt, lässt eine kleine zweite Wolke zurück (nie mehr als 14 Felder, nicht auf einer bestehenden Wolke).
- **Die Köderpuppe ist ein Bodenfeld** an der Figur, das 1,5 s nach dem Aufstellen kleine Gegner in Furcht schickt (`furcht`), die Figur hinter einem Schleier schützt (`schleier`: ein zeitweiliger Wert `rangedTaken`, siehe unten)
  und sich mit `onEnd` in eine Schadenswelle löst (`knall`). Das Netz fängt über `kind: 'root'` die Gruppe um den nächsten Gegner, zieht sie zusammen (`zug`) und betäubt kleine Gegner (`staub`, Zustand `hold`).
- **Pfeilhagel**: Die Salve schlägt verzögert ein; mit `folgen` rutscht ihre Mitte bis zu 1,4 m zur Gruppe, mit `mitte` trifft das Zentrum 25 % härter. **Fangeisen**: Der Haken `listener.kill` sieht, wenn ein Gefangener im Eisen stirbt (`splitter`).
- **`Stats.rangedTaken`** ist neu: ein Faktor auf Schaden aus Fernangriffen (heute nur der Schwarze Sog), den die Köderpuppe über einen zeitweiligen Wert senkt. `Player.hurt` hat dafür den Parameter `ranged`.
- Klänge: `angriff.sporenfalle`, `einschlag.sporenfalle`, `angriff.koederpuppe`, `einschlag.koederpuppe` und `angriff.netz` sind neu in `audio.json` (erzeugt von `tools/audio-erzeugen.py`).
- Zwei neue Bilder: das Gestell der Köderpuppe und die Pilzkapsel (`props.ts`, `effects.ts`), beide aus Rechnung und mit festem Pool; das Netz ist ein Gitter aus Strichen, kein neues Modell.

**Abweichungen von der Vorlage** (die Vorlage ist ein Leitfaden, siehe [Lore](#lore)):

- „Rüstungsverlust“ und „Nachteil“ sind im Spiel ein **Nachteil** (`weak`) für *jeden* Urheber, nicht nur für Pfeile und Messer: Der Gegner erleidet mehr Schaden. Das Spiel hat keine Rüstung der Gegner.
- Bogenschuss: Die Grundwerte sind **1 s Abklingzeit und 36 Schaden** (vorher 0,65 s und 16), damit „−0,3 s“ aus Rang 3 etwas bedeutet. Bogenschuss und Wurfmesser durchschlagen auf Rang 1 nichts mehr (vorher durchschlugen beide ein weiteres Ziel);
  das kommt mit Rang 2 bzw. 5. Die Wurfmesser haben 3 / 4 / 5 Messer (vorher 3 / 5 / 7), Rang 5 bringt den Durchschlag statt zweier Messer mehr. Weil Rang 1 jetzt nur ein Ziel trifft, ist der Schaden höher (Bogenschuss 36 statt 16, Wurfmesser 12 statt 9). Im Messlauf (zwölf Nächte, zwei Saatwerte) überlebt die Automatik-Figur damit im Mittel etwa so lange wie vorher (431 s gegen 470 s; die Streuung liegt bei rund 40 s).
- Fangeisen: Die Haltezeit ist **1,5 s** (vorher 2,5 s); Rang 5 schleudert die Splitter **ohne Zustände**, sonst würde jede Kette neue Gefangene machen.
- Pfeilhagel: Der Schaden steigt mit der Zahl der Pfeile (1,5 × bei neun), weil die Vorlage mehr Pfeile, nicht mehr Fläche meint.
- Sporenfalle, Köderpuppe und Netz: „Fernkämpfer können nicht zielen“ ist im Spiel **ohne Zauber** (`silence`), denn nur der Priester wirkt aus der Ferne. Das gilt gleich für die Betäubung in Rang 5 des Netzes.
- Köderpuppe: „Ausweichchance“ aus Rang 4 ist **40 % weniger Schaden aus Fernangriffen** (`rangedTaken`, 0,6 für 0,8 s, solange man nahe der Puppe steht); das Spiel kennt kein Ausweichen, und der Schwarze Sog ist der einzige Fernangriff.
  „Köderpuppe zerschlagen“ gibt es nicht: Gegner greifen die Puppe nicht an, sie wirkt als Feld und löst sich nach ihrer Dauer auf.
  Das Gestell steht an der Figur (nicht beim Gegner), sobald ein Gegner innerhalb von 9 m ist; das Netz fällt auf die nächste Gruppe.
- Sporenfalle, Rang 5: Die kleinen Wolken sind begrenzt (höchstens 14 Felder, keine Überlagerung), damit die Kette bei einer dichten Horde die Felder nicht aufbraucht.
- Kein Savegame- und kein Plattform-Eingriff: `SAVEGAME_VERSION` bleibt, Pfade und Eingabe sind unverändert.

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
- **Gegenstände und Fertigkeiten**: `__items` (`src/tools/items.ts`) füllt Ausrüstung, Truhe und Börse und würfelt Beute nach; `__skills` (`src/tools/skills.ts`) bringt Zustände, Bodenfelder und
  zeitweilige Werte an und zählt Ereignisse mit Urheber (siehe [Fertigkeiten](#fertigkeiten-der-unterbau)).
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
