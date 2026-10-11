"""Module « En ligne » : annonce dans un salon les jeux que les membres lancent.

Quand un membre lance un jeu (activité Discord « Joue à … »), le bot poste — après un
court délai anti faux-départ — une carte « 🎮 Red Dead Redemption 2 » listant qui y
joue. Une **seule carte par jeu** : si un deuxième membre lance le même jeu, la carte
existante est éditée (« En jeu : A, B ») au lieu d'en poster une nouvelle. Quand tout le
monde a quitté, la carte passe en « partie terminée » ; si quelqu'un relance dans le
délai de reprise, c'est elle qui reprend vie (pas de spam en cas de crash/relance).

Sous chaque carte vivante, un bouton « 🙋 Je suis chaud » : le membre qui clique poste
une réponse qui **pinge les joueurs en cours** — le but est de motiver les autres à
rejoindre. Optionnellement, la première annonce d'une partie pinge le **rôle-jeu**
correspondant (module Rôles-jeux), avec un délai minimal entre deux pings.

Prérequis : intent privilégié « Presence » coché sur le portail Discord ET
``FRIPOUILLE_PRESENCES=1`` dans le .env (voir config.py). L'état des parties est en
mémoire : un redémarrage du bot oublie les cartes en cours (sans conséquence).

Config :
- ``enabled`` / ``channel_id``
- ``delai_s``           : le jeu doit tourner depuis N secondes avant l'annonce.
- ``reprise_min``       : une carte terminée reprend vie si on relance dans ce délai.
- ``ping_role_jeu``     : pinger le rôle-jeu correspondant à la première annonce.
- ``ping_cooldown_min`` : délai minimal entre deux pings d'un même rôle-jeu.
- ``optout_role_id``    : les porteurs de ce rôle ne sont jamais annoncés.
- ``ignores``           : activités ignorées (applis qui se déclarent « en jeu »).
- ``purge_auto``        : purge automatique du salon.
- ``purge_jours``       : jours de la semaine (0 = lundi … 6 = dimanche) où purger.
- ``purge_heure``       : heure de la purge (« HH:MM », heure de Paris).
- ``purge_garder_h``    : ne supprime que les messages plus vieux que N heures (0 = tout).
- ``purge_derniere``    : date (Paris) de la dernière purge auto — état interne.
La purge épargne les messages épinglés ; les cartes des parties en cours sont republiées.
"""
import asyncio
import logging
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import discord

from .. import config
from ..registry import Module, register
from . import stats

log = logging.getLogger("fripouille.enligne")

BOUTON_ID = "enligne:chaud"
VERT = 0x57F287
GRIS = 0x4F545C

DEFAULTS = {
    "enabled": False,
    "channel_id": "1553696366382022727",
    "delai_s": 120,
    "reprise_min": 30,
    "ping_role_jeu": False,
    "ping_cooldown_min": 120,
    "optout_role_id": None,
    "ignores": [
        "Visual Studio Code", "Visual Studio", "Steam", "Wallpaper Engine",
        "Battle.net", "Epic Games Launcher", "EA app", "Ubisoft Connect",
        "Xbox", "Medal", "OBS Studio", "Discord",
    ],
    "purge_auto": False,
    "purge_jours": [0, 1, 2, 3, 4, 5, 6],
    "purge_heure": "04:00",
    "purge_garder_h": 0,
    "purge_derniere": "",
}
PARIS = ZoneInfo("Europe/Paris")

# --- État en mémoire ---
# clé de jeu (normalisée) → session
# {nom, channel_id, message_id, joueurs:{id: iso}, passes:set, debut, fin, chauds:set,
#  thumb}
_sessions: dict[str, dict] = {}
_attente: dict[tuple[int, str], asyncio.Task] = {}   # (membre, clé) → tâche de délai
_derniers_pings: dict[str, datetime] = {}             # clé → dernier ping du rôle-jeu
_verrou = asyncio.Lock()


def _now():
    return datetime.now(timezone.utc)


def _cle(nom: str) -> str:
    """Normalisation pour comparer des noms de jeux (accents, casse, ponctuation)."""
    s = unicodedata.normalize("NFKD", nom).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def _jeux(member: discord.Member, cfg: dict) -> dict[str, discord.BaseActivity]:
    """Jeux en cours d'un membre : clé → activité (type « Joue à », hors ignorés)."""
    ignores = {_cle(x) for x in cfg.get("ignores", []) if x}
    out = {}
    for a in member.activities or ():
        if getattr(a, "type", None) != discord.ActivityType.playing:
            continue
        nom = (getattr(a, "name", None) or "").strip()
        k = _cle(nom)
        if k and k not in ignores:
            out[k] = a
    return out


