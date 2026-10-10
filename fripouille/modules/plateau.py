"""Module « Plateau » : carte de combat partagée (table virtuelle D&D) du dashboard.

État unique (une table) : carte + quadrillage, pions, brouillard de guerre, fil des jets.
Persisté dans ``data/plateau.json`` (hors ConfigStore : ça bouge à chaque déplacement,
inutile de polluer l'audit).

Temps réel : chaque navigateur ouvre un flux SSE **directement** sur l'API de La
Fripouille (via le Funnel), avec un ticket délivré par le dashboard après vérification
de la session. Les gestes (déplacer un pion, révéler une zone…) arrivent en POST avec
le même ticket. Chaque changement est diffusé à tous : aucun appel Vercel par geste.

Gestes (``op``) :
- ``pion_ajouter`` / ``pion_maj`` / ``pion_deplacer`` / ``pion_supprimer``
- ``carte`` (image, colonnes, lignes, quadrillage)
- ``brouillard`` (actif), ``reveler`` / ``masquer`` (rectangle de cases), ``brouillard_reset``
- ``ping`` (éphémère : « regardez ici »), ``jet`` (tiré ici, moteur du module Dés)
"""
import asyncio
import json
import logging
import re
import secrets
import time
import uuid

from .. import config
from . import des as des_module

log = logging.getLogger("fripouille.plateau")

FICHIER = config.DATA_DIR / "plateau.json"
TICKET_TTL = 12 * 3600       # une soirée de jeu
MAX_PIONS = 80
MAX_FIL = 40
COULEUR = re.compile(r"^#[0-9a-fA-F]{6}$")
TYPES = ("joueur", "monstre", "pnj")


def _defaut():
    return {
        "version": 0,
        "carte": {"image_url": "", "cols": 24, "rows": 16, "quadrillage": True},
        "pions": [],
        "brouillard": {"actif": False, "reveles": []},   # reveles : [[x, y, l, h], …]
        "fil": [],                                         # derniers jets partagés
    }


_etat: dict | None = None
_abonnes: set[asyncio.Queue] = set()
_tickets: dict[str, tuple[float, str]] = {}   # ticket → (expiration, acteur)
_sauvegarde: asyncio.Task | None = None


# ─────────────────────────── État & persistance ───────────────────────────
def etat() -> dict:
    global _etat
    if _etat is None:
        _etat = _defaut()
        try:
            if FICHIER.exists():
                _etat.update(json.loads(FICHIER.read_text(encoding="utf-8")))
        except (OSError, ValueError) as exc:
            log.error("plateau.json illisible : %s", exc)
    return _etat


async def _ecrire_plus_tard():
    await asyncio.sleep(1.5)       # regroupe les rafales de déplacements
    try:
        FICHIER.parent.mkdir(parents=True, exist_ok=True)
        tmp = FICHIER.with_suffix(".tmp")
        tmp.write_text(json.dumps(etat(), ensure_ascii=False), encoding="utf-8")
        tmp.replace(FICHIER)
    except OSError as exc:
        log.error("sauvegarde plateau : %s", exc)


def _changer():
    global _sauvegarde
    e = etat()
    e["version"] += 1
    _diffuser({"type": "etat", "etat": e})
    if _sauvegarde is None or _sauvegarde.done():
        _sauvegarde = asyncio.get_running_loop().create_task(_ecrire_plus_tard())


def _diffuser(msg: dict):
    data = json.dumps(msg, ensure_ascii=False)
    for q in list(_abonnes):
        if q.qsize() > 50:          # client trop lent / gelé : on le laisse tomber
            _abonnes.discard(q)
            continue
        q.put_nowait(data)


# ─────────────────────────── Tickets ───────────────────────────
def nouveau_ticket(acteur: str) -> str:
    now = time.monotonic()
    for t, (exp, _) in list(_tickets.items()):
        if exp < now:
            del _tickets[t]
    t = secrets.token_urlsafe(24)
    _tickets[t] = (now + TICKET_TTL, acteur[:40] or "?")
    return t


def acteur_du_ticket(ticket: str) -> str | None:
    v = _tickets.get(ticket or "")
    if v is None or v[0] < time.monotonic():
        return None
    return v[1]


# ─────────────────────────── Validation ───────────────────────────
def _num(v, defaut, mini, maxi, entier=False):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return defaut
    n = max(mini, min(maxi, n))
    return int(round(n)) if entier else round(n, 2)


def _url(v):
    v = str(v or "").strip()
    return v if v.startswith("https://") and len(v) < 500 else ""


def _pion(src: dict, base: dict | None = None) -> dict:
    p = dict(base or {"id": uuid.uuid4().hex[:8], "x": 0, "y": 0, "nom": "Pion",
                      "type": "monstre", "couleur": "#c25340", "taille": 1,
                      "pv": None, "pv_max": None, "image_url": "", "cache": False, "etats": []})
    c = etat()["carte"]
    if "nom" in src:
        p["nom"] = str(src["nom"] or "Pion").strip()[:30] or "Pion"
    if src.get("type") in TYPES:
        p["type"] = src["type"]
    if "couleur" in src and COULEUR.match(str(src["couleur"])):
        p["couleur"] = src["couleur"]
    if "taille" in src:
        p["taille"] = _num(src["taille"], 1, 1, 4, entier=True)
    if "x" in src:
        p["x"] = _num(src["x"], 0, 0, c["cols"] - 1, entier=True)
    if "y" in src:
        p["y"] = _num(src["y"], 0, 0, c["rows"] - 1, entier=True)
    if "pv_max" in src:
        p["pv_max"] = None if src["pv_max"] in (None, "") else _num(src["pv_max"], None, 1, 9999, entier=True)
    if "pv" in src:
        p["pv"] = None if src["pv"] in (None, "") else _num(src["pv"], None, -999, 9999, entier=True)
    if p["pv_max"] and p["pv"] is None:
        p["pv"] = p["pv_max"]
    if "image_url" in src:
        p["image_url"] = _url(src["image_url"])
    if "cache" in src:
        p["cache"] = bool(src["cache"])
    if "etats" in src and isinstance(src["etats"], list):
        p["etats"] = [str(x)[:20] for x in src["etats"][:6]]
    return p


