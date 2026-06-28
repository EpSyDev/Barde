"""Progression de l'ARG : que se passe-t-il quand un PNJ valide une énigme.

Quand un PNJ gardien émet [[SOLVED]], le moteur appelle `trigger_solve`. Selon le
PNJ, on attribue un rôle (qui ouvre l'arc suivant via les permissions Discord) ou on
ouvre un salon profond au seul joueur qui a réussi. Dans tous les cas, le joueur
reçoit un message privé qui annonce sa progression (pas de spoiler dans le salon).
"""
import logging
import os
from dataclasses import dataclass

import discord

from . import config, db

log = logging.getLogger("taverne.quests")


@dataclass(frozen=True)
class Outcome:
    kind: str       # "role" (attribue un rôle) | "open" (ouvre un salon au joueur)
    target: object  # role_id (int) si "role", persona_key (str) si "open"
    dm: str         # message privé annonçant la progression


# persona.key  →  ce qui se passe quand le joueur résout son épreuve.
ON_SOLVE: dict[str, Outcome] = {
    "ermite": Outcome(
        "open", "archiviste",
        "🔮 *L'Ermite hoche lentement la tête.* « Tu as percé mon énigme, voyageur. "
        "Les portes de la **Bibliothèque interdite** te sont désormais ouvertes — "
        "l'Archiviste t'y attend. »",
    ),
    "archiviste": Outcome(
        "role", config.ROLE_ARC1,
        "🗝️ *Le savoir t'a été confié.* Tu reçois le titre de **Disciple de la Ruse**. "
        "L'**Arc II — la Force** s'ouvre à ta marche.",
    ),
    "mineur": Outcome(
        "role", config.ROLE_ARC2,
        "⚔️ *La roche gronde en ton honneur.* Tu deviens **Brave de la Taverne**. "
        "L'**Arc III — l'Ombre** t'est désormais accessible.",
    ),
    "marin": Outcome(
        "open", "ombre",
        "🌊 *Le Marin Maudit baisse les yeux.* « Tu as gagné ma confiance. Le **passage "
        "souterrain** se révèle à toi… mais prends garde à ce qui s'y terre. »",
    ),
    "ombre": Outcome(
        "role", config.ROLE_ARC3,
        "🐉 *Un frisson parcourt la taverne.* Tu deviens **Élu de l'Hydre**. "
        "La **Cave scellée** s'ouvre enfin devant toi…",
    ),
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
    outcome = ON_SOLVE.get(persona_key)
    if outcome is None:
        return

    if outcome.kind == "role":
        ok = await _grant_role(member, int(outcome.target))
    elif outcome.kind == "open":
        ok = await _open_channel(member, str(outcome.target))
    else:
        ok = False

    if ok:
        await _notify(member, outcome.dm)


async def _notify(member: discord.Member, text: str):
    """Message privé au joueur. Échoue silencieusement si ses DM sont fermés."""
    try:
        await member.send(text)
    except discord.Forbidden:
        log.warning("DM refusé par %s (DM fermés) — déblocage fait quand même.", member)
    except discord.HTTPException as exc:
        log.error("DM à %s : %s", member, exc)


async def _grant_role(member: discord.Member, role_id: int) -> bool:
    role = member.guild.get_role(role_id)
    if role is None:
        log.error("Rôle %s introuvable.", role_id)
        return False
    try:
        await member.add_roles(role, reason="Progression ARG")
        log.info("Rôle « %s » attribué à %s", role.name, member)
        return True
    except discord.Forbidden:
        log.error("Pas la permission d'attribuer « %s » (hiérarchie ?).", role.name)
    except discord.HTTPException as exc:
        log.error("add_roles : %s", exc)
    return False


async def _open_channel(member: discord.Member, persona_key: str) -> bool:
    cid = _channel_id_of(persona_key)
    if cid is None:
        log.error("Salon de « %s » non configuré — rien à ouvrir.", persona_key)
        return False
    channel = member.guild.get_channel(cid)
    if channel is None:
        log.error("Salon %s introuvable.", cid)
        return False
    try:
        await channel.set_permissions(
            member, view_channel=True, send_messages=True,
            reason="Progression ARG",
        )
        log.info("Salon #%s ouvert à %s", channel, member)
        return True
    except discord.Forbidden:
        log.error("Pas la permission d'ouvrir #%s.", channel)
    except discord.HTTPException as exc:
        log.error("set_permissions : %s", exc)
    return False
