"""Hub temps réel de la Taverne 3D (MYRHAVEN) — relais WebSocket des joueurs.

Rôle volontairement minimal : chaque navigateur envoie sa position ~10 fois/s, le hub la
retransmet aux autres. Pas de simulation côté serveur (jeu coopératif, triche sans enjeu),
seulement des garde-fous : identité vérifiée, bornes, débits, taille des messages.

Identité :
- joueur connecté (jeton de session du jeu, signé par le dashboard avec GAME_SESSION_SECRET) :
  pseudo et race viennent du bot (Fripouille, en local) — une race de baptême ne s'usurpe pas ;
- invité : « Voyageur », apparence imposée, pas de discussion.

Lancement : ``venv/bin/python -m hub.server`` depuis la racine du projet (service taverne-hub).
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import random
import re
import time
from pathlib import Path

from aiohttp import ClientSession, ClientTimeout, WSMsgType, web
from dotenv import load_dotenv

from hub.marelle import Marelle
from hub.palet import Palet
from hub.veillee import Veillee

BASE_DIR = Path(__file__).parent.parent
load_dotenv(BASE_DIR / ".env")
load_dotenv()

HOST = os.getenv("HUB_HOST", "127.0.0.1").strip()
PORT = int(os.getenv("HUB_PORT") or 8090)
SECRET = os.getenv("GAME_SESSION_SECRET", "").strip()
ORIGINS = {o.strip().rstrip("/") for o in os.getenv(
    "HUB_ORIGINS", "https://myrhaven.vercel.app,http://localhost:5173,http://localhost:5191").split(",") if o.strip()}
FRIP_BASE = os.getenv("HUB_FRIPOUILLE_BASE", "http://127.0.0.1:8081").rstrip("/")
FRIP_TOKEN = (os.getenv("FRIPOUILLE_API_TOKEN") or os.getenv("WEB_API_TOKEN", "")).strip()

MAX_PLAYERS = 80
TICK = 0.1                      # 10 instantanés par seconde
KEYFRAME = 2.0                  # tout le monde renvoyé toutes les 2 s (rattrapage)
MAX_MSG = 8192                  # octets (une offre WebRTC du vocal tient en 3 à 5 Ko)
MAX_RATE = 40                   # messages / seconde avant expulsion
MAX_RTC = 120                   # messages de signalisation du vocal / seconde (candidats ICE en rafale)
CHAT_GAP = 1.2                  # secondes entre deux messages de discussion
CHAT_MAX = 140
WORLDS = {"in", "out", "cave", "cimetiere", "chapelle"}  # salle, esplanade, sous-sol, cimetière, chapelle
EMOTES = {"salut", "trinque", "danse", "oui", "non", "bras"}
# airs des bardes : nombre aligné sur TUNES de public/proto/taverne-3d/src/music.js (repo jeu)
NB_MORCEAUX, BARDES_GAP = 5, 20.0
bardes_t = 0.0  # dernière demande acceptée (une à la fois pour toute la taverne)
TOURNEE = int(os.getenv("HUB_TOURNEE") or 20 * 60)  # la tournée de Brom sonne toutes les 20 min
ACTIF = 10 * 60                  # compte pour la tournée : a bougé / parlé / fait une émote depuis 10 min
BOUND = 250.0

log = logging.getLogger("hub")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [hub] %(message)s")

# ---------------------------------------------------------------- jeton de session du jeu
def verify_token(token: str) -> dict | None:
    """Même format que dashboard/lib/gameSession.ts : base64url(JSON).base64url(HMAC-SHA256)."""
    if not SECRET or not token or "." not in token:
        return None
    payload, sig = token.split(".", 1)
    expected = base64.urlsafe_b64encode(hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(data.get("sub"), str) or not isinstance(data.get("exp"), (int, float)) or data["exp"] < time.time() * 1000:
        return None
    return data

# ---------------------------------------------------------------- Fripouille (baptême)
_http: ClientSession | None = None
_races: set[str] = set()

async def frip(action: str, payload: dict, module: str = "bapteme") -> dict | None:
    if not FRIP_TOKEN or _http is None:
        return None
    try:
        async with _http.post(f"{FRIP_BASE}/api/action/{module}/{action}", json=payload,
                              headers={"X-Api-Token": FRIP_TOKEN}) as r:
            if r.status != 200:
                return None
            return await r.json()
    except Exception:  # bot absent ou lent : le hub reste utilisable
        return None

async def load_races():
    data = await frip("options", {"user_id": "0"})
    if data and data.get("races"):
        _races.clear()
        _races.update(r["key"] for r in data["races"])
        log.info("catalogue du baptême : %d races", len(_races))

# ---------------------------------------------------------------- apparence
_KEY = re.compile(r"^[a-z_]{1,20}$")
def clean_look(look, race_forced: str | None) -> dict:
    """Apparence envoyée par le client : clés et valeurs bornées, rien d'autre ne passe."""
    look = look if isinstance(look, dict) else {}
    out = {}
    race = race_forced or look.get("race")
    if isinstance(race, str) and _KEY.match(race) and (not _races or race in _races):
        out["race"] = race
    if look.get("genre") in ("m", "f"):
        out["genre"] = look["genre"]
    for k in ("teint", "cCheveux", "tenue"):
        v = look.get(k)
        if isinstance(v, int) and 0 <= v < 16:
            out[k] = v
    for k in ("cheveux", "barbe"):
        v = look.get(k)
        if isinstance(v, str) and _KEY.match(v):
            out[k] = v
    out["cape"] = bool(look.get("cape"))
    return out

