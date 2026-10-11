// Écu héraldique d'un quartier du menu : champ émaillé, partition (parti, écartelé,
// chevron…), hachures de Petra Sancta — la convention de gravure qui code chaque émail
// en noir et blanc (azur = traits horizontaux, gueules = verticaux, sinople = diagonale
// dextre, pourpre = diagonale senestre, or = pointillé, sable = quadrillé) —, bordure
// d'or en relief, lustre, et le **meuble** : une pièce pleine, cernée de sable, au métal
// choisi selon la règle héraldique (jamais métal sur métal ni couleur sur couleur).
import type { Hachure, Quartier } from "@/lib/sections";

const ECU = "M3 3h38v20c0 15-9 23-19 27C12 46 3 38 3 23z";

const METAUX = {
  or: ["#fff3c4", "#e8c35c", "#9a7424"],
  argent: ["#ffffff", "#e3e1da", "#9c9a92"],
  sable: ["#5a5148", "#2a241f", "#0d0a08"],
  gueules: ["#ff9a7e", "#c23a28", "#5e140c"],
} as const;

function hachures(id: string, h: Hachure) {
  const trait = { stroke: "rgba(20,10,0,.22)", strokeWidth: 0.7 };
  const motif = {
    azur: <path d="M0 2h4" {...trait} />,
    gueules: <path d="M2 0v4" {...trait} />,
    sinople: <path d="M0 0l4 4M-1 3l2 2M3-1l2 2" {...trait} />,
    pourpre: <path d="M4 0 0 4M5 3l-2 2M1-1l-2 2" {...trait} />,
    or: <circle cx="2" cy="2" r=".55" fill="rgba(60,30,0,.3)" />,
    sable: <path d="M0 2h4M2 0v4" {...trait} />,
  }[h];
  return (
    <pattern id={`h-${id}`} width="4" height="4" patternUnits="userSpaceOnUse">
      {motif}
    </pattern>
  );
}

function piece(q: Quartier) {
  const f = q.piece;
  switch (q.partition) {
    case "bordure":
      return <path d={ECU} fill="none" stroke={f} strokeWidth={7} />;
    case "parti":
      return <rect x="22" y="0" width="22" height="52" fill={f} />;
    case "ecartele":
      return <><rect x="22" y="0" width="22" height="26" fill={f} /><rect x="0" y="26" width="22" height="26" fill={f} /></>;
    case "chevron":
      return <path d="M0 42 L22 19 L44 42 L44 32 L22 9 L0 32z" fill={f} />;
    case "besants":
      return <>{[[10, 11], [34, 11], [10, 37], [34, 37]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="3.2" fill={f} />)}</>;
    case "bande":
      return <path d="M-4 7 L8 -5 L48 41 L36 52z" fill={f} />;
    case "fasce":
      return <>{[9, 21, 33, 45].map((y) => <rect key={y} x="0" y={y} width="44" height="5" fill={f} />)}</>;
  }
}

