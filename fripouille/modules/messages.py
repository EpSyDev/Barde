"""Module « Messages » : envoi de messages (texte + embed) depuis le dashboard.

Usages :
- **Envoi unique** : action ``send`` — poste immédiatement un message (texte + embed)
  dans un salon, après configuration visuelle côté dashboard.
- **Publicité (PUB)** : action ``pub`` — poste une annonce de serveur partenaire à partir
  d'un gabarit structuré (nom, jeu, présentation, bannière, logo, bouton d'invitation).
- **Messages récurrents** : config ``recurring`` — liste de messages repostés à une
  fréquence choisie (minutes / heures / jours / semaines). Un planificateur de fond
  tourne toutes les 60 s et envoie ceux qui sont dus.
- **Historique éditable** : chaque envoi ponctuel (unique + pub) est mémorisé dans
  ``sent`` avec son ``message_id`` ; les actions ``edit`` / ``delete`` permettent de le
  réécrire ou le supprimer en place plus tard.

Un message unique = ``{content, embed:{title, description, color, image_url,
thumbnail_url, footer}}``. Un récurrent ajoute ``{id, enabled, channel_id,
interval_value, interval_unit, next_run, last_run}``. Une pub = ``{pub:{server_name,
games, type, members, description, banner_url, logo_url, invite_url, color}}``.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

import discord

from ..registry import Module, register

log = logging.getLogger("fripouille.messages")

DEFAULTS = {"recurring": [], "sent": []}

# Vignette fixe des embeds « classiques » (logo de la Taverne).
LOGO_URL = "https://taverne-ten.vercel.app/logo1.webp"
MAX_SENT = 50  # taille max de l'historique des envois ponctuels

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


def _valid_url(u):
    u = (u or "").strip()
    return u if u.startswith(("http://", "https://")) else None


def _build_message(data):
    """Construit (content, embed) à partir d'un payload de message unique."""
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
        # Vignette fixe (logo Taverne) sur tous les embeds « classiques ».
        embed.set_thumbnail(url=LOGO_URL)
        if (e.get("footer") or "").strip():
            embed.set_footer(text=e["footer"].strip())
    return content, embed


def _invite_view(url):
    """Vue à un seul bouton-lien « Rejoindre le serveur » (non-interactif)."""
    url = _valid_url(url)
    if not url:
        return None
    view = discord.ui.View(timeout=None)
    view.add_item(discord.ui.Button(
        style=discord.ButtonStyle.link, label="🔗 Rejoindre le serveur", url=url
    ))
    return view


def _build_pub(data):
    """Construit (content, embed, view) d'une annonce de serveur partenaire."""
    p = data.get("pub") or {}

    def f(k):
        return (p.get(k) or "").strip()

    embed = discord.Embed(
        title=(f("server_name") or "Serveur partenaire")[:256],
        description=f("description") or None,
        color=_color(p.get("color")),
    )
    embed.set_author(name="📣 Serveur partenaire")
    embed.set_thumbnail(url=_valid_url(f("logo_url")) or LOGO_URL)
    banner = _valid_url(f("banner_url"))
    if banner:
        embed.set_image(url=banner)
    if f("games"):
        embed.add_field(name="🎮 Jeu(x)", value=f("games")[:1024], inline=True)
    if f("type"):
        embed.add_field(name="🌐 Type", value=f("type")[:1024], inline=True)
    if f("members"):
        embed.add_field(name="👥 Membres", value=f("members")[:1024], inline=True)
    embed.set_footer(text="Proposé via La Fripouille")
    return None, embed, _invite_view(f("invite_url"))


def _render(kind, data):
    """(content, embed, view) selon le type de message."""
    if kind == "pub":
        return _build_pub(data)
    content, embed = _build_message(data)
    return content, embed, None


async def _resolve_channel(bot, channel_id):
    channel = bot.get_channel(int(channel_id)) if channel_id else None
    if channel is None:
        raise ValueError("salon introuvable")
    return channel


