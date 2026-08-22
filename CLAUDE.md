# Bot Music (Barde) — règles du repo

Monorepo GitHub `EpSyDev/Barde` (privé) : 3 sous-projets déployés séparément.

- **racine** — bot Discord musique "Barde" (4 salons = 4 bots). Service systemd `barde`.
- **`fripouille/`** — bot Discord "La Fripouille" (features communauté : autorole, welcome,
  tickets, économie, baptême, jeux...). Process séparé, service systemd `fripouille`, API HTTP
  interne port 8081. C'est ce module qui porte l'économie et le rôle de race (baptême) utilisés
  par le jeu MYRHAVEN (voir plus bas).
- **`dashboard/`** — Next.js (App Router), déployé sur Vercel (Root Directory = `dashboard`,
  réglage à faire depuis l'UI web, pas le CLI). Panneau admin (login Discord, liste blanche
  `ALLOWED_DISCORD_IDS`) **et** proxy public pour le jeu (`/api/game/*` — OAuth Discord sans
  liste blanche + relais vers l'API de Fripouille, token jamais exposé au navigateur).

Hébergement bot : VM Oracle Cloud, alias SSH `barde` (`~/.ssh/config` sur la machine de Nico).

## Règle git — override du CLAUDE.md global

Sur **ce repo uniquement**, le push est automatique après chaque modif de code (ça override la
règle globale "jamais de push automatique") :

1. Commit **et push** sans demander.
2. Toujours redonner ensuite la commande de redémarrage serveur prête à coller :
   ```
   ssh barde "cd ~/Barde && git pull && sudo systemctl restart <service>"
   ```
   `<service>` = `barde` (bot musique) ou `fripouille` (bot intendance/économie/baptême) selon
   ce qui a été modifié. Si déjà en session SSH sur la VM, retirer le `ssh barde "..."` autour.
3. Le dashboard (`dashboard/`) n'a **pas** besoin de cette commande — Vercel redéploie tout seul
   sur push GitHub. Une variable d'env ajoutée dans Vercel après coup demande un redeploy manuel
   (bouton "Redeploy" dans l'UI) pour être prise en compte.

## Lien avec le jeu MYRHAVEN

Repo séparé `EpSyDev/myrhaven-point-and-click` (dossier local `MYRHAVEN POINT AND CLIK`, a son
propre `CLAUDE.md`). Le jeu est un site statique sans backend : l'identité joueur (OAuth Discord)
et l'accès à l'économie/baptême passent **obligatoirement** par ce dashboard (`/api/game/*`),
jamais directement par l'API de Fripouille. Toute modif du contrat entre les deux (nouvelle
action bot, nouvelle route `/api/game/*`) doit rester cohérente des deux côtés — vérifier l'autre
repo avant de changer une forme de réponse JSON partagée.

Env Vercel du dashboard à connaître pour ce lien : `GAME_ORIGIN` (origine exacte du jeu, sans
slash final), `GAME_SESSION_SECRET` (signature du token de session joueur), `DISCORD_CLIENT_ID`/
`SECRET` (app OAuth **Barde**, pas Fripouille — Fripouille n'a pas d'OAuth).

## Architecture Fripouille (le moule répétable)

Chaque feature = `Module(key, label, defaults, apply, actions)` déclaré dans `fripouille/modules/`
et importé dans `modules/__init__.py` (+ `bot.py` si elle a un cycle de vie spécial comme
l'économie). Config JSON par module (`ConfigStore`), API générique `GET/POST /api/config/{module}`
+ `POST /api/action/{module}/{action}` pour les déclenchements ponctuels. Le dashboard n'exécute
jamais l'action Discord : il écrit la config ou déclenche une action, le bot fait le reste.
