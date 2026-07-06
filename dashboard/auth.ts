import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";

// Filet de sécurité Vercel : avec next-auth beta + server actions, la détection
// automatique de l'hôte échoue parfois (`new URL` → erreur "Configuration").
// On garantit une URL de base valide en prod ; le local garde son AUTH_URL.
if (!process.env.AUTH_URL && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
  process.env.AUTH_URL = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
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