def _trouver(pid):
    return next((p for p in etat()["pions"] if p["id"] == pid), None)


def _rect(v):
    try:
        x, y, l, h = (int(round(float(n))) for n in v)
    except (TypeError, ValueError):
        raise ValueError("zone invalide")
    if l < 1 or h < 1:
        raise ValueError("zone vide")
    return [x, y, l, h]


# ─────────────────────────── Gestes ───────────────────────────
async def appliquer(op: str, d: dict, acteur: str) -> dict:
    e = etat()
    if op == "pion_ajouter":
        if len(e["pions"]) >= MAX_PIONS:
            raise ValueError(f"{MAX_PIONS} pions maximum")
        p = _pion(d)
        e["pions"].append(p)
        _changer()
        return {"ok": True, "id": p["id"]}
    if op in ("pion_maj", "pion_deplacer"):
        p = _trouver(d.get("id"))
        if p is None:
            raise ValueError("pion introuvable")
        champs = {k: d[k] for k in ("x", "y")} if op == "pion_deplacer" else d
        p.update(_pion(champs, p))
        _changer()
        return {"ok": True}
    if op == "pion_supprimer":
        e["pions"] = [p for p in e["pions"] if p["id"] != d.get("id")]
        _changer()
        return {"ok": True}
    if op == "carte":
        c = e["carte"]
        if "image_url" in d:
            c["image_url"] = _url(d["image_url"])
        if "cols" in d:
            c["cols"] = _num(d["cols"], 24, 4, 80, entier=True)
        if "rows" in d:
            c["rows"] = _num(d["rows"], 16, 4, 80, entier=True)
        if "quadrillage" in d:
            c["quadrillage"] = bool(d["quadrillage"])
        for p in e["pions"]:                       # rien hors carte
            p["x"], p["y"] = min(p["x"], c["cols"] - 1), min(p["y"], c["rows"] - 1)
        _changer()
        return {"ok": True}
    if op == "brouillard":
        e["brouillard"]["actif"] = bool(d.get("actif"))
        _changer()
        return {"ok": True}
    if op in ("reveler", "masquer"):
        r = _rect(d.get("zone"))
        b = e["brouillard"]
        if op == "reveler":
            b["reveles"].append(r)
            b["reveles"] = b["reveles"][-200:]
        else:   # masquer : on retire les zones révélées entièrement couvertes
            x, y, l, h = r
            b["reveles"] = [z for z in b["reveles"]
                            if not (z[0] >= x and z[1] >= y and z[0] + z[2] <= x + l and z[1] + z[3] <= y + h)]
        _changer()
        return {"ok": True}
    if op == "brouillard_reset":
        e["brouillard"]["reveles"] = []
        _changer()
        return {"ok": True}
    if op == "ping":
        _diffuser({"type": "ping", "x": _num(d.get("x"), 0, 0, 999), "y": _num(d.get("y"), 0, 0, 999),
                   "qui": acteur, "couleur": d.get("couleur") if COULEUR.match(str(d.get("couleur"))) else "#f0d489"})
        return {"ok": True}
    if op == "jet":
        try:
            r = des_module.jet(str(d.get("expr") or "1d20")[:60], "c" if d.get("critique") else "n")
        except des_module.JetInvalide as exc:
            raise ValueError(str(exc))
        entree = {"id": uuid.uuid4().hex[:8], "qui": acteur, "raison": str(d.get("raison") or "")[:60],
                  "expr": r["expr"], "total": r["total"], "nat": r["nat"], "lignes": r["lignes"],
                  "des": r["des"], "cache": bool(d.get("secret")), "heure": int(time.time())}
        e["fil"] = (e["fil"] + [entree])[-MAX_FIL:]
        _changer()
        bot = _bot_ref.get("bot")
        if bot is not None:
            raison = f" · {entree['raison']}" if entree["raison"] else ""
            await des_module._log(bot, f"🗺️ **{acteur}** (plateau){raison}"
                                       f" · `{r['expr']}` → **{r['total']}**"
                                       + (" · 🔒 secret" if entree["cache"] else ""))
        return {"ok": True, "jet": entree}
    raise ValueError("geste inconnu")


_bot_ref: dict = {}


def attacher(bot):
    _bot_ref["bot"] = bot


# ─────────────────────────── Flux SSE ───────────────────────────
async def flux(request, web):
    """Flux d'événements : l'état complet à l'ouverture, puis chaque changement."""
    resp = web.StreamResponse(headers={
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
    })
    await resp.prepare(request)
    q: asyncio.Queue = asyncio.Queue()
    _abonnes.add(q)
    try:
        await resp.write(f"data: {json.dumps({'type': 'etat', 'etat': etat()}, ensure_ascii=False)}\n\n".encode())
        while True:
            try:
                data = await asyncio.wait_for(q.get(), timeout=20)
                await resp.write(f"data: {data}\n\n".encode())
            except asyncio.TimeoutError:
                await resp.write(b": battement\n\n")   # garde la connexion ouverte
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    finally:
        _abonnes.discard(q)
    return resp

