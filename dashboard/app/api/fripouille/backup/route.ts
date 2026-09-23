import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fripouilleFetch, actorFrom } from "@/lib/fripouille";

// GET  : télécharge la configuration complète du bot (sauvegarde).
// POST : restaure une sauvegarde. Additive — un module absent du fichier est laissé
//        intact, et chaque module restauré repasse par le filtre de son schéma.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const res = await fripouilleFetch("/api/export");
    const data = await res.json().catch(() => ({}));
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(data, null, 2), {
      status: res.status,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="taverne-${stamp}.json"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "bot injoignable" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "sauvegarde illisible" }, { status: 400 });
  }
  try {
    const res = await fripouilleFetch("/api/import", {
      method: "POST",
      body: JSON.stringify(body),
      actor: actorFrom(session),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "bot injoignable" }, { status: 502 });
  }
}