# ---------------------------------------------------------------- état
class Player:
    __slots__ = ("id", "ws", "name", "look", "guest", "discord", "refused","w", "p", "yaw", "a", "dirty", "last_chat", "last_emote", "rate_t", "rate_n", "active_t", "active_p", "o", "siege", "siege_t", "voix", "rtc_n", "signal_t")
    def __init__(self, pid, ws):
        self.id, self.ws = pid, ws
        self.name, self.look, self.guest, self.discord = "", {}, True, None
        self.refused = False            # jeton présenté mais invalide ou expiré
        self.w, self.p, self.yaw, self.a = "in", [0.0, 0.0, 0.0], 0.0, "i"
        self.dirty = True
        self.o = ""                     # objet tenu (c : chope)
        self.siege, self.siege_t = None, 0.0  # siège occupé (clé « x,z ») et depuis quand
        self.voix, self.rtc_n, self.signal_t = False, 0, -1e9  # vocal de proximité activé
        self.last_chat = self.last_emote = 0.0
        self.active_t, self.active_p = time.monotonic(), [0.0, 0.0, 0.0]
        self.rate_t, self.rate_n = time.monotonic(), 0

    def pub(self):
        return {"id": self.id, "name": self.name, "look": self.look, "guest": self.guest, "w": self.w, "p": self.p, "yaw": self.yaw, "a": self.a, "o": self.o, "v": self.voix}

players: dict[int, Player] = {}
_next_id = 1

async def send(p: Player, msg: dict | str):
    try:
        await p.ws.send_str(msg if isinstance(msg, str) else json.dumps(msg, separators=(",", ":")))
    except Exception:
        pass

async def broadcast(msg: dict, skip: int | None = None):
    data = json.dumps(msg, separators=(",", ":"))
    await asyncio.gather(*(send(p, data) for p in list(players.values()) if p.id != skip), return_exceptions=True)

def fnum(v, lo=-BOUND, hi=BOUND):
    return max(lo, min(hi, round(float(v), 2))) if isinstance(v, (int, float)) else 0.0

