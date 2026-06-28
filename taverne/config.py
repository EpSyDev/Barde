"""Configuration du système ARG (séparée du bot musique)."""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent.parent          # racine du projet Bot Music
DB_PATH = BASE_DIR / "taverne.db"

load_dotenv(BASE_DIR / ".env")
load_dotenv()

# --- Discord ---
GUILD_ID = int(os.getenv("GUILD_ID") or 0) or None
PNJ_TOKEN = os.getenv("PNJ_TOKEN", "").strip()    # token du 5e bot, dédié à l'ARG

# --- Grok (xAI) — compatible OpenAI ---
GROK_API_KEY = os.getenv("GROK_API_KEY", "").strip()
GROK_BASE_URL = os.getenv("GROK_BASE_URL", "https://api.x.ai/v1")
GROK_MODEL = os.getenv("GROK_MODEL", "grok-3-mini")

# Longueur max de réponse d'un PNJ (caractères) et fenêtre de contexte (messages).
PNJ_MAX_CHARS = int(os.getenv("PNJ_MAX_CHARS") or 600)
PNJ_CONTEXT_MESSAGES = int(os.getenv("PNJ_CONTEXT_MESSAGES") or 6)
# Anti-spam : délai mini entre deux sollicitations d'un même PNJ par un membre (s).
PNJ_COOLDOWN = int(os.getenv("PNJ_COOLDOWN") or 20)

# --- Rôles de progression (attribués automatiquement par le moteur de quêtes) ---
ROLE_ARC1 = int(os.getenv("ROLE_ARC1") or 1520895066908917840)       # 🗝️ Disciple de la Ruse
ROLE_ARC2 = int(os.getenv("ROLE_ARC2") or 1520895284820050131)       # ⚔️ Brave de la Taverne
ROLE_ARC3 = int(os.getenv("ROLE_ARC3") or 1520895438222524537)       # 🐉 Élu de l'Hydre
ROLE_CHAMPION = int(os.getenv("ROLE_CHAMPION") or 1520895650055852213)  # 🏆 Champion de la Taverne
