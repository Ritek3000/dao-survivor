#!/usr/bin/env bash
# Laedt den gebauten Stand (dist/) per SFTP auf einen eigenen Webspace und haelt ihn dort aktuell.
# Der Aufruf steht in .github/workflows/pages.yml (Job "eigene-domain"); das Skript laeuft aber auch von Hand:
#
#   FTP_SERVER=example.org FTP_BENUTZER=... FTP_PASSWORT=... bash tools/sftp-hochladen.sh dist
#
# Zugangsdaten (Pflicht, in GitHub als Secrets, siehe README, Abschnitt "Eigene Domaene"):
#   FTP_SERVER          Rechnername des Webspaces (auch "sftp://rechner" oder "rechner:port" wird verstanden)
#   FTP_BENUTZER        Benutzername
#   FTP_PASSWORT        Passwort
# Einstellungen (Wahl, in GitHub als Variablen; ohne Angabe gilt der Rueckfall in Klammern):
#   FTP_PORT            Port (22)
#   FTP_ZIELORDNER      Ordner auf dem Webspace; "." ist das Heimatverzeichnis des Zugangs, bei Webspaces meist
#                       die Wurzel der Domaene (".")
#   FTP_FINGERABDRUCK   Fingerabdruck des Server-Schluessels, "SHA256:..." (fehlt er, wird der Schluessel beim
#                       Verbinden uebernommen und sein Fingerabdruck ausgegeben, damit man ihn festlegen kann)
#   FTP_ALTES_LOESCHEN  "ja": loescht Dateien, die frueher von diesem Skript hochgeladen wurden und nicht mehr zum Spiel
#                       gehoeren. Fremde Dateien im Zielordner bleiben unberuehrt (Rueckfall: "nein")
#   FTP_ALLES_HOCHLADEN "ja": laedt alle Dateien neu hoch, auch unveraenderte, etwa nachdem auf dem Webspace
#                       von Hand etwas geloescht wurde (Rueckfall: "nein")
#
# Dieses Skript gehoert nicht zum Spiel; es ist reines Werkzeug (nur ASCII, wie die Python-Skripte unter tools/).

set -euo pipefail

QUELLE="${1:-dist}"
PORT="${FTP_PORT:-22}"
ZIEL="${FTP_ZIELORDNER:-.}"
FINGERABDRUCK="${FTP_FINGERABDRUCK:-}"
LOESCHEN="${FTP_ALTES_LOESCHEN:-nein}"
ALLES="${FTP_ALLES_HOCHLADEN:-nein}"
HOST="${FTP_SERVER:-}"
BENUTZER="${FTP_BENUTZER:-}"
PASSWORT="${FTP_PASSWORT:-}"
# Auf dem Webspace liegt im Zielordner diese Datei mit der Pruefsumme jeder hochgeladenen Datei (siehe unten).
MANIFEST=".deploy-manifest"

fehler() {
  # In GitHub Actions erscheint die Meldung als rote Anmerkung zum Lauf.
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::$*"; else echo "FEHLER: $*" >&2; fi
  exit 1
}

# --- Eingaben pruefen ---------------------------------------------------------------------------------------
for name in FTP_SERVER FTP_BENUTZER FTP_PASSWORT; do
  if [ -z "${!name:-}" ]; then
    fehler "Das Secret $name fehlt oder ist leer (GitHub: Settings > Secrets and variables > Actions)."
  fi
done

# "sftp://rechner/" und "rechner:2222" auf den reinen Rechnernamen zurueckfuehren.
HOST="${HOST#sftp://}"
HOST="${HOST#ssh://}"
HOST="${HOST%%/*}"
if [[ "$HOST" =~ ^([^:]+):([0-9]+)$ ]]; then
  HOST="${BASH_REMATCH[1]}"
  [ -n "${FTP_PORT:-}" ] || PORT="${BASH_REMATCH[2]}"
