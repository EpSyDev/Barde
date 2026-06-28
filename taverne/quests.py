"""Progression de l'ARG : que se passe-t-il quand un PNJ valide une énigme.

Quand un PNJ gardien émet [[SOLVED]], le moteur appelle `trigger_solve`. Selon le
PNJ, on attribue un rôle (qui ouvre l'arc suivant via les permissions Discord) ou on
ouvre un salon profond au seul joueur qui a réussi.
"""
import logging
import os

import discord

from . import config, db

log = logging.getLogger("taverne.quests")

# persona.key  →  action déclenchée quand le joueur résout l'épreuve.
#   ("role",  role_id)        : attribue un rôle (débloque tout l'arc suivant)
#   ("open",  persona_key)    : ouvre le salon de ce PNJ au seul joueur (lieu profond)
ON_SOLVE: dict[str, tuple[str, object]] = {
    "ermite":     ("open", "archiviste"),         # forêt → biblio interdite (perso)
    "archiviste": ("role", config.ROLE_ARC1),     # Arc I terminé → ouvre Arc II
    "mineur":     ("role", config.ROLE_ARC2),     # Arc II terminé → ouvre Arc III
    "marin":      ("open", "ombre"),              # port → passage souterrain (perso)
    "ombre":      ("role", config.ROLE_ARC3),     # Arc III terminé → ouvre la Cave
}


def _channel_id_of(persona_key: str) -> int | None:
    """ID du salon d'un PNJ depuis son env (sans dépendre du cache)."""
    from .personas import PERSONAS
    p = next((x for x in PERSONAS if x.key == persona_key), None)
    if p is None:
        return None
    raw = os.getenv(p.channel_env, "").strip()
    return int(raw) if raw.isdigit() else None


async def trigger_solve(member: discord.Member, persona_key: str):
    """Exécute l'action de progression liée à la résolution de l'épreuve d'un PNJ."""
    db.set_flag(member.id, f"solved:{persona_key}")
    action = ON_SOLVE.get(persona_key)
    if action is None:
        return
    kind, target = action
    if kind == "role":
        await _grant_role(member, int(target))
    elif kind == "open":
        await _open_channel(member, str(target))


async def _grant_role(member: discord.Member, role_id: int):
    role = member.guild.get_role(role_id)
    if role is None:
        log.error("Rôle %s introuvable.", role_id)
        return
    try:
        await member.add_roles(role, reason="Progression ARG")
        log.info("Rôle « %s » attribué à %s", role.name, member)
    except discord.Forbidden:
        log.error("Pas la permission d'attribuer « %s » (hiérarchie ?).", role.name)
    except discord.HTTPException as exc:
        log.error("add_roles : %s", exc)


async def _open_channel(member: discord.Member, persona_key: str):
    cid = _channel_id_of(persona_key)
    if cid is None:
        log.error("Salon de « %s » non configuré — rien à ouvrir.", persona_key)
        return
    channel = member.guild.get_channel(cid)
    if channel is None:
        log.error("Salon %s introuvable.", cid)
        return
    try:
        await channel.set_permissions(
            member, view_channel=True, send_messages=True,
            reason="Progression ARG",
        )
        log.info("Salon #%s ouvert à %s", channel, member)
    except discord.Forbidden:
        log.error("Pas la permission d'ouvrir #%s.", channel)
    except discord.HTTPException as exc:
        log.error("set_permissions : %s", exc)
