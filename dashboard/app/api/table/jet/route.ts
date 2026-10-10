import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fripouilleFetch, actorFrom } from "@/lib/fripouille";

// Piste de dés 3D : le tirage est fait par La Fripouille (même moteur que /d sur
// Discord). Le navigateur ne reçoit que le résultat à animer.
const EXPR = /^[0-9d+\-%]{1,60}$/i;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const expr = String(body?.expr ?? "").replace(/\s/g, "");
  if (!EXPR.test(expr)) return NextResponse.json({ error: "jet invalide" }, { status: 400 });
  try {
    const res = await fripouilleFetch("/api/action/des/jet", {
      method: "POST",
      body: JSON.stringify({
        expr,
        raison: String(body?.raison ?? "").slice(0, 60),
        critique: !!body?.critique,
      }),
      actor: actorFrom(session),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error("table/jet", e);
    return NextResponse.json({ error: "bot injoignable" }, { status: 502 });
  }
}