fi
[[ "$HOST" =~ ^[A-Za-z0-9._-]+$ ]] || fehler "FTP_SERVER enthaelt unerlaubte Zeichen (erwartet wird ein Rechnername)."
[[ "$PORT" =~ ^[0-9]+$ ]] || fehler "FTP_PORT muss eine Zahl sein."
# Pfade landen in Befehlen fuer lftp; darum nur schlichte Pfade, nie aus dem Zugang heraus.
[[ "$ZIEL" =~ ^[A-Za-z0-9._/-]+$ ]] || fehler "FTP_ZIELORDNER darf nur Buchstaben, Ziffern und . _ / - enthalten."
[[ "/$ZIEL/" != *"/../"* ]] || fehler "FTP_ZIELORDNER darf kein \"..\" enthalten."
[[ "$QUELLE" =~ ^[A-Za-z0-9._/-]+$ ]] || fehler "Der Quellordner darf nur Buchstaben, Ziffern und . _ / - enthalten."
[ -f "$QUELLE/index.html" ] || fehler "Im Ordner \"$QUELLE\" liegt keine index.html. Wurde zuerst gebaut (npm run build)?"

ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT

# --- Schluessel des Servers pruefen ------------------------------------------------------------------------
# Ohne diese Pruefung koennte sich ein Fremder zwischen GitHub und den Webspace schalten und das Passwort abgreifen.
KNOWN="$ARBEIT/known_hosts"
ssh-keyscan -T 15 -p "$PORT" -t ed25519,ecdsa,rsa "$HOST" > "$ARBEIT/gefunden" 2> /dev/null || true
[ -s "$ARBEIT/gefunden" ] || fehler "Keine Antwort von $HOST:$PORT (Rechnername, Port und SFTP-Zugang pruefen)."

if [ -n "$FINGERABDRUCK" ]; then
  : > "$KNOWN"
  while IFS= read -r zeile; do
    printf '%s\n' "$zeile" > "$ARBEIT/zeile"
    if ssh-keygen -lf "$ARBEIT/zeile" 2> /dev/null | grep -qF -- " $FINGERABDRUCK "; then
      printf '%s\n' "$zeile" >> "$KNOWN"
    fi
  done < "$ARBEIT/gefunden"
  [ -s "$KNOWN" ] || fehler "Der Server meldet keinen Schluessel mit dem Fingerabdruck $FINGERABDRUCK. Bitte FTP_FINGERABDRUCK pruefen (oder jemand schaltet sich dazwischen)."
  echo "Schluessel des Servers stimmt mit FTP_FINGERABDRUCK ueberein."
else
  cp "$ARBEIT/gefunden" "$KNOWN"
  echo "Hinweis: FTP_FINGERABDRUCK ist nicht gesetzt, der Schluessel des Servers wird ungeprueft uebernommen."
  echo "Fingerabdruecke des Servers (einen davon als Variable FTP_FINGERABDRUCK eintragen, dann wird er geprueft):"
  ssh-keygen -lf "$KNOWN" | awk '{ print "  " $2 "  (" $NF ")" }'
fi

# --- Was ist neu oder geaendert? ----------------------------------------------------------------------------
# Ein Vergleich nach Groesse und Zeit reicht dafuer nicht: Wechselt nur eine Zahl (etwa die Versionsnummer in index.html),
# bleibt die Groesse gleich, und lftp hielt die Datei fuer unveraendert; die Seite zeigte dann den alten Stand. Darum fuehrt
# das Skript Buch: Auf dem Webspace liegt die Datei .deploy-manifest mit der Pruefsumme jeder hochgeladenen Datei. Hochgeladen
# wird, was dort fehlt oder eine andere Pruefsumme hat. Gibt es das Manifest noch nicht (erster Lauf), wird alles hochgeladen.
find "$QUELLE" -type f -printf '%P\n' | LC_ALL=C sort > "$ARBEIT/pfade"
if grep -qvE '^[A-Za-z0-9._/-]+$' "$ARBEIT/pfade" || grep -qE '(^|/)\.\.(/|$)|^/' "$ARBEIT/pfade"; then
  fehler "Im Ordner \"$QUELLE\" gibt es Dateinamen mit unerlaubten Zeichen (erlaubt: Buchstaben, Ziffern und . _ / -)."
fi
( cd "$QUELLE" && xargs -d '\n' sha256sum < "$ARBEIT/pfade" ) > "$ARBEIT/neu"

# Rechte, damit der Webserver alles lesen kann, egal wie die Dateien hierher kamen (siehe chmod unten).
DATEI_RECHTE=644
ORDNER_RECHTE=755

