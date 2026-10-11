"""Module « Plateau » : table virtuelle D&D du dashboard (carte, pions, dés, initiative,
carnet du MJ).

État unique (une table) : carte + quadrillage, pions, brouillard de guerre, fil des jets,
initiative, document affiché aux joueurs. Persisté dans ``data/plateau.json`` (hors
ConfigStore : ça bouge à chaque déplacement, inutile de polluer l'audit). Les aventures
préparées par le MJ vivent à part dans ``data/aventures.json``.

Temps réel : chaque navigateur ouvre un flux SSE **directement** sur l'API de La
Fripouille (via le Funnel), avec un ticket délivré par le dashboard après vérification
de la session. Le ticket porte l'identité (acteur, id Discord) et le **rôle** :

- ``admin`` / ``mj`` : tout voir, tout faire (scène, ambiance, brouillard, monstres,
  carnet, jets secrets) ;
- ``joueur`` : ne reçoit qu'une **vue filtrée** (rien sous le brouillard, aucun pion
  caché, pas de PV des monstres, jets secrets masqués, ni carnet ni notes) et ne peut que
  créer / déplacer / soigner **son** héros, pinger, lancer les dés et son initiative.

Le filtrage est fait ICI : ce que le joueur ne doit pas voir ne quitte jamais le serveur.
"""
import asyncio
import json
import logging
import re
import secrets
import time
import uuid

from .. import config
from ..registry import Module, register
from . import des as des_module

log = logging.getLogger("fripouille.plateau")

FICHIER = config.DATA_DIR / "plateau.json"
FICHIER_AVENTURES = config.DATA_DIR / "aventures.json"
TICKET_TTL = 12 * 3600       # une soirée de jeu
MAX_PIONS = 80
MAX_FIL = 40
MAX_AVENTURES = 30
MAX_ETAPES = 40
COULEUR = re.compile(r"^#[0-9a-fA-F]{6}$")
UID = re.compile(r"^\d{15,25}$")
TYPES = ("joueur", "monstre", "pnj")
LUMIERES = ("jour", "crepuscule", "nuit")
METEOS = ("aucune", "pluie", "neige", "brume", "braises")
SONS = ("aucun", "taverne", "crypte", "foret", "camp", "pluie")
ROLES_MJ = ("admin", "mj")
# Gestes ouverts aux joueurs (le reste est réservé au MJ). Les gestes sur un pion sont en
# plus limités à SON héros, et pion_maj aux seuls PV / états.
GESTES_JOUEUR = {"pion_ajouter", "pion_deplacer", "pion_maj", "ping", "jet", "init_lancer", "init_suivant"}
CHAMPS_JOUEUR = ("pv", "etats")


def _defaut():
    return {
        "version": 0,
        "carte": {"image_url": "", "cols": 24, "rows": 16, "quadrillage": True},
        "pions": [],
        "brouillard": {"actif": False, "reveles": []},   # reveles : [[x, y, l, h], …]
        "fil": [],                                         # derniers jets partagés
        "scene": {"id": "", "nom": "", "lumieres": []},    # lumieres : [[x, y, rayon], …] du décor
        "ambiance": {"lumiere": "jour", "meteo": "aucune", "son": "aucun"},
        "initiative": {"actif": False, "round": 0, "tour": 0, "entrees": []},
        "affiche": None,                                   # document montré aux joueurs
        "mj": {"aventure_id": "", "etape_id": ""},         # avancée de la quête (MJ seulement)
    }


_etat: dict | None = None
_aventures: list | None = None
_abonnes: dict[asyncio.Queue, dict] = {}          # file → {acteur, role, uid}
_tickets: dict[str, dict] = {}                    # ticket → {exp, acteur, role, uid}
_sauvegarde: asyncio.Task | None = None


def est_mj(qui: dict) -> bool:
    return (qui or {}).get("role") in ROLES_MJ


# ─────────────────────────── État & persistance ───────────────────────────
def etat() -> dict:
    global _etat
    if _etat is None:
        _etat = _defaut()
        try:
            if FICHIER.exists():
                _etat.update(json.loads(FICHIER.read_text(encoding="utf-8")))
            for k, v in _defaut().items():          # clés ajoutées depuis la sauvegarde
                _etat.setdefault(k, v)
        except (OSError, ValueError) as exc:
            log.error("plateau.json illisible : %s", exc)
    return _etat


