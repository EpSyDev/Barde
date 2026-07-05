import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiFetch } from "@/lib/api";

// Actions autorisées à être relayées vers le bot.
const ALLOWED = new Set([
  "play",
  "stop",
  "next",
  "pause",
  "resume",
  "shuffle",
  "clear",
  "add",
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ index: string; action: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { index, action } = await params;
  if (!/^\d+$/.test(index) || !ALLOWED.has(action)) {
    return NextResponse.json({ error: "requête invalide" }, { status: 400 });
  }

  let body: string | undefined;
  if (action === "add") {
    const json = await req.json().catch(() => ({}));
    const url = String(json.url || "").trim();
    if (!url) return NextResponse.json({ error: "url manquante" }, { status: 400 });
    body = JSON.stringify({ url });
  }

  try {
    const res = await apiFetch(`/api/slot/${index}/${action}`, { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "bot injoignable" }, { status: 502 });
  }
}
