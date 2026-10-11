"""Module « Diffusions » : annonces de lives Twitch et de nouvelles vidéos YouTube.

- **Twitch** : API Helix (jeton d'application, ``TWITCH_CLIENT_ID`` / ``TWITCH_CLIENT_SECRET``
  dans le .env). Une annonce est postée quand un streamer suivi **passe en direct** (une par
  diffusion, identifiée par l'id du stream).
- **YouTube** : flux RSS public de chaque chaîne, sans clé d'API. Une annonce par **nouvelle
  vidéo** publiée après l'ajout de la chaîne.

La première observation d'un suivi est silencieuse (on enregistre l'état courant, sans
annoncer l'existant). L'état vu (``etat``) est persisté pour survivre aux redémarrages.

Config :
- ``enabled`` / ``channel_id`` / ``ping_role_id``
- ``twitch``   : ``[{login, nom}]``
- ``youtube``  : ``[{channel_id, nom}]`` (``channel_id`` = « UC… »)
- ``twitch_intervalle_min`` : fréquence de vérification des lives.
- ``etat``     : état vu (géré par le bot).
"""
import asyncio
import logging
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import aiohttp
import discord

from .. import config
from ..registry import Module, register

log = logging.getLogger("fripouille.diffusions")

DEFAULTS = {
    "enabled": False,
    "channel_id": None,
    "ping_role_id": None,
    "twitch": [],
    "youtube": [],
    "twitch_intervalle_min": 3,
    "etat": {"twitch": {}, "youtube": {}},
}

LOGIN_RE = re.compile(r"^[a-z0-9_]{3,25}$")
YT_ID_RE = re.compile(r"^UC[0-9A-Za-z_-]{22}$")
TIMEOUT = aiohttp.ClientTimeout(total=15)
YT_INTERVALLE_S = 600

_jeton: dict = {"valeur": None, "expire": 0.0}
_derniere = {"twitch": None, "youtube": None}   # horodatages des dernières vérifications
_lives: dict[str, dict] = {}                     # login → infos du live en cours (pour le dashboard)
_erreur: dict = {"twitch": None, "youtube": None}


def _completer(cfg: dict) -> dict:
    twitch, vus = [], set()
    for t in cfg.get("twitch") or []:
        login = str((t or {}).get("login") or "").strip().lower().removeprefix("https://twitch.tv/").strip("/")
        if LOGIN_RE.match(login) and login not in vus:
            vus.add(login)
            twitch.append({"login": login, "nom": str(t.get("nom") or "").strip()[:60]})
    youtube, vus = [], set()
    for y in cfg.get("youtube") or []:
        cid = str((y or {}).get("channel_id") or "").strip()
        if YT_ID_RE.match(cid) and cid not in vus:
            vus.add(cid)
            youtube.append({"channel_id": cid, "nom": str(y.get("nom") or "").strip()[:60]})
    return {**cfg, "twitch": twitch, "youtube": youtube}


# --- Envoi ---
async def _poster(bot, embed: discord.Embed, ping: bool = True):
    cfg = bot.store.get("diffusions")
    channel = bot.get_channel(int(cfg["channel_id"])) if cfg.get("channel_id") else None
    if channel is None:
        log.warning("diffusions : salon introuvable")
        return
    role = cfg.get("ping_role_id") if ping else None
    mentions = (discord.AllowedMentions(roles=[discord.Object(int(role))])
                if role else discord.AllowedMentions.none())
    try:
        await channel.send(content=("<@&%s>" % role) if role else None, embed=embed,
                           allowed_mentions=mentions)
    except discord.HTTPException as exc:
        log.error("annonce diffusion : %s", exc)


# --- Twitch ---
async def _jeton_twitch(session) -> str | None:
    if not (config.TWITCH_CLIENT_ID and config.TWITCH_CLIENT_SECRET):
        return None
    if _jeton["valeur"] and time.monotonic() < _jeton["expire"]:
        return _jeton["valeur"]
    async with session.post("https://id.twitch.tv/oauth2/token", params={
        "client_id": config.TWITCH_CLIENT_ID, "client_secret": config.TWITCH_CLIENT_SECRET,
        "grant_type": "client_credentials",
    }) as r:
        if r.status != 200:
            raise RuntimeError("jeton Twitch refusé (%s)" % r.status)
        data = await r.json()
    _jeton["valeur"] = data["access_token"]
    _jeton["expire"] = time.monotonic() + max(60, int(data.get("expires_in", 3600)) - 300)
    return _jeton["valeur"]


