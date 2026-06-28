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

# --- GROQ (inférence Llama, free tier) — compatible OpenAI ---
# Clé gratuite sur https://console.groq.com . Fallback auto sur le petit modèle si quota.
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_BASE_URL = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
GROQ_MODELS = [
    m.strip() for m in os.getenv(
        "GROQ_MODELS", "llama-3.3-70b-versatile,llama-3.1-8b-instant"
    ).split(",") if m.strip()
]

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
