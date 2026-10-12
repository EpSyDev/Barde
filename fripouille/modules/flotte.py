"""Module « Guerre des Flottes Royales » : bataille navale de la taverne, jouée sur la page
/flotte du dashboard, en salons de 2 à 8 capitaines (bots d'entraînement possibles).

Les règles vivent dans ``flotte_regles.py`` (Python pur, testé). Ici : les salons (codes
de partage, hôte, nettoyage), l'état persistant (``data/flotte.json``), l'horloge des
manches, les tickets et le flux temps réel (SSE).

Temps réel : même pont que les Ombres — le dashboard vérifie la session Discord et délivre
un ticket ; le navigateur se branche ensuite directement sur l'API (Funnel) :
- ``GET  /api/flotte/flux?ticket=…[&salon=…]`` : sans salon, le « quai » (salons publics
  ouverts) ; avec, la vue du salon, filtrée pour CE capitaine (brouillard de guerre) ;
- ``POST /api/flotte/op`` (en-tête ``X-Flotte-Ticket``) : les gestes (``op`` + ``salon`` +
  arguments). Le ticket ne passe dans l'URL que pour le flux (EventSource), et le journal
  d'accès le masque (voir webapi).

Persistance : l'état des salons (``data/flotte.json``) et, pour chaque partie finie, un
résumé (date, carte, participants, vainqueurs, statistiques) dans
``data/flotte_historique.json`` — les 200 dernières parties, rien de plus.

Le serveur est seul juge : le client envoie des intentions (ordres d'une manche), jamais un
état. Un code de salon permet de s'inscrire au quai, rien de plus : chaque geste est
revérifié contre l'identité du ticket et sa place dans le salon.
"""
import asyncio
import json
import logging
import re
import secrets
import time

from .. import config
from ..registry import Module, register
from . import flotte_regles as R

log = logging.getLogger("fripouille.flotte")

FICHIER = config.DATA_DIR / "flotte.json"
HISTORIQUE = config.DATA_DIR / "flotte_historique.json"   # résultats des parties finies
MAX_ARCHIVES = 200                                        # rétention : les 200 dernières
TICKET_TTL = 12 * 3600
UID = re.compile(r"^\d{15,25}$")
AVATAR = re.compile(r"^https://cdn\.discordapp\.com/[\w/.\-]+(\?[\w=&.\-]*)?$")
ROLES_ACCES = ("admin", "mj", "joueur", "convive")
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"     # sans 0/O ni 1/I : se dicte en vocal
MAX_SALONS = 40
GRACE_HOTE = 60                  # hôte déconnecté du quai : la barre passe au suivant
OUBLI = {"salon": 20 * 60, "fin": 30 * 60}         # salons désertés puis refermés
DEFAULTS = {"enabled": True}

_etat: dict | None = None        # {"salons": {id: partie}}
_verrou = asyncio.Lock()
_abonnes: dict[asyncio.Queue, dict] = {}           # file → {"qui": …, "salon": id | None}
_tickets: dict[str, dict] = {}
_debit: dict[str, list] = {}
_taches: dict[str, asyncio.Task] = {}
_bot_ref: dict = {}


# ─────────────────────────── État & persistance ───────────────────────────
def etat() -> dict:
    global _etat
    if _etat is None:
        _etat = {"salons": {}}
        try:
            if FICHIER.exists():
                _etat.update(json.loads(FICHIER.read_text(encoding="utf-8")))
        except (OSError, ValueError) as exc:
            log.error("flotte.json illisible : %s", exc)
    return _etat


def salons() -> dict:
    return etat()["salons"]


def _ecrire():
    try:
        FICHIER.parent.mkdir(parents=True, exist_ok=True)
        tmp = FICHIER.with_suffix(".tmp")
        tmp.write_text(json.dumps(etat(), ensure_ascii=False), encoding="utf-8")
        tmp.replace(FICHIER)
    except OSError as exc:
        log.error("sauvegarde flotte.json : %s", exc)


async def _ecrire_plus_tard():
    await asyncio.sleep(1.0)
    _ecrire()


