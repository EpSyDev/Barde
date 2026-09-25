"""Module « Taverne 3D » : le jeu MYRHAVEN fait signe sur Discord.

Le hub temps réel de la Taverne 3D (``hub/server.py``) appelle l'action ``annonce`` quand la
taverne s'anime : un voyageur pousse la porte d'une salle vide, ou quelqu'un cherche un
adversaire au Borgne. Le texte est rédigé ici (nom échappé), le hub ne fait que choisir le type
et limite la fréquence de son côté.

Config (dashboard, page Jeux) :
- ``enabled`` : active les annonces.
- ``channel_id`` : salon texte où poster.
- ``lien`` : adresse du jeu, ajoutée à chaque annonce.
"""
import logging

import discord

from ..registry import Module, register

log = logging.getLogger("fripouille.taverne3d")

DEFAULTS = {
    "enabled": False,
    "channel_id": None,
    "lien": "https://myrhaven.vercel.app/proto/taverne-3d/",
}

TEXTES = {
    "ouverture": "🍺 **{nom}** vient de pousser la porte de la Taverne. Le feu crépite, Brom essuie une chope… [Entrer]({lien})",
    "borgne": "🎲 **{nom}** cherche un adversaire au **Borgne**, à la table longue. Qui relève le défi ? [Entrer dans la Taverne]({lien})",
}


async def action_annonce(bot, payload) -> dict:
    cfg = bot.store.get("taverne3d")
    kind = str(payload.get("type") or "")
    if not cfg.get("enabled") or not cfg.get("channel_id") or kind not in TEXTES:
        return {"ok": False, "error": "inactif"}
    nom = discord.utils.escape_mentions(discord.utils.escape_markdown(str(payload.get("nom") or "Un voyageur")[:40]))
    channel = bot.get_channel(int(cfg["channel_id"]))
    if not isinstance(channel, discord.abc.Messageable):
        return {"ok": False, "error": "salon_introuvable"}
    try:
        await channel.send(TEXTES[kind].format(nom=nom, lien=cfg.get("lien") or DEFAULTS["lien"]),
                           allowed_mentions=discord.AllowedMentions.none(), suppress_embeds=True)
    except discord.HTTPException as e:
        log.warning("annonce taverne impossible : %s", e)
        return {"ok": False, "error": "discord"}
    return {"ok": True}


MODULE = register(Module(
    key="taverne3d",
    label="Taverne 3D",
    defaults=DEFAULTS,
    apply=None,
    actions={"annonce": action_annonce},
))
