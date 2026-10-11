"""Module « Garde » : anti-raid et réaction rapide.

Trois protections, toutes pilotées depuis le dashboard :

- **Pic d'arrivées** : N membres qui rejoignent en moins de ``arrivees_fenetre_s``
  secondes déclenchent l'alerte (salon staff + ping), puis — au choix — l'exclusion
  temporaire des arrivants récents (``auto_timeout``) et/ou le **verrouillage** du serveur
  (``auto_verrou``).
- **Flood** : un membre non-modérateur qui envoie ``flood_messages`` messages en moins de
  ``flood_fenetre_s`` secondes, ou un message avec ``mentions_seuil`` mentions ou plus (ou
  un @everyone sans en avoir le droit), est exclu temporairement et son message supprimé.
  Sans l'intent message_content : on compte les messages et les mentions, jamais le texte.
- **Verrouillage** : met les invitations en pause et monte la vérification au niveau
  maximal ; le déverrouillage restaure l'état d'avant. Bouton d'urgence du dashboard, ou
  automatique ; ``verrou_duree_min`` > 0 le lève tout seul.

Permissions requises côté bot : « Gérer le serveur » (verrou), « Exclure temporairement
des membres » (timeouts), « Gérer les messages » (suppression du flood).
L'état des compteurs est en mémoire ; seul l'état du verrou est persisté (``verrou``).
"""
import asyncio
import logging
from collections import deque
from datetime import datetime, timedelta, timezone

import discord

from .. import config
from ..registry import Module, register

log = logging.getLogger("fripouille.garde")

MAX_TIMEOUT_MIN = 28 * 24 * 60

DEFAULTS = {
    "enabled": False,
    "alert_channel_id": None,
    "alert_role_id": None,
    # Pic d'arrivées
    "arrivees_seuil": 8,
    "arrivees_fenetre_s": 60,
    "auto_timeout": False,
    "timeout_minutes": 60,
    "auto_verrou": False,
    "verrou_duree_min": 30,      # 0 = jusqu'au déverrouillage manuel
    # Flood
    "flood_actif": True,
    "flood_messages": 8,
    "flood_fenetre_s": 8,
    "mentions_seuil": 6,
    "flood_timeout_min": 10,
    # État (géré par le bot)
    "verrou": {},
}

_arrivees: deque = deque()                       # (member_id, datetime)
_messages: dict[int, deque] = {}                 # member_id → horodatages récents
_alertes: deque = deque(maxlen=20)               # journal court pour le dashboard
_derniere_alerte_raid: datetime | None = None
_verrou_op = asyncio.Lock()


def _now():
    return datetime.now(timezone.utc)


def _guild(bot):
    if config.GUILD_ID:
        return bot.get_guild(config.GUILD_ID)
    return bot.guilds[0] if bot.guilds else None


def _staff(member: discord.Member) -> bool:
    p = member.guild_permissions
    return member.bot or p.administrator or p.manage_messages or p.moderate_members or p.manage_guild


# --- Alertes ---
async def _alerter(bot, titre: str, texte: str, couleur=0xED4245):
    _alertes.appendleft({"quand": _now().isoformat(), "titre": titre, "texte": texte})
    log.warning("garde : %s — %s", titre, texte)
    cfg = bot.store.get("garde")
    cid = cfg.get("alert_channel_id")
    channel = bot.get_channel(int(cid)) if cid else None
    if channel is None:
        return
    role = cfg.get("alert_role_id")
    contenu = "<@&%s>" % role if role else None
    mentions = discord.AllowedMentions(roles=[discord.Object(int(role))]) if role else discord.AllowedMentions.none()
    e = discord.Embed(title="🚨 " + titre, description=texte, color=couleur, timestamp=_now())
    try:
        await channel.send(content=contenu, embed=e, allowed_mentions=mentions)
    except discord.HTTPException as exc:
        log.error("alerte garde : %s", exc)


async def _exclure(member: discord.Member, minutes: int, raison: str) -> bool:
    minutes = max(1, min(int(minutes), MAX_TIMEOUT_MIN))
    try:
        await member.timeout(timedelta(minutes=minutes), reason=raison)
        return True
    except discord.HTTPException as exc:
        log.warning("timeout %s : %s", member, exc)
        return False