# ---------------------------------------------------------------- connexion
async def ws_handler(request: web.Request):
    origin = (request.headers.get("Origin") or "").rstrip("/")
    if ORIGINS and origin not in ORIGINS:
        return web.Response(status=403, text="origine refusée")
    if len(players) >= MAX_PLAYERS:
        return web.Response(status=503, text="taverne pleine")
    global _next_id, bardes_t
    ws = web.WebSocketResponse(heartbeat=20, max_msg_size=MAX_MSG)
    await ws.prepare(request)
    me = Player(_next_id, ws)
    _next_id += 1
    joined = False
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                break
            try:
                m = json.loads(msg.data)
            except json.JSONDecodeError:
                continue
            if not isinstance(m, dict):
                continue
            t = m.get("t")
            # débit : au-delà, c'est un client défaillant ou malveillant (la signalisation du vocal a son propre compteur)
            now = time.monotonic()
            if now - me.rate_t > 1:
                me.rate_t, me.rate_n, me.rtc_n = now, 0, 0
            if t == "rtc":
                me.rtc_n += 1
            else:
                me.rate_n += 1
            if me.rate_n > MAX_RATE or me.rtc_n > MAX_RTC:
                await ws.close(code=4008, message=b"trop de messages")
                break
            if not joined:
                if t != "hello":
                    continue
                await hello(me, m)
                joined = True
                seul = not any(not p.guest for p in players.values())
                players[me.id] = me
                registre_passage(me)
                if seul:
                    asyncio.create_task(annoncer("ouverture", me))
                await send(me, {"t": "welcome", "id": me.id, "name": me.name, "guest": me.guest, "look": me.look,
                                "auth": "refuse" if me.refused else ("invite" if me.guest else "ok"),
                                "players": [p.pub() for p in players.values() if p.id != me.id],
                                "tournee": max(0, int(_next_tournee - time.monotonic())),
                                "borgne": borgne_etat("etat")["s"], "menteur": menteur_etat("etat")["s"],
                                "jeux": {k: j.etat("etat")["s"] for k, j in JEUX.items()},
                                "traces": traces_vue(), "veillee": veillee.etat(),
                                "ice": None if me.guest else ice_servers(me)})
                await broadcast({"t": "join", **me.pub()}, skip=me.id)
                log.info("arrivée #%d %s%s (%d en ligne)", me.id, me.name, " (invité)" if me.guest else "", len(players))
            elif t == "s":
                w = m.get("w")
                if w in WORLDS:
                    me.w = w
                p = m.get("p")
                if isinstance(p, list) and len(p) == 3:
                    me.p = [fnum(p[0]), fnum(p[1], -20, 60), fnum(p[2])]
                    if abs(me.p[0] - me.active_p[0]) + abs(me.p[2] - me.active_p[2]) > 0.5:
                        me.active_t, me.active_p = time.monotonic(), list(me.p)
                me.yaw = fnum(m.get("yaw"), -10, 10)
                me.a = m.get("a") if m.get("a") in ("i", "w", "r", "s") else "i"  # s : assis
                me.o = "".join(ch for ch in "ct" if ch in str(m.get("o") or ""))  # c : chope, t : torche
                me.dirty = True
            elif t == "chat" and not me.guest:
                text = re.sub(r"[\x00-\x1f\x7f]", "", str(m.get("m", ""))).strip()[:CHAT_MAX]
                if text and now - me.last_chat >= CHAT_GAP:
                    me.last_chat = me.active_t = now
                    await broadcast({"t": "chat", "id": me.id, "m": text})
            elif t == "look" and not me.guest:
                locked = me.look.get("_locked")
                me.look = clean_look(m.get("look"), me.look.get("race") if locked else None)
                if locked:
                    me.look["_locked"] = True
                await broadcast({"t": "look", "id": me.id, "look": me.look})
            # liste alignée sur public/proto/taverne-3d/src/emotes.js (repo jeu) ; une émote par seconde au plus
            elif t == "registre":
                await send(me, registre_vue())
            elif t == "borgne" and m.get("a") in ("ouvrir", "rejoindre", "lancer", "garder", "quitter"):
                me.active_t = time.monotonic()
                await borgne_action(me, m["a"])
            elif t == "menteur" and m.get("a") in ("ouvrir", "rejoindre", "lancer", "miser", "menteur", "quitter"):
                me.active_t = time.monotonic()
                await menteur_action(me, m["a"], m)
            elif t == "voix" and not me.guest:
                on = bool(m.get("on"))
                if on != me.voix:
                    me.voix = on
                    await broadcast({"t": "voix", "id": me.id, "on": on})
            elif t == "rtc" and me.voix and not me.guest:
                # signalisation WebRTC relayée telle quelle, seulement entre deux voyageurs au vocal activé
                cible, d = players.get(m.get("a")), m.get("d")
                if cible and cible.id != me.id and cible.voix and not cible.guest and isinstance(d, dict):
                    await send(cible, {"t": "rtc", "de": me.id, "d": d})
            elif t == "signaler" and not me.guest:
                await signaler(me, players.get(m.get("id")), m.get("motif"))
            elif t == "assis":
                k = m.get("k")
                if k is None or (isinstance(k, str) and _CLE_SIEGE.match(k)):
                    await place_quitte(me)
                    me.siege, me.siege_t = k, time.monotonic()
            elif t in JEUX and isinstance(m.get("a"), str):
                me.active_t = time.monotonic()
                await JEUX[t].action(me, m["a"], m)
            elif t == "bardes" and m.get("a") == "jouer" and type(m.get("i")) is int and 0 <= m["i"] < NB_MORCEAUX:
                now = time.monotonic()
                if now - bardes_t < BARDES_GAP:
                    await send(me, {"t": "bardes", "ok": False, "dans": int(BARDES_GAP - (now - bardes_t)) + 1})
                else:
                    bardes_t = me.active_t = now
                    await broadcast({"t": "bardes", "i": m["i"], "n": me.name})
            elif t == "emote" and m.get("e") in EMOTES:
                now = time.monotonic()
                if now - me.last_emote >= 1:
                    me.last_emote = me.active_t = now
                    await broadcast({"t": "emote", "id": me.id, "e": m["e"]})
    finally:
        await borgne_abandon(me.id)
        await menteur_quitte(me.id)
        await place_quitte(me)
        for jeu in JEUX.values():
            await jeu.quitte(me.id)
        if players.pop(me.id, None):
            await broadcast({"t": "leave", "id": me.id})
            log.info("départ #%d %s (%d en ligne)", me.id, me.name, len(players))
    return ws

async def hello(me: Player, m: dict):
    if not _races:  # bot pas encore prêt au démarrage du hub (redémarrage simultané)
        await load_races()
    token = m.get("token") or ""
    sess = verify_token(token) if isinstance(token, str) else None
    if token and not sess:
        # secret désaccordé avec le dashboard ou session expirée : à voir tout de suite dans le journal
        me.refused = True
        log.warning("jeton refusé (signature invalide ou expiré) — connexion en invité")
    race_forced = None
    stored = None
    if sess:
        me.guest, me.discord = False, sess["sub"]
        me.name = str(sess.get("username") or "Voyageur")[:32]
        st = await frip("statut", {"user_id": sess["sub"]})
        if st and st.get("baptise"):
            me.name = str(st.get("nom_rp") or me.name)[:40]
            race_forced = st.get("race")
        # apparence enregistrée chez le bot : fait foi (le client peut en avoir une copie périmée)
        got = await frip("apparence", {"user_id": sess["sub"]})
        stored = got.get("look") if got else None
        # une seule présence par compte : l'ancienne connexion laisse la place
        for p in list(players.values()):
            if p.discord == me.discord:
                await p.ws.close(code=4009, message=b"connecte ailleurs")
    else:
        me.name = f"Voyageur {random.randint(100, 999)}"
    me.look = clean_look(stored or m.get("look"), race_forced) if sess else {"race": None, "cape": True}
    if race_forced:
        me.look["_locked"] = True
    w = m.get("w")
    me.w = w if w in WORLDS else "in"
    p = m.get("p")
    if isinstance(p, list) and len(p) == 3:
        me.p = [fnum(p[0]), fnum(p[1], -20, 60), fnum(p[2])]

