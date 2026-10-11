"""Module « Soirées » : planifier une soirée jeu depuis le dashboard, avec inscriptions.

Le dashboard crée la soirée (jeu, date/heure, description, nombre de places). Le bot
poste une **carte** dans le salon d'annonces avec trois boutons — « ✅ Je viens »,
« 🤔 Peut-être », « ❌ Finalement non » — puis, ``rappel_min`` minutes avant le début,
répond à la carte en **pingant les inscrits**. Une fois la soirée passée, la carte est
figée (« Terminée »).

Les boutons sont des ``DynamicItem`` (custom_id ``soiree:{action}:{id}``) : ils restent
cliquables après un redémarrage du bot.

Config :
- ``enabled`` / ``channel_id`` : salon d'annonce des soirées.
- ``ping_role_id``   : rôle pingé à l'annonce (facultatif).
- ``rappel_min``     : délai du rappel avant le début.
- ``soirees``        : état des soirées (géré par le bot).
"""
import asyncio
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone

import discord

from .. import config
from ..registry import Module, register

log = logging.getLogger("fripouille.soirees")

MAX_CONSERVEES = 30          # soirées terminées/annulées gardées en mémoire
DUREE_CARTE_H = 4            # une soirée passée depuis plus de N heures est « terminée »

DEFAULTS = {
    "enabled": False,
    "channel_id": None,
    "ping_role_id": None,
    "rappel_min": 15,
    "soirees": [],
}

COULEURS = {"a_venir": 0x9B59B6, "terminee": 0x4F545C, "annulee": 0xED4245}


def _now():
    return datetime.now(timezone.utc)


def _debut(s):
    return datetime.fromisoformat(s["debut"])


def _cfg(bot):
    return bot.store.get("soirees")


def _get(bot, sid):
    return next((s for s in _cfg(bot).get("soirees", []) if s.get("id") == sid), None)


def _sauver(bot, s):
    liste = [x for x in _cfg(bot).get("soirees", []) if x.get("id") != s["id"]]
    liste.insert(0, s)
    actives = [x for x in liste if x["statut"] == "a_venir"]
    finies = [x for x in liste if x["statut"] != "a_venir"][:MAX_CONSERVEES]
    bot.store.set("soirees", {"soirees": actives + finies})


# --- Rendu ---
def _mentions(ids):
    return ", ".join("<@%s>" % i for i in ids) if ids else "—"


def _embed(s):
    ts = int(_debut(s).timestamp())
    statut = s["statut"]
    titre = "🎲  %s" % s["titre"]
    if statut == "annulee":
        titre = "❌  %s (annulée)" % s["titre"]
    elif statut == "terminee":
        titre = "🏁  %s (terminée)" % s["titre"]
    e = discord.Embed(title=titre[:256], description=s.get("description") or None,
                      color=COULEURS[statut])
    if s.get("jeu"):
        e.add_field(name="🎮 Jeu", value=s["jeu"][:200], inline=True)
    e.add_field(name="📅 Quand", value="<t:%d:F>\n<t:%d:R>" % (ts, ts), inline=True)
    places = int(s.get("max") or 0)
    nb = len(s["inscrits"])
    e.add_field(name="🪑 Places", value=("%d / %d" % (nb, places)) if places else "%d inscrit(s)" % nb,
                inline=True)
    e.add_field(name="✅ Inscrits (%d)" % nb, value=_mentions(s["inscrits"])[:1024], inline=False)
    if s["peut_etre"]:
        e.add_field(name="🤔 Peut-être (%d)" % len(s["peut_etre"]),
                    value=_mentions(s["peut_etre"])[:1024], inline=False)
    e.set_footer(text="Soirée #%s" % s["id"])
    return e


class SoireeBouton(discord.ui.DynamicItem[discord.ui.Button],
                   template=r"soiree:(?P<action>viens|peutetre|non):(?P<id>[0-9a-f]+)"):
    LIBELLES = {
        "viens": ("Je viens", "✅", discord.ButtonStyle.success),
        "peutetre": ("Peut-être", "🤔", discord.ButtonStyle.secondary),
        "non": ("Finalement non", "❌", discord.ButtonStyle.danger),
    }

    def __init__(self, action: str, sid: str):
        lib, emoji, style = self.LIBELLES[action]
        super().__init__(discord.ui.Button(label=lib, emoji=emoji, style=style,
                                           custom_id="soiree:%s:%s" % (action, sid)))
        self.action, self.sid = action, sid

    @classmethod
    async def from_custom_id(cls, interaction, item, match: re.Match):
        return cls(match["action"], match["id"])

    async def callback(self, interaction: discord.Interaction):
        await _clic(interaction, self.action, self.sid)


