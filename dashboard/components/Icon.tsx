// Jeu de pictogrammes au trait, dessinés pour la taverne : luth, blason, bourse,
// sceau, chandelle… Les emojis système ont chacun leur rendu et leurs couleurs — un
// menu qui en aligne douze ne peut pas avoir de style. Ici tout hérite de la couleur
// du texte (`currentColor`), donc tout suit la matière du conteneur.
//
// Tracé uniforme : viewBox 24, trait 1.5, extrémités arrondies. Ajouter un picto =
// une entrée dans PATHS, rien d'autre.

export type IconName =
  | "luth" | "blason" | "manette" | "plume" | "bourse" | "ticket" | "cor"
  | "chandelle" | "parchemin" | "cadre" | "capuche" | "engrenage" | "balance"
  | "registre" | "coffre" | "personnes" | "loupe" | "sceau" | "croix" | "check"
  | "alerte" | "fleche-droite" | "eclair" | "clepsydre" | "bouclier" | "telecharger"
  | "televerser" | "corbeille" | "oeil" | "gel" | "maison";

const PATHS: Record<IconName, string> = {
  // Ossature du menu
  maison: "M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5M9.5 20v-6h5v6",
  luth: "M14.5 3.5c1.6 1.6 1.6 4 0 5.6M9 9l6-6M9.5 10.5 7 13m-.8 7.2c-1.7-1.7-1.7-4.4 0-6.1a4.3 4.3 0 0 1 6.1 0c1.7 1.7 1.7 4.4 0 6.1a4.3 4.3 0 0 1-6.1 0Z",
  blason: "M12 3 4.5 5.5v6c0 4.4 3.1 8.3 7.5 9.5 4.4-1.2 7.5-5.1 7.5-9.5v-6L12 3Zm0 4.5v9M8 11h8",
  manette: "M7.5 8h9a4.5 4.5 0 0 1 4.4 5.4l-.7 3.4A2.6 2.6 0 0 1 15.9 18l-1.2-1.6h-5.4L8.1 18a2.6 2.6 0 0 1-4.3-1.2l-.7-3.4A4.5 4.5 0 0 1 7.5 8Zm-1 3.2v2.6m-1.3-1.3h2.6m8.2-.7h.01m2 2h.01",
  plume: "M4 20c6-1.5 9-4 11-7.5S18 4 18 4s-6 .5-9.5 3S5.5 14 4 20Zm2.5-2.5L12 12",
  bourse: "M9.5 6.5h5l1 2.5c2 1 3.5 3 3.5 5.5a5.5 5.5 0 0 1-5.5 5.5h-3A5.5 5.5 0 0 1 5 14.5c0-2.5 1.5-4.5 3.5-5.5l1-2.5Zm.5 0L9 3.5h6l-1 3M12 11v6m-1.8-4.4h3.1m-3.1 2.8h3.1",
  ticket: "M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5v2a2 2 0 0 0 0 3.8v2A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-2a2 2 0 0 0 0-3.8ZM13 7v2m0 3v1.5m0 3V18",
  cor: "M5 10.5c0-3 2.5-5 5.5-5 4 0 5.5 2.5 8.5 2.5V16c-3 0-4.5-2.5-8.5-2.5-3 0-5.5-2-5.5-3ZM8 14v5m-1.5 0h3",
  chandelle: "M12 3c1.5 1.8 1.5 3-.5 4 1.5.3 2 1.3 1.5 2.3M8.5 11h7v8a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 8.5 19v-8Zm0 3.5h7",
  parchemin: "M6 4h10.5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7.5a2 2 0 0 1-2-2V4Zm.5 16A2.5 2.5 0 0 1 4 17.5h3M9 8h6M9 11.5h6M9 15h3.5",
  cadre: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Zm1 11 4.5-4.5 3 3L15.5 13 19 16.5M9 9.5h.01",
  capuche: "M12 3c3.5 0 6 3 6 7l1.5 5.5c-2 2.5-4.5 3.5-7.5 3.5s-5.5-1-7.5-3.5L6 10c0-4 2.5-7 6-7Zm-2.5 9.5h.01m5 0h.01M9 17c1.8 1.2 4.2 1.2 6 0",
  engrenage: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm7.5 3c0-.5 0-1-.1-1.4l1.8-1.3-1.8-3-2.1.8a7.4 7.4 0 0 0-2.4-1.4L14.5 3.5h-5l-.4 2.2a7.4 7.4 0 0 0-2.4 1.4l-2.1-.8-1.8 3 1.8 1.3a7.6 7.6 0 0 0 0 2.8l-1.8 1.3 1.8 3 2.1-.8c.7.6 1.5 1.1 2.4 1.4l.4 2.2h5l.4-2.2a7.4 7.4 0 0 0 2.4-1.4l2.1.8 1.8-3-1.8-1.3c.1-.4.1-.9.1-1.4Z",
  // Modération & suivi
  balance: "M12 4v16m-4 0h8M12 6.5 5 9m7-2.5L19 9M5 9l-2.5 5.5a3 3 0 0 0 5 0L5 9Zm14 0-2.5 5.5a3 3 0 0 0 5 0L19 9Z",
  bouclier: "M12 3.5 5 6v5.5c0 4.2 2.9 7.9 7 9 4.1-1.1 7-4.8 7-9V6l-7-2.5Zm-2.5 8.7 1.9 1.9 3.6-3.7",
  registre: "M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5Zm3 0v16M11 8h5m-5 3.5h5M11 15h3",
  coffre: "M3.5 10.5A3.5 3.5 0 0 1 7 7h10a3.5 3.5 0 0 1 3.5 3.5V19h-17v-8.5Zm0 0h17M12 7V4.5m-1.5 8h3v3h-3v-3Z",
  personnes: "M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11Zm-6 8.5c0-3 2.7-5 6-5s6 2 6 5m.5-14.3a3.2 3.2 0 0 1 0 6.2m2 2.4c2.2.6 3.5 2.2 3.5 4.2",
  gel: "M12 3v18m0-18 2.5 2.5M12 3 9.5 5.5m2.5 15.5 2.5-2.5M12 21l-2.5-2.5M3.8 7.5l15.6 9M3.8 7.5l.9 3.4m-.9-3.4 3.4-.9m12.2 9.9-3.4.9m3.4-.9-.9-3.4M3.8 16.5l15.6-9M3.8 16.5l3.4.9m-3.4-.9.9-3.4M19.4 7.5l-.9 3.4m.9-3.4-3.4-.9",
  clepsydre: "M7 3.5h10M7 20.5h10M8 3.5v3.2c0 2 4 3.9 4 5.3s-4 3.3-4 5.3v3.2m8-17v3.2c0 2-4 3.9-4 5.3s4 3.3 4 5.3v3.2",
  // Actions
  loupe: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4.5 4.5",
  sceau: "M12 3.5 14.3 8l5 .7-3.6 3.5.9 4.9-4.6-2.4-4.6 2.4.9-4.9L4.7 8.7l5-.7L12 3.5Z",
  croix: "M6 6l12 12M18 6 6 18",
  check: "M5 12.5 10 17.5 19 7",
  alerte: "M12 4.5 2.8 20h18.4L12 4.5Zm0 5.5v5m0 2.5h.01",
  "fleche-droite": "M4 12h15m-5.5-5.5L19.5 12l-6 5.5",
  eclair: "M13.5 3 5 13.5h6L10.5 21l8.5-10.5h-6L13.5 3Z",
  telecharger: "M12 3.5v11m0 0 4-4m-4 4-4-4M4.5 17v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2",
  televerser: "M12 14.5v-11m0 0 4 4m-4-4-4 4M4.5 17v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2",
  corbeille: "M4.5 6.5h15M9 6.5V4h6v2.5M6.5 6.5 7.5 20a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-13.5M10 10.5v6.5m4-6.5v6.5",
  oeil: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 2.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z",
};

export default function Icon({
  name,
  size,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
