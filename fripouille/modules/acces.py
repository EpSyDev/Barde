"""Module « Accès » : qui peut entrer sur le dashboard / la table de jeu, et avec quel rôle.

Le dashboard (Vercel) n'a pas de base de données : la liste vit ici, dans la config du bot,
et il l'interroge (avec cache court) à chaque connexion. Les IDs de la variable d'env
``ALLOWED_DISCORD_IDS`` restent administrateurs quoi qu'il arrive (accès de secours, non
retirable depuis l'interface).

Rôles :
- ``admin``  : tout le panneau + la table de jeu ;
- ``mj``     : table de dés + plateau, avec les pouvoirs de maître du jeu ;
- ``joueur`` : table de dés + plateau, en tant que joueur.

Config :
- ``membres`` : ``[{id, nom, role}]`` (``id`` = identifiant Discord numérique).
"""
import logging
import re

from ..registry import Module, register

log = logging.getLogger("fripouille.acces")

ROLES = ("admin", "mj", "joueur")
DEFAULTS = {"membres": []}


def _completer(cfg: dict) -> dict:
    """Assainit la liste : ids numériques uniques, rôles connus, noms tronqués."""
    vus, propres = set(), []
    for m in cfg.get("membres") or []:
        if not isinstance(m, dict):
            continue
        uid = str(m.get("id") or "").strip()
        if not re.fullmatch(r"\d{15,25}", uid) or uid in vus:
            continue
        vus.add(uid)
        role = m.get("role") if m.get("role") in ROLES else "joueur"
        propres.append({"id": uid, "nom": str(m.get("nom") or "").strip()[:60], "role": role})
    return {**cfg, "membres": propres}


def role_de(bot, discord_id) -> str | None:
    """Rôle d'un membre dans la liste (None s'il n'y figure pas). Pour le plateau (MJ)."""
    uid = str(discord_id)
    for m in bot.store.get("acces").get("membres", []):
        if m["id"] == uid:
            return m["role"]
    return None


MODULE = register(Module(
    key="acces",
    label="Accès",
    defaults=DEFAULTS,
    completer=_completer,
))
