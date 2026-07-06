import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiFetch } from "@/lib/api";

// Bascule une piste du salon {index} vers le salon {dst}.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ index: string; n: string; dst: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { index, n, dst } = await params;
  if (![index, n, dst].every((v) => /^\d+$/.test(v))) {
    return NextResponse.json({ error: "requête invalide" }, { status: 400 });
  }
  try {
    const res = await apiFetch(`/api/slot/${index}/track/${n}/to/${dst}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "bot injoignable" }, { status: 502 });
  }
}
