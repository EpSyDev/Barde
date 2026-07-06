"""Module « Rôle d'arrivée » : attribue automatiquement un rôle à chaque nouveau membre.

Config (éditée depuis le dashboard) :
- ``enabled`` : active/désactive l'attribution.
- ``role_id`` : ID du rôle à donner.

Runtime : ``on_member_join`` lit la config à la volée → pas d'``apply()`` nécessaire.
Prérequis Discord : intent « Server Members » + permission « Gérer les rôles », et le
rôle du bot placé AU-DESSUS du rôle attribué dans la hiérarchie.
"""
import logging

import discord

from ..registry import Module, register

log = logging.getLogger("fripouille.autorole")

MODULE = register(Module(
    key="autorole",
    label="Rôle d'arrivée",
    defaults={"enabled": False, "role_id": None},
))


async def on_member_join(bot, member: discord.Member):
    cfg = bot.store.get("autorole")
    if not cfg.get("enabled") or not cfg.get("role_id"):
        return
    role = member.guild.get_role(int(cfg["role_id"]))
    if role is None:
        log.warning("autorole : rôle %s introuvable sur le serveur", cfg["role_id"])
        return
    try:
        await member.add_roles(role, reason="Rôle d'arrivée (La Fripouille)")
        log.info("autorole : %s → %s", member, role.name)
    except discord.Forbidden:
        log.error(
            "autorole : permission refusée (rôle bot sous « %s » ou « Gérer les rôles » manquant)",
            role.name,
        )
