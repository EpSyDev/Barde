import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiFetch } from "@/lib/api";

// Déplace une piste dans la file (dir = "up" | "down").
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ index: string; n: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { index, n } = await params;
  if (!/^\d+$/.test(index) || !/^\d+$/.test(n)) {
    return NextResponse.json({ error: "requête invalide" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const dir = body.dir === "up" || body.dir === "down" ? body.dir : null;
  if (!dir) return NextResponse.json({ error: "direction invalide" }, { status: 400 });

  try {
    const res = await apiFetch(`/api/slot/${index}/track/${n}/move`, {
      method: "POST",
      body: JSON.stringify({ dir }),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "bot injoignable" }, { status: 502 });
  }
}
