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

# --- Mode ambiance : « coin des voyageurs » (salon de discussion générale) ---
# Le bot fait vivre ce salon avec des « gens de passage » (monologues, saynètes,
# interpellations), sans jamais parler de la quête. Voir ambient.py + ambient_content.py.
AMBIENT_CHANNEL = int(os.getenv("AMBIENT_CHANNEL") or 1469392215204696178) or None
AMBIENT_ENABLED = (os.getenv("AMBIENT_ENABLED", "1").strip() not in ("0", "false", "False"))

# Plage horaire active (heure locale Europe/Paris) : [début, fin[. Hors plage, silence.
AMBIENT_TZ = os.getenv("AMBIENT_TZ", "Europe/Paris")
AMBIENT_HOUR_START = int(os.getenv("AMBIENT_HOUR_START") or 10)
AMBIENT_HOUR_END = int(os.getenv("AMBIENT_HOUR_END") or 24)        # 24 = jusqu'à minuit

# Cadence : la boucle « réfléchit » toutes les TICK secondes. À chaque tick éligible,
# elle parle avec la probabilité PROBA, en respectant un écart mini entre scènes et un
# plafond quotidien. Le tout produit l'effet « ponctuel et inattendu ».
AMBIENT_TICK_SECONDS = int(os.getenv("AMBIENT_TICK_SECONDS") or 300)   # 5 min
AMBIENT_PROBA = float(os.getenv("AMBIENT_PROBA") or 0.35)
AMBIENT_MIN_GAP_SECONDS = int(os.getenv("AMBIENT_MIN_GAP_SECONDS") or 3600)  # 1 h mini
AMBIENT_DAILY_CAP = int(os.getenv("AMBIENT_DAILY_CAP") or 5)

# Anti-interruption : ne parler que si le dernier message humain remonte à au moins
# LULL secondes (petit silence) — on n'écrase pas une conversation en cours.
AMBIENT_LULL_SECONDS = int(os.getenv("AMBIENT_LULL_SECONDS") or 150)   # 2 min 30

# Interpellations : un PNJ peut s'adresser à un membre récemment actif. Ping réel ?
AMBIENT_PING = (os.getenv("AMBIENT_PING", "0").strip() in ("1", "true", "True"))
# Un membre n'est « interpellable » que s'il a parlé dans les RECENT dernières secondes.
AMBIENT_AUTHOR_RECENT_SECONDS = int(os.getenv("AMBIENT_AUTHOR_RECENT_SECONDS") or 900)

# Réaction live (GROQ) quand un membre répond à une interpellation : fenêtre + nb max
# d'échanges avant que le PNJ « reprenne la route ».
AMBIENT_REACT_WINDOW_SECONDS = int(os.getenv("AMBIENT_REACT_WINDOW_SECONDS") or 300)
AMBIENT_REACT_MAX_EXCHANGES = int(os.getenv("AMBIENT_REACT_MAX_EXCHANGES") or 3)

# --- Rôles de progression (attribués automatiquement par le moteur de quêtes) ---
ROLE_ARC1 = int(os.getenv("ROLE_ARC1") or 1520895066908917840)       # 🗝️ Disciple de la Ruse
ROLE_ARC2 = int(os.getenv("ROLE_ARC2") or 1520895284820050131)       # ⚔️ Brave de la Taverne
ROLE_ARC3 = int(os.getenv("ROLE_ARC3") or 1520895438222524537)       # 🐉 Élu de l'Hydre
ROLE_CHAMPION = int(os.getenv("ROLE_CHAMPION") or 1520895650055852213)  # 🏆 Champion de la Taverne
