# Régie des Bardes — Dashboard

Interface web (Next.js) pour piloter les radios de la Taverne du Gaming.
Thème taverne, connexion Discord restreinte, proxy serveur vers l'API du bot.

## Architecture

```
Navigateur ──HTTPS──> Vercel (Next.js)
                         │  routes /api/* (serveur, injectent le token)
                         ▼
              Tailscale Funnel (HTTPS)
                         ▼
              API aiohttp du bot (VM Oracle, 127.0.0.1:8080)
```

Le token de l'API reste **côté serveur Vercel** : il n'est jamais exposé au navigateur.

## Déploiement Vercel

1. **Importer le repo** sur Vercel → *Add New Project* → sélectionner `Barde`.
2. **Root Directory** : `dashboard` (bouton *Edit* à côté du repo).
3. **Variables d'environnement** (Settings → Environment Variables), cf. `.env.example` :
   - `API_BASE_URL` = `https://barde.tail2985e8.ts.net`
   - `API_TOKEN` = le token du `.env` du bot
   - `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` = app Discord réutilisée
   - `ALLOWED_DISCORD_IDS` = vos deux IDs Discord, séparés par une virgule
   - `AUTH_SECRET` = `openssl rand -base64 32` (ou `npx auth secret`)
4. **Déployer.** Vercel donne une URL `https://barde-dashboard-xxx.vercel.app`.
5. **Discord Developer Portal** → l'app réutilisée → *OAuth2* → *Redirects* → ajouter :
   `https://<ton-url-vercel>/api/auth/callback/discord`

## Dév local

```bash
cp .env.example .env.local   # remplir les valeurs
npm install
npm run dev                  # http://localhost:3000
```

Pour l'OAuth en local, ajouter aussi `http://localhost:3000/api/auth/callback/discord`
dans les redirects Discord.
