"""API HTTP de La Fripouille : config par module, greffée sur la boucle asyncio du bot.

Même pont que le bot musique (navigateur → Vercel → Tailscale Funnel → cette API),
mais sur un PORT DISTINCT (8081). Chaque requête porte le header
``X-Api-Token`` == config.API_TOKEN. Écoute en local uniquement.

Routes génériques (le cœur du « moule répétable ») :
- ``GET  /api/health``           → état du bot + liste des modules
- ``GET  /api/config``           → tous les modules avec leur config effective
- ``GET  /api/config/{module}``  → config effective d'un module
- ``POST /api/config/{module}``  → fusionne, persiste, puis appelle ``apply()`` à chaud
"""
import logging
import re
import uuid
from pathlib import Path

from aiohttp import web

from . import config, registry

log = logging.getLogger("fripouille.webapi")

# --- Média (images des embeds) ---
_ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
_MAX_MEDIA = 8 * 1024 * 1024        # 8 Mo par image
_NAME_RE = re.compile(r"^[a-f0-9]{32}\.(png|jpg|jpeg|gif|webp)$")


def _media_url(name):
    base = config.PUBLIC_BASE_URL
    return f"{base}/media/{name}" if base else f"/media/{name}"


@web.middleware
async def _auth(request, handler):
    if request.method == "OPTIONS":            # préflight CORS
        return _cors(web.Response(status=204))
    if request.path.startswith("/media/"):     # fichiers publics (chargés par Discord)
        return await handler(request)
    token = request.headers.get("X-Api-Token", "")
    if not config.API_TOKEN or token != config.API_TOKEN:
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


async def health(request):
    bot = request.app["bot"]
    return web.json_response({
        "ok": True,
        "user": str(bot.user) if bot.user else None,
        "guild": config.GUILD_ID,
        "modules": list(registry.all_modules()),
    })


async def guild_roles(request):
    """Rôles du serveur (pour peupler les menus déroulants du dashboard).

    Exclut @everyone et les rôles gérés (bots/intégrations), non attribuables.
    Triés du plus haut au plus bas dans la hiérarchie.
    """
    bot = request.app["bot"]
    guild = bot.get_guild(config.GUILD_ID) if config.GUILD_ID else None
    if guild is None:
        return web.json_response({"roles": []})
    roles = [
        {"id": str(r.id), "name": r.name, "color": r.color.value}
        for r in sorted(guild.roles, key=lambda r: r.position, reverse=True)
        if not r.is_default() and not r.managed
    ]
    return web.json_response({"roles": roles})


async def guild_channels(request):
    """Salons texte du serveur (pour choisir où poster un menu)."""
    bot = request.app["bot"]
    guild = bot.get_guild(config.GUILD_ID) if config.GUILD_ID else None
    if guild is None:
        return web.json_response({"channels": []})
    chans = [
        {
            "id": str(c.id),
            "name": c.name,
            "category": c.category.name if c.category else None,
        }
        for c in sorted(guild.text_channels, key=lambda c: (c.position,))
    ]
    return web.json_response({"channels": chans})


async def guild_categories(request):
    """Catégories du serveur (pour lier un jeu à sa catégorie de salons)."""
    bot = request.app["bot"]
    guild = bot.get_guild(config.GUILD_ID) if config.GUILD_ID else None
    if guild is None:
        return web.json_response({"categories": []})
    cats = [
        {"id": str(c.id), "name": c.name}
        for c in sorted(guild.categories, key=lambda c: c.position)
    ]
    return web.json_response({"categories": cats})


async def list_config(request):
    bot = request.app["bot"]
    return web.json_response({
        "modules": [
            {"key": m.key, "label": m.label, "config": bot.store.get(m.key)}
            for m in registry.all_modules().values()
        ]
    })


async def get_config(request):
    key = request.match_info["module"]
    if registry.get(key) is None:
        raise web.HTTPNotFound(reason="module inconnu")
    return web.json_response(request.app["bot"].store.get(key))


