"""Module « Les Ombres de la Taverne » : le jeu de déduction de la taverne (remake du
Loup-Garou), joué sur la page /ombres du dashboard, débat en vocal Discord.

Les règles vivent dans ``ombres_regles.py`` (Python pur, testé). Ici : l'état persistant
(``data/ombres.json``), l'horloge des phases, les tickets, le flux temps réel (SSE), le
narrateur (GROQ, repli sur des récits écrits) et les annonces Discord.

Temps réel : même pont que la table de jeu — le dashboard vérifie la session Discord et
délivre un ticket ; le navigateur se branche ensuite directement sur l'API (Funnel). Chaque
abonné reçoit SA vue, filtrée ici : un rôle secret ne quitte jamais le serveur.

Rôles d'accès (portés par le ticket) :
- ``admin`` / ``mj`` : peuvent ouvrir une partie en tant que MJ (ils ne jouent pas alors),
  ajouter des pantins (parties d'essai), arbitrer ;
- ``joueur`` / ``convive`` : tout membre du serveur peut s'asseoir à la table ;
- ``spectateur`` : lien de scène (stream), vue publique seule, aucun geste.
"""
import asyncio
import json
import logging
import os
import random
import re
import secrets
import time

import aiohttp
import discord

from .. import config
from ..registry import Module, register
from . import ombres_regles as R

log = logging.getLogger("fripouille.ombres")

FICHIER = config.DATA_DIR / "ombres.json"
TICKET_TTL = 12 * 3600
UID = re.compile(r"^\d{15,25}$")
AVATAR = re.compile(r"^https://cdn\.discordapp\.com/[\w/.\-]+(\?[\w=&.\-]*)?$")
ROLES_ACCES = ("admin", "mj", "joueur", "convive")
LIEN_DEFAUT = "https://taverne-ten.vercel.app/ombres"
DEFAULTS = {"enabled": True, "salon_id": "", "lien": LIEN_DEFAUT, "annonces": True}

GROQ_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_URL = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/") + "/chat/completions"
GROQ_MODELES = [m.strip() for m in os.getenv("GROQ_MODELS", "llama-3.3-70b-versatile,llama-3.1-8b-instant").split(",") if m.strip()]

_bot_ref: dict = {}
_etat: dict | None = None          # {"partie": dict | None, "cle_scene": str}
_verrou = asyncio.Lock()
_abonnes: dict[asyncio.Queue, dict] = {}
_tickets: dict[str, dict] = {}
_debit: dict[str, list] = {}
_taches: dict[str, asyncio.Task] = {}
_rng = random.Random()


# ─────────────────────────── État & persistance ───────────────────────────
def etat() -> dict:
    global _etat
    if _etat is None:
        _etat = {"partie": None, "cle_scene": secrets.token_urlsafe(18)}
        try:
            if FICHIER.exists():
                _etat.update(json.loads(FICHIER.read_text(encoding="utf-8")))
        except (OSError, ValueError) as exc:
            log.error("ombres.json illisible : %s", exc)
    return _etat


def partie() -> R.Partie | None:
    d = etat()["partie"]
    return R.Partie(d, _rng) if d else None


def _ecrire():
    try:
        FICHIER.parent.mkdir(parents=True, exist_ok=True)
        tmp = FICHIER.with_suffix(".tmp")
        tmp.write_text(json.dumps(etat(), ensure_ascii=False), encoding="utf-8")
        tmp.replace(FICHIER)
    except OSError as exc:
        log.error("sauvegarde ombres.json : %s", exc)


async def _ecrire_plus_tard():
    await asyncio.sleep(1.0)
    _ecrire()


def _changer():
    _diffuser_etat()
    t = _taches.get("sauvegarde")
    if t is None or t.done():
        _taches["sauvegarde"] = asyncio.get_running_loop().create_task(_ecrire_plus_tard())


# ─────────────────────────── Vue & diffusion ───────────────────────────
def _arbitre(qui: dict, d: dict | None) -> bool:
    """Peut mettre en pause, prolonger, passer, exclure, annuler."""
    if d is None:
        return False
    if d["mj"]:
        return qui.get("uid") == d["mj"] or qui.get("role") == "admin"
    return qui.get("role") in ("admin", "mj") or (qui.get("uid") and qui.get("uid") == d["hote"])