def aventures() -> list:
    global _aventures
    if _aventures is None:
        _aventures = []
        try:
            if FICHIER_AVENTURES.exists():
                _aventures = json.loads(FICHIER_AVENTURES.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            log.error("aventures.json illisible : %s", exc)
    return _aventures


def _ecrire(fichier, donnees):
    try:
        fichier.parent.mkdir(parents=True, exist_ok=True)
        tmp = fichier.with_suffix(".tmp")
        tmp.write_text(json.dumps(donnees, ensure_ascii=False), encoding="utf-8")
        tmp.replace(fichier)
    except OSError as exc:
        log.error("sauvegarde %s : %s", fichier.name, exc)


async def _ecrire_plus_tard():
    await asyncio.sleep(1.5)       # regroupe les rafales de déplacements
    _ecrire(FICHIER, etat())


def _changer():
    global _sauvegarde
    e = etat()
    e["version"] += 1
    _diffuser_etat()
    if _sauvegarde is None or _sauvegarde.done():
        _sauvegarde = asyncio.get_running_loop().create_task(_ecrire_plus_tard())


def _aventures_changees():
    _ecrire(FICHIER_AVENTURES, aventures())
    _diffuser({"type": "aventures", "liste": aventures()}, mj_seulement=True)


# ─────────────────────────── Vue par rôle ───────────────────────────
def _revele(e, x, y, t=1) -> bool:
    b = e["brouillard"]
    if not b["actif"]:
        return True
    for cx in range(x, x + t):
        for cy in range(y, y + t):
            if any(rx <= cx < rx + rl and ry <= cy < ry + rh for rx, ry, rl, rh in b["reveles"]):
                return True
    return False


def _pion_visible(e, p) -> bool:
    if p.get("cache"):
        return False
    return p["type"] == "joueur" or _revele(e, p["x"], p["y"], p.get("taille", 1))


def vue(qui: dict) -> dict:
    """L'état tel que ce participant a le droit de le voir."""
    e = etat()
    ini = dict(e["initiative"])
    entrees = ini.get("entrees") or []
    ini["courant"] = entrees[ini["tour"]]["cle"] if ini.get("round") and entrees and ini["tour"] < len(entrees) else None
    if est_mj(qui):
        return {**e, "initiative": ini, "acces": _liste_acces()}
    visibles = {p["id"] for p in e["pions"] if _pion_visible(e, p)}
    pions = []
    for p in e["pions"]:
        if p["id"] not in visibles:
            continue
        q = dict(p)
        if q["type"] != "joueur":          # les PV des monstres restent derrière l'écran
            q["pv"], q["pv_max"] = None, None
        pions.append(q)
    fil = []
    for j in e["fil"]:
        if j.get("cache"):
            fil.append({"id": j["id"], "qui": j["qui"], "uid": j.get("uid", ""), "raison": "", "expr": "",
                        "total": None, "nat": None, "lignes": [], "des": [], "cache": True,
                        "heure": j["heure"]})
        else:
            fil.append(j)
    ini["entrees"] = [en for en in entrees if not en.get("pion_id") or en["pion_id"] in visibles]
    return {
        "version": e["version"], "carte": e["carte"], "pions": pions,
        "brouillard": e["brouillard"], "fil": fil, "scene": e["scene"], "ambiance": e["ambiance"],
        "initiative": ini, "affiche": e.get("affiche"),
    }


def _liste_acces() -> list:
    bot = _bot_ref.get("bot")
    if bot is None:
        return []
    return [m for m in bot.store.get("acces").get("membres", []) if m.get("role") in ("joueur", "mj")]


def _envoyer(q: asyncio.Queue, data: str):
    if q.qsize() > 50:          # client trop lent / gelé : on le laisse tomber
        _abonnes.pop(q, None)
        return
    q.put_nowait(data)


def _diffuser(msg: dict, mj_seulement: bool = False):
    data = json.dumps(msg, ensure_ascii=False)
    for q, qui in list(_abonnes.items()):
        if mj_seulement and not est_mj(qui):
            continue
        _envoyer(q, data)


def _diffuser_etat():
    cache: dict[str, str] = {}
    for q, qui in list(_abonnes.items()):
        cle = "mj" if est_mj(qui) else "joueur"
        if cle not in cache:
            cache[cle] = json.dumps({"type": "etat", "etat": vue(qui)}, ensure_ascii=False)
        _envoyer(q, cache[cle])


def _presents() -> list:
    vus, out = set(), []
    for qui in _abonnes.values():
        k = qui.get("uid") or qui.get("acteur")
        if k in vus:
            continue
        vus.add(k)
        out.append({"acteur": qui.get("acteur"), "role": qui.get("role"), "uid": qui.get("uid")})
    return out


def _diffuser_presents():
    _diffuser({"type": "presents", "liste": _presents()})


# ─────────────────────────── Tickets ───────────────────────────
def nouveau_ticket(acteur: str, role: str = "admin", uid: str = "") -> str:
    now = time.monotonic()
    for t, v in list(_tickets.items()):
        if v["exp"] < now:
            del _tickets[t]
    t = secrets.token_urlsafe(24)
    _tickets[t] = {
        "exp": now + TICKET_TTL, "acteur": acteur[:40] or "?",
        "role": role if role in ("admin", "mj", "joueur") else "joueur",
        "uid": uid if UID.match(uid or "") else "",
    }
    return t


def ticket(t: str) -> dict | None:
    v = _tickets.get(t or "")
    if v is None or v["exp"] < time.monotonic():
        return None
    return {"acteur": v["acteur"], "role": v["role"], "uid": v["uid"]}


def acteur_du_ticket(t: str) -> str | None:
    v = ticket(t)
    return v["acteur"] if v else None


def role_du_ticket(t: str) -> str | None:
    v = ticket(t)
    return v["role"] if v else None


# ─────────────────────────── Validation ───────────────────────────
def _num(v, defaut, mini, maxi, entier=False):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return defaut
    n = max(mini, min(maxi, n))
    return int(round(n)) if entier else round(n, 2)


def _url(v):
    """Image : URL https (médiathèque) ou carte livrée avec le dashboard (/cartes/…)."""
    v = str(v or "").strip()
    if re.fullmatch(r"/cartes/[a-z0-9_-]+\.(webp|png|jpg)", v):
        return v
    return v if v.startswith("https://") and len(v) < 500 else ""


def _txt(v, n):
    return str(v or "").strip()[:n]


def _pion(src: dict, base: dict | None = None) -> dict:
    p = dict(base or {"id": uuid.uuid4().hex[:8], "x": 0, "y": 0, "nom": "Pion",
                      "type": "monstre", "couleur": "#c25340", "taille": 1,
                      "pv": None, "pv_max": None, "image_url": "", "cache": False, "etats": [],
                      "icone": "", "proprio": ""})
    p.setdefault("proprio", "")
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
    if "icone" in src:
        p["icone"] = str(src["icone"] or "")[:4]
    if "etats" in src and isinstance(src["etats"], list):
        p["etats"] = [str(x)[:20] for x in src["etats"][:6]]
    if "proprio" in src:
        p["proprio"] = str(src["proprio"]) if UID.match(str(src["proprio"] or "")) else ""
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


def _borner_pions(e):
    c = e["carte"]
    for p in e["pions"]:                       # rien hors carte
        p["x"], p["y"] = min(p["x"], c["cols"] - 1), min(p["y"], c["rows"] - 1)


def _appliquer_scene(e, d):
    """Carte, quadrillage, lumières du décor et ambiance (scène prête ou photo d'étape)."""
    c = e["carte"]
    c["image_url"] = _url(d.get("image_url"))
    c["cols"] = _num(d.get("cols"), 24, 4, 80, entier=True)
    c["rows"] = _num(d.get("rows"), 16, 4, 80, entier=True)
    c["quadrillage"] = bool(d.get("quadrillage", True))
    lum = []
    for l in (d.get("lumieres") or [])[:30]:
        try:
            lum.append([float(l[0]), float(l[1]), float(l[2])])
        except (TypeError, ValueError, IndexError):
            pass
    e["scene"] = {"id": _txt(d.get("id"), 30), "nom": _txt(d.get("nom"), 60), "lumieres": lum}
    amb = d.get("ambiance") or {}
    e["ambiance"] = {
        "lumiere": amb.get("lumiere") if amb.get("lumiere") in LUMIERES else "jour",
        "meteo": amb.get("meteo") if amb.get("meteo") in METEOS else "aucune",
        "son": amb.get("son") if amb.get("son") in SONS else "aucun",
    }
    _borner_pions(e)


# ─────────────────────────── Dés & initiative ───────────────────────────
async def _jet(e, qui, expr, critique=False, raison="", secret=False, journal=True) -> dict:
    brut = des_module._normaliser(str(expr or "1d20"))[:des_module.MAX_EXPR]
    try:
        r = des_module.jet(brut, "c" if critique else "n")
    except des_module.JetInvalide as exc:
        raise ValueError(str(exc))
    entree = {"id": uuid.uuid4().hex[:8], "qui": qui["acteur"], "uid": qui.get("uid", ""),
              "raison": _txt(raison, 60), "expr": r["expr"], "brut": brut, "critique": bool(critique),
              "total": r["total"], "nat": r["nat"] if not critique else None, "lignes": r["lignes"],
              "des": r["des"], "cache": bool(secret), "heure": int(time.time())}
    e["fil"] = (e["fil"] + [entree])[-MAX_FIL:]
    bot = _bot_ref.get("bot")
    if bot is not None and journal:
        marques = [m for m, ok in (("🔒 secret", secret), ("💥 critique", critique)) if ok]
        nat = " ✨ 20 naturel" if entree["nat"] == 20 else " 💀 1 naturel" if entree["nat"] == 1 else ""
        raison_txt = " · " + entree["raison"] if entree["raison"] else ""
        await des_module._log(bot, "🗺️ **%s** (table)%s · `%s` → **%s**%s%s" % (
            qui["acteur"], raison_txt, r["expr"], r["total"], nat,
            " · " + ", ".join(marques) if marques else ""))
    return entree


def _trier_initiative(ini):
    courant = ini["entrees"][ini["tour"]]["cle"] if ini["round"] and ini["entrees"] else None
    ini["entrees"].sort(key=lambda en: (en["total"], en["bonus"], en.get("alea", 0)), reverse=True)
    if courant:
        ini["tour"] = next((i for i, en in enumerate(ini["entrees"]) if en["cle"] == courant), 0)


# ─────────────────────────── Aventures (carnet du MJ) ───────────────────────────
def _aventure(aid):
    return next((a for a in aventures() if a["id"] == aid), None)


def _etape(a, eid):
    return next((s for s in a["etapes"] if s["id"] == eid), None)


def _nettoyer_aventure(src: dict, base: dict | None) -> dict:
    a = {"id": (base or {}).get("id") or uuid.uuid4().hex[:8],
         "titre": _txt(src.get("titre"), 80) or "Aventure sans titre",
         "resume": _txt(src.get("resume"), 2000), "etapes": []}
    anciennes = {s["id"]: s for s in (base or {}).get("etapes", [])}
    for s in (src.get("etapes") or [])[:MAX_ETAPES]:
        if not isinstance(s, dict):
            continue
        sid = str(s.get("id") or "")
        sid = sid if re.fullmatch(r"[0-9a-f]{8}", sid) else uuid.uuid4().hex[:8]
        docs = []
        for doc in (s.get("documents") or [])[:12]:
            if isinstance(doc, dict):
                did = str(doc.get("id") or "")
                docs.append({"id": did if re.fullmatch(r"[0-9a-f]{8}", did) else uuid.uuid4().hex[:8],
                             "titre": _txt(doc.get("titre"), 80), "texte": _txt(doc.get("texte"), 3000),
                             "image_url": _url(doc.get("image_url"))})
        a["etapes"].append({
            "id": sid, "titre": _txt(s.get("titre"), 80) or "Étape",
            "texte": _txt(s.get("texte"), 4000), "notes": _txt(s.get("notes"), 4000),
            "documents": docs, "fait": bool(s.get("fait")),
            # la photo du plateau ne se modifie que par « etape_photo »
            "photo": (anciennes.get(sid) or {}).get("photo"),
        })
    return a


def _photo(e) -> dict:
    return {
        "carte": dict(e["carte"]), "scene": dict(e["scene"]), "ambiance": dict(e["ambiance"]),
        "brouillard": {"actif": e["brouillard"]["actif"], "reveles": list(e["brouillard"]["reveles"])},
        "pions": [dict(p) for p in e["pions"] if p["type"] != "joueur"],
        "prise": int(time.time()),
    }


def _lancer_photo(e, ph):
    _appliquer_scene(e, {**ph["carte"], **{k: ph["scene"].get(k) for k in ("id", "nom", "lumieres")},
                         "ambiance": ph["ambiance"]})
    e["brouillard"] = {"actif": bool(ph["brouillard"]["actif"]), "reveles": list(ph["brouillard"]["reveles"])}
    heros = [p for p in e["pions"] if p["type"] == "joueur"]
    nouveaux = []
    for p in ph.get("pions", [])[:MAX_PIONS - len(heros)]:
        q = dict(p)
        q["id"] = uuid.uuid4().hex[:8]
        nouveaux.append(q)
    e["pions"] = heros + nouveaux
    _borner_pions(e)


# ─────────────────────────── Gestes ───────────────────────────
async def appliquer(op: str, d: dict, qui: dict) -> dict:
    e = etat()
    mj = est_mj(qui)
    if not mj and op not in GESTES_JOUEUR:
        raise ValueError("geste réservé au MJ")

    if op == "pion_ajouter":
        if len(e["pions"]) >= MAX_PIONS:
            raise ValueError(f"{MAX_PIONS} pions maximum")
        if not mj:
            # Un joueur ne crée que SON héros, une seule fois.
            if not qui.get("uid"):
                raise ValueError("identité Discord inconnue")
            if any(p.get("proprio") == qui["uid"] for p in e["pions"]):
                raise ValueError("tu as déjà ton héros sur le plateau")
            d = {k: d[k] for k in ("nom", "couleur", "icone", "x", "y", "image_url") if k in d}
            d.update(type="joueur", proprio=qui["uid"], cache=False)
        p = _pion(d)
        e["pions"].append(p)
        _changer()
        return {"ok": True, "id": p["id"]}
    if op in ("pion_maj", "pion_deplacer"):
        p = _trouver(d.get("id"))
        if p is None:
            raise ValueError("pion introuvable")
        if not mj and p.get("proprio") != qui.get("uid"):
            raise ValueError("ce n'est pas ton héros")
        if op == "pion_deplacer":
            champs = {k: d[k] for k in ("x", "y") if k in d}
        elif mj:
            champs = d
        else:
            champs = {k: d[k] for k in CHAMPS_JOUEUR if k in d}
        p.update(_pion(champs, p))
        _changer()
        return {"ok": True}
    if op == "pion_supprimer":
        e["pions"] = [p for p in e["pions"] if p["id"] != d.get("id")]
        e["initiative"]["entrees"] = [en for en in e["initiative"]["entrees"] if en.get("pion_id") != d.get("id")]
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
        _borner_pions(e)
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
    if op == "ambiance":
        a = e.setdefault("ambiance", _defaut()["ambiance"])
        for k, choix in (("lumiere", LUMIERES), ("meteo", METEOS), ("son", SONS)):
            if d.get(k) in choix:
                a[k] = d[k]
        _changer()
        return {"ok": True}
    if op == "scene":
        _appliquer_scene(e, d)
        e["brouillard"] = {"actif": bool(d.get("brouillard")), "reveles": []}
        _changer()
        return {"ok": True}
    if op == "reinitialiser":
        # Nouvelle partie : pions, brouillard, fil, initiative et affiche effacés ; la carte reste.
        e["pions"], e["fil"] = [], []
        e["brouillard"] = {"actif": False, "reveles": []}
        e["initiative"] = _defaut()["initiative"]
        e["affiche"] = None
        if d.get("carte"):
            e["carte"] = _defaut()["carte"]
        _changer()
        return {"ok": True}
    if op == "brouillard_reset":
        e["brouillard"]["reveles"] = []
        _changer()
        return {"ok": True}
    if op == "ping":
        _diffuser({"type": "ping", "x": _num(d.get("x"), 0, 0, 999), "y": _num(d.get("y"), 0, 0, 999),
                   "qui": qui["acteur"],
                   "couleur": d.get("couleur") if COULEUR.match(str(d.get("couleur"))) else "#f0d489"})
        return {"ok": True}

    # ── Dés ──
    if op == "jet":
        entree = await _jet(e, qui, d.get("expr"), bool(d.get("critique")), d.get("raison"),
                            secret=bool(d.get("secret")) and mj)
        _changer()
        return {"ok": True, "jet": entree}
    if op == "jet_reveler":
        j = next((x for x in e["fil"] if x["id"] == d.get("id")), None)
        if j is None:
            raise ValueError("jet introuvable")
        j["cache"] = False
        _changer()
        bot = _bot_ref.get("bot")
        if bot is not None:
            await des_module._log(bot, "📢 **%s** révèle son jet secret à la table (%s)." % (qui["acteur"], j["total"]))
        return {"ok": True}

    # ── Initiative ──
    ini = e["initiative"]
    if op == "init_ouvrir":
        e["initiative"] = {"actif": True, "round": 0, "tour": 0, "entrees": []}
        _changer()
        return {"ok": True}
    if op == "init_lancer":
        if not ini["actif"]:
            raise ValueError("aucun combat en cours (le MJ ouvre l'initiative)")
        try:
            bonus = max(-20, min(30, int(str(d.get("bonus") or 0).replace(" ", "") or 0)))
        except ValueError:
            raise ValueError("le bonus doit être un nombre (ex. 2 ou -1)")
        pion = _trouver(d.get("pion_id")) if d.get("pion_id") else None
        if pion is not None and not mj and pion.get("proprio") != qui.get("uid"):
            raise ValueError("ce n'est pas ton héros")
        nom = _txt(d.get("nom"), 40) or (pion["nom"] if pion else qui["acteur"])
        cle = "%s:%s" % (pion["id"] if pion else qui.get("uid") or qui["acteur"], nom.lower())
        secret = bool(d.get("secret")) and mj
        jet = await _jet(e, qui, "1d20%+d" % bonus if bonus else "1d20", raison="Initiative · " + nom,
                         secret=secret)
        ini["entrees"] = [en for en in ini["entrees"] if en["cle"] != cle]
        ini["entrees"].append({"cle": cle, "uid": pion.get("proprio") if pion else qui.get("uid", ""),
                               "nom": nom, "total": jet["total"], "d20": jet["total"] - bonus,
                               "bonus": bonus, "pion_id": pion["id"] if pion else "",
                               "alea": secrets.randbelow(1000)})
        _trier_initiative(ini)
        _changer()
        return {"ok": True}
    if op == "init_suivant":
        if not ini["actif"] or not ini["entrees"]:
            raise ValueError("personne n'a lancé son initiative")
        if not mj:
            if not ini["round"]:
                raise ValueError("seul le MJ lance le premier tour")
            if ini["entrees"][ini["tour"]].get("uid") != qui.get("uid"):
                raise ValueError("ce n'est pas ton tour")
        if not ini["round"]:
            ini["round"], ini["tour"] = 1, 0
        else:
            ini["tour"] += 1
            if ini["tour"] >= len(ini["entrees"]):
                ini["tour"], ini["round"] = 0, ini["round"] + 1
        _changer()
        bot = _bot_ref.get("bot")
        if bot is not None:
            await des_module._log(bot, "⏭️ Round %d — au tour de **%s** (passé par **%s**)" % (
                ini["round"], ini["entrees"][ini["tour"]]["nom"], qui["acteur"]))
        return {"ok": True}
    if op == "init_retirer":
        ini["entrees"] = [en for en in ini["entrees"] if en["cle"] != d.get("cle")]
        ini["tour"] = min(ini["tour"], max(0, len(ini["entrees"]) - 1))
        _changer()
        return {"ok": True}
    if op == "init_fermer":
        e["initiative"] = _defaut()["initiative"]
        _changer()
        return {"ok": True}

    # ── Document montré aux joueurs ──
    if op == "montrer":
        e["affiche"] = {"id": uuid.uuid4().hex[:8], "titre": _txt(d.get("titre"), 80),
                        "texte": _txt(d.get("texte"), 4000), "image_url": _url(d.get("image_url"))}
        _changer()
        return {"ok": True}
    if op == "montrer_retirer":
        e["affiche"] = None
        _changer()
        return {"ok": True}

    # ── Carnet du MJ ──
    if op == "aventures":
        return {"ok": True, "liste": aventures()}
    if op == "aventure_sauver":
        src = d.get("aventure") if isinstance(d.get("aventure"), dict) else {}
        base = _aventure(src.get("id")) if src.get("id") else None
        if base is None and len(aventures()) >= MAX_AVENTURES:
            raise ValueError(f"{MAX_AVENTURES} aventures maximum")
        a = _nettoyer_aventure(src, base)
        liste = aventures()
        if base is None:
            liste.append(a)
        else:
            liste[liste.index(base)] = a
        _aventures_changees()
        return {"ok": True, "aventure": a}
    if op == "aventure_supprimer":
        a = _aventure(d.get("id"))
        if a is not None:
            aventures().remove(a)
            if e["mj"].get("aventure_id") == a["id"]:
                e["mj"] = {"aventure_id": "", "etape_id": ""}
                _changer()
            _aventures_changees()
        return {"ok": True}
    if op in ("etape_photo", "etape_lancer", "etape_fait"):
        a = _aventure(d.get("aventure_id"))
        s = _etape(a, d.get("etape_id")) if a else None
        if s is None:
            raise ValueError("étape introuvable (enregistre l'aventure d'abord)")
        if op == "etape_photo":
            s["photo"] = _photo(e)
        elif op == "etape_fait":
            s["fait"] = bool(d.get("fait"))
        else:
            if s.get("photo"):
                _lancer_photo(e, s["photo"])
            e["mj"] = {"aventure_id": a["id"], "etape_id": s["id"]}
            e["affiche"] = None
            s["fait"] = True
            _changer()
        _aventures_changees()
        return {"ok": True}
    if op == "aventure_choisir":
        a = _aventure(d.get("id"))
        e["mj"] = {"aventure_id": a["id"] if a else "", "etape_id": ""}
        _changer()
        return {"ok": True}
    raise ValueError("geste inconnu")


_bot_ref: dict = {}


async def action_resume(_bot, _payload):
    """Résumé de la table pour l'accueil du panneau (chiffres réels, rien de secret)."""
    e = etat()
    ini = e["initiative"]
    return {"ok": True, "scene": e["scene"].get("nom") or "", "pions": len(e["pions"]),
            "heros": sum(1 for p in e["pions"] if p["type"] == "joueur"),
            "presents": len(_presents()), "aventures": len(aventures()),
            "combat": bool(ini.get("actif")), "round": ini.get("round", 0)}


MODULE = register(Module(key="plateau", label="Table de jeu", defaults={}, actions={"resume": action_resume}))


def attacher(bot):
    _bot_ref["bot"] = bot


# ─────────────────────────── Flux SSE ───────────────────────────
async def flux(request, web, qui: dict):
    """Flux d'événements : identité + état (filtré selon le rôle) à l'ouverture, puis
    chaque changement."""
    resp = web.StreamResponse(headers={
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
    })
    await resp.prepare(request)
    q: asyncio.Queue = asyncio.Queue()
    _abonnes[q] = qui

    def ligne(msg):
        return ("data: %s\n\n" % json.dumps(msg, ensure_ascii=False)).encode()

    try:
        await resp.write(ligne({"type": "moi", **qui}))
        await resp.write(ligne({"type": "etat", "etat": vue(qui)}))
        if est_mj(qui):
            await resp.write(ligne({"type": "aventures", "liste": aventures()}))
        _diffuser_presents()
        while True:
            try:
                data = await asyncio.wait_for(q.get(), timeout=20)
                await resp.write(("data: %s\n\n" % data).encode())
            except asyncio.TimeoutError:
                await resp.write(b": battement\n\n")   # garde la connexion ouverte
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    finally:
        _abonnes.pop(q, None)
        _diffuser_presents()
    return resp