# Gemeinsame Einstellungen fuer alle lftp-Laeufe. Das Passwort steht nicht hier, sondern nur in der Befehlszeile von lftp.
cat > "$ARBEIT/einstellungen.lftp" <<EOF
set net:max-retries 2
set net:reconnect-interval-base 5
set net:timeout 30
set sftp:auto-confirm no
set sftp:connect-program "ssh -a -x -o UserKnownHostsFile=$KNOWN -o StrictHostKeyChecking=yes -o NumberOfPasswordPrompts=1"
set xfer:use-temp-file yes
set xfer:temp-file-name .hochladen.*
EOF
# Zwei Versuche reichen: Ein falsches Passwort soll den Zugang nicht durch viele Fehlversuche sperren.
# Das Passwort steht nur hier in der Befehlszeile; GitHub blendet Secrets in der Ausgabe automatisch aus.
# Die Befehle stehen in einer Datei, die lftp mit "source" liest ("-f" laesst sich nicht mit der Adresse verbinden).
lftp_ausfuehren() { lftp -u "$BENUTZER,$PASSWORT" -p "$PORT" -e "source $1" "sftp://$HOST"; }

# Ins Zielverzeichnis wechseln (und es anlegen, falls es fehlt). Danach gelten alle Pfade relativ dazu.
ins_ziel() {
  if [ "$ZIEL" != "." ]; then
    printf 'mkdir -p -f "%s"\ncd "%s"\n' "$ZIEL" "$ZIEL"
  fi
}

echo "Pruefe $HOST:$PORT, Ordner \"$ZIEL\" ..."
# Das Manifest holen. Fehlt es, ist das kein Fehler; ein Fehler beim Verbinden (falsches Passwort ...) bricht aber ab.
{
  echo "source $ARBEIT/einstellungen.lftp"
  echo "set cmd:fail-exit yes"
  ins_ziel
  echo "cls -1 -a . > $ARBEIT/liste"
  echo "set cmd:fail-exit no"
  echo "get \"$MANIFEST\" -o \"$ARBEIT/alt\""
  # "bye" ohne Zahl gaebe den Fehler des letzten Befehls weiter, und ein fehlendes Manifest ist hier erlaubt.
  echo "bye 0"
} > "$ARBEIT/holen.lftp"
lftp_ausfuehren "$ARBEIT/holen.lftp" 2> "$ARBEIT/holen.fehler" \
  || { cat "$ARBEIT/holen.fehler" >&2; fehler "Keine Verbindung zum Webspace (Benutzer, Passwort, Zielordner pruefen)."; }

# Nur ein Manifest in genau dem erwarteten Aufbau gilt; alles andere zaehlt als "kein Manifest".
if [ -s "$ARBEIT/alt" ] && ! grep -qvE '^[0-9a-f]{64}  [A-Za-z0-9._/-]+$' "$ARBEIT/alt" \
  && ! grep -qE '  (/|(.*/)?\.\.(/|$))' "$ARBEIT/alt"; then
  LC_ALL=C sort "$ARBEIT/alt" > "$ARBEIT/alt.sortiert"
  echo "Stand auf dem Webspace gefunden ($(wc -l < "$ARBEIT/alt.sortiert") Dateien)."
else
  : > "$ARBEIT/alt.sortiert"
  echo "Kein Stand auf dem Webspace gefunden (erster Lauf); alle Dateien werden hochgeladen."
fi

# Neu oder geaendert: Zeilen (Pruefsumme und Pfad), die im alten Stand fehlen. Bei FTP_ALLES_HOCHLADEN=ja alle.
if [ "$ALLES" = "ja" ]; then
  echo "FTP_ALLES_HOCHLADEN=ja: Alle Dateien werden neu hochgeladen."
  cp "$ARBEIT/neu" "$ARBEIT/geaendert"
else
  grep -vxFf "$ARBEIT/alt.sortiert" "$ARBEIT/neu" > "$ARBEIT/geaendert" || true
fi
sed 's/^[0-9a-f]\{64\}  //' "$ARBEIT/geaendert" | LC_ALL=C sort > "$ARBEIT/hochladen"
# Frueher hochgeladen, jetzt nicht mehr im Spiel: nur Dateien, die dieses Skript selbst angelegt hat.
sed 's/^[0-9a-f]\{64\}  //' "$ARBEIT/alt.sortiert" | LC_ALL=C sort > "$ARBEIT/alte-pfade"
LC_ALL=C comm -23 "$ARBEIT/alte-pfade" "$ARBEIT/pfade" > "$ARBEIT/veraltet"