def _vue(s):
    if s["statut"] != "a_venir":
        return None
    v = discord.ui.View(timeout=None)
    for a in ("viens", "peutetre", "non"):
        v.add_item(SoireeBouton(a, s["id"]))
    return v


async def _maj_carte(bot, s):
    channel = bot.get_channel(int(s["channel_id"]))
    if channel is None or not s.get("message_id"):
        return None
    msg = channel.get_partial_message(int(s["message_id"]))
    try:
        await msg.edit(embed=_embed(s), view=_vue(s))
    except discord.NotFound:
        return None
    except discord.HTTPException as exc:
        log.warning("carte soirée %s : %s", s["id"], exc)
    return msg


async def _clic(interaction: discord.Interaction, action: str, sid: str):
    bot = interaction.client
    s = _get(bot, sid)
    if s is None or s["statut"] != "a_venir":
        await interaction.response.send_message("Cette soirée n'est plus ouverte.", ephemeral=True)
        return
    uid = str(interaction.user.id)
    inscrits, peut = s["inscrits"], s["peut_etre"]
    if action == "viens":
        places = int(s.get("max") or 0)
        if uid not in inscrits and places and len(inscrits) >= places:
            await interaction.response.send_message(
                "Désolé, la soirée est complète. Clique sur 🤔 pour être prévenu d'une place.", ephemeral=True)
            return
        if uid in peut:
            peut.remove(uid)
        if uid not in inscrits:
            inscrits.append(uid)
        retour = "✅ Tu es inscrit(e) !"
    elif action == "peutetre":
        if uid in inscrits:
            inscrits.remove(uid)
        if uid not in peut:
            peut.append(uid)
        retour = "🤔 Noté : peut-être."
    else:
        for liste in (inscrits, peut):
            if uid in liste:
                liste.remove(uid)
        retour = "❌ Désinscription prise en compte."
    _sauver(bot, s)
    await interaction.response.edit_message(embed=_embed(s), view=_vue(s))
    try:
        await interaction.followup.send(retour, ephemeral=True)
    except discord.HTTPException:
        pass


# --- Planificateur : rappels et clôture ---
async def _scheduler(bot):
    await bot.wait_until_ready()
    while not bot.is_closed():
        try:
            cfg = _cfg(bot)
            rappel = timedelta(minutes=max(1, int(cfg.get("rappel_min") or 15)))
            now = _now()
            for s in list(cfg.get("soirees", [])):
                if s["statut"] != "a_venir":
                    continue
                debut = _debut(s)
                if not s.get("rappel_envoye") and debut - now <= rappel:
                    s["rappel_envoye"] = True
                    _sauver(bot, s)
                    if s["inscrits"] and now < debut + timedelta(hours=1):
                        await _rappeler(bot, s)
                if now > debut + timedelta(hours=DUREE_CARTE_H):
                    s["statut"] = "terminee"
                    _sauver(bot, s)
                    await _maj_carte(bot, s)
        except Exception as exc:  # noqa: BLE001
            log.error("scheduler soirées : %s", exc)
        await asyncio.sleep(30)


async def _rappeler(bot, s):
    channel = bot.get_channel(int(s["channel_id"]))
    if channel is None:
        return
    ts = int(_debut(s).timestamp())
    texte = "⏰ **%s** commence <t:%d:R> ! %s" % (
        s["titre"], ts, " ".join("<@%s>" % i for i in s["inscrits"]))
    mentions = discord.AllowedMentions(users=[discord.Object(int(i)) for i in s["inscrits"]],
                                       roles=False, everyone=False)
    try:
        if s.get("message_id"):
            await channel.get_partial_message(int(s["message_id"])).reply(
                texte, allowed_mentions=mentions, mention_author=False)
        else:
            await channel.send(texte, allowed_mentions=mentions)
    except discord.HTTPException as exc:
        log.warning("rappel soirée %s : %s", s["id"], exc)


def start_scheduler(bot):
    bot.loop.create_task(_scheduler(bot))


def setup_persistent(bot):
    bot.add_dynamic_items(SoireeBouton)


