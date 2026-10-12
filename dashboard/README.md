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

## Guerre des Flottes Royales (`/flotte`)

Bataille navale multijoueur de la taverne : 2 à 8 capitaines (bots d'entraînement possibles),
tours simultanés sur une carte hexagonale générée par graine, vent et météo, brouillard de
guerre. Ouverte à tout membre du serveur Discord (rôle « convive » compris), comme `/ombres`.

```
Navigateur ──session Discord──> Vercel  POST /api/flotte/ticket (token API jamais exposé)
    │                                   │
    │  flux SSE  GET  /api/flotte/flux?ticket=…[&salon=…]   (vue filtrée pour CE capitaine)
    └─ gestes    POST /api/flotte/op   (en-tête X-Flotte-Ticket)
                         ▼
        La Fripouille (VM, aiohttp) : modules/flotte.py (salons, horloge, persistance)
                                       modules/flotte_regles.py (règles, Python pur)
```

**Serveur autoritaire.** Le navigateur n'envoie que des intentions (le cap et l'action de
chaque navire pour la manche en cours) ; le bot valide tout (identité du ticket, place dans
le salon, phase, numéro de manche, propriété du navire, chemin, cible visible), résout la
manche et ne renvoie à chacun que ce qu'il voit — aucune position cachée ne quitte le
serveur. Les jets de combat viennent d'un aléa secret distinct de la graine de carte (qui
n'est révélée qu'en fin de partie). Le ticket ne passe dans l'URL que pour le flux SSE
(EventSource ne sait pas envoyer d'en-tête), et le journal d'accès du bot le masque.

**Fichiers.**
- `fripouille/modules/flotte_regles.py` — règles (carte, déplacements simultanés, tirs,
  vent, météo, vision, victoire, bots), déterministes : même graine + même sel + mêmes ordres
  → même partie.
- `fripouille/modules/flotte.py` — salons (code à 5 caractères, hôte, relais de l'hôte absent),
  tickets, flux SSE, horloge des manches, persistance, archive des résultats.
- `dashboard/app/flotte/` (page + CSS), `dashboard/components/flotte/` (écrans, rendu Canvas
  `rendu.ts`, connexion `useFlotte.ts`), `dashboard/lib/flotte.ts` (types, géométrie, miroir
  d'aide des règles), `dashboard/lib/flotte-son.ts` (sons synthétisés, aucun fichier),
  `dashboard/app/api/flotte/ticket/route.ts`.

**Variables d'environnement.** Aucune nouvelle : côté Vercel, `FRIPOUILLE_API_BASE_URL` (URL
publique Funnel de l'API Fripouille) et `FRIPOUILLE_API_TOKEN` (repli : `API_TOKEN`), déjà
utilisées par les Ombres ; côté bot, `FRIPOUILLE_PUBLIC_BASE` (base des URLs de flux renvoyées
au navigateur) et `GUILD_ID` (seuls les membres de ce serveur reçoivent un ticket).

**Déploiement.** Push → Vercel redéploie le dashboard ; sur la VM :
`ssh barde "cd ~/Barde && git pull && sudo systemctl restart fripouille"`.

**Données conservées.** `fripouille/data/flotte.json` : salons en cours (refermés après 20 min
désertés, 30 min après la fin). `fripouille/data/flotte_historique.json` : résumé des 200
dernières parties (date, code, graine, participants avec identifiant et pseudo Discord,
vainqueurs, statistiques). Aucune économie, aucune récompense.

**Tests.**
- Règles : `python3 fripouille/tests/test_flotte_regles.py` (dont 175 parties de bots, le
  déterminisme et le brouillard vérifié manche par manche sur des parties entières).
- API : `python3 -m fripouille.tests.test_flotte_api` (vraie API aiohttp, plusieurs clients,
  permissions, falsifications, rejeu, reconnexion, journaux sans ticket ; dépendances du bot).
- Bout en bout : `fripouille/tests/e2e_flotte/lancer.sh` (vraie API + vrai dashboard +
  Chromium : deux navigateurs, partie jusqu'à la fin, non-régression) — voir son README.