async def _verifier_twitch(bot):
    cfg = bot.store.get("diffusions")
    suivis = cfg.get("twitch") or []
    _derniere["twitch"] = datetime.now(timezone.utc).isoformat()
    if not suivis:
        _lives.clear()
        return
    async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
        jeton = await _jeton_twitch(session)
        if jeton is None:
            _erreur["twitch"] = "TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET absents du .env"
            return
        en_direct = {}
        for i in range(0, len(suivis), 100):
            lot = suivis[i:i + 100]
            params = [("user_login", s["login"]) for s in lot]
            async with session.get("https://api.twitch.tv/helix/streams", params=params, headers={
                "Client-Id": config.TWITCH_CLIENT_ID, "Authorization": "Bearer " + jeton,
            }) as r:
                if r.status == 401:
                    _jeton["valeur"] = None
                    raise RuntimeError("jeton Twitch expiré")
                if r.status != 200:
                    raise RuntimeError("Twitch HTTP %s" % r.status)
                for st in (await r.json()).get("data", []):
                    if st.get("type") == "live":
                        en_direct[st["user_login"].lower()] = st
    _erreur["twitch"] = None
    _lives.clear()
    _lives.update({k: {"titre": v.get("title"), "jeu": v.get("game_name"),
                       "spectateurs": v.get("viewer_count"), "depuis": v.get("started_at")}
                   for k, v in en_direct.items()})

    etat = dict((cfg.get("etat") or {}).get("twitch") or {})
    modifie = False
    for s in suivis:
        login = s["login"]
        st = en_direct.get(login)
        avant = etat.get(login)            # None = jamais observé
        if st is not None:
            if avant is None or avant.get("stream_id") != st["id"]:
                etat[login] = {"stream_id": st["id"]}
                modifie = True
                if avant is not None:      # nouvelle diffusion (pas la 1re observation)
                    await _annoncer_twitch(bot, s, st)
        elif avant is None or avant.get("stream_id"):
            etat[login] = {"stream_id": None}
            modifie = True
    if modifie:
        full = dict(bot.store.get("diffusions").get("etat") or {})
        full["twitch"] = etat
        bot.store.set("diffusions", {"etat": full})


async def _annoncer_twitch(bot, suivi, st):
    nom = st.get("user_name") or suivi["login"]
    e = discord.Embed(
        title="🔴  %s est en live !" % nom, url="https://twitch.tv/%s" % suivi["login"],
        description=(st.get("title") or "")[:300], color=0x9146FF,
    )
    if st.get("game_name"):
        e.add_field(name="🎮 Jeu", value=st["game_name"][:100], inline=True)
    thumb = (st.get("thumbnail_url") or "").replace("{width}", "440").replace("{height}", "248")
    if thumb.startswith("https://"):
        e.set_image(url="%s?t=%d" % (thumb, int(time.time())))
    e.set_footer(text="Twitch")
    await _poster(bot, e)


# --- YouTube ---
async def _verifier_youtube(bot):
    cfg = bot.store.get("diffusions")
    suivis = cfg.get("youtube") or []
    _derniere["youtube"] = datetime.now(timezone.utc).isoformat()
    etat = dict((cfg.get("etat") or {}).get("youtube") or {})
    modifie, derniere_erreur = False, None
    ns = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}
    async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
        for s in suivis:
            cid = s["channel_id"]
            try:
                async with session.get("https://www.youtube.com/feeds/videos.xml",
                                       params={"channel_id": cid}) as r:
                    if r.status != 200:
                        raise RuntimeError("HTTP %s" % r.status)
                    racine = ET.fromstring(await r.text())
            except Exception as exc:  # noqa: BLE001
                derniere_erreur = "YouTube %s : %s" % (s.get("nom") or cid, exc)
                continue
            videos = []
            for entree in racine.findall("a:entry", ns):
                vid = entree.findtext("yt:videoId", namespaces=ns)
                if vid:
                    videos.append({"id": vid, "titre": entree.findtext("a:title", namespaces=ns) or "",
                                   "auteur": entree.findtext("a:author/a:name", namespaces=ns) or s.get("nom") or ""})
            if not videos:
                continue
            vus = etat.get(cid)
            ids = [v["id"] for v in videos]
            if vus is None:                 # 1re observation : silencieuse
                etat[cid] = ids[:15]
                modifie = True
                continue
            nouvelles = [v for v in videos if v["id"] not in vus]
            if nouvelles:
                etat[cid] = (ids + vus)[:15]
                modifie = True
                for v in reversed(nouvelles[:3]):     # anciennes d'abord, 3 max d'un coup
                    e = discord.Embed(title="▶️  %s" % v["titre"][:250],
                                      url="https://www.youtube.com/watch?v=%s" % v["id"],
                                      description="Nouvelle vidéo de **%s**" % v["auteur"], color=0xFF0000)
                    e.set_image(url="https://i.ytimg.com/vi/%s/hqdefault.jpg" % v["id"])
                    e.set_footer(text="YouTube")
                    await _poster(bot, e)
    _erreur["youtube"] = derniere_erreur
    if modifie:
        full = dict(bot.store.get("diffusions").get("etat") or {})
        full["youtube"] = etat
        bot.store.set("diffusions", {"etat": full})