def _thumb(activity) -> str | None:
    url = getattr(activity, "large_image_url", None)
    return url if isinstance(url, str) and url.startswith("https://") else None


def _role_jeu(bot, nom: str):
    """Rôle-jeu (module Rôles-jeux) dont le libellé correspond au jeu lancé.

    Égalité normalisée, ou inclusion d'un nom dans l'autre (« Red Dead » ↔
    « Red Dead Redemption 2 ») à partir de 4 caractères pour éviter les faux positifs.
    """
    k = _cle(nom)
    for cat in bot.store.get("jeux").get("categories", []):
        for g in cat.get("games", []):
            gk = _cle(g.get("label") or "")
            if not gk or not g.get("role_id"):
                continue
            if gk == k or (min(len(gk), len(k)) >= 4 and (gk in k or k in gk)):
                return str(g["role_id"])
    return None


# --- Rendu ---
def _embed(s: dict) -> discord.Embed:
    ts = int(s["debut"].timestamp())
    if s["joueurs"]:
        ids = list(s["joueurs"])
        noms = ", ".join(f"<@{i}>" for i in ids)
        n = len(ids)
        lignes = [
            f"**En jeu ({n})** : {noms}",
            f"-# Partie lancée <t:{ts}:R> · rejoins-les ou clique sur 🙋 pour les prévenir",
        ]
        e = discord.Embed(title=f"🎮  {s['nom']}", description="\n".join(lignes), color=VERT)
    else:
        fin = int((s["fin"] or _now()).timestamp())
        passes = ", ".join(f"<@{i}>" for i in s["passes"])
        e = discord.Embed(
            title=s["nom"],
            description=f"-# Partie terminée <t:{fin}:R> · ont joué : {passes}",
            color=GRIS,
        )
    if s.get("role_id"):
        e.add_field(name="Rôle-jeu", value=f"<@&{s['role_id']}>", inline=True)
    if s.get("thumb"):
        e.set_thumbnail(url=s["thumb"])
    return e


class ChaudView(discord.ui.View):
    """Bouton persistant (même custom_id pour toutes les cartes, session retrouvée
    par l'id du message)."""

    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Je suis chaud", emoji="🙋", style=discord.ButtonStyle.success,
                       custom_id=BOUTON_ID)
    async def chaud(self, interaction: discord.Interaction, _button):
        s = next((x for x in _sessions.values()
                  if x.get("message_id") == interaction.message.id), None)
        if s is None or not s["joueurs"]:
            await interaction.response.send_message(
                "Cette partie n'est plus suivie — lance le jeu pour en démarrer une !",
                ephemeral=True,
            )
            return
        uid = interaction.user.id
        if uid in s["joueurs"]:
            await interaction.response.send_message("Tu y es déjà 😄", ephemeral=True)
            return
        if uid in s["chauds"]:
            await interaction.response.send_message(
                "Tu les as déjà prévenus pour cette partie.", ephemeral=True
            )
            return
        s["chauds"].add(uid)
        joueurs = " ".join(f"<@{i}>" for i in s["joueurs"])
        await interaction.response.send_message(
            f"🙋 <@{uid}> est chaud pour **{s['nom']}** ! {joueurs}",
            allowed_mentions=discord.AllowedMentions(users=True, roles=False, everyone=False),
        )


_VUE: ChaudView | None = None


def _vue() -> ChaudView:
    global _VUE
    if _VUE is None:
        _VUE = ChaudView()
    return _VUE


async def _maj_message(bot, s: dict):
    channel = bot.get_channel(int(s["channel_id"]))
    if channel is None or not s.get("message_id"):
        return
    try:
        msg = channel.get_partial_message(s["message_id"])
        await msg.edit(embed=_embed(s), view=_vue() if s["joueurs"] else None)
    except discord.NotFound:
        s["message_id"] = None
    except discord.HTTPException as exc:
        log.warning("édition carte %s : %s", s["nom"], exc)


def _purger(cfg: dict):
    """Oublie les sessions terminées au-delà du délai de reprise."""
    limite = _now() - timedelta(minutes=max(1, int(cfg.get("reprise_min") or 30)))
    for k in [k for k, s in _sessions.items() if not s["joueurs"] and s["fin"] and s["fin"] < limite]:
        del _sessions[k]


