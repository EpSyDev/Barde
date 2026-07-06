"""Module « Salons vocaux temporaires » (type TempVoice).

Principe : un salon vocal « hub » (« ➕ Créer un salon »). Quand un membre le
rejoint, le bot lui crée un salon vocal **temporaire** dans la catégorie choisie,
l'y déplace, et lui donne l'overwrite « Gérer le salon » dessus → il renomme, met
une limite de places, verrouille… directement via l'interface native de Discord
(pas de panneau custom à maintenir). Le salon est **supprimé automatiquement** dès
qu'il se vide.

Config (éditée depuis le dashboard) :
- ``enabled`` : active/désactive le système.
- ``hub_channel_id`` : salon vocal « hub » que les membres rejoignent pour créer.
- ``category_id`` : catégorie des salons temporaires (défaut = celle du hub).
- ``name_template`` : nom du salon créé. Variable ``{name}`` = pseudo du membre.
- ``user_limit`` : limite de places par défaut (0 = illimité).
- ``owners`` : état géré par le bot — {id_salon: id_proprio}.

Runtime : ``on_voice_state_update`` (lu à la volée → pas d'``apply()``).
Prérequis Discord : intent « Voice States » + permission « Gérer les salons » et
« Déplacer les membres », le rôle du bot au-dessus dans la hiérarchie.
"""
import logging

import discord

from ..registry import Module, register

log = logging.getLogger("fripouille.tempvoice")

DEFAULTS = {
    "enabled": False,
    "hub_channel_id": None,
    "category_id": None,
    "name_template": "Salon de {name}",
    "user_limit": 0,
    "owners": {},          # état géré bot : {str(channel_id): owner_id}
}


def _cfg(bot):
    return bot.store.get("tempvoice")


def _humans(channel):
    """Membres humains présents dans le salon (les bots ne comptent pas)."""
    return [m for m in getattr(channel, "members", []) if not m.bot]


def _set_owners(bot, owners):
    bot.store.set("tempvoice", {"owners": owners})


async def _create(bot, member, cfg):
    guild = member.guild
    hub = bot.get_channel(int(cfg["hub_channel_id"]))
    if not isinstance(hub, discord.VoiceChannel):
        return

    cat_id = cfg.get("category_id")
    category = bot.get_channel(int(cat_id)) if cat_id else hub.category
    if cat_id and not isinstance(category, discord.CategoryChannel):
        category = hub.category

    name = (cfg.get("name_template") or "Salon de {name}").replace(
        "{name}", member.display_name
    )[:100]
    try:
        limit = max(0, min(99, int(cfg.get("user_limit") or 0)))
    except (TypeError, ValueError):
        limit = 0

    overwrites = {
        guild.me: discord.PermissionOverwrite(
            view_channel=True, connect=True, manage_channels=True, move_members=True
        ),
        member: discord.PermissionOverwrite(
            view_channel=True, connect=True, manage_channels=True, move_members=True
        ),
    }
    try:
        channel = await guild.create_voice_channel(
            name=name, category=category, user_limit=limit, overwrites=overwrites,
            reason=f"Salon vocal temporaire de {member}",
        )
    except discord.Forbidden:
        log.error("tempvoice : création refusée (« Gérer les salons » manquant ?)")
        return
    except discord.HTTPException as exc:
        log.error("tempvoice : création échouée : %s", exc)
        return

    try:
        await member.move_to(channel, reason="Salon vocal temporaire")
    except discord.HTTPException:
        # Le membre a peut-être déjà quitté : salon vide → on le supprime.
        if not _humans(channel):
            await _delete(channel)
            return

    owners = dict(cfg.get("owners") or {})
    owners[str(channel.id)] = member.id
    _set_owners(bot, owners)
    log.info("tempvoice : salon « %s » créé pour %s", channel.name, member)


async def _delete(channel):
    try:
        await channel.delete(reason="Salon vocal temporaire vidé")
    except discord.HTTPException:
        pass


async def _maybe_delete(bot, channel, cfg):
    """Supprime un salon temporaire s'il est vide et retire son entrée d'état."""
    owners = cfg.get("owners") or {}
    if str(channel.id) not in owners:
        return
    if _humans(channel):
        return
    await _delete(channel)
    remaining = dict(owners)
    remaining.pop(str(channel.id), None)
    _set_owners(bot, remaining)


async def on_voice(bot, member, before, after):
    """Point d'entrée appelé depuis ``on_voice_state_update`` (bot.py)."""
    cfg = _cfg(bot)
    if not cfg.get("enabled") or not cfg.get("hub_channel_id"):
        return
    if member.bot:
        return

    hub_id = int(cfg["hub_channel_id"])

    # Départ / changement de salon : purge de l'ancien s'il est temporaire et vide.
    if before.channel is not None and before.channel != after.channel:
        await _maybe_delete(bot, before.channel, cfg)
        cfg = _cfg(bot)  # relire : _maybe_delete a pu modifier owners

    # Arrivée dans le hub : on crée un salon perso et on y déplace le membre.
    if after.channel is not None and after.channel.id == hub_id:
        await _create(bot, member, cfg)


async def cleanup(bot):
    """Au démarrage : supprime les salons temporaires restés vides après un restart."""
    cfg = _cfg(bot)
    owners = cfg.get("owners") or {}
    if not owners:
        return
    remaining = {}
    for cid, owner_id in owners.items():
        channel = bot.get_channel(int(cid))
        if channel is None:
            continue  # salon déjà disparu → on oublie
        if _humans(channel):
            remaining[cid] = owner_id
        else:
            await _delete(channel)
    if remaining != owners:
        _set_owners(bot, remaining)


MODULE = register(Module(
    key="tempvoice",
    label="Salons vocaux",
    defaults=DEFAULTS,
))
