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
#   FTP_ALTES_LOESCHEN  "ja": loescht im Zielordner alles, was nicht zum Spiel gehoert (Rueckfall: "nein")
#
# Dieses Skript gehoert nicht zum Spiel; es ist reines Werkzeug (nur ASCII, wie die Python-Skripte unter tools/).

set -euo pipefail

QUELLE="${1:-dist}"
PORT="${FTP_PORT:-22}"
ZIEL="${FTP_ZIELORDNER:-.}"
FINGERABDRUCK="${FTP_FINGERABDRUCK:-}"
LOESCHEN="${FTP_ALTES_LOESCHEN:-nein}"
HOST="${FTP_SERVER:-}"
BENUTZER="${FTP_BENUTZER:-}"
PASSWORT="${FTP_PASSWORT:-}"

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
# Der Zielordner landet in einem Befehl fuer lftp; darum nur schlichte Pfade, nie aus dem Zugang heraus.
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

# --- Dateien fuer den Vergleich vorbereiten -----------------------------------------------------------------
# lftp laedt nur hoch, was sich unterscheidet (Groesse oder Zeitstempel). Frisch gebaute Dateien haben aber immer die
# Zeit des Bauens, also wuerde sonst jedes Mal alles hochgeladen (ueber 150 MB). Darum bekommt jede Datei einen
# Zeitstempel, der nur von ihrem Inhalt abhaengt: gleicher Inhalt, gleiche Zeit, nichts zu tun. Ein geaenderter Inhalt
# bekommt (fast sicher) eine andere Zeit und wird hochgeladen, auch wenn die Groesse gleich bleibt.
find "$QUELLE" -type f -print0 | while IFS= read -r -d '' datei; do
  summe="$(sha256sum "$datei" | cut -c1-8)"
  touch -d "@$((1577836800 + 0x$summe % 31536000))" "$datei"
done
# Feste Rechte, damit der Webserver alles lesen kann, egal wie die Dateien hierher kamen.
find "$QUELLE" -type d -exec chmod 755 {} +
find "$QUELLE" -type f -exec chmod 644 {} +

# --- Hochladen ----------------------------------------------------------------------------------------------
# Zwei Durchgaenge: erst alles ausser den HTML-Seiten (Skripte, Modelle, Klaenge), dann die Seiten selbst. So zeigt
# eine neue index.html nie auf Dateien, die noch fehlen. Mit "--overwrite" und einer Zwischendatei wird eine Datei
# erst ersetzt, wenn die neue vollstaendig da ist. Geloescht wird nur auf ausdruecklichen Wunsch (FTP_ALTES_LOESCHEN).
LOESCHEN_OPTION=""
if [ "$LOESCHEN" = "ja" ]; then
  LOESCHEN_OPTION="--delete"
  echo "FTP_ALTES_LOESCHEN=ja: Dateien im Zielordner, die nicht zum Spiel gehoeren, werden geloescht."
fi

# lftp liest die Befehle hinter "-e" nur, wenn sie mit Semikolon getrennt sind (Zeilenumbrueche gehen nicht).
BEFEHLE="set cmd:fail-exit yes"
BEFEHLE="$BEFEHLE; set net:max-retries 2; set net:reconnect-interval-base 5; set net:timeout 30"
BEFEHLE="$BEFEHLE; set sftp:auto-confirm no"
BEFEHLE="$BEFEHLE; set sftp:connect-program \"ssh -a -x -o UserKnownHostsFile=$KNOWN -o StrictHostKeyChecking=yes -o NumberOfPasswordPrompts=1\""
BEFEHLE="$BEFEHLE; set xfer:use-temp-file yes; set xfer:temp-file-name .hochladen.*"
BEFEHLE="$BEFEHLE; mirror -R -v --overwrite --parallel=2 $LOESCHEN_OPTION -x '\\.html\$' \"$QUELLE\" \"$ZIEL\""
BEFEHLE="$BEFEHLE; mirror -R -v --overwrite $LOESCHEN_OPTION -x . -i '\\.html\$' \"$QUELLE\" \"$ZIEL\""
BEFEHLE="$BEFEHLE; bye"

echo "Lade \"$QUELLE\" nach $HOST:$PORT, Ordner \"$ZIEL\" ..."
# Das Passwort steht nur hier in der Befehlszeile; GitHub blendet Secrets in der Ausgabe automatisch aus.
# Zwei Versuche reichen: Ein falsches Passwort soll den Zugang nicht durch viele Fehlversuche sperren.
lftp -u "$BENUTZER,$PASSWORT" -p "$PORT" -e "$BEFEHLE" "sftp://$HOST" \
  || fehler "Das Hochladen ist fehlgeschlagen (Einzelheiten stehen oben). Haeufige Ursachen: falscher Benutzer oder falsches Passwort, Zielordner nicht beschreibbar, Webspace voll."
echo "Fertig: Der aktuelle Stand liegt auf $HOST."
