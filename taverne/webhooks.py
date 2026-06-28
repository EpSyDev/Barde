"""Voix des PNJ : un webhook par salon, créé et mis en cache automatiquement."""
import logging
import os

import discord

log = logging.getLogger("taverne.webhooks")

_cache: dict[int, discord.Webhook] = {}   # channel_id → webhook


async def _get_webhook(channel: discord.TextChannel) -> discord.Webhook | None:
    if channel.id in _cache:
        return _cache[channel.id]
    try:
        hooks = await channel.webhooks()
        hook = discord.utils.get(hooks, name="Taverne")
        if hook is None:
            hook = await channel.create_webhook(name="Taverne")
        _cache[channel.id] = hook
        return hook
    except discord.Forbidden:
        log.error("Permission « Gérer les webhooks » manquante sur #%s", channel)
        return None
    except discord.HTTPException as exc:
        log.error("Webhook #%s : %s", channel, exc)
        return None


async def speak(channel: discord.TextChannel, persona, content: str):
    """Fait parler un PNJ dans le salon, avec son nom et son avatar."""
    hook = await _get_webhook(channel)
    if hook is None:
        return
    avatar = os.getenv(persona.avatar_env, "").strip() or None
    try:
        await hook.send(content=content, username=persona.name, avatar_url=avatar)
    except discord.HTTPException as exc:
        log.error("Envoi webhook (%s) : %s", persona.name, exc)