# ---------------------------------------------------------------- registre de la taverne
# Tableau d'affichage : derniers passages (joueurs identifiés) et palmarès du Borgne entre voyageurs.
# Petit JSON à côté du hub, réécrit de façon atomique à chaque changement.
REGISTRE = Path(os.getenv("HUB_REGISTRE") or (Path(__file__).parent / "registre.json"))
try:
    registre = json.loads(REGISTRE.read_text(encoding="utf8"))
except (OSError, ValueError):
    registre = {}
registre.setdefault("passages", {})   # discord → {"n": nom, "ts": epoch}
registre.setdefault("borgne", {})     # discord → {"n": nom, "v": victoires, "p": parties}
registre.setdefault("menteur", {})    # idem pour le Dé menteur
for _jeu in ("palet", "marelle"):
    registre.setdefault(_jeu, {})
registre.setdefault("habitues", {})   # discord → {"n": nom, "j": jours de passage distincts, "d": dernier jour}
registre.setdefault("places", {})     # clé du siège « x,z » → {discord: [nom, secondes assis]}
HABITUE_JOURS, PLACE_SECONDES = 3, 30 * 60

def registre_sauver():
    try:
        tmp = REGISTRE.with_suffix(".tmp")
        tmp.write_text(json.dumps(registre, ensure_ascii=False), encoding="utf8")
        tmp.replace(REGISTRE)
    except OSError as e:
        log.warning("registre non enregistré : %s", e)

def registre_passage(p: "Player"):
    if p.guest or not p.discord:
        return
    registre["passages"][p.discord] = {"n": p.name, "ts": int(time.time())}
    # jours de passage distincts : à trois, Brom grave une chope à son nom (étagère des habitués)
    jour = time.strftime("%Y-%m-%d")
    h = registre["habitues"].setdefault(p.discord, {"n": p.name, "j": 0, "d": ""})
    h["n"] = p.name
    if h["d"] != jour:
        h["j"], h["d"] = h["j"] + 1, jour
        if h["j"] == HABITUE_JOURS:
            asyncio.get_running_loop().create_task(broadcast(traces_vue()))
    if len(registre["passages"]) > 200:  # on ne garde que les plus récents
        for k, _ in sorted(registre["passages"].items(), key=lambda kv: kv[1]["ts"])[:50]:
            registre["passages"].pop(k, None)
    registre_sauver()

def registre_partie(gagnant: "Player | None", perdant: "Player | None", jeu: str = "borgne", autres=()):
    for pl, win in ((gagnant, 1), (perdant, 0), *((a, 0) for a in autres)):
        if pl and pl.discord:
            e = registre[jeu].setdefault(pl.discord, {"n": pl.name, "v": 0, "p": 0})
            e["n"], e["v"], e["p"] = pl.name, e["v"] + win, e["p"] + 1
    registre_sauver()
    asyncio.get_running_loop().create_task(broadcast(traces_vue()))  # le trophée a pu changer de main

# ---------------------------------------------------------------- vocal de proximité
# Le son passe en pair-à-pair (WebRTC) ; le hub ne fait que présenter les pairs l'un à l'autre, donner
# les serveurs STUN/TURN (identifiants TURN temporaires, coturn « use-auth-secret ») et recevoir
# les signalements.
TURN_URLS = [u.strip() for u in os.getenv("TURN_URLS", "").split(",") if u.strip()]
TURN_SECRET = os.getenv("TURN_SECRET", "").strip()
STUN = ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"]
MOTIFS = {"insultes", "harcelement", "bruit", "autre"}

def ice_servers(p: "Player") -> list[dict]:
    out = [{"urls": STUN}]
    if TURN_URLS and TURN_SECRET:
        user = f"{int(time.time()) + 12 * 3600}:{p.id}"
        cred = base64.b64encode(hmac.new(TURN_SECRET.encode(), user.encode(), hashlib.sha1).digest()).decode()
        out.append({"urls": TURN_URLS, "username": user, "credential": cred})
    return out