# --- Cycle d'une partie ---
async def _annoncer(bot, member: discord.Member, k: str, activity):
    cfg = bot.store.get("enligne")
    channel_id = cfg.get("channel_id")
    channel = bot.get_channel(int(channel_id)) if channel_id else None
    if channel is None:
        log.warning("enligne : salon %s introuvable", channel_id)
        return
    async with _verrou:
        _purger(cfg)
        s = _sessions.get(k)
        if s is not None and s.get("message_id"):
            # Carte vivante (ou terminée récemment) : on y ajoute le joueur.
            if member.id in s["joueurs"]:
                return
            if not s["joueurs"]:
                s["debut"], s["fin"], s["chauds"] = _now(), None, set()
            s["joueurs"][member.id] = _now().isoformat()
            s["passes"].add(member.id)
            s["thumb"] = s.get("thumb") or _thumb(activity)
            await _maj_message(bot, s)
            return

        nom = (activity.name or "").strip()
        s = {
            "nom": nom, "channel_id": int(channel.id), "message_id": None,
            "joueurs": {member.id: _now().isoformat()}, "passes": {member.id},
            "debut": _now(), "fin": None, "chauds": set(), "thumb": _thumb(activity),
            "role_id": _role_jeu(bot, nom),
        }
        contenu, mentions = None, discord.AllowedMentions.none()
        if cfg.get("ping_role_jeu") and s["role_id"]:
            dernier = _derniers_pings.get(k)
            delai = timedelta(minutes=max(0, int(cfg.get("ping_cooldown_min") or 0)))
            if dernier is None or _now() - dernier >= delai:
                contenu = f"<@&{s['role_id']}> — **{member.display_name}** vient de lancer **{nom}** !"
                mentions = discord.AllowedMentions(roles=[discord.Object(int(s["role_id"]))])
                _derniers_pings[k] = _now()
        try:
            msg = await channel.send(content=contenu, embed=_embed(s), view=_vue(),
                                     allowed_mentions=mentions)
        except discord.HTTPException as exc:
            log.error("annonce %s : %s", nom, exc)
            return
        s["message_id"] = msg.id
        _sessions[k] = s


async def _apres_delai(bot, guild_id: int, member_id: int, k: str, delai: int):
    try:
        await asyncio.sleep(delai)
        guild = bot.get_guild(guild_id)
        member = guild.get_member(member_id) if guild else None
        if member is None:
            return
        cfg = bot.store.get("enligne")
        activity = _jeux(member, cfg).get(k)
        if activity is not None and cfg.get("enabled"):
            await _annoncer(bot, member, k, activity)
    except asyncio.CancelledError:
        pass
    except Exception as exc:  # noqa: BLE001
        log.error("enligne : %s", exc)
    finally:
        _attente.pop((member_id, k), None)


async def _arret(bot, member: discord.Member, k: str):
    tache = _attente.pop((member.id, k), None)
    if tache is not None:
        tache.cancel()
    async with _verrou:
        s = _sessions.get(k)
        if s is None or member.id not in s["joueurs"]:
            return
        debut = s["joueurs"].pop(member.id)
        try:
            minutes = (_now() - datetime.fromisoformat(debut)).total_seconds() / 60
            stats.enregistrer_jeu(bot, s["nom"], minutes, member.id)
        except Exception as exc:  # noqa: BLE001  (les stats ne doivent jamais casser l'annonce)
            log.warning("stats jeu : %s", exc)
        if not s["joueurs"]:
            s["fin"] = _now()
        await _maj_message(bot, s)


async def on_presence_update(bot, before: discord.Member, after: discord.Member):
    cfg = bot.store.get("enligne")
    if not cfg.get("enabled") or after.bot:
        return
    optout = cfg.get("optout_role_id")
    if optout and any(str(r.id) == str(optout) for r in after.roles):
        return
    avant, apres = _jeux(before, cfg), _jeux(after, cfg)
    for k in apres.keys() - avant.keys():
        if (after.id, k) in _attente:
            continue
        delai = max(0, int(cfg.get("delai_s") or 0))
        _attente[(after.id, k)] = asyncio.create_task(
            _apres_delai(bot, after.guild.id, after.id, k, delai)
        )
    for k in avant.keys() - apres.keys():
        await _arret(bot, after, k)


# --- Purge du salon ---
async def _purge_salon(bot, garder_h: int = 0) -> int:
    """Supprime les messages du salon (hors épinglés, hors ceux plus récents que
    ``garder_h`` heures), puis republie les cartes des parties en cours.
    Lève ValueError (salon introuvable) ou discord.Forbidden (permission manquante)."""
    cfg = bot.store.get("enligne")
    channel_id = cfg.get("channel_id")
    channel = bot.get_channel(int(channel_id)) if channel_id else None
    if channel is None:
        raise ValueError("salon introuvable")
    avant = _now() - timedelta(hours=garder_h) if garder_h > 0 else None
    supprimes: set[int] = set()

    def garde(m: discord.Message) -> bool:
        if m.pinned:
            return False
        supprimes.add(m.id)
        return True

    async with _verrou:
        effaces = await channel.purge(limit=None, check=garde, before=avant, bulk=True,
                                      reason="Purge du salon « En ligne »")
        for k, s in list(_sessions.items()):
            if s.get("message_id") not in supprimes:
                continue
            if not s["joueurs"]:
                del _sessions[k]
                continue
            try:
                msg = await channel.send(embed=_embed(s), view=_vue(),
                                         allowed_mentions=discord.AllowedMentions.none())
                s["message_id"] = msg.id
            except discord.HTTPException as exc:
                log.error("republication %s : %s", s["nom"], exc)
                s["message_id"] = None
    return len(effaces)


