import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Les routes vérifient elles-mêmes qu'une session existe ; ce middleware ajoute la
// séparation des rôles : un MJ ou un joueur n'accède qu'aux tables de jeu (plateau D&D,
// Ombres, Flottes Royales), jamais au panneau d'administration ni à ses API ; un convive
// (tout membre du serveur) n'a que les Ombres et les Flottes. /api/game a sa propre auth (public).
const FICHIER_PUBLIC = /\/[^/]+\.(webp|png|jpe?g|svg|ico|gif|mp3|ogg|woff2?)$/i;

export default auth((req) => {
  const role = (req.auth?.user as { role?: string } | undefined)?.role;
  if (!req.auth || role === "admin") return;
  const p = req.nextUrl.pathname;
  if (FICHIER_PUBLIC.test(p)) return;          // images de /public (cartes du plateau…) : publiques
  if (p.startsWith("/ombres") || p.startsWith("/api/ombres")) return;
  if (p.startsWith("/flotte") || p.startsWith("/api/flotte")) return;
  if (role === "convive") {
    if (p.startsWith("/api/")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return NextResponse.redirect(new URL("/ombres", req.url));
  }
  if (p.startsWith("/table") || p.startsWith("/api/table") || p.startsWith("/api/game")) return;
  // Le MJ illustre ses aventures (documents, cartes) : médiathèque autorisée.
  if (role === "mj" && p.startsWith("/api/fripouille/media")) return;
  if (p.startsWith("/api/")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.redirect(new URL("/table", req.url));
});

// Protège tout sauf : endpoints Auth.js, page de login, vue de scène des Ombres (lien de
// stream, protégée par sa clé côté bot), assets Next, favicon.
export const config = {
  matcher: ["/((?!api/auth|login|ombres/scene|_next/static|_next/image|favicon.ico).*)"],
};
