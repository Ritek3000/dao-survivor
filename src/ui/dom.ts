/** Kleine Helfer für die Oberfläche, die HUD und Menüs gemeinsam nutzen. */

/** Holt ein Element aus index.html; fehlt es, bricht der Start mit einer klaren Meldung ab. */
export function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Element #${id} fehlt in index.html.`);
  return found as T;
}

/** Ein `<span>` mit Klasse und Text, etwa für die Teile einer Karte. */
export function span(className: string, text: string): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}
