"""Module « Membres » : la fiche unifiée d'un habitant de la taverne, et les
compteurs réels du tableau de bord.

Ce module n'a **aucun comportement Discord propre** : il ne fait qu'agréger ce que
les autres tiennent déjà (économie, baptême, modération, tickets, journal) pour que
le dashboard n'ait pas à faire six appels et à recoller les morceaux lui-même.

Règle de fabrication : tout ce qui sort d'ici est **mesuré**. Pas de score de santé,
pas d'indice composite — un chiffre affiché correspond à une ligne en base ou à un
état Discord réel. Ce qu'on ne peut pas savoir (membres en ligne : demande l'intent
``presences``, non activé) n'est pas renvoyé plutôt que d'être approché.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import discord

from .. import config
from ..registry import Module, register
from . import journal, moderation

log = logging.getLogger("fripouille.membres")

DEFAULTS: dict = {}  # rien à configurer : module de lecture seule


def _guild(bot) -> Optional[discord.Guild]:
    return bot.get_guild(config.GUILD_ID) if config.GUILD_ID else None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _member_card(member: discord.Member) -> dict:
    return {
        "id": str(member.id),
        "tag": str(member),
        "nom": member.display_name,
        "avatar": member.display_avatar.url if member.display_avatar else None,
        "bot": member.bot,
        "arrive_le": member.joined_at.isoformat() if member.joined_at else None,
        "compte_cree_le": member.created_at.isoformat(),
        "anciennete_jours": (_now() - member.joined_at).days if member.joined_at else None,
        "boost": member.premium_since is not None,
        "timeout_jusqu_a": (member.timed_out_until.isoformat()
                            if member.timed_out_until else None),
        "roles": [{"id": str(r.id), "nom": r.name, "couleur": r.color.value}
                  for r in member.roles if r.name != "@everyone"],
    }


def _open_tickets(guild: discord.Guild) -> list[dict]:
    """Tickets ouverts, lus depuis les salons réels (topic ``ticket|opener|claimer``)."""
    out = []
    for channel in guild.text_channels:
        topic = channel.topic or ""
        if not topic.startswith("ticket|"):
            continue
        parts = topic.split("|")
        out.append({
            "channel_id": str(channel.id),
            "nom": channel.name,
            "opener_id": parts[1] if len(parts) > 1 and parts[1] else None,
            "claimer_id": parts[2] if len(parts) > 2 and parts[2] else None,
            "cree_le": channel.created_at.isoformat() if channel.created_at else None,
        })
    return out


# ───────────────────────── Actions dashboard ─────────────────────────
async def action_rechercher(bot, payload) -> dict:
    """Recherche un membre par pseudo, nom affiché ou ID. Utilisée par la palette ⌘K."""
    guild = _guild(bot)
    if guild is None:
        return {"membres": []}
    q = str(payload.get("q") or "").strip().lower()
    limit = min(int(payload.get("limit") or 12), 50)
    if not q:
        return {"membres": []}

    if q.isdigit():
        member = guild.get_member(int(q))
        if member is None:
            try:
                member = await guild.fetch_member(int(q))
            except (discord.NotFound, discord.HTTPException):
                member = None
        return {"membres": [_member_card(member)] if member else []}

    # Le cache membres n'est pas complet (chunk désactivé) : on interroge Discord,
    # qui fait la recherche côté serveur, puis on complète avec le cache local.
    try:
        found = await guild.query_members(query=q, limit=limit)
    except (discord.HTTPException, AttributeError):
        found = [m for m in guild.members
                 if q in m.name.lower() or q in m.display_name.lower()][:limit]
    return {"membres": [_member_card(m) for m in found if not m.bot]}


async def action_fiche(bot, payload) -> dict:
    """Tout ce que la taverne sait d'un membre, en un seul appel."""
    user_id = payload.get("user_id")
    if not user_id:
        raise ValueError("user_id requis")
    user_id = int(user_id)
    guild = _guild(bot)
    member = None
    if guild is not None:
        member = guild.get_member(user_id)
        if member is None:
            try:
                member = await guild.fetch_member(user_id)
            except (discord.NotFound, discord.HTTPException):
                member = None

    # --- Économie ---
    eco_cfg = bot.store.get("economie")
    boutique = {str(i.get("id")): i for i in (eco_cfg.get("boutique") or [])}
    inventaire = [
        {"item_id": row["item_id"], "qty": int(row["qty"]),
         "nom": (boutique.get(row["item_id"]) or {}).get("nom", row["item_id"])}
        for row in bot.economy.inventory(user_id)
    ]
    economie_bloc = {
        "solde": bot.economy.balance(user_id),
        "gele": bot.economy.is_frozen(user_id),
        "inventaire": inventaire,
        "mouvements": bot.economy.transactions(15, user_id),
        "devise": eco_cfg.get("devise", {}),
    }

    # --- Baptême ---
    roster = (bot.store.get("bapteme").get("roster") or {})
    bapteme_bloc = roster.get(str(user_id))

    # --- Modération ---
    mod_cfg = bot.store.get("moderation")
    sanctions = [moderation.row_to_dict(r) for r in moderation.db().history(user_id, 50)]
    moderation_bloc = {
        "sanctions": sanctions,
        "warns_actifs": moderation.db().active_warns(
            user_id, mod_cfg.get("warn_expire_jours") or 0),
    }

    # --- Tickets ouverts par ce membre ---
    tickets = ([t for t in _open_tickets(guild) if t["opener_id"] == str(user_id)]
               if guild else [])

    # --- Journal ---
    evenements = [journal.row_to_dict(r) for r in journal.db().recent(25, target_id=user_id)]

    return {
        "membre": _member_card(member) if member else {"id": str(user_id), "tag": str(user_id),
                                                       "nom": "Membre parti", "absent": True},
        "economie": economie_bloc,
        "bapteme": bapteme_bloc,
        "moderation": moderation_bloc,
        "tickets": tickets,
        "journal": evenements,
    }