def _changer(sid: str | None):
    """Un salon a bougé : nouvelle vue pour ses abonnés, et le quai suit."""
    if sid and sid in salons():
        salons()[sid]["maj"] = time.time()
        _archiver(salons()[sid])
    _diffuser(sid)
    _diffuser(None)
    t = _taches.get("sauvegarde")
    if t is None or t.done():
        try:
            _taches["sauvegarde"] = asyncio.get_running_loop().create_task(_ecrire_plus_tard())
        except RuntimeError:          # hors boucle (tests) : écriture immédiate
            _ecrire()


def _archiver(d: dict):
    """Une seule fois par partie finie : son résumé rejoint l'historique (borné)."""
    if d["phase"] != "fin" or not d.get("fin") or d.get("archivee"):
        return
    d["archivee"] = True
    f = d["fin"]
    rangs = {c["uid"]: c for c in f["classement"]}
    resume = {
        "date": round(time.time()), "code": d.get("code"), "graine": d["graine"], "manches": f["manches"],
        "duree": f["duree"], "raison": f["raison"], "gagnants": f["gagnants"],
        "joueurs": [{"uid": j["uid"], "nom": j["nom"], "bot": j["bot"], "pavillon": j["pavillon"],
                     **{k: rangs.get(j["uid"], {}).get(k) for k in ("rang", "degats", "coules", "perdus", "precision")}}
                    for j in d["joueurs"]],
    }
    try:
        liste = json.loads(HISTORIQUE.read_text(encoding="utf-8")) if HISTORIQUE.exists() else []
        liste = (liste if isinstance(liste, list) else [])[-(MAX_ARCHIVES - 1):] + [resume]
        HISTORIQUE.parent.mkdir(parents=True, exist_ok=True)
        tmp = HISTORIQUE.with_suffix(".tmp")
        tmp.write_text(json.dumps(liste, ensure_ascii=False), encoding="utf-8")
        tmp.replace(HISTORIQUE)
        log.info("flotte salon=%s archivee gagnants=%s manches=%d", d["id"], ",".join(f["gagnants"]), f["manches"])
    except (OSError, ValueError) as exc:
        log.error("historique des Flottes : %s", exc)


def historique(n: int = 10) -> list:
    try:
        liste = json.loads(HISTORIQUE.read_text(encoding="utf-8")) if HISTORIQUE.exists() else []
    except (OSError, ValueError):
        return []
    return liste[-n:] if isinstance(liste, list) else []


# ─────────────────────────── Vues ───────────────────────────
def connectes(sid: str) -> set:
    return {v["qui"]["uid"] for v in _abonnes.values() if v["salon"] == sid}


def salon_de(uid: str) -> str | None:
    """Le salon où ce capitaine a encore une flotte (ou une place au quai)."""
    for sid, d in salons().items():
        if d["phase"] == "fin":
            continue
        j = R.Partie(d).j(uid)
        if j and not j["abandon"] and j["elimine"] is None:
            return sid
    return None


def _peut_revanche(qui: dict, d: dict) -> bool:
    """L'hôte relance ; s'il a quitté le quai, n'importe quel capitaine de la partie."""
    if d["phase"] != "fin" or not R.Partie(d).j(qui["uid"]):
        return False
    return qui["uid"] == d["hote"] or d["hote"] not in connectes(d["id"])


def vue_salon(qui: dict, d: dict, maintenant: float) -> dict:
    v = R.vue(d, qui["uid"], maintenant)
    hote = qui["uid"] == d["hote"]
    v.update(type="salon", code=d["code"], public=d["public"], connectes=sorted(connectes(d["id"])),
             peut={"regler": hote and d["phase"] == "salon", "lancer": hote and d["phase"] == "salon",
                   "revanche": _peut_revanche(qui, d)},
             regles={"classes": R.CLASSES, "temps": R.TEMPS, "pavillons": R.PAVILLONS,
                     "min": R.MIN_JOUEURS, "max": R.MAX_JOUEURS, "bornes": R.BORNES,
                     "garde": R.MALUS_GARDE, "lourd": R.MALUS_LOURD_EN_MOUVEMENT,
                     "critique": R.PART_CRITIQUE, "points": R.POINTS_PAR_VITESSE,
                     "pas_en_plus": R.PAS_EN_PLUS, "resolution": R.DUREES["resolution"]})
    return v


