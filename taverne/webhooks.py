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


async def speak_as(
    channel: discord.TextChannel,
    name: str,
    avatar_url: str | None,
    content: str,
    *,
    mention: "discord.abc.Snowflake | None" = None,
) -> bool:
    """Fait parler une voix arbitraire (nom + avatar) dans le salon, via webhook.

    `mention` : si fourni, ce membre est réellement notifié (@). Sinon, aucune
    mention n'est résolue (les `<@id>` éventuels restent inertes). Renvoie True si envoyé.
    """
    hook = await _get_webhook(channel)
    if hook is None:
        return False
    allowed = (
        discord.AllowedMentions(everyone=False, roles=False, users=[mention])
        if mention is not None
        else discord.AllowedMentions.none()
    )
    try:
        await hook.send(
            content=content,
            username=name,
            avatar_url=(avatar_url or None),
            allowed_mentions=allowed,
        )
        return True
    except discord.HTTPException as exc:
        log.error("speak_as (%s) : %s", name, exc)
        return False


async def speak(channel: discord.TextChannel, persona, content: str):
    """Fait parler un PNJ dans le salon de quête, avec son nom et son avatar."""
    avatar = os.getenv(persona.avatar_env, "").strip() or None
    await speak_as(channel, persona.name, avatar, content)