def vue(qui: dict) -> dict:
    d = etat()["partie"]
    peut = {
        "ouvrir": qui.get("role") in ROLES_ACCES and (d is None or d["phase"] == "fin"),
        "ouvrir_mj": qui.get("role") in ("admin", "mj"),
        "pantins": qui.get("role") in ("admin", "mj"),
        "arbitre": _arbitre(qui, d),
    }
    base = {"type": "etat", "presents": _nb_presents(), "peut": peut,
            "moi": {"uid": qui.get("uid", ""), "nom": qui.get("nom", ""), "role": qui.get("role", "")}}
    if d is None:
        return {**base, "partie": None, "maintenant": time.time()}
    v = R.vue(d, qui, time.time())
    if peut["arbitre"] or qui.get("role") in ("admin", "mj"):
        base["cle_scene"] = etat()["cle_scene"]
    return {**base, "partie": v}


def _nb_presents() -> int:
    return len({q.get("uid") or id(q) for q in _abonnes.values()})


def _envoyer(q: asyncio.Queue, data: str):
    if q.qsize() > 40:
        _abonnes.pop(q, None)
        return
    q.put_nowait(data)


def _diffuser_etat():
    cache: dict[str, str] = {}
    for q, qui in list(_abonnes.items()):
        cle = "%s|%s" % (qui.get("uid", ""), qui.get("role", ""))
        if cle not in cache:
            cache[cle] = json.dumps(vue(qui), ensure_ascii=False)
        _envoyer(q, cache[cle])


def _diffuser(msg: dict):
    data = json.dumps(msg, ensure_ascii=False)
    for q in list(_abonnes):
        _envoyer(q, data)


# ─────────────────────────── Tickets ───────────────────────────
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


def spectateur(cle: str) -> dict | None:
    if cle and secrets.compare_digest(cle, etat()["cle_scene"]):
        return {"uid": "", "nom": "Spectateur", "avatar": "", "role": "spectateur"}
    return None


def identite(bot, corps: dict) -> dict:
    """Identité d'un ticket, à partir de ce que le dashboard a vérifié. Refuse les comptes
    qui ne sont pas membres du serveur (la connexion Discord est ouverte à tous)."""
    uid = str(corps.get("uid") or "")
    role = str(corps.get("role") or "convive")
    if role not in ROLES_ACCES or not UID.match(uid):
        raise PermissionError("identité Discord invalide")
    guild = bot.get_guild(config.GUILD_ID) if config.GUILD_ID else None
    membre = guild.get_member(int(uid)) if guild else None
    if role != "admin" and membre is None:
        raise PermissionError("la table des Ombres est réservée aux membres du serveur")
    nom = (membre.display_name if membre else str(corps.get("nom") or "")).strip()[:32] or "?"
    avatar = str(corps.get("avatar") or "")
    if membre is not None:
        avatar = str(membre.display_avatar.replace(size=128, static_format="webp").url)
    return {"uid": uid, "nom": nom, "avatar": avatar if AVATAR.match(avatar) else "", "role": role}


# ─────────────────────────── Narrateur ───────────────────────────
CAUSES = {
    "ombres": ["On a retrouvé {nom} près de l'âtre, la gorge marquée de griffes d'ombre",
               "La paillasse de {nom} est vide ; on n'a retrouvé que son bonnet, noirci",
               "{nom} ne descendra plus jamais prendre son petit-déjeuner : les Ombres sont passées"],
    "fiole": ["{nom} a les lèvres bleues et sent l'amande amère : une fiole a parlé cette nuit",
              "On a trouvé {nom} affalé sur sa chope, un drôle de dépôt violet au fond"],
}
OUVERTURES = ["Le coq de la taverne s'étrangle à moitié en saluant l'aube.",
              "Une lumière grise filtre par les volets disjoints.",
              "Le feu n'est plus que braises quand les premiers convives descendent.",
              "Le tavernier ouvre les volets en bâillant ; l'odeur de la nuit traîne encore."]
CALMES = ["Miracle : tout le monde est là, la tête lourde mais bien vivant.",
          "Personne ne manque à l'appel. Les Ombres auraient-elles trop bu ?",
          "On compte les têtes deux fois : il n'en manque aucune."]


def recit_ecrit(f: dict) -> str:
    morceaux = [_rng.choice(OUVERTURES)]
    if f["morts"]:
        for m in f["morts"]:
            modele = _rng.choice(CAUSES.get(m["cause"], CAUSES["ombres"]))
            morceaux.append(modele.format(nom=m["nom"]) + f" — c'était {m['role']}.")
    else:
        morceaux.append(_rng.choice(CALMES))
    return " ".join(morceaux)


