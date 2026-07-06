// Images intégrées à l'app (dossier public/), toujours dispo dans la bibliothèque
// et servies par Vercel à une URL publique que Discord peut charger. Non supprimables.
export type MediaItem = { name: string; url: string; size?: number; builtin?: boolean };

const PUBLIC_BASE = "https://taverne-ten.vercel.app";

export const BUILTIN_MEDIA: MediaItem[] = [
  { name: "logo1.webp", url: `${PUBLIC_BASE}/logo1.webp`, builtin: true },
  { name: "Taverniers.webp", url: `${PUBLIC_BASE}/Taverniers.webp`, builtin: true },
];
