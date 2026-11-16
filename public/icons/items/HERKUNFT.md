# Herkunft der Gegenstandsbilder

Die 27 Bilder (`<platz>-<klasse>.webp`, neun Plätze mal drei Klassen) sind für dieses Spiel mit dem Bildmodell GPT-Image-2
erzeugt worden (Qualität „mittel“, Seitenverhältnis 1:1). Die Prompts stehen in `tools/item-icons/prompts.py`; freigestellt und
verkleinert haben sie `tools/item-icons/freistellen.py` und `tools/item-icons/webp-erzeugen.py`.

Die Bilder zeigen keine Figuren und keinen Text. Wer sie ersetzen will, legt eine Datei mit demselben Namen (256 × 256, durchsichtiger Grund) hierher;
fehlt eine Datei, zeigt das Lager stattdessen das Umrisszeichen aus `src/ui/itemIcons.ts`.