async def narrer(f: dict) -> str:
    """Récit d'aube : GROQ si disponible (contrôlé : il doit nommer chaque mort et son rôle),
    sinon un récit écrit. Ne reçoit QUE des faits publics."""
    secours = recit_ecrit(f)
    if not GROQ_KEY:
        return secours
    faits = "; ".join(f"{m['nom']} est mort ({'dévoré par les Ombres' if m['cause'] == 'ombres' else 'empoisonné'}), "
                      f"c'était {m['role']}" for m in f["morts"]) or "personne n'est mort cette nuit"
    messages = [
        {"role": "system", "content": (
            "Tu es le narrateur de « Les Ombres de la Taverne », un loup-garou médiéval-fantasy joué dans "
            "une taverne de joueurs. Ton : sombre mais drôle, gouailleur, images concrètes de taverne "
            "(chopes, paille, chandelles, cave). Écris en français, 2 à 4 phrases, 450 caractères maximum, "
            "sans titre ni liste. N'invente AUCUN fait de jeu : cite exactement chaque mort et son rôle "
            "fournis, n'ajoute ni mort, ni indice, ni accusation, ni rôle.")},
        {"role": "user", "content": f"Aube du jour {f['jour']}. Faits : {faits}. Il reste {f['vivants']} convives."},
    ]
    try:
        timeout = aiohttp.ClientTimeout(total=8)
        async with aiohttp.ClientSession(timeout=timeout) as s:
            for modele in GROQ_MODELES:
                async with s.post(GROQ_URL, headers={"Authorization": f"Bearer {GROQ_KEY}"},
                                  json={"model": modele, "messages": messages, "temperature": 0.9, "max_tokens": 260}) as r:
                    if r.status == 429:
                        continue
                    if r.status != 200:
                        log.warning("narrateur GROQ %s : %s", r.status, (await r.text())[:200])
                        return secours
                    texte = ((await r.json())["choices"][0]["message"]["content"] or "").strip().strip('"')
                    if texte and len(texte) < 700 and all(m["nom"] in texte for m in f["morts"]):
                        return texte
                    return secours
    except Exception as exc:  # noqa: BLE001
        log.warning("narrateur indisponible : %s", exc)
    return secours


async def _narration(id_partie: str):
    """Rédige l'aube ; en mode auto elle est proclamée aussitôt, en mode MJ elle attend le MJ."""
    p = partie()
    if p is None:
        return
    texte = await narrer(p.faits_aube())
    async with _verrou:
        p = partie()
        if p is None or p.d["id"] != id_partie or p.d["phase"] != "aube" or p.d["aube"]["proclamee"]:
            return
        if p.d["mode"] == "mj":
            p.d["aube"]["brouillon"] = texte
        else:
            p.proclamer(texte)
        _changer()


# ─────────────────────────── Horloge ───────────────────────────
async def _horloge():
    while True:
        await asyncio.sleep(0.5)
        try:
            async with _verrou:
                await _tic()
        except Exception as exc:  # noqa: BLE001
            log.exception("horloge des Ombres : %s", exc)


async def _tic():
    p = partie()
    if p is None or p.d["phase"] in ("hall", "fin"):
        return
    d, now = p.d, time.time()
    if d["pause"] is not None:
        return
    # Tout le monde a joué : la phase se clôt sans attendre (12 s de nuit au minimum).
    if d["phase"] in ("nuit", "alchimie") and d["echeance"] and not p.humains_attendus():
        tot = max(now + 2, d.get("debut", now) + (12 if d["phase"] == "nuit" else 0))
        if tot < d["echeance"] - 0.5:
            d["echeance"] = tot
            _changer()
    if d["phase"] == "aube" and not d["aube"]["proclamee"]:
        t = _taches.get("narration")
        if (t is None or t.done()) and not (d["mode"] == "mj" and d["aube"]["brouillon"]):
            _taches["narration"] = asyncio.get_running_loop().create_task(_narration(d["id"]))
        return
    if d["echeance"] and now >= d["echeance"]:
        avant = d["phase"]
        p.avancer()
        if d["phase"] != avant or d["echeance"] is None:
            _diffuser({"type": "phase", "de": avant, "vers": d["phase"]})
        if d["phase"] == "fin":
            asyncio.get_running_loop().create_task(_annoncer_fin(d))
        _changer()


# ─────────────────────────── Discord ───────────────────────────
def _salon(bot):
    cfg = bot.store.get("ombres")
    if not cfg.get("annonces") or not str(cfg.get("salon_id") or "").isdigit():
        return None, cfg
    return bot.get_channel(int(cfg["salon_id"])), cfg


