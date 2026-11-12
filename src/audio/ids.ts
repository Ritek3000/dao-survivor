/**
 * Die Ereignisse, für die das Spiel einen Ton verlangt. Der Name steht in public/audio/audio.json und
 * ordnet dort dem Ereignis seine Datei zu; im Code kommt keine Datei vor.
 *
 * Namen mit Punkt haben einen Rückfall: Fehlt `gegner-tod.brute` in audio.json, gilt `gegner-tod`.
 * So braucht eine neue Waffe, Gegnerart oder Trefferart keinen eigenen Eintrag, um nicht stumm zu bleiben.
 */
export type SoundId =
  // Ablauf und Oberfläche
  | 'abendglocke'
  | 'auswahl'
  | 'bestaetigen'
  | 'pause'
  | 'stufe'
  | 'segen'
  | 'steigerung'
  // Spielfigur
  | 'spieler-treffer'
  | 'spieler-verstaubt'
  | 'schild.faengt'
  | 'schild.bereit'
  | 'schritt'
  | 'eingesammelt'
  | 'muenze'
  // Feuerschalen
  | 'feuer.entzuenden'
  | 'feuer.entzuendet'
  | 'feuer.erlischt'
  | 'feuer.geloescht'
  // Angriffe: `angriff.<Waffe>` beim Auslösen, `einschlag.<Waffe>` bei verzögerter Wirkung,
  // `treffer.<stahl|staub|brand>` beim Treffer, `gegner-tod[.<Gegnerart>]` und `gegner-laut.<Gegnerart>`
  | `angriff.${string}`
  | `einschlag.${string}`
  | `treffer.${string}`
  | 'gegner-tod'
  | `gegner-tod.${string}`
  | `gegner-laut.${string}`
  // Schwarzer Sog und Verschlinger
  | 'sog.ankuendigung'
  | 'sog.wirkung'
  | 'boss.erscheint'
  | 'boss.hieb-ausholen'
  | 'boss.hieb'
  | 'boss.ansturm'
  | 'boss.aufprall'
  | 'boss.verschlingen'
  | 'boss.faellt';

/** Dauerklänge, deren Lautstärke das Spiel laufend nachführt. */
export type LoopId = 'feuer.knistern' | 'wind.nacht' | 'finsternis.brummen';

/** Musikstücke; `sieg` und `niederlage` sind kurze Stücke zum Ende der Nacht. */
export type MusicId = 'menue' | 'nacht' | 'nacht-spaet' | 'boss' | 'sieg' | 'niederlage';
