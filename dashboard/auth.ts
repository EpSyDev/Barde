import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";

// Liste blanche : seuls ces IDs Discord peuvent entrer (toi + le fonda).
const allowed = (process.env.ALLOWED_DISCORD_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      // L'URL doit être fournie explicitement : n'indiquer que `params` écrase
      // la chaîne par défaut du provider et casse `new URL` (Invalid URL).
      authorization: {
        url: "https://discord.com/api/oauth2/authorize",
        params: { scope: "identify" },
      },
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
