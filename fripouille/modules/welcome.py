"""Module « Accueil » : annonce l'arrivée d'un nouveau membre dans un salon public
pour que la communauté lui fasse bon accueil.

Config (éditée depuis le dashboard) :
- ``enabled``    : module actif.
- ``channel_id`` : salon où poster l'annonce (un salon visible de tous).
- ``message``    : texte, avec des variables : ``{mention}`` (ping du membre),
  ``{name}`` (pseudo affiché), ``{server}`` (nom du serveur), ``{count}`` (nombre
  de membres).

Runtime : déclenché à l'arrivée réelle du membre (après validation de l'écran de
règles s'il y en a un) — voir le dispatch dans bot.py, partagé avec autorole.
"""
import logging

import discord

from ..registry import Module, register

log = logging.getLogger("fripouille.welcome")

# Image de fond du dashboard, réutilisée par défaut dans l'embed d'accueil.
BACKGROUND_URL = "https://taverne-ten.vercel.app/Taverniers.webp"

DEFAULTS = {
    "enabled": False,
    "channel_id": None,
    "message": "Bienvenue à {mention} à la Taverne ! 🍻 Faites-lui bon accueil !",
    "image_url": BACKGROUND_URL,
}


def _format(template, member: discord.Member) -> str:
    return (
        (template or "")
        .replace("{mention}", member.mention)
        .replace("{name}", member.display_name)
        .replace("{server}", member.guild.name)
        .replace("{count}", str(member.guild.member_count or "?"))
    )


async def on_arrival(bot, member: discord.Member):
    cfg = bot.store.get("welcome")
    if not cfg.get("enabled") or not cfg.get("channel_id"):
        return
    channel = bot.get_channel(int(cfg["channel_id"]))
    if channel is None:
        log.warning("welcome : salon %s introuvable", cfg["channel_id"])
        return
    text = _format(cfg.get("message"), member).strip()
    image = (cfg.get("image_url") or "").strip()
    embed = None
    if image:
        # Le ping reste dans le contenu (les mentions dans un embed ne notifient pas) ;
        # l'embed ne porte que le visuel, à taille d'embed standard.
        embed = discord.Embed(color=0xC9A44A)
        embed.set_image(url=image)
    if not text and embed is None:
        return
    try:
        await channel.send(
            content=text or None,
            embed=embed,
            # Autorise les mentions présentes dans le message : membre (<@id>),
            # rôle (<@&id>) et @everyone/@here. Ne ping que ce qui est réellement écrit.
            allowed_mentions=discord.AllowedMentions(users=True, roles=True, everyone=True),
        )
    except discord.Forbidden:
        log.error("welcome : envoi refusé dans #%s", getattr(channel, "name", cfg["channel_id"]))


MODULE = register(Module(
    key="welcome",
    label="Accueil",
    defaults=DEFAULTS,
))
