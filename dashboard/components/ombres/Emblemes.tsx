"use client";

// Blasons des rôles et des cartes Événement, dessinés en SVG (métal doré gravé, ombre
// portée, reflets) : aucun fichier image, net à toutes les tailles, recolorable par camp.

import { useId } from "react";
import type { CarteId, RoleId } from "@/lib/ombres";

type Props = { role: RoleId | "dos"; taille?: number; className?: string };

/** Dégradés partagés par un dessin (identifiants uniques par instance). */
function Defs({ id, nuit = false }: { id: string; nuit?: boolean }) {
  return (
    <defs>
      <linearGradient id={`${id}or`} x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0" stopColor="#fff2c4" />
        <stop offset="0.28" stopColor="#e8c169" />
        <stop offset="0.62" stopColor="#a87a2c" />
        <stop offset="1" stopColor="#5e3f12" />
      </linearGradient>
      <linearGradient id={`${id}fer`} x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#d9dde3" />
        <stop offset="0.5" stopColor="#7d8591" />
        <stop offset="1" stopColor="#363b44" />
      </linearGradient>
      <linearGradient id={`${id}bois`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#a86a34" />
        <stop offset="0.55" stopColor="#6e3f19" />
        <stop offset="1" stopColor="#3b1f0b" />
      </linearGradient>
      <radialGradient id={`${id}ombre`} cx="0.5" cy="0.45" r="0.6">
        <stop offset="0" stopColor={nuit ? "#d6c2ff" : "#c9a7ff"} />
        <stop offset="0.45" stopColor="#7b4fd0" />
        <stop offset="1" stopColor="#24103f" />
      </radialGradient>
      <radialGradient id={`${id}lueur`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#ffe9a8" stopOpacity="0.95" />
        <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
      </radialGradient>
      <filter id={`${id}relief`} x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1.6" stdDeviation="1.2" floodColor="#000" floodOpacity="0.55" />
      </filter>
    </defs>
  );
}

const TRAIT = "#2a1806";

function Dessin({ role, id }: { role: RoleId | "dos"; id: string }) {
  const or = `url(#${id}or)`, fer = `url(#${id}fer)`, bois = `url(#${id}bois)`, ombre = `url(#${id}ombre)`;
  const f = `url(#${id}relief)`;
  switch (role) {
    case "habitue":
      return (
        <g filter={f} stroke={TRAIT} strokeWidth="1.6" strokeLinejoin="round">
          <path d="M66 42h7q10 0 10 10v12q0 10-10 10h-7" fill="none" stroke={TRAIT} strokeWidth="9" />
          <path d="M66 42h7q10 0 10 10v12q0 10-10 10h-7" fill="none" stroke={or} strokeWidth="6" />
          <path d="M28 34h40v42q0 9-9 9H37q-9 0-9-9z" fill={bois} />
          <path d="M28 46h40M28 70h40" stroke={TRAIT} strokeWidth="5" />
          <path d="M28 46h40M28 70h40" stroke={or} strokeWidth="3" />
          <path d="M36 52v12M48 52v14M60 52v12" stroke="#2a1806" strokeOpacity="0.45" />
          <g fill="#fbf3dc" stroke="#cdbf9a" strokeWidth="1">
            <circle cx="33" cy="32" r="7" /><circle cx="44" cy="27" r="9" /><circle cx="56" cy="29" r="8" />
            <circle cx="65" cy="33" r="6" /><circle cx="50" cy="34" r="7" />
          </g>
          <path d="M66 33q4 6 2 12" stroke="#fbf3dc" strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
      );
    case "inquisiteur":
      return (
        <g filter={f}>
          <g stroke={or} strokeWidth="3.4" strokeLinecap="round">
            {Array.from({ length: 11 }, (_, i) => {
              const a = Math.PI * (0.08 + (0.84 * i) / 10);
              const c = Math.cos(a), s = Math.sin(a);
              return <line key={i} x1={50 - 30 * c} y1={52 - 30 * s} x2={50 - (i % 2 ? 38 : 43) * c} y2={52 - (i % 2 ? 38 : 43) * s} />;
            })}
          </g>
          <path d="M12 54Q50 18 88 54Q50 88 12 54Z" fill="#f6ecd2" stroke={TRAIT} strokeWidth="2" />
          <path d="M12 54Q50 18 88 54" fill="none" stroke={or} strokeWidth="3.5" />
          <circle cx="50" cy="54" r="15" fill="#3d6aa8" stroke={TRAIT} strokeWidth="1.6" />
          <circle cx="50" cy="54" r="15" fill="none" stroke="#9cc2f0" strokeWidth="2" strokeDasharray="2 2.5" />
          <circle cx="50" cy="54" r="7" fill="#0c0a10" />
          <circle cx="45" cy="49" r="3" fill="#fff" />
          <path d="M12 54Q50 88 88 54" fill="none" stroke={TRAIT} strokeWidth="2" />
        </g>
      );
    case "alchimiste":
      return (
        <g filter={f} stroke={TRAIT} strokeWidth="1.6">
          <rect x="43" y="10" width="14" height="9" rx="2" fill={bois} />
          <path d="M44 19h12v20q20 8 20 28a26 26 0 0 1-52 0q0-20 20-28z" fill="#e9f3f0" fillOpacity="0.35" />
          <clipPath id={`${id}liq`}><path d="M44 19h12v20q20 8 20 28a26 26 0 0 1-52 0q0-20 20-28z" /></clipPath>
          <g clipPath={`url(#${id}liq)`}>
            <path d="M20 62q15-7 30 0t30 0V100H20z" fill="#4fbf7a" />
            <path d="M20 62q15-7 30 0t30 0" fill="none" stroke="#b9f5cf" strokeWidth="2" />
            <circle cx="40" cy="78" r="3.4" fill="#d6ffe5" stroke="none" />
            <circle cx="55" cy="72" r="2.2" fill="#d6ffe5" stroke="none" />
            <circle cx="60" cy="84" r="4" fill="#d6ffe5" stroke="none" opacity="0.8" />
          </g>
          <path d="M44 19h12v20q20 8 20 28a26 26 0 0 1-52 0q0-20 20-28z" fill="none" stroke={TRAIT} strokeWidth="2.2" />
          <path d="M33 56q-4 8-2 18" fill="none" stroke="#fff" strokeOpacity="0.7" strokeWidth="3" strokeLinecap="round" />
          <path d="M42 39h16" stroke={or} strokeWidth="4" />
          <circle cx="72" cy="22" r="2.4" fill="#d6ffe5" stroke="none" />
          <circle cx="78" cy="14" r="1.6" fill="#d6ffe5" stroke="none" />
        </g>
      );
    case "paladin":
      return (
        <g filter={f}>
          <path d="M50 10L82 21V47Q82 76 50 91Q18 76 18 47V21Z" fill={fer} stroke={TRAIT} strokeWidth="2" />
          <path d="M50 16L76 25V47Q76 71 50 84Q24 71 24 47V25Z" fill="#2d4f86" stroke={or} strokeWidth="2.5" />
          <path d="M45 24h10v20h16v10H55v24H45V54H29V44h16z" fill={or} stroke={TRAIT} strokeWidth="1.5" />
          <path d="M28 27q8-4 14-5" stroke="#fff" strokeOpacity="0.55" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </g>
      );
    case "videur":
      return (
        <g filter={f} stroke={TRAIT} strokeWidth="1.6">
          <path d="M24 90V42Q24 14 50 14Q76 14 76 42V90Z" fill={bois} strokeWidth="2.2" />
          <path d="M37 18V90M50 14V90M63 18V90" stroke="#2a1806" strokeOpacity="0.55" />
          <path d="M24 38H76M24 72H76" stroke={TRAIT} strokeWidth="7" />
          <path d="M24 38H76M24 72H76" stroke={fer} strokeWidth="4.6" />
          <g fill={or} strokeWidth="1">
            {[30, 43, 57, 70].flatMap((x) => [38, 72].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.4" />))}
          </g>
          <circle cx="66" cy="56" r="6" fill="none" stroke={TRAIT} strokeWidth="5" />
          <circle cx="66" cy="56" r="6" fill="none" stroke={or} strokeWidth="2.8" />
          <path d="M20 90h60" stroke={TRAIT} strokeWidth="3" />
        </g>
      );
    case "tavernier":
      return (
        <g filter={f} stroke={TRAIT} strokeWidth="1.6">
          <path d="M27 18Q50 10 73 18Q83 50 73 82Q50 90 27 82Q17 50 27 18Z" fill={bois} strokeWidth="2.2" />
          <path d="M38 14Q33 50 38 86M50 12V88M62 14Q67 50 62 86" stroke="#2a1806" strokeOpacity="0.5" fill="none" />
          <path d="M23 30Q50 22 77 30M23 70Q50 78 77 70" fill="none" stroke={TRAIT} strokeWidth="7" />
          <path d="M23 30Q50 22 77 30M23 70Q50 78 77 70" fill="none" stroke={fer} strokeWidth="4.4" />
          <ellipse cx="50" cy="17" rx="23" ry="5" fill="#8a5426" />
          <rect x="44" y="47" width="12" height="8" rx="2" fill={or} />
          <path d="M50 55v9h-6" fill="none" stroke={or} strokeWidth="4" strokeLinecap="round" />
          <path d="M43 66q-1 4 0 6" stroke="#f0c34a" strokeWidth="3" strokeLinecap="round" fill="none" />
        </g>
      );
    case "cultiste":
      return (
        <g filter={f}>
          <path d="M50 8Q80 12 86 52Q88 78 80 92H20Q12 78 14 52Q20 12 50 8Z" fill="#24133d" stroke={TRAIT} strokeWidth="2" />
          <path d="M50 8Q80 12 86 52" fill="none" stroke={ombre} strokeWidth="3" />
          <path d="M50 30Q70 34 70 58Q68 80 50 82Q32 80 30 58Q30 34 50 30Z" fill="#06030c" />
          <ellipse cx="42" cy="58" rx="5" ry="2.6" fill="#c9a7ff" transform="rotate(12 42 58)" />
          <ellipse cx="58" cy="58" rx="5" ry="2.6" fill="#c9a7ff" transform="rotate(-12 58 58)" />
          <ellipse cx="42" cy="58" rx="9" ry="5" fill={ombre} opacity="0.35" />
          <ellipse cx="58" cy="58" rx="9" ry="5" fill={ombre} opacity="0.35" />
          <path d="M30 92Q36 72 50 70Q64 72 70 92" fill="none" stroke="#3b2266" strokeWidth="2" />
        </g>
      );
    case "voix":
      return (
        <g filter={f}>
          <circle cx="44" cy="50" r="30" fill={ombre} />
          <circle cx="56" cy="44" r="27" fill="#14091f" />
          <g fill="none" stroke="#c9a7ff" strokeLinecap="round">
            <path d="M66 36q7 10 0 20" strokeWidth="3.5" />
            <path d="M73 29q12 17 0 34" strokeWidth="3" opacity="0.75" />
            <path d="M80 22q17 24 0 48" strokeWidth="2.5" opacity="0.5" />
          </g>
          <path d="M18 66q4-3 6 0t6 0" fill="none" stroke="#e9dcff" strokeWidth="2" strokeLinecap="round" />
          <circle cx="30" cy="40" r="2.2" fill="#e9dcff" />
        </g>
      );
    case "barde":
      return (
        <g filter={f} stroke={TRAIT} strokeWidth="1.6">
          <path d="M57 44L72 12l7 3-13 32z" fill={bois} />
          <path d="M70 10l12 5-3 6-11-4z" fill={or} />
          <path d="M44 90Q16 88 18 62Q20 42 44 40Q68 42 70 62Q72 88 44 90Z" fill={bois} strokeWidth="2.2" transform="rotate(18 44 65)" />
          <circle cx="45" cy="64" r="8" fill="#1c0e04" stroke={or} strokeWidth="2" />
          <g stroke="#f6e7bd" strokeWidth="0.9">
            <path d="M40 78L72 16M43 79L75 17M46 80L78 18" />
          </g>
          <path d="M34 80l14 6" stroke={or} strokeWidth="3.4" strokeLinecap="round" />
          <g fill={or} stroke={TRAIT} strokeWidth="1">
            <path d="M18 24v14a4 4 0 1 1-2-3.4V20l10-3v4z" />
            <path d="M84 52v10a3.4 3.4 0 1 1-1.8-3V50z" />
          </g>
        </g>
      );
    case "ragequit":
      return (
        <g filter={f} stroke={TRAIT} strokeWidth="1.6">
          <g transform="rotate(-24 52 56)">
            <rect x="20" y="58" width="64" height="11" rx="2" fill={bois} strokeWidth="2" />
            <path d="M28 58V30M76 58V30M36 58V40M68 58V40" stroke={TRAIT} strokeWidth="6" strokeLinecap="round" />
            <path d="M28 58V30M76 58V30M36 58V40M68 58V40" stroke="#8a5426" strokeWidth="3.6" strokeLinecap="round" />
          </g>
          <g fill="none" stroke="#e2714f" strokeWidth="3" strokeLinecap="round">
            <path d="M10 70q6-2 9 2" /><path d="M8 80q7-1 10 3" /><path d="M14 60q5-3 8 0" />
          </g>
          <g transform="rotate(30 78 22)">
            <path d="M70 16h14v14q0 4-4 4h-6q-4 0-4-4z" fill={or} />
            <circle cx="77" cy="14" r="4" fill="#fbf3dc" stroke="#cdbf9a" />
          </g>
          <path d="M60 10l3 6M66 8l-1 7" stroke="#fbf3dc" strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case "dos":
    default:
      return (
        <g filter={f}>
          <path d={sceau(50, 50, 34, 30, 22)} fill="#7a1a14" stroke="#3a0905" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="24" fill="#8f2219" stroke="#5e0f09" strokeWidth="2" />
          <circle cx="50" cy="50" r="20" fill="none" stroke="#c7473a" strokeWidth="1" strokeDasharray="1.5 2.5" />
          <rect x="45" y="44" width="10" height="20" rx="1.5" fill="#5e0f09" />
          <path d="M50 30q6 7 0 13q-6-6 0-13z" fill="#5e0f09" />
          <path d="M60 36a9 9 0 1 0 0 12a7 7 0 1 1 0-12z" fill="#5e0f09" />
          <path d="M38 40q2-6 8-8" stroke="#e8857a" strokeOpacity="0.7" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      );
  }
}

/** Contour festonné d'un sceau de cire. */
function sceau(cx: number, cy: number, rMax: number, rMin: number, n: number) {
  let d = "";
  for (let i = 0; i <= n * 2; i++) {
    const a = (Math.PI * i) / n;
    const r = i % 2 ? rMin : rMax;
    d += `${i ? "L" : "M"}${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  }
  return d + "Z";
}

export function Embleme({ role, taille = 96, className }: Props) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 100 100" width={taille} height={taille} className={className} aria-hidden="true">
      <Defs id={id} />
      <Dessin role={role} id={id} />
    </svg>
  );
}

// ─────────────────────────── Cartes Événement ───────────────────────────
function DessinCarte({ carte, id }: { carte: CarteId; id: string }) {
  const or = `url(#${id}or)`;
  const f = `url(#${id}relief)`;
  const t = { fill: "none", stroke: or, strokeWidth: 4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (carte) {
    case "pleine_lune":
      return (
        <g filter={f}>
          <circle cx="50" cy="50" r="30" fill="url(#lunePleine)" />
          <defs>
            <radialGradient id="lunePleine" cx="0.4" cy="0.35" r="0.7">
              <stop offset="0" stopColor="#fffbe8" /><stop offset="0.7" stopColor="#e6dcc0" /><stop offset="1" stopColor="#a99a77" />
            </radialGradient>
          </defs>
          <circle cx="40" cy="42" r="6" fill="#cbbd98" /><circle cx="60" cy="58" r="8" fill="#cbbd98" /><circle cx="56" cy="36" r="3" fill="#cbbd98" />
          <path d="M14 84q10-12 20-4t18-6 18 4 16-6" {...t} stroke="#7b4fd0" strokeWidth={3} />
        </g>
      );
    case "tempete":
      return (
        <g filter={f}>
          <path d="M26 46a14 14 0 0 1 22-16a16 16 0 0 1 28 10a11 11 0 0 1-2 22H30a12 12 0 0 1-4-16z" fill="#5d6680" stroke="#2a2f40" strokeWidth="2" />
          <path d="M52 56l-12 18h11l-6 18 18-24H52l6-12z" fill={or} stroke="#5e3f12" strokeWidth="1.5" />
          <path d="M30 72l-3 7M70 70l-3 7M80 60l-3 7" stroke="#9fb7e6" strokeWidth="2.5" strokeLinecap="round" />
        </g>
      );
    case "brouillard":
      return (
        <g filter={f} {...t} stroke="#b9c4d6">
          <path d="M14 36q12-8 24 0t24 0 24 0" /><path d="M20 52q12-8 24 0t24 0 18 0" opacity="0.8" />
          <path d="M12 68q12-8 24 0t24 0 26 0" opacity="0.6" /><path d="M24 84q12-8 24 0t24 0" opacity="0.4" />
        </g>
      );
    case "lanterne":
      return (
        <g filter={f}>
          <circle cx="50" cy="58" r="26" fill={`url(#${id}lueur)`} />
          <path d="M42 18h16M50 12v6" {...t} />
          <path d="M36 26h28l-4 8H40z" fill={or} />
          <rect x="38" y="34" width="24" height="34" rx="3" fill="#ffd56b" fillOpacity="0.25" stroke={or} strokeWidth="3" />
          <path d="M50 42q6 8 0 16q-6-8 0-16z" fill="#ffb347" />
          <path d="M34 68h32l-3 8H37z" fill={or} />
        </g>
      );
    case "rumeur":
      return (
        <g filter={f}>
          <path d="M20 28h50q8 0 8 8v24q0 8-8 8H44l-14 12v-12H20q-8 0-8-8V36q0-8 8-8z" fill="#efe2c2" stroke="#5e3f12" strokeWidth="2" />
          <path d="M26 42h40M26 52h28" stroke="#8a6328" strokeWidth="3" strokeLinecap="round" />
          <path d="M82 22q6 6 0 12M88 16q10 12 0 24" {...t} strokeWidth={3} />
        </g>
      );
    case "biere":
      return (
        <g filter={f} stroke="#2a1806" strokeWidth="1.6">
          <path d="M28 34h36v42q0 8-8 8H36q-8 0-8-8z" fill="#5f7d2e" />
          <path d="M64 42h6q9 0 9 9v10q0 9-9 9h-6" fill="none" stroke={or} strokeWidth="5" />
          <g fill="#b6e07a" stroke="#4e6b1f" strokeWidth="1"><circle cx="34" cy="31" r="6" /><circle cx="45" cy="27" r="8" /><circle cx="57" cy="30" r="7" /></g>
          <circle cx="40" cy="60" r="3" fill="#d4f59a" stroke="none" /><circle cx="52" cy="70" r="2" fill="#d4f59a" stroke="none" />
          <path d="M42 46q4-4 8 0" fill="none" stroke="#1a2a08" strokeWidth="2.5" />
        </g>
      );
    case "couvre_feu":
      return (
        <g filter={f}>
          <path d="M50 14q4 0 4 4q16 4 16 24v18l6 8H24l6-8V42q0-20 16-24q0-4 4-4z" fill={or} stroke="#5e3f12" strokeWidth="2" />
          <circle cx="50" cy="76" r="5" fill="#8a6328" />
          <path d="M18 34q-4 10 0 20M82 34q4 10 0 20" fill="none" stroke="#e8c169" strokeWidth="3" strokeLinecap="round" />
        </g>
      );
    case "bulletins":
      return (
        <g filter={f}>
          <path d="M22 26h48q8 0 8 8v40H30q-8 0-8-8z" fill="#efe2c2" stroke="#5e3f12" strokeWidth="2" />
          <path d="M30 38h36M30 48h30M30 58h34" stroke="#b9a578" strokeWidth="2.5" strokeLinecap="round" />
          <path d={sceau(66, 70, 14, 12, 14)} fill="#8f2219" stroke="#5e0f09" strokeWidth="1" />
          <circle cx="66" cy="70" r="8" fill="none" stroke="#c7473a" strokeWidth="1.2" />
        </g>
      );
    case "calme":
    default:
      return (
        <g filter={f}>
          <path d="M62 20a30 30 0 1 0 18 46a24 24 0 1 1-18-46z" fill="#2c2a4a" stroke="#6b6aa0" strokeWidth="2" />
          <g fill="#e9dcff"><circle cx="26" cy="24" r="1.6" /><circle cx="78" cy="30" r="1.2" /><circle cx="70" cy="84" r="1.4" /><circle cx="18" cy="60" r="1" /></g>
        </g>
      );
  }
}

export function EmblemeCarte({ carte, taille = 72 }: { carte: CarteId; taille?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 100 100" width={taille} height={taille} aria-hidden="true">
      <Defs id={id} />
      <DessinCarte carte={carte} id={id} />
    </svg>
  );
}