async def _send(bot, channel_id, data, kind="unique"):
    """Poste un message et renvoie l'objet ``Message`` créé."""
    channel = await _resolve_channel(bot, channel_id)
    content, embed, view = _render(kind, data)
    if not content and embed is None:
        raise ValueError("message vide")
    return await channel.send(content=content, embed=embed, view=view)


# --- Historique des envois ponctuels (unique + pub) ---
def _payload_for(kind, data):
    """Extrait le sous-ensemble à mémoriser pour ré-édition."""
    if kind == "pub":
        return {"pub": data.get("pub") or {}}
    return {"content": data.get("content") or "", "embed": data.get("embed") or {}}


def _label_for(kind, data):
    if kind == "pub":
        return ((data.get("pub") or {}).get("server_name") or "Publicité").strip()[:80] or "Publicité"
    e = data.get("embed") or {}
    return ((e.get("title") or data.get("content") or "Message").strip())[:80] or "Message"


def _history_add(bot, record):
    sent = list(bot.store.get("messages").get("sent", []))
    sent.insert(0, record)
    bot.store.set("messages", {"sent": sent[:MAX_SENT]})


def _history_update(bot, message_id, patch):
    sent = list(bot.store.get("messages").get("sent", []))
    for r in sent:
        if str(r.get("message_id")) == str(message_id):
            r.update(patch)
            break
    bot.store.set("messages", {"sent": sent})


def _history_remove(bot, message_id):
    sent = [
        r for r in bot.store.get("messages").get("sent", [])
        if str(r.get("message_id")) != str(message_id)
    ]
    bot.store.set("messages", {"sent": sent})


# --- Actions : envoi unique, pub, édition, suppression ---
async def _send_and_record(bot, channel_id, kind, payload):
    if not channel_id:
        raise ValueError("salon manquant")
    msg = await _send(bot, channel_id, payload, kind)
    _history_add(bot, {
        "id": uuid.uuid4().hex[:8],
        "kind": kind,
        "channel_id": str(channel_id),
        "message_id": str(msg.id),
        "label": _label_for(kind, payload),
        "payload": _payload_for(kind, payload),
        "sent_at": _now().isoformat(),
        "edited_at": None,
    })
    return {"ok": True, "message_id": str(msg.id)}


async def action_send(bot, payload):
    return await _send_and_record(bot, payload.get("channel_id"), "unique", payload)


async def action_pub(bot, payload):
    return await _send_and_record(bot, payload.get("channel_id"), "pub", payload)


async def action_edit(bot, payload):
    channel_id = payload.get("channel_id")
    message_id = payload.get("message_id")
    kind = payload.get("kind") or "unique"
    data = payload.get("payload") or {}
    if not channel_id or not message_id:
        raise ValueError("message introuvable")
    channel = await _resolve_channel(bot, channel_id)
    content, embed, view = _render(kind, data)
    if not content and embed is None:
        raise ValueError("message vide")
    try:
        msg = await channel.fetch_message(int(message_id))
        await msg.edit(content=content, embed=embed, view=view)
    except discord.NotFound:
        _history_remove(bot, message_id)
        raise ValueError("message introuvable sur Discord (retiré de l'historique)")
    except discord.Forbidden:
        raise ValueError("droits insuffisants pour éditer ce message")
    _history_update(bot, message_id, {
        "label": _label_for(kind, data),
        "payload": _payload_for(kind, data),
        "edited_at": _now().isoformat(),
    })
    return {"ok": True}


async def action_delete(bot, payload):
    channel_id = payload.get("channel_id")
    message_id = payload.get("message_id")
    if not channel_id or not message_id:
        raise ValueError("message introuvable")
    channel = await _resolve_channel(bot, channel_id)
    try:
        msg = await channel.fetch_message(int(message_id))
        await msg.delete()
    except discord.NotFound:
        pass
    except discord.Forbidden:
        raise ValueError("droits insuffisants pour supprimer ce message")
    _history_remove(bot, message_id)
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
    actions={
        "send": action_send,
        "pub": action_pub,
        "edit": action_edit,
        "delete": action_delete,
    },
))