async def signaler(auteur: "Player", cible: "Player | None", motif):
    now = time.monotonic()
    if not cible or cible.guest or not cible.discord or cible.id == auteur.id or now - auteur.signal_t < 60:
        return await send(auteur, {"t": "signale", "ok": False})
    auteur.signal_t = now
    motif = motif if motif in MOTIFS else "autre"
    log.warning("signalement : %s (%s) par %s (%s) — %s", cible.name, cible.discord, auteur.name, auteur.discord, motif)
    res = await frip("signalement", {"cible_id": cible.discord, "cible_nom": cible.name, "auteur_id": auteur.discord,
                                     "auteur_nom": auteur.name, "motif": motif}, "taverne3d")
    await send(auteur, {"t": "signale", "ok": True, "poste": bool(res and res.get("ok"))})

# ---------------------------------------------------------------- traces de soi
# Chopes gravées des habitués, trophées des champions en titre, places attitrées (temps assis cumulé).
def traces_vue() -> dict:
    chopes = sorted(((e["n"], e["j"]) for e in registre["habitues"].values() if e["j"] >= HABITUE_JOURS), key=lambda x: -x[1])[:24]
    trophees = {}
    for jeu in ("borgne", "menteur", "palet", "marelle"):
        top = max(registre[jeu].values(), key=lambda e: (e["v"], -e["p"]), default=None)
        if top and top["v"] > 0:
            trophees[jeu] = [top["n"], top["v"]]
    return {"t": "traces", "chopes": [list(c) for c in chopes], "trophees": trophees, "places": _titulaires()}

def _titulaires() -> dict:
    out = {}
    for cle, occ in registre["places"].items():
        best = max(occ.values(), key=lambda e: e[1], default=None)
        if best and best[1] >= PLACE_SECONDES:
            out[cle] = best[0]
    return out

_CLE_SIEGE = re.compile(r"^-?\d{1,3}\.\d,-?\d{1,3}\.\d$")

async def place_quitte(p: "Player"):
    """Le joueur se lève (ou part) : son temps assis s'ajoute au siège."""
    cle, p.siege = p.siege, None
    if not cle or p.guest or not p.discord:
        return
    secs = min(4 * 3600, time.monotonic() - p.siege_t)
    if secs < 5:
        return
    avant = _titulaires().get(cle)
    occ = registre["places"].setdefault(cle, {})
    e = occ.setdefault(p.discord, [p.name, 0])
    e[0], e[1] = p.name, int(e[1] + secs)
    if len(occ) > 5:  # on ne garde que les cinq plus assidus par siège
        for k, _ in sorted(occ.items(), key=lambda kv: kv[1][1])[:len(occ) - 5]:
            occ.pop(k, None)
    registre_sauver()
    if _titulaires().get(cle) != avant:
        await broadcast(traces_vue())

def registre_vue() -> dict:
    now = int(time.time())
    pas = sorted(registre["passages"].values(), key=lambda e: -e["ts"])[:12]
    def top(jeu):
        return [[e["n"], e["v"], e["p"]] for e in sorted(registre[jeu].values(), key=lambda e: (-e["v"], e["p"]))[:8]]
    return {"t": "registre", "passages": [[e["n"], now - e["ts"]] for e in pas],
            "borgne": top("borgne"), "menteur": top("menteur"), "palet": top("palet"), "marelle": top("marelle"), "tournee": max(0, int(_next_tournee - time.monotonic()))}

# ---------------------------------------------------------------- annonces sur Discord
# La taverne fait signe (module Fripouille taverne3d) : un voyageur identifié entre dans une salle
# vide, ou quelqu'un cherche un adversaire au Borgne. Fréquences bornées ici, texte rédigé par le bot.
_annonce_t = {"ouverture": 0.0, "borgne": 0.0, "menteur": 0.0, "palet": 0.0, "marelle": 0.0}
_annonce_joueur: dict[str, float] = {}
ANNONCE_ECART = {"ouverture": 15 * 60, "borgne": 10 * 60, "menteur": 10 * 60, "palet": 10 * 60, "marelle": 10 * 60}
ANNONCE_JOUEUR = 3 * 3600

async def annoncer(kind: str, p: "Player"):
    now = time.monotonic()
    if p.guest or not p.discord or now - _annonce_t[kind] < ANNONCE_ECART[kind]:
        return
    if kind == "ouverture" and now - _annonce_joueur.get(p.discord, -1e9) < ANNONCE_JOUEUR:
        return
    _annonce_t[kind] = now
    _annonce_joueur[p.discord] = now
    await frip("annonce", {"type": kind, "nom": p.name}, "taverne3d")

# ---------------------------------------------------------------- le Borgne entre voyageurs
# Une seule table (la table longue). Le hub est l'arbitre : il tire les dés, applique les règles
# (un 1 = pot perdu, garder = pot en poche, premier à 30) et diffuse l'état à tous — les spectateurs
# voient le dé rouler. Joueurs identifiés seulement ; 90 s sans jouer à son tour = abandon.
BORGNE_BUT, BORGNE_ATTENTE, BORGNE_LENT = 30, 180, 90
borgne: dict | None = None