# --- Verrou ---
async def verrouiller(bot, par: str, auto: bool = False) -> dict:
    async with _verrou_op:
        cfg = bot.store.get("garde")
        if (cfg.get("verrou") or {}).get("actif"):
            return {"ok": True, "deja": True}
        guild = _guild(bot)
        if guild is None:
            raise ValueError("serveur introuvable")
        paused = getattr(guild, "invites_paused", None)
        etat = {
            "actif": True, "depuis": _now().isoformat(), "par": par, "auto": auto,
            "verif_avant": int(guild.verification_level.value),
            "invites_avant": bool(paused()) if callable(paused) else False,
        }
        raison = "Garde : verrouillage (%s)" % par
        try:
            try:
                await guild.edit(verification_level=discord.VerificationLevel.highest,
                                 invites_disabled=True, reason=raison)
            except TypeError:   # discord.py ancien : pas de invites_disabled
                await guild.edit(verification_level=discord.VerificationLevel.highest, reason=raison)
        except discord.Forbidden:
            raise ValueError("permission « Gérer le serveur » manquante")
        except discord.HTTPException as exc:
            raise ValueError("Discord : %s" % exc)
        bot.store.set("garde", {"verrou": etat})
    await _alerter(bot, "Serveur verrouillé",
                   "Invitations en pause, vérification au maximum. Déclenché par **%s**." % par,
                   0xE67E22)
    return {"ok": True}


async def deverrouiller(bot, par: str) -> dict:
    async with _verrou_op:
        cfg = bot.store.get("garde")
        etat = cfg.get("verrou") or {}
        if not etat.get("actif"):
            return {"ok": True, "deja": True}
        guild = _guild(bot)
        if guild is None:
            raise ValueError("serveur introuvable")
        raison = "Garde : déverrouillage (%s)" % par
        try:
            niveau = discord.VerificationLevel(int(etat.get("verif_avant", 1)))
            try:
                await guild.edit(verification_level=niveau,
                                 invites_disabled=bool(etat.get("invites_avant")), reason=raison)
            except TypeError:
                await guild.edit(verification_level=niveau, reason=raison)
        except discord.Forbidden:
            raise ValueError("permission « Gérer le serveur » manquante")
        except discord.HTTPException as exc:
            raise ValueError("Discord : %s" % exc)
        bot.store.set("garde", {"verrou": {}})
    await _alerter(bot, "Serveur déverrouillé", "Retour à la normale par **%s**." % par, 0x57F287)
    return {"ok": True}


# --- Détection ---
async def on_member_join(bot, member: discord.Member):
    global _derniere_alerte_raid
    cfg = bot.store.get("garde")
    if not cfg.get("enabled") or member.bot:
        return
    now = _now()
    fenetre = timedelta(seconds=max(5, int(cfg.get("arrivees_fenetre_s") or 60)))
    _arrivees.append((member.id, now))
    while _arrivees and now - _arrivees[0][1] > fenetre:
        _arrivees.popleft()
    if len(_arrivees) < max(2, int(cfg.get("arrivees_seuil") or 8)):
        return
    if _derniere_alerte_raid and now - _derniere_alerte_raid < timedelta(minutes=5):
        # Raid en cours déjà signalé : les nouveaux arrivants sont quand même exclus.
        if cfg.get("auto_timeout"):
            await _exclure(member, cfg.get("timeout_minutes") or 60, "Garde : raid en cours")
        return
    _derniere_alerte_raid = now
    ids = [i for i, _ in _arrivees]
    actions = []
    guild = member.guild
    if cfg.get("auto_timeout"):
        n = 0
        for i in ids:
            m = guild.get_member(i)
            if m is not None and not _staff(m) and await _exclure(
                    m, cfg.get("timeout_minutes") or 60, "Garde : raid (arrivées en masse)"):
                n += 1
        actions.append("%d arrivant(s) exclu(s) %d min" % (n, int(cfg.get("timeout_minutes") or 60)))
    if cfg.get("auto_verrou"):
        try:
            await verrouiller(bot, "détection automatique", auto=True)
            actions.append("serveur verrouillé")
        except ValueError as exc:
            actions.append("verrouillage impossible (%s)" % exc)
    texte = "**%d arrivées en %d s.**\n%s\n%s" % (
        len(ids), int(fenetre.total_seconds()),
        " ".join("<@%d>" % i for i in ids[:25]),
        ("Actions : " + ", ".join(actions)) if actions else "Aucune action automatique — à toi de jouer (dashboard → Garde).",
    )
    await _alerter(bot, "Pic d'arrivées suspect", texte)