/** Meubles : silhouettes pleines dessinées pour l'écu (repère 24×24, centrées). */
function meuble(nom: string, metal: string, ombre: string) {
  const plein = { fill: metal, stroke: "#1a0e04", strokeWidth: 0.75, strokeLinejoin: "round" as const };
  const detail = { fill: "none", stroke: ombre, strokeWidth: 0.8, strokeLinecap: "round" as const };
  switch (nom) {
    case "flamme": // flamme vive
      return <>
        <path {...plein} d="M12 1.8c.6 3.4 3.6 5 5.2 8.2 1.6 3.3.9 7.6-2.2 9.6-1.7 1.1-3.6 1.5-5.6 1.1-3.3-.7-5.5-3.6-5.3-7 .2-2.6 1.7-4.3 2.9-5.6.1 1.8.7 3 1.8 3.7-.4-3.6.9-6.9 3.2-10Z" />
        <path fill={ombre} opacity=".55" d="M12.2 11.2c1.6 1.7 3 3.3 2.6 5.6-.3 1.5-1.5 2.6-3 2.7-1.7.1-3-1.2-3-2.8 0-1.4.9-2.3 1.7-3.1.2.9.6 1.4 1.2 1.7-.2-1.5 0-2.8.5-4.1Z" />
      </>;
    case "manette": // manette de jeu
      return <>
        <path {...plein} d="M7.2 7.5h9.6c2.3 0 4.2 1.7 4.6 4l.8 4.6c.3 1.9-1.9 3.2-3.4 2l-2.6-2.1H7.8l-2.6 2.1c-1.5 1.2-3.7-.1-3.4-2l.8-4.6c.4-2.3 2.3-4 4.6-4Z" />
        <path {...detail} d="M7 10.6v3M5.5 12.1h3" strokeWidth={1.3} />
        <circle cx="16" cy="11" r=".95" fill={ombre} /><circle cx="17.9" cy="12.9" r=".95" fill={ombre} />
      </>;
    case "de": // dé à vingt faces
      return <>
        <path {...plein} d="M12 1.8 21 7v10l-9 5.2L3 17V7l9-5.2Z" />
        <path {...detail} d="M12 6.5 16.8 15H7.2L12 6.5Zm0 0V1.8M7.2 15 3 17m13.8-2L21 17M12 6.5 3 7m9-.5L21 7M7.2 15l4.8 7.2m4.8-7.2L12 22.2" />
      </>;
    case "cor": // huchet (cor de chasse) lié
      return <>
        <path {...plein} d="M2.5 8.5c4.5.3 8 1.1 11.5 3.2l5.6-4.4c.8-.6 1.9 0 1.9 1v8.4c0 1-1.1 1.6-1.9 1L14 13.3c-3.5 2.1-7 2.9-11.5 3.2Z" />
        <path {...detail} d="M5.5 9.6v5.8M14 11.7v1.6" />
        <path fill="none" stroke="#1a0e04" strokeWidth="1.1" d="M6 9.3c1.5-4 6-4.8 8.5-2" />
      </>;
    case "bourse": // bourse liée, pleine d'écus
      return <>
        <path {...plein} d="M9.2 3.5h5.6l-1.1 2.9c3.4 1.2 5.8 4.4 5.8 8.1 0 4-3.1 6.5-7.5 6.5s-7.5-2.5-7.5-6.5c0-3.7 2.4-6.9 5.8-8.1L9.2 3.5Z" />
        <path {...detail} d="M8.6 7.2c2.2.7 4.6.7 6.8 0M12 10.5v6.3m-1.8-4.8h2.6a1 1 0 0 1 0 2h-1.6a1 1 0 0 0 0 2h2.6" />
      </>;
    case "epees": // deux épées en sautoir
      return <>
        {[-42, 42].map((a) => (
          <g key={a} transform={`rotate(${a} 12 12)`}>
            <path {...plein} d="M11.2 1.5h1.6l.5 13.3h-2.6l.5-13.3Z" />
            <path {...plein} d="M7.5 14.6h9v1.8h-9z" />
            <path {...plein} d="M11.3 16.4h1.4v3.8h-1.4z" />
            <circle {...plein} cx="12" cy="21.1" r="1.25" />
          </g>
        ))}
      </>;
    case "marteau": // marteau de forgeron posé en barre
      return <g transform="rotate(-35 12 12)">
        <path {...plein} d="M10.9 9.5h2.2V22h-2.2z" />
        <path {...plein} d="M4.5 4.3h12.2l2.8 1.9v3.6H4.5z" />
        <path {...detail} d="M8 4.3v5.5" />
      </g>;
    default:
      return null;
  }
}

export default function Blason({ q, taille = 44 }: { q: Quartier; taille?: number }) {
  const id = q.id;
  const [clair, moyen, sombre] = METAUX[q.teinte];
  return (
    <span className="blason" style={{ width: taille, height: (taille * 52) / 44 }}>
      <svg viewBox="0 0 44 52" aria-hidden="true">
        <defs>
          <clipPath id={`c-${id}`}><path d={ECU} /></clipPath>
          {hachures(id, q.hachure)}
          <linearGradient id={`l-${id}`} x1="0" y1="0" x2=".35" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".42" />
            <stop offset=".42" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity=".38" />
          </linearGradient>
          <linearGradient id={`o-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fbe7a6" />
            <stop offset=".45" stopColor="#c9a44a" />
            <stop offset=".7" stopColor="#8a6c29" />
            <stop offset="1" stopColor="#e9cf86" />
          </linearGradient>
          <linearGradient id={`m-${id}`} x1="0" y1="0" x2=".4" y2="1">
            <stop offset="0" stopColor={clair} />
            <stop offset=".5" stopColor={moyen} />
            <stop offset="1" stopColor={sombre} />
          </linearGradient>
          <filter id={`f-${id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy=".8" stdDeviation=".6" floodColor="#000" floodOpacity=".55" />
          </filter>
        </defs>
        <g clipPath={`url(#c-${id})`}>
          <rect width="44" height="52" fill={q.couleur} />
          <rect width="44" height="52" fill={`url(#h-${id})`} />
          {piece(q)}
          <rect width="44" height="52" fill={`url(#l-${id})`} />
        </g>
        <g transform="translate(9.2 10) scale(1.07)" filter={`url(#f-${id})`}>
          {meuble(q.meuble, `url(#m-${id})`, sombre)}
        </g>
        <g clipPath={`url(#c-${id})`}>
          <rect className="blason-reflet" x="-30" y="-10" width="12" height="80" fill="#fff" opacity=".3" transform="rotate(25)" />
        </g>
        <path d={ECU} fill="none" stroke="rgba(0,0,0,.55)" strokeWidth="3.2" />
        <path d={ECU} fill="none" stroke={`url(#o-${id})`} strokeWidth="2.2" />
      </svg>
    </span>
  );
}