def borgne_etat(evt: str, v: int | None = None) -> dict:
    b = borgne
    if not b:
        return {"t": "borgne", "s": None}
    return {"t": "borgne", "s": {"j": b["j"], "n": b["n"], "sc": b["sc"], "pot": b["pot"], "tour": b["tour"],
                                 "g": b.get("g"), "evt": evt, "v": v}}

async def borgne_action(me: Player, a: str):
    global borgne
    now = time.monotonic()
    b = borgne
    if a == "ouvrir" and not me.guest:
        if b:
            return  # une seule table : partie déjà en attente ou en cours
        borgne = {"j": [me.id, None], "n": [me.name, None], "sc": [0, 0], "pot": 0, "tour": 0, "t": now, "last": now}
        await broadcast(borgne_etat("attente"))
        asyncio.create_task(annoncer("borgne", me))
    elif a == "rejoindre" and not me.guest and b and b["j"][1] is None and b["j"][0] != me.id and b.get("g") is None:
        b["j"][1], b["n"][1] = me.id, me.name
        b["tour"], b["t"], b["last"] = random.randint(0, 1), now, now
        await broadcast(borgne_etat("debut"))
    elif a in ("lancer", "garder") and b and b["j"][1] is not None and b.get("g") is None and b["j"][b["tour"]] == me.id:
        if now - b["last"] < 0.9:  # le dé roule encore
            return
        b["last"] = b["t"] = now
        if a == "lancer":
            v = random.randint(1, 6)
            if v == 1:
                b["pot"], b["tour"] = 0, 1 - b["tour"]
                await broadcast(borgne_etat("borgne", v))
            else:
                b["pot"] += v
                await broadcast(borgne_etat("lance", v))
        elif b["pot"] > 0:
            b["sc"][b["tour"]] += b["pot"]
            b["pot"] = 0
            if b["sc"][b["tour"]] >= BORGNE_BUT:
                b["g"] = b["tour"]
                registre_partie(players.get(b["j"][b["g"]]), players.get(b["j"][1 - b["g"]]))
                await broadcast(borgne_etat("fin"))
                borgne = None
            else:
                b["tour"] = 1 - b["tour"]
                await broadcast(borgne_etat("garde"))
    elif a == "quitter" and b and me.id in b["j"]:
        await borgne_abandon(me.id)

async def borgne_abandon(pid: int):
    global borgne
    b = borgne
    if not b or pid not in b["j"]:
        return
    if b["j"][1] is not None and b.get("g") is None:
        b["g"] = 1 - b["j"].index(pid)
        registre_partie(players.get(b["j"][b["g"]]), players.get(pid))
        await broadcast(borgne_etat("abandon"))
    borgne = None
    await broadcast(borgne_etat("ferme"))

async def borgne_veille():
    while True:
        await asyncio.sleep(5)
        b, now = borgne, time.monotonic()
        if not b:
            continue
        if b["j"][1] is None and now - b["t"] > BORGNE_ATTENTE:
            await borgne_abandon(b["j"][0])
        elif b["j"][1] is not None and now - b["t"] > BORGNE_LENT:
            await borgne_abandon(b["j"][b["tour"]])

# ---------------------------------------------------------------- le Dé menteur entre voyageurs
# Perudo à la table ronde : 2 à 6 voyageurs, 5 dés chacun sous un gobelet. Le hub tire les dés et ne
# les envoie qu'à leur propriétaire (message « menteur_des ») ; l'état public (mises, nombre de dés)
# va à toute la salle. Les 1 (l'œil du Borgne) sont jokers, sauf quand on mise sur les 1.
# « Menteur ! » : on soulève tous les gobelets (dés révélés à tous), le perdant laisse un dé.
# Liste d'actions et règle de surenchère alignées sur public/proto/taverne-3d/src/menteur.js (repo jeu).
MENTEUR_MAX, MENTEUR_DES, MENTEUR_ATTENTE, MENTEUR_LENT, MENTEUR_REVELE = 6, 5, 240, 60, 5.5
menteur: dict | None = None

def menteur_etat(evt: str, extra: dict | None = None) -> dict:
    m = menteur
    if not m:
        return {"t": "menteur", "s": None, "evt": evt}
    return {"t": "menteur", "s": {"j": m["j"], "n": m["n"], "nd": [len(d) for d in m["d"]], "tour": m["tour"],
                                  "mise": m["mise"], "mi": m["mi"], "manche": m["manche"], "jeu": m["jeu"],
                                  "pause": m["pause"], "g": m.get("g"), "evt": evt, **(extra or {})}}

def menteur_legal(mise, q, f, total: int) -> bool:
    """Surenchère : plus de dés, ou autant d'une face plus forte. Passer aux 1 divise par deux, en revenir double."""
    if not (isinstance(q, int) and isinstance(f, int) and 1 <= f <= 6 and 1 <= q <= total):
        return False
    if not mise:
        return f != 1  # on n'ouvre pas une manche sur l'œil
    q0, f0 = mise
    if f0 == 1 and f == 1:
        return q > q0
    if f0 == 1:
        return q >= q0 * 2 + 1
    if f == 1:
        return q >= (q0 + 1) // 2
    return q > q0 or (q == q0 and f > f0)

