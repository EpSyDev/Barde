"""Store de configuration par module, persisté en JSON.

Même idée que settings.py (bot musique) mais indexé par module, avec les défauts
issus du registre. Lecture = défauts du schéma écrasés par les valeurs stockées ;
écriture = fusion filtrée sur les clés connues du schéma (garde-fou anti-pollution).
"""
import json
import logging
import threading

from . import config, registry

log = logging.getLogger("fripouille.store")


class ConfigStore:
    def __init__(self):
        self._data: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._load()

    def _load(self):
        if config.CONFIG_PATH.exists():
            try:
                self._data = json.loads(config.CONFIG_PATH.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                log.error("config.json illisible — repart des défauts")

    def _save(self):
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        try:
            config.CONFIG_PATH.write_text(
                json.dumps(self._data, indent=2, ensure_ascii=False), encoding="utf-8"
            )
        except OSError:
            log.error("écriture config.json impossible")

    def get(self, module_key: str) -> dict:
        """Config effective d'un module : défauts du registre + valeurs stockées."""
        mod = registry.get(module_key)
        merged = dict(mod.defaults) if mod else {}
        merged.update(self._data.get(module_key, {}))
        return merged

    def set(self, module_key: str, values: dict) -> dict:
        """Fusionne et persiste. Ignore les clés hors schéma. Renvoie la config effective."""
        mod = registry.get(module_key)
        allowed = set(mod.defaults) if mod else None
        with self._lock:
            current = dict(self._data.get(module_key, {}))
            for key, value in values.items():
                if allowed is None or key in allowed:
                    current[key] = value
            self._data[module_key] = current
            self._save()
        return self.get(module_key)
