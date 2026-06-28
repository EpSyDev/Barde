"""Playlist locale d'un salon : manifeste JSON + fichiers audio."""
import json
import logging
from pathlib import Path

import config

log = logging.getLogger("bot.library")


class Library:
    """Gère la liste des pistes d'un salon (persistée dans manifest.json)."""

    def __init__(self, index):
        self.index = index
        self.dir = config.MEDIA_DIR / f"slot_{index}"
        self.dir.mkdir(parents=True, exist_ok=True)
        self._manifest = self.dir / "manifest.json"
        self.tracks = []        # [{title, url, file|None, live: bool}]
        self.shuffle = False
        self._load()

    def _load(self):
        if self._manifest.exists():
            try:
                data = json.loads(self._manifest.read_text(encoding="utf-8"))
                self.tracks = data.get("tracks", [])
                self.shuffle = data.get("shuffle", False)
            except (json.JSONDecodeError, OSError):
                log.error("[slot %s] manifest illisible", self.index)

    def save(self):
        data = {"shuffle": self.shuffle, "tracks": self.tracks}
        self._manifest.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    def add(self, track):
        self.tracks.append(track)
        self.save()

    def remove(self, i):
        if 0 <= i < len(self.tracks):
            t = self.tracks.pop(i)
            self._unlink(t)
            self.save()

    def clear(self):
        for t in self.tracks:
            self._unlink(t)
        self.tracks = []
        self.save()

    def set_shuffle(self, value):
        self.shuffle = bool(value)
        self.save()

    def path(self, track):
        return str(self.dir / track["file"]) if track.get("file") else None

    def _unlink(self, track):
        if track.get("file"):
            try:
                (self.dir / track["file"]).unlink(missing_ok=True)
            except OSError:
                pass