def menteur_suivant(i: int) -> int:
    """Prochain joueur qui a encore des dés après i."""
    m = menteur
    n = len(m["j"])
    for k in range(1, n + 1):
        if m["d"][(i + k) % n]:
            return (i + k) % n
    return i

async def menteur_manche(evt: str, extra: dict | None = None):
    """Nouvelle manche : chacun secoue son gobelet (dés envoyés en privé) ; le tour est déjà posé."""
    m = menteur
    m["d"] = [[random.randint(1, 6) for _ in d] for d in m["d"]]
    m["mise"], m["mi"], m["pause"], m["manche"] = None, None, False, m["manche"] + 1
    m["t"] = m["last"] = time.monotonic()
    await broadcast(menteur_etat(evt, extra))
    for pid, d in zip(m["j"], m["d"]):
        if pid in players:
            await send(players[pid], {"t": "menteur_des", "d": d, "manche": m["manche"]})

async def menteur_fin(evt: str, extra: dict | None = None):
    global menteur
    m = menteur
    vivants = [i for i, d in enumerate(m["d"]) if d]
    m["g"] = vivants[0] if len(vivants) == 1 else None
    if m["g"] is not None:
        g = m["j"][m["g"]]
        autres = [players.get(pid) for pid in m["j"] + m["sortis"] if pid != g]
        registre_partie(players.get(g), None, "menteur", autres)
    await broadcast(menteur_etat(evt, extra))
    menteur = None

async def menteur_apres_revele(m: dict, manche: int):
    await asyncio.sleep(MENTEUR_REVELE)  # le temps de lever les gobelets et de compter
    if menteur is m and m["manche"] == manche:
        await menteur_manche("manche")

async def menteur_action(me: Player, a: str, msg: dict):
    global menteur
    now = time.monotonic()
    m = menteur
    mon_tour = bool(m and m["jeu"] and not m["pause"] and m["j"][m["tour"]] == me.id and now - m["last"] > 0.4)
    if a == "ouvrir" and not me.guest and not m:
        menteur = {"j": [me.id], "n": [me.name], "d": [[0] * MENTEUR_DES], "tour": 0, "mise": None, "mi": None,
                   "manche": 0, "jeu": False, "pause": False, "t": now, "last": now, "sortis": []}
        await broadcast(menteur_etat("attente"))
        asyncio.create_task(annoncer("menteur", me))
    elif a == "rejoindre" and not me.guest and m and not m["jeu"] and me.id not in m["j"] and len(m["j"]) < MENTEUR_MAX:
        m["j"].append(me.id)
        m["n"].append(me.name)
        m["d"].append([0] * MENTEUR_DES)
        m["t"] = now
        await broadcast(menteur_etat("rejoint"))
    elif a == "lancer" and m and not m["jeu"] and m["j"][0] == me.id and len(m["j"]) >= 2:
        m["jeu"], m["tour"] = True, random.randrange(len(m["j"]))
        await menteur_manche("debut")
    elif a == "miser" and mon_tour:
        q, f = msg.get("q"), msg.get("f")
        if not menteur_legal(m["mise"], q, f, sum(len(d) for d in m["d"])):
            return
        m["mise"], m["mi"] = [q, f], m["tour"]
        m["tour"] = menteur_suivant(m["tour"])
        m["t"] = m["last"] = now
        await broadcast(menteur_etat("mise"))
    elif a == "menteur" and mon_tour and m["mise"]:
        q, f = m["mise"]
        compte = sum(1 for d in m["d"] for v in d if v == f or (f != 1 and v == 1))
        perdant = m["tour"] if compte >= q else m["mi"]
        rev = {"des": m["d"], "compte": compte, "accuse": m["mi"], "crieur": m["tour"], "perdant": perdant}
        m["d"] = [list(d) for d in m["d"]]
        m["d"][perdant].pop()
        # le perdant ouvre la manche suivante (son voisin s'il vient de perdre son dernier dé)
        m["tour"] = perdant if m["d"][perdant] else menteur_suivant(perdant)
        if sum(1 for d in m["d"] if d) <= 1:
            return await menteur_fin("fin", {"rev": rev})
        m["pause"], m["t"] = True, now
        await broadcast(menteur_etat("revele", {"rev": rev}))
        asyncio.create_task(menteur_apres_revele(m, m["manche"]))
    elif a == "quitter" and m and me.id in m["j"]:
        await menteur_quitte(me.id)

