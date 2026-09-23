import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fripouilleFetch } from "@/lib/fripouille";

// Journal d'audit de la configuration : qui a changé quoi, et depuis quelle valeur.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = req.nextUrl.searchParams.get("limit") || "100";
  const module = req.nextUrl.searchParams.get("module") || "";
  const qs = new URLSearchParams({ limit, ...(module ? { module } : {}) });
  try {
    const res = await fripouilleFetch(`/api/audit?${qs}`);
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "bot injoignable" }, { status: 502 });
  }
}
