"""Module « Taverne 3D » : le jeu MYRHAVEN fait signe sur Discord.

Le hub temps réel de la Taverne 3D (``hub/server.py``) appelle l'action ``annonce`` quand la
taverne s'anime : un voyageur pousse la porte d'une salle vide, ou quelqu'un cherche un
adversaire au Borgne ou au Dé menteur. Le texte est rédigé ici (nom échappé), le hub ne fait que choisir le type
et limite la fréquence de son côté.

Config (dashboard, page Jeux) :
- ``enabled`` : active les annonces.
- ``channel_id`` : salon texte où poster.
- ``lien`` : adresse du jeu, ajoutée à chaque annonce.
- ``signalement_channel_id`` : salon (privé, modération) où tombent les signalements du vocal de
  proximité. Sans salon, le signalement reste dans le journal du hub.
"""
import logging

import discord

from ..registry import Module, register

log = logging.getLogger("fripouille.taverne3d")

DEFAULTS = {
    "enabled": False,
    "channel_id": None,
    "lien": "https://myrhaven.vercel.app/proto/taverne-3d/",
    "signalement_channel_id": None,
}
MOTIFS = {"insultes": "Insultes", "harcelement": "Harcèlement", "bruit": "Bruit / micro saturé", "autre": "Autre"}

TEXTES = {
    "ouverture": "🍺 **{nom}** vient de pousser la porte de la Taverne. Le feu crépite, Brom essuie une chope… [Entrer]({lien})",
    "borgne": "🎲 **{nom}** cherche un adversaire au **Borgne**, à la table longue. Qui relève le défi ? [Entrer dans la Taverne]({lien})",
    "palet": "🥇 **{nom}** attend un adversaire au **palet de comptoir**, à la table de Jehanne. Qui a le poignet ? [Entrer dans la Taverne]({lien})",
    "marelle": "♟️ **{nom}** attend un adversaire à la **marelle**, à la table de l'étranger encapuchonné. [Entrer dans la Taverne]({lien})",
    "veillee_bientot": "🔥 **La veillée commence dans un quart d'heure** au coin du feu de la Taverne. Ce soir : *{titre}*. Prenez place sur les bancs. [Entrer dans la Taverne]({lien})",
    "veillee_resume": "🔥 **Veillée du conteur — {titre}**\n{resume}\n\nAutour du feu : {presents}. [La Taverne]({lien})",
    "menteur": "🎲 **{nom}** ouvre une partie de **Dé menteur** à la table ronde (2 à 6 voyageurs). Gobelets en main ! [Entrer dans la Taverne]({lien})",
}


async def action_annonce(bot, payload) -> dict:
    cfg = bot.store.get("taverne3d")
    kind = str(payload.get("type") or "")
    if not cfg.get("enabled") or not cfg.get("channel_id") or kind not in TEXTES:
        return {"ok": False, "error": "inactif"}
    def propre(v, n):
        return discord.utils.escape_mentions(discord.utils.escape_markdown(str(v)[:n]))
    nom = propre(payload.get("nom") or "Un voyageur", 40)
    champs = {"titre": propre(payload.get("titre") or "", 80), "resume": propre(payload.get("resume") or "", 900),
              "presents": propre(payload.get("presents") or "personne… le conteur a parlé aux braises", 600)}
    channel = bot.get_channel(int(cfg["channel_id"]))
    if not isinstance(channel, discord.abc.Messageable):
        return {"ok": False, "error": "salon_introuvable"}
    try:
        await channel.send(TEXTES[kind].format(nom=nom, lien=cfg.get("lien") or DEFAULTS["lien"], **champs),
                           allowed_mentions=discord.AllowedMentions.none(), suppress_embeds=True)
    except discord.HTTPException as e:
        log.warning("annonce taverne impossible : %s", e)
        return {"ok": False, "error": "discord"}
    return {"ok": True}


async def action_signalement(bot, payload) -> dict:
    """Signalement d'un voyageur depuis le vocal de proximité (le hub a vérifié l'identité des deux
    joueurs et limité la fréquence). Posté tel quel pour la modération, mentions désactivées."""
    cfg = bot.store.get("taverne3d")
    salon = cfg.get("signalement_channel_id")
    if not salon:
        return {"ok": False, "error": "aucun_salon"}
    channel = bot.get_channel(int(salon))
    if not isinstance(channel, discord.abc.Messageable):
        return {"ok": False, "error": "salon_introuvable"}
    def propre(v, n=60):
        return discord.utils.escape_mentions(discord.utils.escape_markdown(str(v or "?")[:n]))
    try:
        cible, auteur = int(payload["cible_id"]), int(payload["auteur_id"])
    except (KeyError, TypeError, ValueError):
        return {"ok": False, "error": "ids"}
    motif = MOTIFS.get(str(payload.get("motif")), "Autre")
    texte = (f"⚑ **Signalement — Taverne 3D (vocal)**\n"
             f"Signalé : **{propre(payload.get('cible_nom'))}** (<@{cible}>)\n"
             f"Par : {propre(payload.get('auteur_nom'))} (<@{auteur}>)\n"
             f"Motif : {motif}")
    try:
        await channel.send(texte, allowed_mentions=discord.AllowedMentions.none())
    except discord.HTTPException as e:
        log.warning("signalement non posté : %s", e)
        return {"ok": False, "error": "discord"}
    return {"ok": True}


MODULE = register(Module(
    key="taverne3d",
    label="Taverne 3D",
    defaults=DEFAULTS,
    apply=None,
    actions={"annonce": action_annonce, "signalement": action_signalement},
))