def _prochaine_purge(cfg: dict) -> str | None:
    """Prochaine purge auto prévue (ISO, heure de Paris), ou None."""
    if not cfg.get("purge_auto"):
        return None
    jours = {int(j) for j in cfg.get("purge_jours") or [] if str(j).isdigit()}
    try:
        h, m = (int(x) for x in str(cfg.get("purge_heure") or "04:00").split(":"))
    except ValueError:
        return None
    if not jours:
        return None
    now = datetime.now(PARIS)
    aujourdhui = now.strftime("%Y-%m-%d")
    for i in range(8):
        jour = now + timedelta(days=i)
        cible = jour.replace(hour=h, minute=m, second=0, microsecond=0)
        if jour.weekday() not in jours:
            continue
        if cible > now or (i == 0 and cfg.get("purge_derniere") != aujourdhui):
            return cible.isoformat()
    return None


async def apply(bot, cfg):
    """À l'activation de la purge auto : si l'heure du jour est déjà passée, on ne
    purge pas aussitôt (la première purge aura lieu à la prochaine échéance)."""
    if not cfg.get("purge_auto") or cfg.get("purge_derniere"):
        return
    now = datetime.now(PARIS)
    prochaine = _prochaine_purge(cfg)
    if prochaine and datetime.fromisoformat(prochaine) <= now:
        bot.store.set("enligne", {"purge_derniere": now.strftime("%Y-%m-%d")})


async def _scheduler(bot):
    await bot.wait_until_ready()
    while not bot.is_closed():
        try:
            cfg = bot.store.get("enligne")
            if cfg.get("purge_auto"):
                prochaine = _prochaine_purge(cfg)
                now = datetime.now(PARIS)
                if prochaine and datetime.fromisoformat(prochaine) <= now:
                    # Marqué avant l'exécution : en cas d'échec, pas de boucle de retry.
                    bot.store.set("enligne", {"purge_derniere": now.strftime("%Y-%m-%d")})
                    try:
                        n = await _purge_salon(bot, max(0, int(cfg.get("purge_garder_h") or 0)))
                        log.info("purge auto du salon « En ligne » : %d message(s)", n)
                    except Exception as exc:  # noqa: BLE001
                        log.error("purge auto : %s", exc)
        except Exception as exc:  # noqa: BLE001
            log.error("scheduler enligne : %s", exc)
        await asyncio.sleep(60)


def start_scheduler(bot):
    bot.loop.create_task(_scheduler(bot))


def setup_persistent(bot):
    """Réenregistre le bouton « Je suis chaud » (cliquable après redémarrage — il
    répond alors que la partie n'est plus suivie)."""
    bot.add_view(_vue())


# --- Actions dashboard ---
async def action_etat(bot, _payload):
    """Parties en cours (pour le panneau) — noms affichables, pas d'ids exposés inutilement."""
    guild = bot.get_guild(config.GUILD_ID) if config.GUILD_ID else None

    def nom(mid):
        m = guild.get_member(mid) if guild else None
        return m.display_name if m else str(mid)

    parties = [
        {
            "nom": s["nom"],
            "joueurs": [nom(i) for i in s["joueurs"]],
            "debut": s["debut"].isoformat(),
            "terminee": not s["joueurs"],
        }
        for s in _sessions.values()
    ]
    parties.sort(key=lambda p: (p["terminee"], p["debut"]))
    return {
        "ok": True, "presences": config.PRESENCES, "parties": parties,
        "purge_prochaine": _prochaine_purge(bot.store.get("enligne")),
    }


async def action_purger(bot, payload):
    """Purge manuelle du salon. ``garder_h`` (optionnel) épargne les messages récents."""
    try:
        garder = max(0, int((payload or {}).get("garder_h") or 0))
    except (TypeError, ValueError):
        garder = 0
    try:
        n = await _purge_salon(bot, garder)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    except discord.Forbidden:
        return {"ok": False, "error": "permission « Gérer les messages » manquante dans ce salon"}
    except discord.HTTPException as exc:
        return {"ok": False, "error": "Discord : %s" % exc}
    return {"ok": True, "supprimes": n}


MODULE = register(Module(
    key="enligne",
    label="En ligne",
    defaults=DEFAULTS,
    apply=apply,
    actions={"etat": action_etat, "purger": action_purger},
))
