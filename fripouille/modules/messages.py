"""Module « Messages » : envoi de messages (texte + embed) depuis le dashboard.

Deux usages :
- **Envoi unique** : action ``send`` (POST /api/action/messages/send) — poste
  immédiatement un message dans un salon, après configuration visuelle côté dashboard.
- **Messages récurrents** : config ``recurring`` — liste de messages repostés à une
  fréquence choisie (minutes / heures / jours / semaines). Un planificateur de fond
  tourne toutes les 60 s et envoie ceux qui sont dus.

Chaque message = ``{content, embed:{title, description, color, image_url,
thumbnail_url, footer}}``. Un récurrent ajoute ``{id, enabled, channel_id,
interval_value, interval_unit, next_run, last_run}``.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

import discord

from ..registry import Module, register

log = logging.getLogger("fripouille.messages")

DEFAULTS = {"recurring": []}

# Vignette fixe de tous les embeds (logo de la Taverne).
LOGO_URL = "https://taverne-ten.vercel.app/logo1.webp"

UNIT_SECONDS = {
    "minutes": 60,
    "hours": 3600,
    "days": 86400,
    "weeks": 604800,
}


def _now():
    return datetime.now(timezone.utc)


def _color(v):
    if isinstance(v, int):
        return v
    if not v:
        return 0xC9A44A
    try:
        return int(str(v).lstrip("#"), 16)
    except ValueError:
        return 0xC9A44A


def _build_message(data):
    """Construit (content, embed) à partir d'un payload de message."""
    content = (data.get("content") or "").strip() or None
    e = data.get("embed") or {}
    has_embed = any(
        (e.get(k) or "").strip()
        for k in ("title", "description", "image_url", "footer")
    )
    embed = None
    if has_embed:
        embed = discord.Embed(
            title=(e.get("title") or "").strip() or None,
            description=(e.get("description") or "").strip() or None,
            color=_color(e.get("color")),
        )
        if (e.get("image_url") or "").strip():
            embed.set_image(url=e["image_url"].strip())
        # Vignette fixe (logo Taverne) sur tous les embeds.
        embed.set_thumbnail(url=LOGO_URL)
        if (e.get("footer") or "").strip():
            embed.set_footer(text=e["footer"].strip())
    return content, embed


async def _send(bot, channel_id, data):
    channel = bot.get_channel(int(channel_id))
    if channel is None:
        raise ValueError("salon introuvable")
    content, embed = _build_message(data)
    if not content and embed is None:
        raise ValueError("message vide")
    await channel.send(content=content, embed=embed)


# --- Action : envoi unique immédiat ---
async def action_send(bot, payload):
    channel_id = payload.get("channel_id")
    if not channel_id:
        raise ValueError("salon manquant")
    await _send(bot, channel_id, payload)
    return {"ok": True}


# --- Récurrents ---
def _interval_seconds(item):
    unit = item.get("interval_unit", "days")
    try:
        value = int(item.get("interval_value") or 1)
    except (TypeError, ValueError):
        value = 1
    return max(60, max(1, value) * UNIT_SECONDS.get(unit, 86400))


def _schedule(item, ref):
    item["next_run"] = (ref + timedelta(seconds=_interval_seconds(item))).isoformat()


async def apply(bot, cfg):
    """À chaque sauvegarde : (re)planifie les récurrents actifs sans prochaine échéance."""
    recurring = cfg.get("recurring", [])
    changed = False
    for item in recurring:
        if item.get("enabled") and not item.get("next_run"):
            _schedule(item, _now())
            changed = True
        elif not item.get("enabled") and item.get("next_run"):
            item["next_run"] = None
            changed = True
    if changed:
        bot.store.set("messages", {"recurring": recurring})


async def _scheduler(bot):
    await bot.wait_until_ready()
    while not bot.is_closed():
        try:
            recurring = bot.store.get("messages").get("recurring", [])
            now = _now()
            changed = False
            for item in recurring:
                if not item.get("enabled") or not item.get("channel_id"):
                    continue
                nr = item.get("next_run")
                if not nr:
                    _schedule(item, now)
                    changed = True
                    continue
                try:
                    due = datetime.fromisoformat(nr) <= now
                except ValueError:
                    due = True
                if due:
                    try:
                        await _send(bot, item["channel_id"], item)
                        item["last_run"] = now.isoformat()
                    except Exception as exc:  # noqa: BLE001
                        log.error("récurrent %s : %s", item.get("id"), exc)
                    _schedule(item, now)
                    changed = True
            if changed:
                bot.store.set("messages", {"recurring": recurring})
        except Exception as exc:  # noqa: BLE001
            log.error("scheduler : %s", exc)
        await asyncio.sleep(60)


def start_scheduler(bot):
    bot.loop.create_task(_scheduler(bot))


MODULE = register(Module(
    key="messages",
    label="Messages",
    defaults=DEFAULTS,
    apply=apply,
    actions={"send": action_send},
))
