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
MAX_MSG = 2048                  # octets
MAX_RATE = 40                   # messages / seconde avant expulsion
CHAT_GAP = 1.2                  # secondes entre deux messages de discussion
CHAT_MAX = 140
WORLDS = {"in", "out"}
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

async def frip(action: str, payload: dict) -> dict | None:
    if not FRIP_TOKEN or _http is None:
        return None
    try:
        async with _http.post(f"{FRIP_BASE}/api/action/bapteme/{action}", json=payload,
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
    __slots__ = ("id", "ws", "name", "look", "guest", "discord", "refused","w", "p", "yaw", "a", "dirty", "last_chat", "rate_t", "rate_n")
    def __init__(self, pid, ws):
        self.id, self.ws = pid, ws
        self.name, self.look, self.guest, self.discord = "", {}, True, None
        self.refused = False            # jeton présenté mais invalide ou expiré
        self.w, self.p, self.yaw, self.a = "in", [0.0, 0.0, 0.0], 0.0, "i"
        self.dirty = True
        self.last_chat = 0.0
        self.rate_t, self.rate_n = time.monotonic(), 0

    def pub(self):
        return {"id": self.id, "name": self.name, "look": self.look, "guest": self.guest, "w": self.w, "p": self.p, "yaw": self.yaw, "a": self.a}

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
    global _next_id
    ws = web.WebSocketResponse(heartbeat=20, max_msg_size=MAX_MSG)
    await ws.prepare(request)
    me = Player(_next_id, ws)
    _next_id += 1
    joined = False
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                break
            # débit : au-delà, c'est un client défaillant ou malveillant
            now = time.monotonic()
            if now - me.rate_t > 1:
                me.rate_t, me.rate_n = now, 0
            me.rate_n += 1
            if me.rate_n > MAX_RATE:
                await ws.close(code=4008, message=b"trop de messages")
                break
            try:
                m = json.loads(msg.data)
            except json.JSONDecodeError:
                continue
            t = m.get("t")
            if not joined:
                if t != "hello":
                    continue
                await hello(me, m)
                joined = True
                players[me.id] = me
                await send(me, {"t": "welcome", "id": me.id, "name": me.name, "guest": me.guest, "look": me.look,
                                "auth": "refuse" if me.refused else ("invite" if me.guest else "ok"),
                                "players": [p.pub() for p in players.values() if p.id != me.id]})
                await broadcast({"t": "join", **me.pub()}, skip=me.id)
                log.info("arrivée #%d %s%s (%d en ligne)", me.id, me.name, " (invité)" if me.guest else "", len(players))
            elif t == "s":
                w = m.get("w")
                if w in WORLDS:
                    me.w = w
                p = m.get("p")
                if isinstance(p, list) and len(p) == 3:
                    me.p = [fnum(p[0]), fnum(p[1], -20, 60), fnum(p[2])]
                me.yaw = fnum(m.get("yaw"), -10, 10)
                me.a = m.get("a") if m.get("a") in ("i", "w", "r") else "i"
                me.dirty = True
            elif t == "chat" and not me.guest:
                text = re.sub(r"[\x00-\x1f\x7f]", "", str(m.get("m", ""))).strip()[:CHAT_MAX]
                if text and now - me.last_chat >= CHAT_GAP:
                    me.last_chat = now
                    await broadcast({"t": "chat", "id": me.id, "m": text})
            elif t == "look" and not me.guest:
                locked = me.look.get("_locked")
                me.look = clean_look(m.get("look"), me.look.get("race") if locked else None)
                if locked:
                    me.look["_locked"] = True
                await broadcast({"t": "look", "id": me.id, "look": me.look})
            elif t == "emote" and m.get("e") in ("salut", "trinque", "danse"):
                await broadcast({"t": "emote", "id": me.id, "e": m["e"]})
    finally:
        if players.pop(me.id, None):
            await broadcast({"t": "leave", "id": me.id})
            log.info("départ #%d %s (%d en ligne)", me.id, me.name, len(players))
    return ws

async def hello(me: Player, m: dict):
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
        rows = [[p.id, p.p[0], p.p[1], p.p[2], round(p.yaw, 3), p.a, p.w] for p in players.values() if key or p.dirty]
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
    if not SECRET:
        log.warning("GAME_SESSION_SECRET absent : seuls les invités peuvent se connecter")

async def on_stop(app):
    app["ticker"].cancel()
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