async def action_tableau(bot, payload) -> dict:
    """Compteurs de l'accueil. Que du mesuré — ce qui est inconnu est absent."""
    guild = _guild(bot)
    if guild is None:
        return {"disponible": False}

    now = _now()
    jour, semaine = now - timedelta(hours=24), now - timedelta(days=7)

    en_vocal = sum(len([m for m in ch.members if not m.bot]) for ch in guild.voice_channels)
    salons_vocaux_actifs = [
        {"nom": ch.name, "membres": len([m for m in ch.members if not m.bot])}
        for ch in guild.voice_channels if any(not m.bot for m in ch.members)
    ]

    roster = bot.store.get("bapteme").get("roster") or {}
    derniers_baptises = sorted(
        ({"user_id": uid, **entry} for uid, entry in roster.items() if entry.get("at")),
        key=lambda e: e["at"], reverse=True,
    )[:5]

    tickets = _open_tickets(guild)
    mod_stats = moderation.db().counts(semaine)

    return {
        "disponible": True,
        "serveur": {
            "nom": guild.name,
            "icone": guild.icon.url if guild.icon else None,
            "membres": guild.member_count,
            "boosts": guild.premium_subscription_count,
            "niveau_boost": guild.premium_tier,
        },
        "vocal": {"total": en_vocal, "salons": salons_vocaux_actifs},
        "tickets": {"ouverts": len(tickets), "non_pris": len([t for t in tickets
                                                              if not t["claimer_id"]])},
        "bapteme": {"total": len(roster), "derniers": derniers_baptises},
        "economie": {
            "masse": bot.economy.money_supply(),
            "flux_24h": bot.economy.flows_since(jour),
            "anomalies": len(bot.economy.anomalies(jour)),
            "geles": len(bot.economy.frozen_accounts()),
            "devise": bot.store.get("economie").get("devise", {}),
        },
        "moderation": {"semaine": mod_stats, "total_semaine": sum(mod_stats.values())},
        "journal": {"jour": journal.db().counts_since(jour)},
        "modules_actifs": sorted(
            key for key in bot.store.keys() if bot.store.get(key).get("enabled")
        ),
    }


async def action_tickets_ouverts(bot, payload) -> dict:
    guild = _guild(bot)
    if guild is None:
        return {"tickets": []}
    tickets = _open_tickets(guild)
    for t in tickets:
        for key in ("opener_id", "claimer_id"):
            uid = t.get(key)
            if uid:
                member = guild.get_member(int(uid))
                t[key.replace("_id", "_tag")] = str(member) if member else uid
    return {"tickets": tickets}


MODULE = register(Module(
    key="membres",
    label="Membres",
    defaults=DEFAULTS,
    apply=None,
    actions={
        "rechercher": action_rechercher,
        "fiche": action_fiche,
        "tableau": action_tableau,
        "tickets_ouverts": action_tickets_ouverts,
    },
))