def vue_hall(qui: dict, maintenant: float) -> dict:
    ouverts = []
    for sid, d in salons().items():
        if d["phase"] == "salon" and d["public"] and d["hote"]:
            hote = R.Partie(d).j(d["hote"])
            ouverts.append({"id": sid, "code": d["code"], "hote": hote["nom"] if hote else "?",
                            "joueurs": len(d["joueurs"]), "options": d["options"], "cree": d["cree"]})
    ouverts.sort(key=lambda x: -x["cree"])
    return {"type": "quai", "maintenant": maintenant, "salons": ouverts[:30], "mon_salon": salon_de(qui["uid"]),
            "moi": {"uid": qui["uid"], "nom": qui["nom"], "avatar": qui["avatar"]}}


def _envoyer(q: asyncio.Queue, data: str):
    if q.qsize() > 40:              # client qui ne lit plus : on le débranche
        _abonnes.pop(q, None)
        return
    q.put_nowait(data)


def _diffuser(sid: str | None):
    now = time.time()
    d = salons().get(sid) if sid else None
    cache: dict[str, str] = {}
    for q, ab in list(_abonnes.items()):
        if ab["salon"] != sid:
            continue
        uid = ab["qui"]["uid"]
        if uid not in cache:
            if sid is None:
                cache[uid] = json.dumps(vue_hall(ab["qui"], now), ensure_ascii=False)
            elif d is None:
                cache[uid] = json.dumps({"type": "ferme", "salon": sid})
            else:
                cache[uid] = json.dumps(vue_salon(ab["qui"], d, now), ensure_ascii=False)
        _envoyer(q, cache[uid])


# ─────────────────────────── Tickets & identité ───────────────────────────
def nouveau_ticket(qui: dict) -> str:
    now = time.monotonic()
    for t, v in list(_tickets.items()):
        if v["exp"] < now:
            del _tickets[t]
    t = secrets.token_urlsafe(24)
    _tickets[t] = {"exp": now + TICKET_TTL, **qui}
    return t


def ticket(t: str) -> dict | None:
    v = _tickets.get(t or "")
    if v is None or v["exp"] < time.monotonic():
        return None
    return {k: v[k] for k in ("uid", "nom", "avatar", "role")}


def identite(bot, corps: dict) -> dict:
    """Identité d'un ticket, à partir de ce que le dashboard a vérifié (session Discord).
    Refuse les comptes qui ne sont pas membres du serveur."""
    uid = str(corps.get("uid") or "")
    role = str(corps.get("role") or "convive")
    if role not in ROLES_ACCES or not UID.match(uid):
        raise PermissionError("identité Discord invalide")
    guild = bot.get_guild(config.GUILD_ID) if config.GUILD_ID else None
    membre = guild.get_member(int(uid)) if guild else None
    if role != "admin" and membre is None:
        raise PermissionError("les Flottes Royales sont réservées aux membres du serveur")
    nom = (membre.display_name if membre else str(corps.get("nom") or "")).strip()[:32] or "?"
    avatar = str(corps.get("avatar") or "")
    if membre is not None:
        avatar = str(membre.display_avatar.replace(size=128, static_format="webp").url)
    return {"uid": uid, "nom": nom, "avatar": avatar if AVATAR.match(avatar) else "", "role": role}


# ─────────────────────────── Gestes ───────────────────────────
def _limiter(cle: str, fenetre=2.0, maxi=12):
    now = time.monotonic()
    l = [t for t in _debit.get(cle, []) if now - t < fenetre]
    if len(l) >= maxi:
        raise R.Refus("doucement, moussaillon : trop d'ordres d'un coup")
    l.append(now)
    _debit[cle] = l


def _code() -> str:
    pris = {d["code"] for d in salons().values()}
    while True:
        c = "".join(secrets.choice(ALPHABET) for _ in range(5))
        if c not in pris:
            return c


def _salon(a: dict) -> dict:
    d = salons().get(str(a.get("salon") or ""))
    if d is None:
        raise R.Refus("ce salon a levé l'ancre ou n'existe plus")
    return d


def _hote(qui: dict, d: dict):
    if qui["uid"] != d["hote"]:
        raise R.Refus("seul l'hôte du salon peut faire ça")


async def appliquer(op: str, a: dict, qui: dict) -> dict:
    uid = qui["uid"]
    _limiter(uid)
    now = time.time()
    async with _verrou:
        try:
            return _appliquer(op, a, qui, uid, now)
        except R.Refus as exc:
            log.info("flotte refus op=%s salon=%s uid=%s : %s", op, a.get("salon"), uid, exc)
            raise