# --- Boucle ---
async def _boucle(bot):
    await bot.wait_until_ready()
    prochain_yt = 0.0
    prochain_tw = 0.0
    while not bot.is_closed():
        try:
            cfg = bot.store.get("diffusions")
            if cfg.get("enabled") and cfg.get("channel_id"):
                now = time.monotonic()
                if now >= prochain_tw:
                    prochain_tw = now + max(1, int(cfg.get("twitch_intervalle_min") or 3)) * 60
                    try:
                        await _verifier_twitch(bot)
                    except Exception as exc:  # noqa: BLE001
                        _erreur["twitch"] = str(exc)
                        log.warning("twitch : %s", exc)
                if now >= prochain_yt:
                    prochain_yt = now + YT_INTERVALLE_S
                    try:
                        await _verifier_youtube(bot)
                    except Exception as exc:  # noqa: BLE001
                        _erreur["youtube"] = str(exc)
                        log.warning("youtube : %s", exc)
        except Exception as exc:  # noqa: BLE001
            log.error("diffusions : %s", exc)
        await asyncio.sleep(30)


def start_scheduler(bot):
    bot.loop.create_task(_boucle(bot))


# --- Actions dashboard ---
async def action_etat(bot, _payload):
    return {
        "ok": True,
        "twitch_configure": bool(config.TWITCH_CLIENT_ID and config.TWITCH_CLIENT_SECRET),
        "derniere": _derniere, "erreurs": _erreur, "lives": _lives,
    }


async def action_resoudre_youtube(bot, payload):
    """Trouve l'identifiant « UC… » d'une chaîne à partir de son URL, @handle ou id."""
    brut = str(payload.get("valeur") or "").strip()
    if YT_ID_RE.match(brut):
        return {"ok": True, "channel_id": brut}
    m = re.search(r"youtube\.com/channel/(UC[0-9A-Za-z_-]{22})", brut)
    if m:
        return {"ok": True, "channel_id": m.group(1)}
    handle = re.search(r"(@[A-Za-z0-9._-]{3,40})", brut)
    if not handle:
        return {"ok": False, "error": "colle l'URL de la chaîne (youtube.com/@nom) ou son identifiant UC…"}
    try:
        async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
            async with session.get("https://www.youtube.com/%s" % handle.group(1),
                                   headers={"Accept-Language": "fr"}, cookies={"CONSENT": "YES+1"}) as r:
                html = await r.text()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": "YouTube injoignable : %s" % exc}
    m = re.search(r'"(?:externalId|channelId)":"(UC[0-9A-Za-z_-]{22})"', html)
    if not m:
        return {"ok": False, "error": "chaîne introuvable — colle plutôt l'URL youtube.com/channel/UC…"}
    return {"ok": True, "channel_id": m.group(1)}


async def action_tester(bot, payload):
    e = discord.Embed(title="🔴  Test d'annonce", description="Ceci est un message de test du module Diffusions.",
                      color=0x9146FF)
    await _poster(bot, e, ping=False)
    return {"ok": True}


MODULE = register(Module(
    key="diffusions",
    label="Diffusions",
    defaults=DEFAULTS,
    completer=_completer,
    actions={"etat": action_etat, "resoudre_youtube": action_resoudre_youtube, "tester": action_tester},
))
