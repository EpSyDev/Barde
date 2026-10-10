"use client";

import dynamic from "next/dynamic";

// Three.js / WebGL n'existent que dans le navigateur : pas de rendu serveur.
const PisteDes = dynamic(() => import("@/components/table/PisteDes"), {
  ssr: false,
  loading: () => <div className="piste-chargement">On installe la table…</div>,
});

export default function PisteDesClient() {
  return <PisteDes />;
}
