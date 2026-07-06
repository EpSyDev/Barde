"""Configuration du bot d'intendance « La Fripouille » (séparée du bot musique)."""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent.parent          # racine du projet Bot Music
DATA_DIR = Path(__file__).parent / "data"        # config JSON + état (git-ignoré)
CONFIG_PATH = DATA_DIR / "config.json"

load_dotenv(BASE_DIR / ".env")
load_dotenv()

# --- Discord ---
GUILD_ID = int(os.getenv("GUILD_ID") or 0) or None
TOKEN = os.getenv("FRIPOUILLE_TOKEN", "").strip()   # token du bot dédié « La Fripouille »

# --- API du dashboard web ---
# Même pont que le bot musique (Tailscale Funnel) mais PORT DISTINCT : le bot
# musique écoute 8080, La Fripouille 8081. Token réutilisé par défaut (WEB_API_TOKEN),
# surchargeable via FRIPOUILLE_API_TOKEN. Vide = API désactivée.
API_TOKEN = (os.getenv("FRIPOUILLE_API_TOKEN") or os.getenv("WEB_API_TOKEN", "")).strip()
API_HOST = os.getenv("FRIPOUILLE_API_HOST", "127.0.0.1").strip()
API_PORT = int(os.getenv("FRIPOUILLE_API_PORT") or 8081)
