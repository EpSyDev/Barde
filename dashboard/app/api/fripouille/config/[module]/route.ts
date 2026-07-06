import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fripouilleFetch } from "@/lib/fripouille";

// Proxy générique vers /api/config/{module} de la Fripouille : une même route
// dessert tous les modules (autorole, et les suivants à venir).
const VALID = /^[a-z0-9_]+$/;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ module: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { module } = await params;
  if (!VALID.test(module)) {
    return NextResponse.json({ error: "module invalide" }, { status: 400 });
  }
  try {
    const res = await fripouilleFetch(`/api/config/${module}`);
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "bot injoignable" }, { status: 502 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ module: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { module } = await params;
  if (!VALID.test(module)) {
    return NextResponse.json({ error: "module invalide" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return NextResponse.json({ error: "corps invalide" }, { status: 400 });
  }
  try {
    const res = await fripouilleFetch(`/api/config/${module}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "bot injoignable" }, { status: 502 });
  }
}
