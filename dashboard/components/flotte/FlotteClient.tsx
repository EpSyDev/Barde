"use client";

import dynamic from "next/dynamic";

const Flotte = dynamic(() => import("./Flotte"), {
  ssr: false,
  loading: () => <div className="fl-chargement">On hisse les voiles…</div>,
});

export default function FlotteClient() {
  return <Flotte />;
}
