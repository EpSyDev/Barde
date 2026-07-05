export { auth as middleware } from "@/auth";

// Protège tout sauf : endpoints Auth.js, page de login, assets Next, favicon.
export const config = {
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)"],
};
