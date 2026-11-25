"""Prompts fuer die 27 Item-Icons (9 Plaetze x 3 Klassen). ASCII-only, Prompts englisch, weil die Bildmodelle damit am besten arbeiten.

Ablauf (so sind die mitgelieferten Bilder in public/bilder/items entstanden):
  1. Je Gegenstand einen Prompt aus diesem Skript an ein Bildmodell geben (verwendet: GPT-Image-2, Qualitaet "mittel", 1:1, 1K).
     Aufruf: python tools/item-icons/prompts.py helm kaempfer
  2. Die Ausgabe auf magenta Grund mit freistellen.py auf durchsichtigen Grund bringen (512 px PNG).
  3. Mit webp-erzeugen.py auf 256 px als WebP verkleinern und nach public/bilder/items/<platz>-<klasse>.webp legen.
Pillow, numpy und scipy werden gebraucht (pip install pillow numpy scipy).
"""

import sys

STYLE = (
    "Dark gritty fantasy video game inventory icon, hand-painted digital illustration with realistic worn materials, "
    "in the style of Diablo, Grim Dawn and Path of Exile item art. One single object, centered, seen from slightly above "
    "in three-quarter view, filling about 80 percent of the square frame, bold readable silhouette that still works when "
    "shrunk to 64 pixels. Warm ember-orange key light from the upper left, cool dark rim light, deep shadows, fine scratches, "
    "dust and wear. Muted, desaturated earthy palette. "
    "Background: perfectly flat solid pure magenta (#FF00FF), no gradient, no floor, no cast shadow, no reflection, "
    "no glow or color spill onto the background. No text, no letters, no border, no frame, no watermark, no hands, no character."
)

CLASS_MATERIAL = {
    "kaempfer": (
        "Fighter gear: heavy forged blackened iron and dull steel, riveted plates, aged bronze rivets and trim, "
        "deep crimson lacquered leather accents, tufts of rust-orange fur, brutal and sturdy dwarven look."
    ),
    "wildnislaeufer": (
        "Ranger gear: weathered brown and moss-green leather, laced sinew cords, carved dark wood, bone and horn, "
        "a few small feathers, lichen-green accents, light and practical, no heavy metal plate."
    ),
    "magier": (
        "Mage gear: dark indigo and violet cloth, thin silk, ochre-gold embroidery with sun-like circular glyphs, "
        "polished aged brass, a faint warm ember-orange magical glow, fragile and scholarly."
    ),
}

# (Platz, Klasse) -> Beschreibung des Gegenstands
ITEMS = {
    ("fackel", "kaempfer"): "a heavy wooden torch bound with iron bands, pitch-soaked wrap on top burning with a bright orange flame",
    ("fackel", "wildnislaeufer"): "a slim torch made of a dark branch wrapped with resin-soaked rags and sinew lashing, burning with a small flame",
    ("fackel", "magier"): "a tall slender candle in an ornate brass holder, engraved glyphs in the wax, burning with a pale cold blue-white flame, melted wax drips",
    ("helm", "kaempfer"): "a dented round iron helmet with a nasal guard, riveted bronze brow band and a rust-orange fur trim",
    ("helm", "wildnislaeufer"): "a hooded leather cap with a bone brow plate, stitched seams and two feathers tucked at the side",
    ("helm", "magier"): "a pointed cowl hood of dark indigo cloth with a gold embroidered rim and a small brass sun disc on the brow",
    ("guertel", "kaempfer"): "a wide thick leather belt with a heavy iron buckle, bronze studs and an iron hook",
    ("guertel", "wildnislaeufer"): "a slim worn leather belt with a small pouch, a knife sheath, a coiled cord and a bone toggle",
    ("guertel", "magier"): "a cloth sash belt with a brass clasp, small glass vials, a rolled scroll case and tassels",
    ("waffe", "kaempfer"): "a bearded single-bit battle axe with a notched dark steel blade, a wooden haft wrapped in leather and a bronze ring",
    ("waffe", "wildnislaeufer"): "a recurve hunting bow of layered dark wood and horn with a leather-wrapped grip, bone tips and a taut sinew string",
    ("waffe", "magier"): "a thick leather spellbook with brass corner pieces and a strap clasp, a glowing ember-orange sun glyph on the cover",
    ("handschuh", "kaempfer"): "a heavy gauntlet with plated dark iron knuckles, bronze rivets and a fur cuff",
    ("handschuh", "wildnislaeufer"): "a fingerless leather archer's glove with lacing and a short bracer",
    ("handschuh", "magier"): "a slim cloth glove with a gold embroidered cuff, a small brass ring over the fingers and a faint ember glow at the fingertips",
    ("schuh", "kaempfer"): "a heavy iron-shod leather boot with a steel toe cap, buckled straps and a fur cuff, side view",
    ("schuh", "wildnislaeufer"): "a soft laced brown leather boot with moss-green wraps and a light sole, side view",
    ("schuh", "magier"): "a cloth slipper boot with a curled toe, ochre-gold trim and a brass buckle, side view",
    ("ring", "kaempfer"): "a thick blackened iron signet ring with a dull red stone and bronze inlay",
    ("ring", "wildnislaeufer"): "a carved bone ring with a green stone and a braided leather band",
    ("ring", "magier"): "a slender brass ring with engraved glyphs and a glowing ember-orange sun gem",
    ("brust", "kaempfer"): "a heavy dark iron cuirass with riveted plates, bronze edging, a crimson cloth hem and a fur collar",
    ("brust", "wildnislaeufer"): "a studded leather jerkin with front lacing, a fur shoulder collar and moss-green dye",
    ("brust", "magier"): "a dark indigo robe with a high collar, ochre-gold embroidery, brass clasps and an open front",
    ("amulett", "kaempfer"): "a heavy round iron pendant with a bronze rim on a thick chain",
    ("amulett", "wildnislaeufer"): "a bone and claw talisman on a braided leather cord with a green stone and a feather",
    ("amulett", "magier"): "a brass sun disc amulet, a circle with three straight rays pointing downward, on a fine chain, glowing faintly ember-orange",
}


def prompt(slot, classId):
    return f"{STYLE} Subject: {ITEMS[(slot, classId)]}. {CLASS_MATERIAL[classId]}"


if __name__ == "__main__":
    if len(sys.argv) == 3:
        print(prompt(sys.argv[1], sys.argv[2]))
    else:
        for key in ITEMS:
            print(key[0], key[1], len(prompt(*key)))
