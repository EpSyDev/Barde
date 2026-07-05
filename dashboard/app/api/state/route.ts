import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiFetch } from "@/lib/api";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const res = await apiFetch("/api/state");
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "bot injoignable" }, { status: 502 });
  }
}
