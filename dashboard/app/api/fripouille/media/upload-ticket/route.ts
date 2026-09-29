import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fripouilleFetch } from "@/lib/fripouille";

// Délivre un ticket d'upload à usage unique : le fichier part ensuite directement du
// navigateur vers le Funnel (voir Media.tsx), en contournant la limite de taille de
// requête des fonctions serverless Vercel qui bloquerait un audio de quelques Mo.
export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const res = await fripouilleFetch("/api/media/upload-ticket", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "bot injoignable" }, { status: 502 });
  }
}
