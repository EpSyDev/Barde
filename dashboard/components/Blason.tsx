// Écu héraldique d'un quartier du menu : champ émaillé, partition (parti, écartelé,
// chevron…), hachures de Petra Sancta — la convention de gravure qui code chaque émail
// en noir et blanc (azur = traits horizontaux, gueules = verticaux, sinople = diagonale
// dextre, pourpre = diagonale senestre, or = pointillé, sable = quadrillé) —, bordure
// d'or en relief, lustre, et le meuble (picto) au centre.
import Icon from "@/components/Icon";
import type { Hachure, Quartier } from "@/lib/sections";

const ECU = "M3 3h38v20c0 15-9 23-19 27C12 46 3 38 3 23z";

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
      return <>{[[12, 13], [32, 13], [22, 26], [12, 37], [32, 37]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="3.4" fill={f} />)}</>;
    case "bande":
      return <path d="M-4 7 L8 -5 L48 41 L36 52z" fill={f} />;
    case "fasce":
      return <>{[9, 21, 33, 45].map((y) => <rect key={y} x="0" y={y} width="44" height="5" fill={f} />)}</>;
  }
}

export default function Blason({ q, taille = 44 }: { q: Quartier; taille?: number }) {
  const id = q.id;
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
        </defs>
        <g clipPath={`url(#c-${id})`}>
          <rect width="44" height="52" fill={q.couleur} />
          <rect width="44" height="52" fill={`url(#h-${id})`} />
          {piece(q)}
          <rect width="44" height="52" fill={`url(#l-${id})`} />
          <rect className="blason-reflet" x="-30" y="-10" width="12" height="80" fill="#fff" opacity=".35" transform="rotate(25)" />
        </g>
        <path d={ECU} fill="none" stroke="rgba(0,0,0,.55)" strokeWidth="3.2" />
        <path d={ECU} fill="none" stroke={`url(#o-${id})`} strokeWidth="2.2" />
      </svg>
      <span className="blason-meuble">
        <Icon name={q.meuble} />
      </span>
    </span>
  );
}
