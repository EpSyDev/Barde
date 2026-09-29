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
import json
import logging
import re
import secrets
import time
import uuid
from urllib.parse import unquote
from pathlib import Path

from aiohttp import web

from . import config, registry

log = logging.getLogger("fripouille.webapi")

# --- Média (images et audios des embeds/messages) ---
_ALLOWED_EXT_IMAGE = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
_ALLOWED_EXT_AUDIO = {".mp3", ".ogg", ".wav", ".m4a"}
_ALLOWED_EXT = _ALLOWED_EXT_IMAGE | _ALLOWED_EXT_AUDIO
_MAX_IMAGE = 8 * 1024 * 1024         # 8 Mo par image
_MAX_AUDIO = 10 * 1024 * 1024        # 10 Mo par audio (limite d'upload Discord standard)
_NAME_RE = re.compile(r"^[a-f0-9]{32}\.(png|jpg|jpeg|gif|webp|mp3|ogg|wav|m4a)$")

# Étiquette affichée (nom d'origine du fichier) associée au nom de stockage (hash).
# Fichier séparé du dossier média (servi tel quel via /media/) pour ne pas l'exposer.
_LABELS_PATH = config.DATA_DIR / "media_labels.json"


def _load_labels():
    try:
        return json.loads(_LABELS_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}


