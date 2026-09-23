"""Store de configuration par module, persisté en JSON.

Même idée que settings.py (bot musique) mais indexé par module, avec les défauts
issus du registre. Lecture = défauts du schéma écrasés par les valeurs stockées ;
écriture = fusion filtrée sur les clés connues du schéma (garde-fou anti-pollution).

Deux ajouts au-delà du stockage brut :
- **journal d'audit** (``audit.json``) : chaque écriture garde qui a changé quoi, avec
  la valeur d'avant. Le panneau a plusieurs taverniers ; sans ça, un réglage qui
  change de valeur tout seul reste un mystère.
- **export / import** de la configuration entière, pour sauvegarder la taverne en un
  fichier et la restaurer (la VM n'a pas de sauvegarde automatique).
"""
import json
import logging
import threading
from datetime import datetime, timezone

from . import config, registry

log = logging.getLogger("fripouille.store")

AUDIT_PATH = config.DATA_DIR / "audit.json"
AUDIT_MAX = 400          # entrées conservées (fichier borné, VM 1 Go)
# Clés écrites par le bot lui-même (compteurs, IDs de messages postés, roster) :
# les tracer noierait le journal sous du bruit machine.
AUDIT_SKIP = {"message_id", "counter", "roster", "panel_message_id"}
# Valeurs volumineuses : on garde la trace du changement, pas son contenu entier.
AUDIT_MAX_VALUE_LEN = 400


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _short(value):
    """Réduit une valeur pour le journal : on veut lire un diff, pas un dump."""
    if isinstance(value, (list, dict)):
        rendered = json.dumps(value, ensure_ascii=False)
        if len(rendered) > AUDIT_MAX_VALUE_LEN:
            kind = "éléments" if isinstance(value, list) else "clés"
            return f"<{len(value)} {kind}>"
        return value
    if isinstance(value, str) and len(value) > AUDIT_MAX_VALUE_LEN:
        return value[:AUDIT_MAX_VALUE_LEN] + "…"
    return value


class ConfigStore:
    def __init__(self):
        self._data: dict[str, dict] = {}
        self._audit: list[dict] = []
        self._lock = threading.Lock()
        self._load()

    def _load(self):
        if config.CONFIG_PATH.exists():
            try:
                self._data = json.loads(config.CONFIG_PATH.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                log.error("config.json illisible — repart des défauts")
        if AUDIT_PATH.exists():
            try:
                self._audit = json.loads(AUDIT_PATH.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                self._audit = []

    def _save(self):
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        try:
            config.CONFIG_PATH.write_text(
                json.dumps(self._data, indent=2, ensure_ascii=False), encoding="utf-8"
            )
        except OSError:
            log.error("écriture config.json impossible")

    def _save_audit(self):
        try:
            AUDIT_PATH.write_text(
                json.dumps(self._audit[-AUDIT_MAX:], indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError:
            log.error("écriture audit.json impossible")

    def get(self, module_key: str) -> dict:
        """Config effective d'un module : défauts du registre + valeurs stockées."""
        mod = registry.get(module_key)
        merged = dict(mod.defaults) if mod else {}
        merged.update(self._data.get(module_key, {}))
        return merged

    def keys(self) -> list[str]:
        """Tous les modules connus (registre ∪ valeurs déjà stockées)."""
        return sorted(set(registry.all_modules()) | set(self._data))

    def set(self, module_key: str, values: dict, actor: str = "") -> dict:
        """Fusionne et persiste. Ignore les clés hors schéma. Renvoie la config effective."""
        mod = registry.get(module_key)
        allowed = set(mod.defaults) if mod else None
        with self._lock:
            current = dict(self._data.get(module_key, {}))
            effective_before = self.get(module_key)
            changes = {}
            for key, value in values.items():
                if allowed is not None and key not in allowed:
                    continue
                if effective_before.get(key) != value and key not in AUDIT_SKIP:
                    changes[key] = {"avant": _short(effective_before.get(key)),
                                    "apres": _short(value)}
                current[key] = value
            self._data[module_key] = current
            self._save()
            if changes:
                self._audit.append({
                    "ts": _now_iso(),
                    "module": module_key,
                    "acteur": actor or "inconnu",
                    "champs": sorted(changes),
                    "diff": changes,
                })
                self._audit = self._audit[-AUDIT_MAX:]
                self._save_audit()
        return self.get(module_key)

    # --- Audit ---
    def audit(self, limit: int = 100, module: str = "") -> list[dict]:
        entries = [e for e in self._audit if not module or e.get("module") == module]
        return list(reversed(entries[-int(limit):]))

    # --- Sauvegarde / restauration ---
    def export(self) -> dict:
        """Configuration complète, telle qu'elle est stockée (sans les défauts)."""
        return {
            "version": 1,
            "exporte_le": _now_iso(),
            "modules": json.loads(json.dumps(self._data, ensure_ascii=False)),
        }

    def import_data(self, payload: dict, actor: str = "") -> dict:
        """Restaure une sauvegarde. Chaque module passe par :meth:`set` — donc filtré
        sur son schéma et tracé dans l'audit. Les modules absents du fichier sont
        laissés intacts (restauration additive, jamais destructrice)."""
        modules = payload.get("modules")
        if not isinstance(modules, dict):
            raise ValueError("sauvegarde invalide : clé « modules » manquante")
        restored = []
        for key, values in modules.items():
            if not isinstance(values, dict):
                continue
            self.set(key, values, actor=f"{actor} (restauration)")
            restored.append(key)
        return {"restaures": sorted(restored)}