def _appliquer(op: str, a: dict, qui: dict, uid: str, now: float) -> dict:
    if op == "creer":
        deja = salon_de(uid)
        if deja:                                 # double clic, ou salon oublié : on y retourne
            return {"ok": True, "salon": deja, "code": salons()[deja]["code"]}
        _limiter("creer:" + uid, 20.0, 3)
        if len(salons()) >= MAX_SALONS:
            raise R.Refus("tous les quais sont pris, réessaie dans un moment")
        sid = secrets.token_hex(6)
        d = R.nouvelle(sid, qui, secrets.randbits(32), a.get("options") or {}, sel=secrets.randbits(32))
        d.update(code=_code(), public=bool(a.get("public", True)), cree=now, maj=now, hote_absent=None)
        R.Partie(d).rejoindre(qui)
        salons()[sid] = d
        log.info("flotte salon=%s code=%s cree par uid=%s", sid, d["code"], uid)
        _changer(sid)
        return {"ok": True, "salon": sid, "code": d["code"]}

    if op == "rejoindre":
        code = str(a.get("code") or "").strip().upper()
        d = next((x for x in salons().values() if x["code"] == code), None)
        if d is None:
            raise R.Refus("aucun salon ne porte ce code")
        p = R.Partie(d)
        if p.j(uid) is None:
            deja = salon_de(uid)
            if deja:
                raise R.Refus("tu commandes déjà une flotte dans un autre salon (quitte-le d'abord)")
            p.rejoindre(qui)                   # refuse si la partie a commencé ou est pleine
        _changer(d["id"])
        return {"ok": True, "salon": d["id"], "code": d["code"]}

    d = _salon(a)
    p = R.Partie(d)
    sid = d["id"]
    if op == "quitter":
        p.quitter(uid, now)
        if not any(not x["bot"] for x in d["joueurs"]) and d["phase"] == "salon":
            del salons()[sid]
            log.info("flotte salon=%s ferme (plus personne)", sid)
    elif op == "pavillon":
        p.pavillon(uid, str(a.get("pavillon") or ""))
    elif op == "pret":
        p.pret(uid, bool(a.get("valeur")))
    elif op == "regler":
        _hote(qui, d)
        p.regler(a.get("options") or {})
        if "public" in a:
            d["public"] = bool(a["public"])
    elif op == "bot":
        _hote(qui, d)
        p.ajouter_bot()
    elif op == "retirer":
        _hote(qui, d)
        cible = str(a.get("uid") or "")
        if cible == uid:
            raise R.Refus("l'hôte quitte le salon avec « Quitter »")
        p.retirer(cible)
    elif op == "lancer":
        _hote(qui, d)
        p.lancer(now)
        log.info("flotte salon=%s lance joueurs=%d graine=%d", sid, len(d["joueurs"]), d["graine"])
    elif op == "ordres":
        p.ordonner(uid, a.get("manche"), a.get("ordres"),
                   a.get("verrou") if isinstance(a.get("verrou"), bool) else None)
    elif op == "revanche":
        if not _peut_revanche(qui, d):
            raise R.Refus("seul l'hôte relance (ou tout capitaine si l'hôte est parti)")
        neuve = R.revanche(d, sid, secrets.randbits(32), bool(a.get("meme_carte")), secrets.randbits(32))
        neuve.update(code=d["code"], public=d["public"], cree=d["cree"], maj=now, hote_absent=None)
        q, con = R.Partie(neuve), connectes(sid) | {uid}
        for x in list(neuve["joueurs"]):       # on ne réembarque que les présents (et les bots)
            if not x["bot"] and x["uid"] not in con:
                q.retirer(x["uid"])
        if q.j(uid) is None:
            q.rejoindre(qui)
        if neuve["hote"] not in con:
            neuve["hote"] = uid
        salons()[sid] = neuve
    else:
        raise R.Refus("geste inconnu")
    _changer(sid)
    return {"ok": True, "salon": sid}


