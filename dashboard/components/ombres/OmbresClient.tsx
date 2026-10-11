"use client";

import dynamic from "next/dynamic";

const Ombres = dynamic(() => import("./Ombres"), {
  ssr: false,
  loading: () => <div className="om-chargement">On allume les chandelles…</div>,
});

/** ``scene`` absent = page joueur ; présent (même vide si la clé est invalide) = vue de scène. */
export default function OmbresClient({ scene }: { scene?: string }) {
  return <Ombres scene={scene} />;
}
