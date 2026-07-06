import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fripouilleFetch } from "@/lib/fripouille";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const res = await fripouilleFetch("/api/guild/roles");
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "bot injoignable" }, { status: 502 });
  }
}
