# Bot Musique — 4 salons en boucle

Bot Discord qui diffuse en boucle une URL YouTube (vidéos longues type 3H) dans
4 salons vocaux. Pilotage par panneau interactif `/panel`.

## Structure

| Fichier | Rôle |
|---|---|
| `main.py` | Démarrage, synchro des commandes, autostart |
| `config.py` | Lecture du `.env` + persistance des URLs (`state.json`) |
| `manager.py` | `PlayerManager` — orchestre les 4 players |
| `player.py` | `VoicePlayer` — lecture, boucle, reconnexion par salon |
| `ui.py` | Panneau `/panel` (boutons + modal URL) |
| `commands.py` | Commandes slash : `/panel`, `/play`, `/stop`, `/status` |

## Prérequis

- Python 3.11+
- **FFmpeg** installé (binaire dans le PATH, ou `FFMPEG_PATH` dans le `.env`)
- Un bot Discord (Developer Portal) avec le token

## Installation locale

```bash
pip install -r requirements.txt
cp .env.example .env   # puis remplir les valeurs
python main.py
```

### Récupérer les IDs
Discord > Paramètres > Avancés > **Mode développeur** activé, puis clic droit
sur le serveur / les salons > *Copier l'identifiant*.

## Commandes

- `/panel` — ouvre le panneau (1 ligne de boutons par salon : 🎵 URL, ▶️, ⏸️, ⏹️)
- `/play <salon 1-4> <url>` — change l'URL et lance la lecture
- `/stop <salon 1-4>` — arrête un salon
- `/status` — état des 4 salons

Tout est réservé aux administrateurs (ou au rôle `ADMIN_ROLE_ID`).

## Déploiement sur Wispbyte

1. Créer un serveur **Python** (egg incluant FFmpeg, ou ajouter FFmpeg).
2. Uploader le dossier `bot/`.
3. Renseigner les variables d'environnement (mêmes clés que `.env.example`)
   dans le panneau Wispbyte, ou uploader le `.env`.
4. Commande de démarrage : `pip install -r requirements.txt && python main.py`.

> ⚠️ YouTube bloque parfois les IP de datacenter. Le bot utilise déjà le client
> `android` de yt-dlp pour limiter ça. Si un flux refuse de démarrer, mettre
> yt-dlp à jour (`pip install -U yt-dlp`) — YouTube change ses APIs régulièrement.

## Permissions du bot (invitation)
Scopes `bot` + `applications.commands`, permissions : *Connect*, *Speak*.