# --- Actions dashboard ---
async def action_creer(bot, payload):
    try:
        return await _creer(bot, payload)
    except ValueError as exc:   # message lisible côté dashboard (pas un 400 muet)
        return {"ok": False, "error": str(exc)}


async def _creer(bot, payload):
    cfg = _cfg(bot)
    if not cfg.get("enabled"):
        raise ValueError("module désactivé (coche « Activer les soirées » et enregistre)")
    channel = bot.get_channel(int(cfg["channel_id"])) if cfg.get("channel_id") else None
    if channel is None:
        raise ValueError("salon d'annonce non configuré")
    titre = str(payload.get("titre") or "").strip()
    if not titre:
        raise ValueError("titre obligatoire")
    try:
        debut = datetime.fromisoformat(str(payload.get("debut")).replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("date invalide")
    if debut.tzinfo is None:
        debut = debut.replace(tzinfo=timezone.utc)
    if debut <= _now():
        raise ValueError("la date doit être dans le futur")
    try:
        places = max(0, min(int(payload.get("max") or 0), 100))
    except (TypeError, ValueError):
        places = 0
    s = {
        "id": uuid.uuid4().hex[:6], "titre": titre[:100],
        "jeu": str(payload.get("jeu") or "").strip()[:100],
        "description": str(payload.get("description") or "").strip()[:1500],
        "debut": debut.astimezone(timezone.utc).isoformat(), "max": places,
        "statut": "a_venir", "inscrits": [], "peut_etre": [], "rappel_envoye": False,
        "channel_id": str(channel.id), "message_id": None,
        "cree_par": str(payload.get("_acteur") or "dashboard")[:80], "cree": _now().isoformat(),
    }
    role = cfg.get("ping_role_id") if payload.get("ping") else None
    contenu = "<@&%s> — nouvelle soirée !" % role if role else None
    mentions = (discord.AllowedMentions(roles=[discord.Object(int(role))])
                if role else discord.AllowedMentions.none())
    try:
        msg = await channel.send(content=contenu, embed=_embed(s), view=_vue(s), allowed_mentions=mentions)
    except discord.Forbidden:
        raise ValueError("le bot ne peut pas écrire dans ce salon")
    s["message_id"] = str(msg.id)
    _sauver(bot, s)
    return {"ok": True, "id": s["id"]}


async def action_annuler(bot, payload):
    s = _get(bot, str(payload.get("id") or ""))
    if s is None:
        raise ValueError("soirée introuvable")
    if s["statut"] != "a_venir":
        return {"ok": True}
    s["statut"] = "annulee"
    _sauver(bot, s)
    await _maj_carte(bot, s)
    channel = bot.get_channel(int(s["channel_id"]))
    if channel is not None and s["inscrits"]:
        try:
            await channel.send(
                "❌ La soirée **%s** est annulée. %s" % (s["titre"], " ".join("<@%s>" % i for i in s["inscrits"])),
                allowed_mentions=discord.AllowedMentions(users=[discord.Object(int(i)) for i in s["inscrits"]]),
            )
        except discord.HTTPException:
            pass
    return {"ok": True}


async def action_supprimer(bot, payload):
    s = _get(bot, str(payload.get("id") or ""))
    if s is None:
        raise ValueError("soirée introuvable")
    channel = bot.get_channel(int(s["channel_id"]))
    if channel is not None and s.get("message_id"):
        try:
            await channel.get_partial_message(int(s["message_id"])).delete()
        except discord.HTTPException:
            pass
    bot.store.set("soirees", {"soirees": [x for x in _cfg(bot).get("soirees", []) if x["id"] != s["id"]]})
    return {"ok": True}


async def action_liste(bot, _payload):
    guild = bot.get_guild(config.GUILD_ID) if config.GUILD_ID else None

    def nom(uid):
        m = guild.get_member(int(uid)) if guild else None
        return m.display_name if m else "#%s" % uid

    return {"ok": True, "soirees": [
        {**s, "inscrits_noms": [nom(i) for i in s["inscrits"]],
         "peut_etre_noms": [nom(i) for i in s["peut_etre"]]}
        for s in _cfg(bot).get("soirees", [])
    ]}


MODULE = register(Module(
    key="soirees",
    label="Soirées",
    defaults=DEFAULTS,
    actions={"creer": action_creer, "annuler": action_annuler,
             "supprimer": action_supprimer, "liste": action_liste},
))
