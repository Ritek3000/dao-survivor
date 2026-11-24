/**
 * Die Sammelstelle für die Statistik aller Spieler: eine Supabase-Datenbank (Einrichtung in `tools/supabase/statistik.sql`).
 * Das Spiel schickt am Ende jeder Nacht einen anonymen Datensatz hin (`sendRun`); die globale Seite liest die Zähler zurück
 * (`fetchOverview`). Alles läuft über die REST-Schnittstelle von Supabase mit `fetch`, ohne Bibliothek.
 *
 * Was gesendet wird, ist die Nacht aus dem Protokoll (`statistik.ts`) ohne den Zeitpunkt (den setzt der Server): Klasse, Nachtart,
 * Grad, Ausgang, Zeit, Stufe, Stärkungen, Segen und Ränge der Fertigkeiten, dazu die zufällige Kennung der Nacht und die Fassung
 * des Spiels.
 * Kein Name, keine Kennung des Geräts, nichts vom Spielstand.
 *
 * Das Senden ist standardmäßig an, ohne Rückfrage, und lässt sich in den Optionen abschalten (`Settings.data.share`, siehe
 * `settings.ts`); das entscheidet das Spiel, nicht dieser Teil. Fehler schaden dem Spiel nie: Eine Nacht, die nicht ankommt, fehlt in der Statistik
 * aller, mehr nicht.
 */

import { CONFIG } from '../config';
import { parseAuswertung, type Auswertung } from './auswertung';
import type { RunRecord } from './statistik';

/** Ein Fehler der Sammelstelle mit einem Satz, den die globale Seite dem Leser zeigen kann. */
export class SammelstelleError extends Error {}

/** Schickt eine Anfrage an die Sammelstelle; bricht nach `timeoutSeconds` ab. */
async function request(path: string, body: unknown, extra: Record<string, string> = {}): Promise<Response> {
  const { url, key, timeoutSeconds } = CONFIG.sammelstelle;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    return await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json', ...extra },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Schickt eine Nacht an die Sammelstelle. Ohne Rückmeldung: Ein Fehler steht nur in der Konsole. */
export function sendRun(run: RunRecord): void {
  const payload = {
    id: run.id,
    game_version: run.version,
    class_id: run.classId,
    // Neue Nächte tragen immer eine Nachtart; die Spalten gibt es erst seit 0.25.0 (siehe `tools/supabase/statistik.sql`, die
    // Datenbank muss vor dem Spiel dieser Fassung auf dem neuen Stand sein, sonst weist sie die Nacht ab).
    night_id: run.night || null,
    grade: run.night ? run.grade : null,
    outcome: run.outcome,
    seconds: run.seconds,
    level: run.level,
    upgrades: run.upgrades,
    segen: run.segen,
    skills: run.skills,
  };
  request('/rest/v1/runs', payload, { Prefer: 'return=minimal' })
    .then((response) => {
      // 409: Diese Nacht ist schon dort (doppelt gesendet); das ist gut so.
      if (!response.ok && response.status !== 409) console.warn(`Statistik: Die Sammelstelle antwortete mit ${response.status}.`);
    })
    .catch((error: unknown) => console.warn('Statistik: Die Sammelstelle ist nicht erreichbar.', error));
}

/** Liest die Zähler aller Spieler; `token` ist der Schlüssel aus dem Link der globalen Seite. */
export async function fetchOverview(token: string): Promise<Auswertung> {
  let response: Response;
  try {
    response = await request('/rest/v1/rpc/stats_overview', { token });
  } catch {
    throw new SammelstelleError('Die Sammelstelle ist nicht erreichbar.');
  }
  if (response.status === 403) throw new SammelstelleError('Der Schlüssel im Link stimmt nicht.');
  if (!response.ok) throw new SammelstelleError(`Die Sammelstelle hat mit Fehler ${response.status} geantwortet.`);
  try {
    return parseAuswertung(await response.json());
  } catch {
    throw new SammelstelleError('Die Antwort der Sammelstelle war unlesbar.');
  }
}
