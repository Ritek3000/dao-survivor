/**
 * Einstieg der globalen Statistik (statistik-global.html): holt die Zähler aller Spieler aus der Sammelstelle und zeigt sie mit
 * derselben Anzeige wie die eigene Statistik im Spiel. Der Schlüssel steht hinter dem "#" der Adresse; er geht nur an die Sammelstelle,
 * nie an den Server dieser Seite (ein Fragment wird nicht mitgeschickt).
 */

import './statistik-seite.css';
import { fetchOverview, SammelstelleError } from './core/sammelstelle';
import { element } from './ui/dom';
import { StatistikView, type StatistikTexts } from './ui/statistikView';

const TEXTS: StatistikTexts = {
  empty: 'In der Sammelstelle liegt noch keine Nacht.',
  emptyClass: (name) => `Mit ${name} wurde noch keine Nacht gemeldet.`,
  emptyNights: 'In der Sammelstelle liegt noch keine Nacht mit Angabe der Nachtart.',
  emptyClassNight: (name, night) => `Mit ${name} wurde noch keine Nacht der Art „${night}“ gemeldet.`,
  outdated:
    'Die Sammelstelle liefert diese Aufschlüsselung noch nicht. Dazu muss das SQL-Skript tools/supabase/statistik.sql im Supabase-Dashboard noch einmal ausgeführt werden.',
};

function fail(message: string): void {
  const status = element('stats-status');
  status.textContent = message;
  status.classList.add('error');
}

async function main(): Promise<void> {
  const status = element('stats-status');
  const view = new StatistikView(element('stats-view'), document.documentElement, TEXTS);
  // Links und Rechts wechseln den Reiter, wie im Spiel.
  window.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') view.stepTab(-1);
    else if (event.key === 'ArrowRight') view.stepTab(1);
  });
  const token = decodeURIComponent(window.location.hash.slice(1));
  if (!token) {
    fail('Dieser Link ist unvollständig: Es fehlt der Schlüssel hinter dem #.');
    return;
  }
  try {
    const data = await fetchOverview(token);
    status.textContent = `Stand: ${new Date().toLocaleString('de-DE')} · ${data.total.nights} Nächte`;
    view.show(data);
  } catch (error) {
    fail(error instanceof SammelstelleError ? error.message : 'Die Statistik konnte nicht geladen werden.');
  }
}

void main();
