import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";

// Filet de sécurité Vercel : avec next-auth beta.25 + server actions, la
// détection automatique de l'hôte échoue (`new URL` → TypeError "Invalid URL"
// → erreur "Configuration" au login). On garantit une URL de base valide, sans
// dépendre d'aucune variable Vercel. Le local garde son AUTH_URL (.env.local).
if (!process.env.AUTH_URL) {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) {
    process.env.AUTH_URL = `https://${prod}`;
  } else if (process.env.VERCEL) {
    process.env.AUTH_URL = "https://taverne-ten.vercel.app";
  }
}

// Liste blanche : seuls ces IDs Discord peuvent entrer (toi + le fonda).
const allowed = (process.env.ALLOWED_DISCORD_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  debug: true,
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      authorization: { params: { scope: "identify" } },
    }),
  ],
  callbacks: {
    // Refuse toute connexion dont l'ID Discord n'est pas dans la liste blanche.
    async signIn({ profile }) {
      return !!profile && allowed.includes(String(profile.id));
    },
    async jwt({ token, profile }) {
      if (profile) token.discordId = String(profile.id);
      return token;
    },
    async session({ session, token }) {
      if (token.discordId) (session.user as any).discordId = token.discordId;
      return session;
    },
  },
  pages: { signIn: "/login" },
});