ANZAHL="$(wc -l < "$ARBEIT/hochladen")"
echo "$ANZAHL von $(wc -l < "$ARBEIT/pfade") Dateien sind neu oder geaendert."
if [ "$ANZAHL" -eq 0 ] && { [ "$LOESCHEN" != "ja" ] || [ ! -s "$ARBEIT/veraltet" ]; }; then
  echo "Nichts zu tun: Der Webspace ist auf dem aktuellen Stand."
  if [ -s "$ARBEIT/veraltet" ]; then
    echo "Hinweis: $(wc -l < "$ARBEIT/veraltet") Dateien gehoeren nicht mehr zum Spiel und bleiben liegen (loeschen mit FTP_ALTES_LOESCHEN=ja)."
  fi
  exit 0
fi

# --- Hochladen ----------------------------------------------------------------------------------------------
# Erst alles ausser den HTML-Seiten (Skripte, Modelle, Klaenge), dann die Seiten selbst. So zeigt eine neue index.html nie
# auf Dateien, die noch fehlen. Eine Datei wird ueber eine Zwischendatei geladen und erst ersetzt, wenn die neue vollstaendig
# da ist. Das Manifest kommt ganz zuletzt: Bricht ein Lauf ab, holt der naechste das Fehlende nach.
{
  echo "source $ARBEIT/einstellungen.lftp"
  echo "set cmd:fail-exit yes"
  ins_ziel
  # Verzeichnisse, die gebraucht werden.
  sed -n 's#/[^/]*$##p' "$ARBEIT/hochladen" | LC_ALL=C sort -u > "$ARBEIT/ordner"
  while IFS= read -r ordner; do printf 'mkdir -p -f "%s"\n' "$ordner"; done < "$ARBEIT/ordner"
  grep -v '\.html$' "$ARBEIT/hochladen" | while IFS= read -r pfad; do printf 'put "%s/%s" -o "%s"\n' "$QUELLE" "$pfad" "$pfad"; done || true
  grep '\.html$' "$ARBEIT/hochladen" | while IFS= read -r pfad; do printf 'put "%s/%s" -o "%s"\n' "$QUELLE" "$pfad" "$pfad"; done || true
  # Rechte setzen; scheitert das (manche Server verbieten es), geht es trotzdem weiter.
  echo "set cmd:fail-exit no"
  while IFS= read -r ordner; do printf 'chmod %s "%s"\n' "$ORDNER_RECHTE" "$ordner"; done < "$ARBEIT/ordner"
  while IFS= read -r pfad; do printf 'chmod %s "%s"\n' "$DATEI_RECHTE" "$pfad"; done < "$ARBEIT/hochladen"
  echo "set cmd:fail-exit yes"
  if [ "$LOESCHEN" = "ja" ] && [ -s "$ARBEIT/veraltet" ]; then
    while IFS= read -r pfad; do printf 'rm -f "%s"\n' "$pfad"; done < "$ARBEIT/veraltet"
  fi
  echo "put \"$ARBEIT/neu\" -o \"$MANIFEST\""
  echo "chmod $DATEI_RECHTE \"$MANIFEST\""
  echo "bye"
} > "$ARBEIT/hochladen.lftp"

if [ "$LOESCHEN" = "ja" ]; then
  echo "FTP_ALTES_LOESCHEN=ja: $(wc -l < "$ARBEIT/veraltet") veraltete Dateien werden geloescht."
elif [ -s "$ARBEIT/veraltet" ]; then
  echo "Hinweis: $(wc -l < "$ARBEIT/veraltet") Dateien gehoeren nicht mehr zum Spiel und bleiben liegen (loeschen mit FTP_ALTES_LOESCHEN=ja)."
  # Sie bleiben im Manifest stehen, damit ein spaeteres Einschalten des Loeschens sie noch findet.
  awk 'NR == FNR { v[$0] = 1; next } substr($0, 67) in v' "$ARBEIT/veraltet" "$ARBEIT/alt.sortiert" >> "$ARBEIT/neu"
  LC_ALL=C sort -o "$ARBEIT/neu" "$ARBEIT/neu"
fi

echo "Lade hoch ..."
lftp_ausfuehren "$ARBEIT/hochladen.lftp" \
  || fehler "Das Hochladen ist fehlgeschlagen (Einzelheiten stehen oben). Haeufige Ursachen: Zielordner nicht beschreibbar, Webspace voll, Verbindung abgebrochen."
echo "Fertig: Der aktuelle Stand liegt auf $HOST."
