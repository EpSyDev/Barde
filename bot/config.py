"""Configuration et persistance de l'état des salons."""
import json
import os
import shutil
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).parent
STATE_FILE = BASE_DIR / "state.json"

# --- Secrets / identifiants ---
TOKEN = os.getenv("DISCORD_TOKEN", "")
GUILD_ID = int(os.getenv("GUILD_ID") or 0) or None
ADMIN_ROLE_ID = int(os.getenv("ADMIN_ROLE_ID") or 0) or None


def _resolve_ffmpeg() -> str:
    """Trouve FFmpeg : variable d'env > PATH système > binaire pip embarqué."""
    raw = os.getenv("FFMPEG_PATH", "ffmpeg")
    if raw != "ffmpeg" and Path(raw).exists():
        return raw
    if shutil.which(raw):
        return raw
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        return raw  # tentera "ffmpeg" et échouera proprement si introuvable


FFMPEG_PATH = _resolve_ffmpeg()

# --- Les 4 salons ---
# Chaque entrée : (index, channel_id, nom par défaut)
CHANNELS = []
for i in range(1, 5):
    cid = int(os.getenv(f"CHANNEL_{i}") or 0)
    if cid:
        name = os.getenv(f"CHANNEL_{i}_NAME", f"Salon {i}")
        CHANNELS.append((i, cid, name))


def load_state() -> dict:
    """Charge les URLs sauvegardées (URL par salon, persistante entre redémarrages)."""
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def save_state(slots) -> None:
    """Sauvegarde l'URL et le nom de chaque salon."""
    data = {
        str(s.index): {"name": s.name, "url": s.url}
        for s in slots
    }
    STATE_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )
