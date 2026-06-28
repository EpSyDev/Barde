# La Taverne du Gaming — système PNJ (ARG)

Bot Discord **séparé** du bot musique. Fait parler les PNJ via webhooks + Grok.

## Architecture

| Fichier | Rôle |
|---|---|
| `personas.py` | Les 5 PNJ : nom, salon, system prompt. **C'est ici qu'on écrit leur personnalité.** |
| `grok.py` | Appel API Grok (xAI, compatible OpenAI) |
| `webhooks.py` | Crée 1 webhook « Taverne » par salon, fait parler le PNJ avec son nom/avatar |
| `db.py` | SQLite : mémoire de conversation + drapeaux de quête (`set_flag`/`has_flag`/`count_flag`) |
| `engine.py` | Route message joueur → bon PNJ → Grok → réponse. Anti-spam + mémoire. |
| `bot.py` | Le client Discord. Lancement : `python -m taverne.bot` |

Chaque membre a **sa propre conversation** avec chaque PNJ (mémoire des 6 derniers échanges).

## Mise en route

### 1. Créer le 5e bot Discord
- Portail dev → New Application → Bot → copier le token → `PNJ_TOKEN` dans `.env`
- **Activer « MESSAGE CONTENT INTENT »** (obligatoire, sinon le bot ne lit rien)
- Inviter le bot avec les permissions : *Lire les messages*, *Gérer les webhooks*, *Envoyer des messages*

### 2. Clé Grok (gratuite)
- https://console.x.ai → API Keys → `GROK_API_KEY` dans `.env`

### 3. Variables `.env` à ajouter
```
PNJ_TOKEN=...
GROK_API_KEY=...
# ID de chaque salon où vit un PNJ (clic droit salon → Copier l'identifiant) :
PNJ_AUBERGISTE_CHANNEL=
PNJ_PYTHIE_CHANNEL=
PNJ_HERAUT_CHANNEL=
PNJ_MARCHAND_CHANNEL=
PNJ_OMBRE_CHANNEL=
# Avatars (optionnel) : URL d'image
PNJ_AUBERGISTE_AVATAR=
```
Un PNJ sans `_CHANNEL` reste endormi — active-les un par un.

### 4. Lancer (test)
```
cd ~/Barde && python -m taverne.bot
```

### 5. Service systemd (permanent)
Créer `/etc/systemd/system/taverne.service` (calqué sur barde.service), puis :
```
sudo systemctl daemon-reload && sudo systemctl enable --now taverne
```

## Étendre (quêtes)
Le moteur de quêtes se branche dans `engine.py` : avant/après l'appel Grok, lire
`db.has_flag(user_id, "arc1_resolu")`, débloquer des salons (permissions), poser
des drapeaux. Les portes collectives utilisent `db.count_flag(...)`.
