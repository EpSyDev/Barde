// Emblèmes des huit royaumes, générés en code (viewBox 24, remplissage « nonzero » : les
// trous sont tracés à contre-sens). Les mêmes tracés servent en SVG (interface) et en
// Path2D (navires sur la carte) : chaque camp se reconnaît à sa FORME, pas qu'à sa couleur.
import { PAVILLONS, type PavillonId } from "@/lib/flotte";

/** Cercle ; `trou` le trace à contre-sens pour l'évider. */
function rond(cx: number, cy: number, r: number, trou = false) {
  const s = trou ? 0 : 1;
  return `M${cx - r} ${cy}a${r} ${r} 0 1 ${s} ${2 * r} 0a${r} ${r} 0 1 ${s} ${-2 * r} 0Z`;
}

function etoile(cx: number, cy: number, n: number, ro: number, ri: number, rot = -Math.PI / 2) {
  const pts: string[] = [];
  for (let i = 0; i < 2 * n; i++) {
    const a = rot + (i * Math.PI) / n;
    const r = i % 2 ? ri : ro;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

function petales(cx: number, cy: number, n: number, dist: number, r: number) {
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    d += rond(cx + dist * Math.cos(a), cy + dist * Math.sin(a), r);
  }
  return d;
}

export const EMBLEMES: Record<PavillonId, string> = {
  // Crinière en étoile, face évidée, yeux et museau pleins.
  lion: etoile(12, 12, 12, 11, 8.4) + rond(12, 12.4, 6.2, true) + rond(9.7, 11.2, 1.1) + rond(14.3, 11.2, 1.1)
    + "M10.4 14.2h3.2L12 16.4Z",
  // Dôme, yeux évidés, quatre tentacules enroulées.
  kraken: "M4.5 12.5C4.5 5 19.5 5 19.5 12.5Z" + rond(9.4, 10, 1.3, true) + rond(14.6, 10, 1.3, true)
    + "M5.5 12C4 15 6 18 3 20.5l1.6.6C8 18.6 7 15.6 8.3 12Z"
    + "M9 12c-.6 3.5 1 6-1.2 9l1.6.3c2.4-3 1-6 2-9.3Z"
    + "M15 12c.6 3.5-1 6 1.2 9l-1.6.3c-2.4-3-1-6-2-9.3Z"
    + "M18.5 12c1.5 3-.5 6 2.5 8.5l-1.6.6C16 18.6 17 15.6 15.7 12Z",
  // Corbeau en vol, ailes déployées.
  corbeau: "M1.5 12.5 7.5 10 9.6 3.5l3 5.4 4.6-2.4h3.2l-2.6 2.2 2.2 1.1-3.6.6-2.6 2.7 2.2 7.4-4.9-5.5-4.6.9Z"
    + rond(17.2, 7.6, 0.6, true),
  // Rose : cinq pétales, cœur évidé, bouton plein.
  rose: petales(12, 12, 5, 4.6, 4.4) + rond(12, 12, 2.6, true) + rond(12, 12, 1.2),
  // Tête de loup : oreilles dressées, yeux évidés.
  loup: "M4 2.5 9 8h6l5-5.5-.8 9.5-3.7 6.3L12 21.5l-3.5-3.2L4.8 12Z"
    + "M8.4 11.6 8.8 13.6 10.8 12.5Z" + "M15.6 11.6 13.2 12.5 15.2 13.6Z",   // yeux à contre-sens : évidés
  // Soleil : disque et huit rais.
  soleil: rond(12, 12, 5.2) + etoile(12, 12, 8, 11.5, 5.5, -Math.PI / 2) + rond(12, 12, 3, true) + rond(12, 12, 1.6),
  // Ancre : anneau, jas, verge et pattes.
  ancre: rond(12, 4.6, 2.4) + rond(12, 4.6, 1.1, true) + "M7.5 8.4h9v1.7h-9Z"
    + "M11.1 7h1.8v12.1c2.6-.4 4.3-1.9 4.9-4l-1.7-.4 3.2-2.9 1.2 4.1-1.6-.4c-.9 3.6-3.6 6-6.9 6.1-3.3-.1-6-2.5-6.9-6.1l-1.6.4 1.2-4.1 3.2 2.9-1.7.4c.6 2.1 2.3 3.6 4.9 4Z",
  // Aile de dragon, griffue.
  dragon: "M2.5 20.5C4.6 12 9.4 5.8 21.5 2.5c-2.8 3-2.8 5.2-1.8 7.4-3-.2-4.4 1-4 3.4-3-.6-4.6.9-4.1 3.4-3-.6-5.6.9-9.1 3.8Z"
    + "M21.5 2.5 23 1l-.3 2.6Z",
};

export function Embleme({ id, taille = 18, className }: { id: PavillonId; taille?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={taille} height={taille} className={className} aria-hidden="true" focusable="false">
      <path d={EMBLEMES[id]} fill="currentColor" />
    </svg>
  );
}

/** Pavillon flottant : étamine à la couleur du royaume, emblème sombre, hampe dorée. */
export function Pavillon({ id, taille = 34, titre }: { id: PavillonId; taille?: number; titre?: boolean }) {
  const p = PAVILLONS[id];
  return (
    <svg viewBox="0 0 40 32" width={taille} height={(taille * 32) / 40} className="fl-pavillon" role="img"
      aria-label={`Pavillon ${p.nom}`}>
      {titre && <title>{`${p.nom} — ${p.royaume}`}</title>}
      <rect x="2" y="2" width="2.2" height="29" rx="1" fill="#c9a44a" />
      <path d="M4.2 3.5h30c-1.8 3.6-1.8 7.4 0 11 1.8 3.6 1.8 7.4 0 11h-30Z" fill={p.couleur} stroke={p.fonce} strokeWidth="1" />
      <path d="M4.2 3.5h30c-1.8 3.6-1.8 7.4 0 11" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="1.2" />
      <g transform="translate(9.6 4.6) scale(0.82)" fill={p.fonce}>
        <path d={EMBLEMES[id]} />
      </g>
    </svg>
  );
}