async def _annoncer_ouverture(d: dict, qui: dict):
    bot = _bot_ref.get("bot")
    if bot is None:
        return
    salon, cfg = _salon(bot)
    if salon is None:
        return
    e = discord.Embed(
        title="🕯️ Les Ombres de la Taverne",
        description=(f"**{qui['nom']}** ouvre une table{' et mènera la partie en MJ' if d['mode'] == 'mj' else ''}.\n"
                     f"Des Ombres se cachent parmi les convives… Prends place, puis rejoins le vocal pour débattre.\n\n"
                     f"➜ **[S'asseoir à la table]({cfg.get('lien') or LIEN_DEFAUT})**"),
        color=0x6B3FA0)
    e.set_footer(text=f"{R.MIN_JOUEURS} à {R.MAX_JOUEURS} convives")
    try:
        await salon.send(embed=e)
    except discord.HTTPException as exc:
        log.warning("annonce Ombres : %s", exc)


async def _annoncer_fin(d: dict):
    bot = _bot_ref.get("bot")
    if bot is None or not d.get("fin") or d["fin"]["vainqueur"] == "annulee":
        return
    salon, _cfg = _salon(bot)
    if salon is None:
        return
    gagnants = [x for x in d["joueurs"] if x["uid"] in d["fin"]["gagnants"]]
    lignes = "\n".join(f"{'🏆' if x['uid'] in d['fin']['gagnants'] else '🕯️' if x['vivant'] else '💀'} "
                       f"**{x['nom']}** — {R.ROLES[x['role']]['nom']}" for x in d["joueurs"])
    e = discord.Embed(title="🕯️ " + d["fin"]["titre"], description=lignes[:3900], color=0xC9A44A)
    e.set_footer(text=f"{d['jour']} jour(s) · {len(gagnants)} gagnant(s)")
    try:
        await salon.send(embed=e)
    except discord.HTTPException as exc:
        log.warning("annonce fin Ombres : %s", exc)


# ─────────────────────────── Gestes ───────────────────────────
def _limiter(uid: str, fenetre=2.0, maxi=10):
    now = time.monotonic()
    l = [t for t in _debit.get(uid, []) if now - t < fenetre]
    if len(l) >= maxi:
        raise R.Refus("doucement, l'aubergiste ne suit plus")
    l.append(now)
    _debit[uid] = l


GESTES_ARBITRE = {"pause", "reprendre", "prolonger", "passer", "exclure", "annuler"}


