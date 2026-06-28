"""Playlist locale d'un salon : manifeste JSON + fichiers audio."""
import json
import logging

import config

log = logging.getLogger("bot.library")


class Library:
    """Gère la liste des pistes d'un salon (persistée dans manifest.json)."""

    def __init__(self, index):
        self.index = index
        self.dir = config.MEDIA_DIR / f"slot_{index}"
        self.dir.mkdir(parents=True, exist_ok=True)
        self._manifest = self.dir / "manifest.json"
        self.tracks = []        # [{title, url, file|None, live, thumb, duration}]
        self.shuffle = False
        self.pos = 0            # dernière position lue (reprise au reboot)
        self.public_message_id = None   # message jukebox posté dans le salon
        self._load()

    def _load(self):
        if self._manifest.exists():
            try:
                data = json.loads(self._manifest.read_text(encoding="utf-8"))
                self.tracks = data.get("tracks", [])
                self.shuffle = data.get("shuffle", False)
                self.pos = data.get("pos", 0)
                self.public_message_id = data.get("public_message_id")
            except (json.JSONDecodeError, OSError):
                log.error("[slot %s] manifest illisible", self.index)

    def save(self):
        data = {
            "shuffle": self.shuffle,
            "pos": self.pos,
            "public_message_id": self.public_message_id,
            "tracks": self.tracks,
        }
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

    def move(self, i, delta):
        """Déplace la piste i de delta (-1 = monter, +1 = descendre). Retourne la nouvelle position."""
        j = i + delta
        if 0 <= i < len(self.tracks) and 0 <= j < len(self.tracks):
            self.tracks[i], self.tracks[j] = self.tracks[j], self.tracks[i]
            self.save()
            return j
        return i

    def clear(self):
        for t in self.tracks:
            self._unlink(t)
        self.tracks = []
        self.pos = 0
        self.save()

    def set_shuffle(self, value):
        self.shuffle = bool(value)
        self.save()

    def set_pos(self, pos):
        self.pos = pos
        self.save()

    def path(self, track):
        return str(self.dir / track["file"]) if track.get("file") else None

    def _unlink(self, track):
        if track.get("file"):
            try:
                (self.dir / track["file"]).unlink(missing_ok=True)
            except OSError:
                pass
