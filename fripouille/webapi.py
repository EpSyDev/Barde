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

from aiohttp import web

from . import config, registry

log = logging.getLogger("fripouille.webapi")


@web.middleware
async def _auth(request, handler):
    if request.method == "OPTIONS":            # préflight CORS
        return _cors(web.Response(status=204))
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


def build_app(bot):
    app = web.Application(middlewares=[_auth])
    app["bot"] = bot
    app.add_routes([
        web.get("/api/health", health),
        web.get("/api/guild/roles", guild_roles),
        web.get("/api/config", list_config),
        web.get("/api/config/{module}", get_config),
        web.post("/api/config/{module}", set_config),
    ])
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
