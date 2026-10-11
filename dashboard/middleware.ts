import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Les routes vérifient elles-mêmes qu'une session existe ; ce middleware ajoute la
// séparation des rôles : un MJ ou un joueur n'accède qu'à la table de jeu (dés + plateau),
// jamais au panneau d'administration ni à ses API. /api/game a sa propre auth (public).
export default auth((req) => {
  const role = (req.auth?.user as { role?: string } | undefined)?.role;
  if (!req.auth || role === "admin") return;
  const p = req.nextUrl.pathname;
  if (p.startsWith("/table") || p.startsWith("/api/table") || p.startsWith("/api/game")) return;
  // Le MJ illustre ses aventures (documents, cartes) : médiathèque autorisée.
  if (role === "mj" && p.startsWith("/api/fripouille/media")) return;
  if (p.startsWith("/api/")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.redirect(new URL("/table", req.url));
});

// Protège tout sauf : endpoints Auth.js, page de login, assets Next, favicon.
export const config = {
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)"],
};