async def action_resume(_bot, _payload):
    """Résumé pour l'accueil du panneau (rien de secret)."""
    par_phase: dict = {}
    for d in salons().values():
        par_phase[d["phase"]] = par_phase.get(d["phase"], 0) + 1
    return {"ok": True, "salons": len(salons()), "phases": par_phase,
            "capitaines": len({v["qui"]["uid"] for v in _abonnes.values()}),
            "dernieres": historique(5)}


MODULE = register(Module(key="flotte", label="Guerre des Flottes Royales", defaults=DEFAULTS,
                         actions={"resume": action_resume}))


# ─────────────────────────── Horloge ───────────────────────────
def attacher(bot):
    _bot_ref["bot"] = bot
    t = _taches.get("horloge")
    if t is None or t.done():
        _taches["horloge"] = asyncio.get_running_loop().create_task(_horloge())


async def _horloge():
    while True:
        await asyncio.sleep(0.5)
        try:
            async with _verrou:
                tic(time.time())
        except Exception as exc:  # noqa: BLE001
            log.exception("horloge des Flottes : %s", exc)


def tic(now: float):
    """Fait avancer chaque salon (appelé toutes les 0,5 s ; ``now`` injectable en test)."""
    for sid, d in list(salons().items()):
        p = R.Partie(d)
        con = connectes(sid)
        if d["phase"] == "salon":
            if not any(not x["bot"] for x in d["joueurs"]) or (not con and now - d["maj"] > OUBLI["salon"]):
                del salons()[sid]
                log.info("flotte salon=%s ferme (déserté)", sid)
                _changer(sid)
                continue
            # Hôte parti du quai alors qu'un autre capitaine attend : la barre passe après 60 s.
            relais = next((x["uid"] for x in d["joueurs"]
                           if not x["bot"] and x["uid"] in con and x["uid"] != d["hote"]), None)
            if d["hote"] in con or relais is None:
                d["hote_absent"] = None
            elif d["hote_absent"] is None:
                d["hote_absent"] = now
            elif now - d["hote_absent"] > GRACE_HOTE:
                log.info("flotte salon=%s hote %s -> %s (absent)", sid, d["hote"], relais)
                d["hote"], d["hote_absent"] = relais, None
                _changer(sid)
            continue
        if d["phase"] == "fin":
            if not con and now - d["maj"] > OUBLI["fin"]:
                del salons()[sid]
                _changer(sid)
            continue
        if not any(not x["bot"] for x in p.actifs()):
            p.clore(now)
            log.info("flotte salon=%s clos (plus aucun humain en lice)", sid)
            _changer(sid)
            continue
        if d["phase"] == "planification" and not p.humains_attendus() and d["echeance"] > now + 1:
            d["echeance"] = now + 1            # tout le monde a verrouillé : on n'attend plus
            _changer(sid)
        if d["echeance"] and now >= d["echeance"]:
            avant = (d["phase"], d["manche"])
            p.avancer(now)
            if avant[0] == "planification":
                log.info("flotte salon=%s manche=%d resolue phase=%s", sid, avant[1], d["phase"])
            _changer(sid)


# ─────────────────────────── Flux SSE ───────────────────────────
async def flux(request, web, qui: dict):
    sid = request.query.get("salon") or None
    if sid is not None and sid not in salons():
        return web.json_response({"error": "salon introuvable"}, status=404,
                                 headers={"Access-Control-Allow-Origin": "*"})
    resp = web.StreamResponse(headers={
        "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no", "Access-Control-Allow-Origin": "*",
    })
    await resp.prepare(request)
    q: asyncio.Queue = asyncio.Queue()
    _abonnes[q] = {"qui": qui, "salon": sid}
    try:
        now = time.time()
        d = salons().get(sid) if sid else None
        premiere = vue_salon(qui, d, now) if d else vue_hall(qui, now)
        await resp.write(("data: %s\n\n" % json.dumps(premiere, ensure_ascii=False)).encode())
        if sid:
            _diffuser(sid)                   # la liste des présents bouge pour tout le salon
        while True:
            try:
                data = await asyncio.wait_for(q.get(), timeout=20)
                await resp.write(("data: %s\n\n" % data).encode())
            except asyncio.TimeoutError:
                await resp.write(b": battement\n\n")
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    finally:
        _abonnes.pop(q, None)
        if sid and sid in salons():
            log.info("flotte salon=%s deconnexion uid=%s", sid, qui["uid"])
            _diffuser(sid)
    return resp
