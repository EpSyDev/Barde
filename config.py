"""Configuration et helpers partagés."""
import os
import shutil
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent
MEDIA_DIR = BASE_DIR / "media"        # fichiers audio pré-téléchargés (radios)

# Charge les secrets, que le .env soit dans le dossier du bot ou à la racine.
load_dotenv(BASE_DIR / ".env")
load_dotenv()

GUILD_ID = int(os.getenv("GUILD_ID") or 0) or None
ADMIN_ROLE_ID = int(os.getenv("ADMIN_ROLE_ID") or 0) or None
# Normalisation du volume au téléchargement (ré-encodage one-shot). 1 = activé.
NORMALIZE = os.getenv("NORMALIZE_AUDIO", "1").strip().lower() not in ("0", "false", "")
# Nombre max de pistes importées d'une playlist d'un coup.
PLAYLIST_LIMIT = int(os.getenv("PLAYLIST_LIMIT") or 100)


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
        return raw


FFMPEG_PATH = _resolve_ffmpeg()


def cookies_path():
    """Chemin du fichier cookies YouTube s'il existe (sinon None)."""
    p = os.getenv("COOKIES_FILE", str(BASE_DIR / "cookies.txt"))
    return p if Path(p).exists() else None


def ytdl_base_opts() -> dict:
    """Options yt-dlp communes (extraction + téléchargement)."""
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "default_search": "auto",
        "source_address": "0.0.0.0",
        # Solveur JS (deno) pour les challenges de signature YouTube.
        "remote_components": ["ejs:github"],
        # Privilégie l'opus (copie sans ré-encodage côté lecture).
        "format": "bestaudio[acodec=opus]/bestaudio/best",
    }
    cookies = cookies_path()
    if cookies:
        opts["cookiefile"] = cookies
    return opts


# --- Les 4 salons : un bot (token) par salon ---
SLOTS = []
for i in range(1, 5):
    token = os.getenv(f"TOKEN_{i}", "").strip()
    cid = int(os.getenv(f"CHANNEL_{i}") or 0)
    if token and cid:
        name = os.getenv(f"CHANNEL_{i}_NAME", f"Salon {i}")
        SLOTS.append((i, token, cid, name))
