import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fripouilleFetch } from "@/lib/fripouille";

// Proxy générique vers /api/action/{module}/{action} de la Fripouille (actions
// ponctuelles : ex. envoi immédiat d'un message).
const VALID = /^[a-z0-9_]+$/;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ module: string; action: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { module, action } = await params;
  if (!VALID.test(module) || !VALID.test(action)) {
    return NextResponse.json({ error: "requête invalide" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return NextResponse.json({ error: "corps invalide" }, { status: 400 });
  }
  try {
    const res = await fripouilleFetch(`/api/action/${module}/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "bot injoignable" }, { status: 502 });
  }
}
