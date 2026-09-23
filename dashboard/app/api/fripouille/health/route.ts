import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fripouilleFetch } from "@/lib/fripouille";
import { apiFetch } from "@/lib/api";

// État des deux bots en un appel : la pastille de l'en-tête interroge ceci toutes les
// 20 s. Un bot injoignable n'est pas une erreur de la route — c'est l'information.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [fripouille, barde] = await Promise.all([
    fripouilleFetch("/api/health")
      .then(async (r) => (r.ok ? { en_ligne: true, ...(await r.json()) } : { en_ligne: false }))
      .catch(() => ({ en_ligne: false })),
    apiFetch("/api/state")
      .then(async (r) => {
        if (!r.ok) return { en_ligne: false };
        const data = await r.json();
        const slots = Array.isArray(data.slots) ? data.slots : [];
        return {
          en_ligne: true,
          salons: slots.length,
          a_l_antenne: slots.filter((s: { playing?: boolean }) => s.playing).length,
        };
      })
      .catch(() => ({ en_ligne: false })),
  ]);

  return NextResponse.json({ fripouille, barde });
}