async def appliquer(op: str, a: dict, qui: dict) -> dict:
    if qui.get("role") == "spectateur":
        raise R.Refus("les spectateurs regardent sans toucher")
    uid = qui.get("uid") or ""
    _limiter(uid or "?")
    async with _verrou:
        e = etat()
        d = e["partie"]
        p = partie()

        if op == "ouvrir":
            if d is not None and d["phase"] != "fin":
                raise R.Refus("une partie est déjà en cours")
            mode = "mj" if a.get("mode") == "mj" and qui["role"] in ("admin", "mj") else "auto"
            e["partie"] = R.nouvelle(qui, mode, mj=uid if mode == "mj" else "")
            p = partie()
            if mode == "auto" and not a.get("spectateur"):
                p.rejoindre(qui)
            _changer()
            asyncio.get_running_loop().create_task(_annoncer_ouverture(e["partie"], qui))
            return {"ok": True}
        if p is None:
            raise R.Refus("aucune partie ouverte")
        hote_ou_mj = uid and (uid == d["hote"] or uid == d["mj"])

        if op == "rejoindre":
            p.rejoindre(qui)
        elif op == "quitter":
            p.quitter(uid)
        elif op == "pantin":
            if qui["role"] not in ("admin", "mj"):
                raise R.Refus("réservé aux MJ (parties d'essai)")
            for _ in range(max(1, min(15, int(a.get("nombre") or 1)))):
                if len(d["joueurs"]) >= R.MAX_JOUEURS:
                    break
                p.ajouter_pantin()
        elif op == "renvoyer":                  # hall : retirer un convive ou un pantin
            if not (hote_ou_mj or qui["role"] == "admin"):
                raise R.Refus("seul l'hôte range les chaises")
            p.quitter(str(a.get("uid") or ""))
        elif op == "regler":
            if not (hote_ou_mj or qui["role"] == "admin"):
                raise R.Refus("seul l'hôte règle la partie")
            p.regler(a.get("options") or {})
        elif op == "lancer":
            if not (hote_ou_mj or qui["role"] == "admin"):
                raise R.Refus("seul l'hôte lance la partie")
            p.lancer()
        elif op == "agir":
            p.agir(uid, a)
        elif op == "voter":
            p.voter(uid, str(a.get("cible") or ""))
        elif op == "pret":
            p.pret_vote(uid)
        elif op == "tir":
            p.tir_videur(uid, str(a.get("cible") or ""))
        elif op == "ames":
            p.vote_ames(uid, str(a.get("carte") or ""))
        elif op == "testament":
            p.testament(uid, a.get("texte"))
        elif op == "murmure":
            _limiter("murmure:" + uid, 1.0, 1)
            p.conciliabule(uid, a.get("texte"))
        elif op == "proclamer":
            if not (d["mj"] and uid == d["mj"]):
                raise R.Refus("seul le MJ proclame l'aube")
            if d["phase"] != "aube":
                raise R.Refus("ce n'est pas l'aube")
            texte = " ".join(str(a.get("texte") or "").split())[:1200]
            p.proclamer(texte or d["aube"].get("brouillon") or recit_ecrit(p.faits_aube()))
        elif op == "rejouer":
            if d["phase"] != "fin":
                raise R.Refus("la partie n'est pas finie")
            if not (hote_ou_mj or qui["role"] in ("admin", "mj")):
                raise R.Refus("seul l'hôte relance une partie")
            neuve = R.nouvelle({"uid": d["hote"]}, d["mode"], d["mj"])
            neuve["options"] = d["options"]
            e["partie"] = neuve
            q = partie()
            for x in d["joueurs"]:
                q.rejoindre({"uid": x["uid"], "nom": x["nom"], "avatar": x["avatar"]}, pantin=x["pantin"])
                q.j(x["uid"])["testament"] = x["testament"] if x["pantin"] else ""
        elif op in GESTES_ARBITRE:
            if not _arbitre(qui, d):
                raise R.Refus("geste réservé à l'arbitre de la partie")
            now = time.time()
            if op == "annuler":
                p.terminer("annulee", f"par {qui['nom']}")
            elif op == "exclure":
                p.exclure(str(a.get("uid") or ""))
            elif d["phase"] in ("hall", "fin"):
                raise R.Refus("rien à minuter")
            elif op == "pause" and d["echeance"]:
                d["pause"], d["echeance"] = max(0.0, d["echeance"] - now), None
            elif op == "reprendre" and d["pause"] is not None:
                d["echeance"], d["pause"] = now + d["pause"], None
            elif op == "prolonger" and d["echeance"]:
                d["echeance"] += max(10, min(300, int(a.get("secondes") or 30)))
            elif op == "passer":
                if d["phase"] == "aube" and not d["aube"]["proclamee"]:
                    raise R.Refus("proclame d'abord l'aube")
                d["pause"], d["echeance"] = None, now
        elif op == "scene_cle":
            if not (_arbitre(qui, d) or qui["role"] in ("admin", "mj")):
                raise R.Refus("réservé au MJ")
            e["cle_scene"] = secrets.token_urlsafe(18)
        else:
            raise R.Refus("geste inconnu")
        _changer()
        if op in ("lancer", "passer"):
            _diffuser({"type": "phase", "de": "", "vers": d["phase"]})
        return {"ok": True}


async def action_resume(_bot, _payload):
    """Résumé pour l'accueil du panneau (rien de secret)."""
    d = etat()["partie"]
    if d is None:
        return {"ok": True, "phase": None}
    return {"ok": True, "phase": d["phase"], "jour": d["jour"], "joueurs": len(d["joueurs"]),
            "vivants": sum(1 for x in d["joueurs"] if x["vivant"]), "mode": d["mode"],
            "presents": _nb_presents(), "vainqueur": (d.get("fin") or {}).get("vainqueur")}


MODULE = register(Module(key="ombres", label="Les Ombres de la Taverne", defaults=DEFAULTS,
                         actions={"resume": action_resume}))


def attacher(bot):
    _bot_ref["bot"] = bot
    t = _taches.get("horloge")
    if t is None or t.done():
        _taches["horloge"] = asyncio.get_running_loop().create_task(_horloge())


# ─────────────────────────── Flux SSE ───────────────────────────
async def flux(request, web, qui: dict):
    resp = web.StreamResponse(headers={
        "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no", "Access-Control-Allow-Origin": "*",
    })
    await resp.prepare(request)
    q: asyncio.Queue = asyncio.Queue()
    _abonnes[q] = qui
    try:
        await resp.write(("data: %s\n\n" % json.dumps(vue(qui), ensure_ascii=False)).encode())
        _diffuser_etat()                     # le compteur de présents bouge pour tout le monde
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
    return resp
