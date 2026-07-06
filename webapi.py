"""API HTTP du dashboard : greffée sur la boucle asyncio du bot, partage le PlayerManager.

Sécurité : chaque requête doit porter le header `X-Api-Token` == config.WEB_API_TOKEN.
Le serveur écoute en local (127.0.0.1) ; l'exposition HTTPS se fait via Tailscale Funnel.
"""
import logging

from aiohttp import web

import config

log = logging.getLogger("bot.webapi")


# --- Auth ---
@web.middleware
async def _auth(request, handler):
    if request.method == "OPTIONS":            # préflight CORS
        return _cors(web.Response(status=204))
    token = request.headers.get("X-Api-Token", "")
    if not config.WEB_API_TOKEN or token != config.WEB_API_TOKEN:
        return _cors(web.json_response({"error": "unauthorized"}, status=401))
    try:
        resp = await handler(request)
    except web.HTTPException as exc:
        return _cors(exc)
    return _cors(resp)


def _cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "X-Api-Token, Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp


# --- Sérialisation ---
def _track_dict(t):
    return {
        "title": t.get("title"),
        "duration": t.get("duration"),
        "live": bool(t.get("live")),
        "thumb": t.get("thumb"),
    }


def _slot_state(player, manager):
    lib = player.library
    return {
        "index": player.slot.index,
        "name": player.slot.name,
        "active": player.active,
        "playing": player.is_playing,
        "paused": player.paused,
        "shuffle": lib.shuffle,
        "pos": player.pos,
        "position": player.current_position,
        "current": _track_dict(player.current) if player.current else None,
        "queue": [_track_dict(t) for t in lib.tracks],
        "queue_len": player.queue_len,
        "baking": {
            "pending": manager.baker.pending(player.slot.index),
            "progress": manager.baker.progress.get(player.slot.index),
        },
    }


# --- Handlers ---
def _get_player(request):
    manager = request.app["manager"]
    try:
        index = int(request.match_info["index"])
    except (KeyError, ValueError):
        raise web.HTTPBadRequest(reason="index invalide")
    player = manager.get(index)
    if player is None:
        raise web.HTTPNotFound(reason="salon introuvable")
    return player


async def state(request):
    manager = request.app["manager"]
    slots = [_slot_state(manager.get(i), manager) for i in manager.indexes]
    return web.json_response({"slots": slots})


async def play(request):
    await _get_player(request).start()
    return web.json_response({"ok": True})


async def stop(request):
    await _get_player(request).stop()
    return web.json_response({"ok": True})


async def nxt(request):
    await _get_player(request).skip()
    return web.json_response({"ok": True})


async def pause(request):
    await _get_player(request).pause()
    return web.json_response({"ok": True})


async def resume(request):
    await _get_player(request).resume()
    return web.json_response({"ok": True})


async def shuffle(request):
    await _get_player(request).toggle_shuffle()
    return web.json_response({"ok": True})


async def add(request):
    player = _get_player(request)
    data = await request.json()
    url = (data.get("url") or "").strip()
    if not url:
        raise web.HTTPBadRequest(reason="url manquante")
    await request.app["manager"].baker.enqueue(player.slot.index, url)
    return web.json_response({"ok": True})


async def remove_track(request):
    player = _get_player(request)
    try:
        n = int(request.match_info["n"])
    except ValueError:
        raise web.HTTPBadRequest(reason="index piste invalide")
    player.library.remove(n)
    await player.refresh_public()
    return web.json_response({"ok": True})


async def move_track(request):
    player = _get_player(request)
    try:
        n = int(request.match_info["n"])
    except ValueError:
        raise web.HTTPBadRequest(reason="index piste invalide")
    data = await request.json()
    delta = {"up": -1, "down": 1}.get(data.get("dir"))
    if delta is None:
        raise web.HTTPBadRequest(reason="direction invalide (up/down)")
    new_pos = player.library.move(n, delta)
    await player.refresh_public()
    return web.json_response({"ok": True, "pos": new_pos})


async def clear(request):
    player = _get_player(request)
    player.library.clear()
    await player.stop()
    await player.refresh_public()
    return web.json_response({"ok": True})


async def get_settings(request):
    return web.json_response(request.app["manager"].settings._data)


async def set_settings(request):
    settings = request.app["manager"].settings
    data = await request.json()
    for key, value in data.items():
        settings.set(key, value)
    return web.json_response({"ok": True})


def build_app(manager):
    app = web.Application(middlewares=[_auth])
    app["manager"] = manager
    app.add_routes([
        web.get("/api/state", state),
        web.post("/api/slot/{index}/play", play),
        web.post("/api/slot/{index}/stop", stop),
        web.post("/api/slot/{index}/next", nxt),
        web.post("/api/slot/{index}/pause", pause),
        web.post("/api/slot/{index}/resume", resume),
        web.post("/api/slot/{index}/shuffle", shuffle),
        web.post("/api/slot/{index}/add", add),
        web.post("/api/slot/{index}/track/{n}/remove", remove_track),
        web.post("/api/slot/{index}/track/{n}/move", move_track),
        web.post("/api/slot/{index}/clear", clear),
        web.get("/api/settings", get_settings),
        web.post("/api/settings", set_settings),
    ])
    return app


async def start_web(manager):
    """Démarre le serveur HTTP sur la boucle courante (à appeler depuis main)."""
    if not config.WEB_API_TOKEN:
        log.warning("WEB_API_TOKEN absent du .env : API dashboard désactivée.")
        return
    app = build_app(manager)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, config.WEB_API_HOST, config.WEB_API_PORT)
    await site.start()
    log.info("API dashboard sur http://%s:%s", config.WEB_API_HOST, config.WEB_API_PORT)
