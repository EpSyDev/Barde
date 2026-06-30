"""Réglages globaux persistés (hors playlists) : salon de notif des suggestions, etc."""
import json
import logging

import config

log = logging.getLogger("bot.settings")

_PATH = config.MEDIA_DIR / "settings.json"


class Settings:
    """Petit store clé/valeur persisté dans media/settings.json."""

    def __init__(self):
        self._data = {}
        self._load()

    def _load(self):
        if _PATH.exists():
            try:
                self._data = json.loads(_PATH.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                log.error("settings.json illisible")

    def save(self):
        try:
            _PATH.write_text(
                json.dumps(self._data, indent=2, ensure_ascii=False), encoding="utf-8"
            )
        except OSError:
            log.error("écriture settings.json impossible")

    def get(self, key, default=None):
        return self._data.get(key, default)

    def set(self, key, value):
        self._data[key] = value
        self.save()
