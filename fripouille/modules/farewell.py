"""Module « Départ » : annonce quand un membre quitte le serveur (pendant de welcome).

Config (éditée depuis le dashboard) :
- ``enabled``    : module actif.
- ``channel_id`` : salon où poster l'annonce.
- ``message``    : texte, variables ``{name}`` (pseudo), ``{mention}`` (son tag —
  ne ping pas, le membre est parti), ``{server}``, ``{count}``.
- ``image_url``  : image d'embed optionnelle (vide = texte seul).

Runtime : déclenché sur ``on_member_remove`` (voir bot.py). Pas d'écran de règles à
gérer : un départ est immédiat.
"""
import logging

import discord

from ..registry import Module, register

log = logging.getLogger("fripouille.farewell")

DEFAULTS = {
    "enabled": False,
    "channel_id": None,
    "message": "{name} a quitté la Taverne. 👋",
    "image_url": "",
}


def _format(template, member: discord.Member) -> str:
    return (
        (template or "")
        .replace("{mention}", member.mention)
        .replace("{name}", member.display_name)
        .replace("{server}", member.guild.name)
        .replace("{count}", str(member.guild.member_count or "?"))
    )


async def on_leave(bot, member: discord.Member):
    cfg = bot.store.get("farewell")
    if not cfg.get("enabled") or not cfg.get("channel_id"):
        return
    channel = bot.get_channel(int(cfg["channel_id"]))
    if channel is None:
        log.warning("farewell : salon %s introuvable", cfg["channel_id"])
        return
    text = _format(cfg.get("message"), member).strip()
    image = (cfg.get("image_url") or "").strip()
    embed = None
    if image:
        embed = discord.Embed(color=0x8A6A3B)
        embed.set_image(url=image)
    if not text and embed is None:
        return
    try:
        await channel.send(
            content=text or None,
            embed=embed,
            allowed_mentions=discord.AllowedMentions(users=True, roles=True, everyone=True),
        )
    except discord.Forbidden:
        log.error("farewell : envoi refusé dans #%s", getattr(channel, "name", cfg["channel_id"]))


MODULE = register(Module(
    key="farewell",
    label="Départ",
    defaults=DEFAULTS,
))
