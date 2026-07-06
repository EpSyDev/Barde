import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiFetch } from "@/lib/api";

// Retire une piste de la file d'un salon (index n dans la liste des pistes).
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ index: string; n: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { index, n } = await params;
  if (!/^\d+$/.test(index) || !/^\d+$/.test(n)) {
    return NextResponse.json({ error: "requête invalide" }, { status: 400 });
  }
  try {
    const res = await apiFetch(`/api/slot/${index}/track/${n}/remove`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "bot injoignable" }, { status: 502 });
  }
}