def _save_labels(labels):
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    _LABELS_PATH.write_text(json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8")

# Tickets d'upload à usage unique : le fichier passe directement navigateur → Funnel,
# en contournant la limite de taille de requête des fonctions serverless Vercel (~4,5 Mo)
# qui bloquerait un upload relayé par le dashboard pour un audio de quelques Mo.
_UPLOAD_TICKETS: dict[str, float] = {}
_TICKET_TTL = 300  # secondes


def _new_ticket():
    now = time.monotonic()
    for t, exp in list(_UPLOAD_TICKETS.items()):
        if exp < now:
            del _UPLOAD_TICKETS[t]
    ticket = secrets.token_urlsafe(24)
    _UPLOAD_TICKETS[ticket] = now + _TICKET_TTL
    return ticket


def _consume_ticket(ticket):
    exp = _UPLOAD_TICKETS.pop(ticket, None)
    return exp is not None and exp >= time.monotonic()


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
    authorized = bool(config.API_TOKEN) and token == config.API_TOKEN
    if not authorized and request.method == "POST" and request.path == "/api/media/upload":
        ticket = request.query.get("ticket", "")
        authorized = bool(ticket) and _consume_ticket(ticket)
    if not authorized:
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
    guild = bot.get_guild(config.GUILD_ID) if config.GUILD_ID else None
    latency = bot.latency  # secondes ; nan tant que le premier heartbeat n'a pas eu lieu
    return web.json_response({
        "ok": True,
        "user": str(bot.user) if bot.user else None,
        "guild": config.GUILD_ID,
        "guild_nom": guild.name if guild else None,
        "membres": guild.member_count if guild else None,
        "latence_ms": round(latency * 1000) if latency == latency else None,
        "modules": list(registry.all_modules()),
        "modules_actifs": sorted(k for k in bot.store.keys()
                                 if bot.store.get(k).get("enabled")),
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


async def guild_voice_channels(request):
    """Salons vocaux du serveur (pour choisir le hub TempVoice)."""
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
        for c in sorted(guild.voice_channels, key=lambda c: (c.position,))
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


def _actor(request) -> str:
    """Qui agit, tel que le proxy du dashboard l'a déclaré (header ``X-Actor``).

    Purement informatif pour l'audit : l'autorisation, elle, tient au token d'API et
    à la liste blanche Discord côté dashboard — pas à cet en-tête.
    """
    # le dashboard l'encode (pseudos Discord avec emoji, hors Latin-1)
    return unquote(request.headers.get("X-Actor") or "").strip()[:80] or "inconnu"


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
    merged = bot.store.set(key, data, actor=_actor(request))
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
    # L'appelant déclaré est injecté dans le payload : les actions qui attribuent un
    # geste (sanction, ajustement de solde) s'en servent comme auteur par défaut.
    data.setdefault("_acteur", _actor(request))
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
    labels = _load_labels()
    items = []
    for p in sorted(config.MEDIA_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if p.is_file():
            kind = "audio" if p.suffix.lower() in _ALLOWED_EXT_AUDIO else "image"
            items.append({
                "name": p.name,
                "url": _media_url(p.name),
                "size": p.stat().st_size,
                "kind": kind,
                "label": labels.get(p.name, p.name),
            })
    return web.json_response({"media": items})


async def media_upload_ticket(request):
    """Ticket à usage unique (5 min) pour un upload direct navigateur → Funnel."""
    ticket = _new_ticket()
    base = config.PUBLIC_BASE_URL or ""
    return web.json_response({"upload_url": f"{base}/api/media/upload?ticket={ticket}"})


async def media_upload(request):
    reader = await request.multipart()
    field = await reader.next()
    while field is not None and field.name != "file":
        field = await reader.next()
    if field is None:
        raise web.HTTPBadRequest(reason="fichier manquant")
    ext = Path(field.filename or "").suffix.lower()
    if ext not in _ALLOWED_EXT:
        raise web.HTTPBadRequest(reason="format non supporté (png, jpg, gif, webp, mp3, ogg, wav, m4a)")
    is_audio = ext in _ALLOWED_EXT_AUDIO
    max_size = _MAX_AUDIO if is_audio else _MAX_IMAGE

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
                if size > max_size:
                    raise web.HTTPBadRequest(reason=f"fichier trop lourd (max {max_size // (1024 * 1024)} Mo)")
                f.write(chunk)
    except web.HTTPException:
        dest.unlink(missing_ok=True)
        raise

    label = Path(field.filename or "").stem.strip()[:120] or name
    labels = _load_labels()
    labels[name] = label
    _save_labels(labels)
    return web.json_response({
        "name": name, "url": _media_url(name), "kind": "audio" if is_audio else "image", "label": label,
    })


async def media_rename(request):
    data = await request.json()
    name = str(data.get("name") or "")
    label = str(data.get("label") or "").strip()[:120]
    if not _NAME_RE.match(name):
        raise web.HTTPBadRequest(reason="nom invalide")
    if not (config.MEDIA_DIR / name).is_file():
        raise web.HTTPNotFound(reason="fichier introuvable")
    labels = _load_labels()
    if label:
        labels[name] = label
    else:
        labels.pop(name, None)
    _save_labels(labels)
    return web.json_response({"ok": True, "label": label or name})


async def media_delete(request):
    data = await request.json()
    name = str(data.get("name") or "")
    if not _NAME_RE.match(name):
        raise web.HTTPBadRequest(reason="nom invalide")
    (config.MEDIA_DIR / name).unlink(missing_ok=True)
    labels = _load_labels()
    if labels.pop(name, None) is not None:
        _save_labels(labels)
    return web.json_response({"ok": True})


async def audit_log(request):
    """Journal des modifications de configuration (qui a changé quoi, et depuis quoi)."""
    bot = request.app["bot"]
    limit = int(request.query.get("limit") or 100)
    module = request.query.get("module") or ""
    return web.json_response({"entrees": bot.store.audit(limit, module)})


async def export_config(request):
    """Sauvegarde complète de la configuration (à télécharger depuis le dashboard)."""
    return web.json_response(request.app["bot"].store.export())


async def import_config(request):
    """Restauration d'une sauvegarde. Additive : ne supprime jamais un module absent."""
    data = await request.json()
    if not isinstance(data, dict):
        raise web.HTTPBadRequest(reason="corps JSON attendu (objet)")
    bot = request.app["bot"]
    try:
        result = bot.store.import_data(data, actor=_actor(request))
    except ValueError as exc:
        raise web.HTTPBadRequest(reason=str(exc))
    # Répercute à chaud tout ce qui sait s'appliquer sans redémarrage.
    for key in result["restaures"]:
        mod = registry.get(key)
        if mod and mod.apply is not None:
            try:
                await mod.apply(bot, bot.store.get(key))
            except Exception as exc:  # noqa: BLE001
                log.error("apply(%s) après restauration : %s", key, exc)
    return web.json_response({"ok": True, **result})


def build_app(bot):
    app = web.Application(middlewares=[_auth], client_max_size=_MAX_AUDIO + 1024 * 1024)
    app["bot"] = bot
    app.add_routes([
        web.get("/api/health", health),
        web.get("/api/audit", audit_log),
        web.get("/api/export", export_config),
        web.post("/api/import", import_config),
        web.get("/api/guild/roles", guild_roles),
        web.get("/api/guild/channels", guild_channels),
        web.get("/api/guild/voice-channels", guild_voice_channels),
        web.get("/api/guild/categories", guild_categories),
        web.get("/api/config", list_config),
        web.get("/api/config/{module}", get_config),
        web.post("/api/config/{module}", set_config),
        web.post("/api/action/{module}/{action}", run_action),
        web.get("/api/media", media_list),
        web.post("/api/media/upload-ticket", media_upload_ticket),
        web.post("/api/media/upload", media_upload),
        web.post("/api/media/rename", media_rename),
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
