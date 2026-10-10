// Tuiles SVG de la météo du plateau (pluie, neige, braises), répétées et animées en CSS
// sur deux couches à vitesses différentes pour donner de la profondeur. Positions
// pseudo-aléatoires mais fixes (graine) : le motif ne « saute » pas d'un rendu à l'autre.

function alea(graine: number) {
  let s = graine;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function tuile(contenu: string, t = 220) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${t}" height="${t}" viewBox="0 0 ${t} ${t}">${contenu}</svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

const r1 = alea(7), r2 = alea(13), r3 = alea(29);

export const TUILES: Record<string, string> = {
  pluie: tuile(
    Array.from({ length: 16 }, () => {
      const x = r1() * 220, y = r1() * 220, l = 18 + r1() * 16;
      return `<line x1="${x}" y1="${y}" x2="${x - l * 0.22}" y2="${y + l}" stroke="rgb(205,220,245)" stroke-opacity="${0.35 + r1() * 0.35}" stroke-width="1.3" stroke-linecap="round"/>`;
    }).join("")
  ),
  neige: tuile(
    Array.from({ length: 26 }, () =>
      `<circle cx="${r2() * 220}" cy="${r2() * 220}" r="${0.8 + r2() * 2.4}" fill="white" fill-opacity="${0.55 + r2() * 0.4}"/>`
    ).join("")
  ),
  braises: tuile(
    Array.from({ length: 9 }, () => {
      const x = r3() * 220, y = r3() * 220, r = 1 + r3() * 1.8;
      return `<circle cx="${x}" cy="${y}" r="${r * 2.6}" fill="rgb(255,140,40)" fill-opacity="0.18"/><circle cx="${x}" cy="${y}" r="${r}" fill="rgb(255,200,110)"/>`;
    }).join("")
  ),
};
