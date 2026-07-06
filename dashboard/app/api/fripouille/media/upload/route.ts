import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

// Upload multipart : on relaie le fichier au bot en laissant fetch poser la
// frontière multipart (ne pas passer par fripouilleFetch qui force du JSON).
const BASE = process.env.FRIPOUILLE_API_BASE_URL || "";
const TOKEN = process.env.FRIPOUILLE_API_TOKEN || process.env.API_TOKEN || "";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "fichier manquant" }, { status: 400 });
  }
  const fwd = new FormData();
  fwd.append("file", file, file.name || "image");
  try {
    const res = await fetch(`${BASE}/api/media/upload`, {
      method: "POST",
      headers: { "X-Api-Token": TOKEN },
      body: fwd,
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "bot injoignable" }, { status: 502 });
  }
}