async def set_config(request):
    key = request.match_info["module"]
    mod = registry.get(key)
    if mod is None:
        raise web.HTTPNotFound(reason="module inconnu")
    data = await request.json()
    if not isinstance(data, dict):
        raise web.HTTPBadRequest(reason="corps JSON attendu (objet)")
    bot = request.app["bot"]
    merged = bot.store.set(key, data)
    if mod.apply is not None:
        try:
            await mod.apply(bot, merged)
        except Exception as exc:  # noqa: BLE001
            log.error("apply(%s) : %s", key, exc)
            raise web.HTTPInternalServerError(reason="échec application de la config")
    return web.json_response({"ok": True, "config": merged})


async def run_action(request):
    """Déclenche une action ponctuelle d'un module (ex. envoi immédiat d'un message)."""
    key = request.match_info["module"]
    action = request.match_info["action"]
    mod = registry.get(key)
    if mod is None or action not in mod.actions:
        raise web.HTTPNotFound(reason="action inconnue")
    data = await request.json()
    if not isinstance(data, dict):
        raise web.HTTPBadRequest(reason="corps JSON attendu (objet)")
    try:
        result = await mod.actions[action](request.app["bot"], data)
    except ValueError as exc:
        raise web.HTTPBadRequest(reason=str(exc))
    except web.HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        log.error("action %s/%s : %s", key, action, exc)
        raise web.HTTPInternalServerError(reason="échec de l'action")
    return web.json_response(result or {"ok": True})


async def media_list(request):
    config.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    items = []
    for p in sorted(config.MEDIA_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if p.is_file():
            items.append({"name": p.name, "url": _media_url(p.name), "size": p.stat().st_size})
    return web.json_response({"media": items})


async def media_upload(request):
    reader = await request.multipart()
    field = await reader.next()
    while field is not None and field.name != "file":
        field = await reader.next()
    if field is None:
        raise web.HTTPBadRequest(reason="fichier manquant")
    ext = Path(field.filename or "").suffix.lower()
    if ext not in _ALLOWED_EXT:
        raise web.HTTPBadRequest(reason="format non supporté (png, jpg, gif, webp)")

    config.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{ext}"
    dest = config.MEDIA_DIR / name
    size = 0
    try:
        with dest.open("wb") as f:
            while True:
                chunk = await field.read_chunk()
                if not chunk:
                    break
                size += len(chunk)
                if size > _MAX_MEDIA:
                    raise web.HTTPBadRequest(reason="fichier trop lourd (max 8 Mo)")
                f.write(chunk)
    except web.HTTPException:
        dest.unlink(missing_ok=True)
        raise
    return web.json_response({"name": name, "url": _media_url(name)})


async def media_delete(request):
    data = await request.json()
    name = str(data.get("name") or "")
    if not _NAME_RE.match(name):
        raise web.HTTPBadRequest(reason="nom invalide")
    (config.MEDIA_DIR / name).unlink(missing_ok=True)
    return web.json_response({"ok": True})


def build_app(bot):
    app = web.Application(middlewares=[_auth], client_max_size=_MAX_MEDIA + 1024 * 1024)
    app["bot"] = bot
    app.add_routes([
        web.get("/api/health", health),
        web.get("/api/guild/roles", guild_roles),
        web.get("/api/guild/channels", guild_channels),
        web.get("/api/guild/categories", guild_categories),
        web.get("/api/config", list_config),
        web.get("/api/config/{module}", get_config),
        web.post("/api/config/{module}", set_config),
        web.post("/api/action/{module}/{action}", run_action),
        web.get("/api/media", media_list),
        web.post("/api/media/upload", media_upload),
        web.post("/api/media/delete", media_delete),
    ])
    config.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    app.router.add_static("/media/", str(config.MEDIA_DIR))
    return app


async def start_web(bot):
    """Démarre le serveur HTTP sur la boucle courante (à appeler depuis setup_hook)."""
    if not config.API_TOKEN:
        log.warning("FRIPOUILLE_API_TOKEN/WEB_API_TOKEN absent : API dashboard désactivée.")
        return
    app = build_app(bot)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, config.API_HOST, config.API_PORT)
    await site.start()
    log.info("API Fripouille sur http://%s:%s", config.API_HOST, config.API_PORT)
