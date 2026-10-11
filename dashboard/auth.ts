import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { roleOf } from "@/lib/acces";

// Accès = ALLOWED_DISCORD_IDS (admins de secours) ∪ liste du module « Accès » du dashboard,
// chacun avec un rôle (admin | mj | joueur). Voir lib/acces.ts.
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      // Discord renvoie désormais un paramètre « iss » (RFC 9207) au retour OAuth ; sans
      // émetteur déclaré, Auth.js le compare à son défaut « https://authjs.dev » et refuse
      // la connexion (CallbackRouteError, page « Server error »).
      issuer: "https://discord.com",
      // L'URL doit être fournie explicitement : n'indiquer que `params` écrase
      // la chaîne par défaut du provider et casse `new URL` (Invalid URL).
      authorization: {
        url: "https://discord.com/api/oauth2/authorize",
        params: { scope: "identify" },
      },
    }),
  ],
  callbacks: {
    // Refuse toute connexion dont l'ID Discord n'a aucun rôle.
    async signIn({ profile }) {
      return !!profile && (await roleOf(String(profile.id))) !== null;
    },
    // Revérifié à chaque requête : retirer un accès coupe aussi les sessions déjà ouvertes
    // (au plus 30 s de latence, durée du cache de la liste).
    async jwt({ token, profile }) {
      if (profile) token.discordId = String(profile.id);
      const role = await roleOf(token.discordId as string | undefined);
      if (!role) return null;
      token.role = role;
      return token;
    },
    async session({ session, token }) {
      if (token.discordId) (session.user as any).discordId = token.discordId;
      if (token.role) (session.user as any).role = token.role;
      return session;
    },
  },
  pages: { signIn: "/login" },
});
