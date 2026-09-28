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
import re
import time

import discord

from ..registry import Module, register

log = logging.getLogger("fripouille.taverne3d")

DEFAULTS = {
    "enabled": False,
    "channel_id": None,
    "lien": "https://myrhaven.vercel.app/proto/taverne-3d/",
    "signalement_channel_id": None,
    # veillée du conteur (hub) : programmée chaque semaine, chapitre imposé ou suivant, lancement à la demande
    "veillee_actif": True,
    "veillee_jour": 4,          # 0 lundi … 6 dimanche
    "veillee_heure": "21:00",   # heure de Paris
    "veillee_chapitre": None,   # index imposé pour la prochaine veillée (None : le suivant)
    "veillee_demande": 0,       # horodatage d'un « lancer maintenant » (le hub ne le joue qu'une fois)
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


# --- Veillée du conteur, pilotée depuis le dashboard ---
# Le hub relit les réglages toutes les 20 s (action veillee_reglages) et y dépose son état (chapitres,
# prochaine date, veillée en cours) ; le dashboard lit cet état et règle jour, heure, chapitre, ou lance.
ETAT_VEILLEE: dict = {}
_HEURE = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d$")


def _reglages(cfg: dict) -> dict:
    return {k: cfg.get(k, DEFAULTS[k]) for k in ("veillee_actif", "veillee_jour", "veillee_heure", "veillee_chapitre", "veillee_demande")}


async def action_veillee_reglages(bot, payload) -> dict:
    """Appelée par le hub : dépose son état, reçoit les réglages."""
    etat = payload.get("etat")
    if isinstance(etat, dict):
        ETAT_VEILLEE.clear(); ETAT_VEILLEE.update(etat); ETAT_VEILLEE["vu"] = int(time.time())
    return {"ok": True, **_reglages(bot.store.get("taverne3d"))}


async def action_veillee_consommee(bot, payload) -> dict:
    """Le hub a joué le chapitre imposé : on revient au chapitre suivant."""
    bot.store.set("taverne3d", {"veillee_chapitre": None})
    return {"ok": True}


async def action_veillee_etat(bot, payload) -> dict:
    """Pour le dashboard : réglages + état rapporté par le hub (vide si le hub ne répond plus)."""
    frais = ETAT_VEILLEE and time.time() - ETAT_VEILLEE.get("vu", 0) < 90
    return {"ok": True, "reglages": _reglages(bot.store.get("taverne3d")), "hub": dict(ETAT_VEILLEE) if frais else None}


async def action_veillee_regler(bot, payload) -> dict:
    maj = {}
    if isinstance(payload.get("actif"), bool):
        maj["veillee_actif"] = payload["actif"]
    j = payload.get("jour")
    if isinstance(j, int) and not isinstance(j, bool) and 0 <= j <= 6:
        maj["veillee_jour"] = j
    h = payload.get("heure")
    if isinstance(h, str) and _HEURE.match(h):
        maj["veillee_heure"] = h
    if "chapitre" in payload:
        c = payload["chapitre"]
        maj["veillee_chapitre"] = c if isinstance(c, int) and not isinstance(c, bool) and 0 <= c < 200 else None
    if not maj:
        raise ValueError("rien à régler")
    bot.store.set("taverne3d", maj)
    return {"ok": True, **_reglages(bot.store.get("taverne3d"))}


async def action_veillee_lancer(bot, payload) -> dict:
    """« Lancer maintenant » : le hub démarre la veillée à son prochain passage (20 s au plus)."""
    maj = {"veillee_demande": int(time.time())}
    c = payload.get("chapitre")
    if isinstance(c, int) and not isinstance(c, bool) and 0 <= c < 200:
        maj["veillee_chapitre"] = c
    bot.store.set("taverne3d", maj)
    return {"ok": True}


MODULE = register(Module(
    key="taverne3d",
    label="Taverne 3D",
    defaults=DEFAULTS,
    apply=None,
    actions={"annonce": action_annonce, "signalement": action_signalement,
             "veillee_reglages": action_veillee_reglages, "veillee_consommee": action_veillee_consommee,
             "veillee_etat": action_veillee_etat, "veillee_regler": action_veillee_regler, "veillee_lancer": action_veillee_lancer},
))
