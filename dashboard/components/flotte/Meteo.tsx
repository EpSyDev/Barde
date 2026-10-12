// Pictogrammes météo et rose des vents, tracés en code.
import type { Meteo as M, Regles, Temps } from "@/lib/flotte";
import { DIRECTIONS } from "@/lib/flotte";

const PICTOS: Record<Temps, string> = {
  calme: "M12 7.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9ZM12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8",
  brise: "M3 9h11a2.5 2.5 0 1 0-2.5-2.5M3 13h15a2.5 2.5 0 1 1-2.5 2.5M3 17h8",
  vent_fort: "M2.5 7.5h12a2.5 2.5 0 1 0-2.5-2.5M2.5 11.5h17a2.5 2.5 0 1 1-2.5 2.5M2.5 15.5h9a2.5 2.5 0 1 1-2.5 2.5M14 19.5h6",
  brouillard: "M3 8h18M5 12h14M3 16h18M7 20h10",
  tempete: "M7 15.5H6a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 16.3 7 3.8 3.8 0 0 1 18 14.5M12.5 12l-2.5 4.5h3.5L11 21",
};

export function PictoTemps({ temps, taille = 20 }: { temps: Temps; taille?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={taille} height={taille} fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PICTOS[temps]} />
    </svg>
  );
}

/** Flèche du vent : elle pointe là où le vent pousse les navires. */
export function RoseDesVents({ vent, taille = 34 }: { vent: number; taille?: number }) {
  return (
    <svg viewBox="-20 -20 40 40" width={taille} height={taille} className="fl-rose" role="img"
      aria-label={`Vent soufflant vers le ${DIRECTIONS[vent]}`}>
      <circle r="17" fill="rgba(8,20,30,.6)" stroke="rgba(217,180,90,.55)" strokeWidth="1.2" />
      {[0, 1, 2, 3, 4, 5].map((d) => (
        <line key={d} x1={14 * Math.cos((-d * Math.PI) / 3)} y1={14 * Math.sin((-d * Math.PI) / 3)}
          x2={17 * Math.cos((-d * Math.PI) / 3)} y2={17 * Math.sin((-d * Math.PI) / 3)} stroke="rgba(217,180,90,.6)" strokeWidth="1" />
      ))}
      <g transform={`rotate(${-vent * 60})`}>
        <path d="M-11 0H6" stroke="#e9dcbc" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M12 0 3-6v12Z" fill="#f3d78e" />
        <path d="M-11 0-14-4M-11 0l-3 4M-7 0l-3-4M-7 0l-3 4" stroke="#e9dcbc" strokeWidth="1.4" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export function NomMeteo({ meteo, regles }: { meteo: M; regles: Regles }) {
  return <>{regles.temps[meteo.temps].nom} · vent vers le {DIRECTIONS[meteo.vent]}</>;
}
