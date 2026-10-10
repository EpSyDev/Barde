"use client";

import dynamic from "next/dynamic";

const Plateau = dynamic(() => import("@/components/table/Plateau"), {
  ssr: false,
  loading: () => <div className="piste-chargement">On déroule la carte…</div>,
});

export default function PlateauClient() {
  return <Plateau />;
}