async def on_message(bot, message: discord.Message):
    cfg = bot.store.get("garde")
    if not cfg.get("enabled") or not cfg.get("flood_actif"):
        return
    auteur = message.author
    if not isinstance(auteur, discord.Member) or _staff(auteur):
        return
    now = _now()
    motif = None
    nb_mentions = len(message.mentions) + len(message.role_mentions)
    if message.mention_everyone and not auteur.guild_permissions.mention_everyone:
        motif = "@everyone/@here sans permission"
    elif nb_mentions >= max(2, int(cfg.get("mentions_seuil") or 6)):
        motif = "%d mentions dans un message" % nb_mentions
    else:
        fen = timedelta(seconds=max(2, int(cfg.get("flood_fenetre_s") or 8)))
        q = _messages.setdefault(auteur.id, deque())
        q.append(now)
        while q and now - q[0] > fen:
            q.popleft()
        if len(q) >= max(3, int(cfg.get("flood_messages") or 8)):
            motif = "%d messages en %d s" % (len(q), int(fen.total_seconds()))
            q.clear()
        if len(_messages) > 2000:   # garde-fou mémoire
            _messages.clear()
    if motif is None:
        return
    try:
        await message.delete()
    except discord.HTTPException:
        pass
    minutes = int(cfg.get("flood_timeout_min") or 10)
    ok = await _exclure(auteur, minutes, "Garde : " + motif)
    await _alerter(
        bot, "Flood détecté",
        "<@%d> — %s dans <#%d>.\n%s" % (
            auteur.id, motif, message.channel.id,
            ("Exclu %d min, message supprimé." % minutes) if ok else "Exclusion impossible (permission ?)."),
        0xE67E22,
    )


# --- Planificateur : levée automatique du verrou, nettoyage ---
async def _scheduler(bot):
    await bot.wait_until_ready()
    while not bot.is_closed():
        try:
            cfg = bot.store.get("garde")
            v = cfg.get("verrou") or {}
            duree = int(cfg.get("verrou_duree_min") or 0)
            if v.get("actif") and v.get("auto") and duree > 0:
                depuis = datetime.fromisoformat(v["depuis"])
                if _now() - depuis >= timedelta(minutes=duree):
                    await deverrouiller(bot, "levée automatique")
            now = _now()
            for uid in [u for u, q in _messages.items() if not q or now - q[-1] > timedelta(minutes=2)]:
                _messages.pop(uid, None)
        except Exception as exc:  # noqa: BLE001
            log.error("scheduler garde : %s", exc)
        await asyncio.sleep(30)


def start_scheduler(bot):
    bot.loop.create_task(_scheduler(bot))


# --- Actions dashboard ---
def _acteur(payload):
    return str(payload.get("_acteur") or "dashboard")


async def action_etat(bot, _payload):
    cfg = bot.store.get("garde")
    guild = _guild(bot)
    now = _now()
    fen = timedelta(seconds=max(5, int(cfg.get("arrivees_fenetre_s") or 60)))
    recentes = sum(1 for _, t in _arrivees if now - t <= fen)
    perms = {}
    if guild is not None and guild.me is not None:
        p = guild.me.guild_permissions
        perms = {"manage_guild": p.manage_guild, "moderate_members": p.moderate_members,
                 "manage_messages": p.manage_messages}
    return {"ok": True, "verrou": cfg.get("verrou") or {}, "arrivees_fenetre": recentes,
            "perms": perms, "alertes": list(_alertes)}


async def action_verrouiller(bot, payload):
    try:
        return await verrouiller(bot, _acteur(payload))
    except ValueError as exc:   # message lisible côté dashboard (pas un 400 muet)
        return {"ok": False, "error": str(exc)}


async def action_deverrouiller(bot, payload):
    try:
        return await deverrouiller(bot, _acteur(payload))
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}


async def action_neutraliser(bot, payload):
    try:
        return await _neutraliser(bot, payload)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}


async def _neutraliser(bot, payload):
    """Exclut temporairement tous les membres arrivés dans les ``depuis_min`` dernières minutes."""
    guild = _guild(bot)
    if guild is None:
        raise ValueError("serveur introuvable")
    cfg = bot.store.get("garde")
    try:
        depuis = max(1, min(int(payload.get("depuis_min") or 10), 1440))
        minutes = max(1, int(payload.get("minutes") or cfg.get("timeout_minutes") or 60))
    except (TypeError, ValueError):
        raise ValueError("valeurs invalides")
    limite = _now() - timedelta(minutes=depuis)
    n = 0
    for m in guild.members:
        if m.joined_at and m.joined_at >= limite and not _staff(m):
            if await _exclure(m, minutes, "Garde : neutralisation par %s" % _acteur(payload)):
                n += 1
    await _alerter(bot, "Arrivants récents neutralisés",
                   "%d membre(s) arrivés depuis moins de %d min exclus %d min par **%s**." % (
                       n, depuis, minutes, _acteur(payload)), 0xE67E22)
    return {"ok": True, "exclus": n}


async def action_tester(bot, payload):
    await _alerter(bot, "Test d'alerte", "Alerte de test déclenchée par **%s**." % _acteur(payload), 0x3498DB)
    return {"ok": True}


MODULE = register(Module(
    key="garde",
    label="Garde",
    defaults=DEFAULTS,
    actions={
        "etat": action_etat, "verrouiller": action_verrouiller, "deverrouiller": action_deverrouiller,
        "neutraliser": action_neutraliser, "tester": action_tester,
    },
))