async def menteur_quitte(pid: int):
    """Départ (ou trop lent) : ses dés quittent la table et les autres relancent une manche."""
    global menteur
    m = menteur
    if not m or pid not in m["j"]:
        return
    i = m["j"].index(pid)
    if not m["jeu"] and i == 0:  # l'hôte s'en va avant le début : la table se referme
        menteur = None
        return await broadcast(menteur_etat("ferme"))
    nom, avait_des = m["n"][i], bool(m["d"][i])
    tour_id = m["j"][m["tour"]]
    if tour_id == pid:
        tour_id = m["j"][menteur_suivant(i)]
    for k in ("j", "n", "d"):
        m[k].pop(i)
    if not m["jeu"]:
        return await broadcast(menteur_etat("parti", {"parti": nom}))
    m["sortis"].append(pid)
    if sum(1 for d in m["d"] if d) <= 1:
        return await menteur_fin("abandon", {"parti": nom})
    m["tour"] = m["j"].index(tour_id) if tour_id in m["j"] else 0
    if avait_des and not m["pause"]:
        await menteur_manche("parti", {"parti": nom})
    else:  # simple spectateur éliminé, ou gobelets déjà levés : la manche suit son cours
        if m["mi"] is not None and i < m["mi"]:  # les places suivantes glissent d'un cran
            m["mi"] -= 1
        await broadcast(menteur_etat("parti", {"parti": nom}))

async def menteur_veille():
    while True:
        await asyncio.sleep(5)
        m, now = menteur, time.monotonic()
        if not m:
            continue
        if not m["jeu"] and now - m["t"] > MENTEUR_ATTENTE:
            await menteur_quitte(m["j"][0])
        elif m["jeu"] and not m["pause"] and now - m["t"] > MENTEUR_LENT:
            await menteur_quitte(m["j"][m["tour"]])

# ---------------------------------------------------------------- jeux de table en modules (hub/palet.py…)
# Chaque jeu reçoit ce contexte ; il expose etat(), action(), quitte() et veille().
class _Ctx:
    players = players
    broadcast = staticmethod(lambda msg: broadcast(msg))
    registre_partie = staticmethod(lambda g, p, jeu: registre_partie(g, p, jeu))
    annoncer = staticmethod(lambda kind, p: annoncer(kind, p))
    frip = staticmethod(lambda action, payload, module="bapteme": frip(action, payload, module))
    registre = registre
    registre_sauver = staticmethod(lambda: registre_sauver())

JEUX = {"palet": Palet(_Ctx), "marelle": Marelle(_Ctx)}
veillee = Veillee(_Ctx)

# ---------------------------------------------------------------- la tournée de Brom
# Toutes les TOURNEE secondes : chaque joueur identifié, présent (dedans ou sur l'esplanade) et actif
# reçoit la tournée — le bot décide du montant, du plafond quotidien et du rôle requis.
_next_tournee = 0.0

async def tournees():
    global _next_tournee
    while True:
        _next_tournee = time.monotonic() + TOURNEE
        await asyncio.sleep(TOURNEE)
        if not players:
            continue
        now = time.monotonic()
        actifs = [p for p in players.values() if not p.guest and p.discord and now - p.active_t < ACTIF]
        res = await frip("tournee", {"user_ids": [p.discord for p in actifs]}, "economie") if actifs else None
        ok = set((res or {}).get("credites") or [])
        montant = int((res or {}).get("montant") or 0)
        _next_tournee = time.monotonic() + TOURNEE
        await broadcast({"t": "tournee", "m": montant, "ids": [p.id for p in actifs if p.discord in ok], "next": TOURNEE})
        log.info("tournée : %d actif(s), %d crédité(s) de %d", len(actifs), len(ok), montant)

# ---------------------------------------------------------------- boucle d'instantanés
async def ticker():
    last_key = 0.0
    while True:
        await asyncio.sleep(TICK)
        if not players:
            continue
        now = time.monotonic()
        key = now - last_key > KEYFRAME
        if key:
            last_key = now
        rows = [[p.id, p.p[0], p.p[1], p.p[2], round(p.yaw, 3), p.a, p.w, p.o] for p in players.values() if key or p.dirty]
        for p in players.values():
            p.dirty = False
        if rows:
            await broadcast({"t": "snap", "s": rows})

async def health(_request):
    return web.json_response({"ok": True, "joueurs": len(players), "races": len(_races)})

async def on_start(app):
    global _http
    _http = ClientSession(timeout=ClientTimeout(total=4))
    await load_races()
    app["ticker"] = asyncio.create_task(ticker())
    app["tournees"] = asyncio.create_task(tournees())
    app["borgne"] = asyncio.create_task(borgne_veille())
    app["menteur"] = asyncio.create_task(menteur_veille())
    app["jeux"] = [asyncio.create_task(j.veille()) for j in JEUX.values()] + [asyncio.create_task(veillee.boucle())]
    if not SECRET:
        log.warning("GAME_SESSION_SECRET absent : seuls les invités peuvent se connecter")

async def on_stop(app):
    app["ticker"].cancel()
    app["tournees"].cancel()
    app["borgne"].cancel()
    app["menteur"].cancel()
    for tache in app["jeux"]:
        tache.cancel()
    if _http:
        await _http.close()

def main():
    app = web.Application()
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/health", health)
    app.on_startup.append(on_start)
    app.on_cleanup.append(on_stop)
    log.info("hub sur %s:%d (origines : %s)", HOST, PORT, ", ".join(sorted(ORIGINS)))
    web.run_app(app, host=HOST, port=PORT, print=None)

if __name__ == "__main__":
    main()
