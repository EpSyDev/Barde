"""Module « Sauvegarde » : copie nocturne des données hors de la VM (Oracle Object Storage).

Chaque nuit (``heure``, Paris) : archive ``.tar.gz`` de
- ``fripouille/data`` (config, journal, stats, économie, plateau, aventures, médias…),
- ``taverne.db``, ``state.json`` et les ``*.json`` du hub,
les bases SQLite étant copiées via l'API de sauvegarde SQLite (cohérentes même en
pleine écriture). **Exclus** : ``media/`` (bibliothèque musicale, 3 Go) et le ``.env``
(les tokens ne partent jamais dans une archive).

Envoi par **URL pré-authentifiée** (PAR) Oracle en écriture seule
(``FRIPOUILLE_SAUVEGARDE_PAR`` dans le .env, se termine par ``/o/``) : pas de clé d'API
ni de SDK sur la VM, et l'URL ne permet ni de lire ni de lister le bucket.
Rotation par nom (écrasement) : ``quotidien/<jour>.tar.gz`` (7 dernières nuits) et
``hebdo/semaine-<n>.tar.gz`` (5 dernières semaines). Une copie de la dernière archive
reste aussi sur la VM (``sauvegardes/derniere.tar.gz``) pour une restauration rapide.

Config : ``enabled``, ``heure``, ``derniere`` (état : date, taille, durée, résultat).
"""
import asyncio
import logging
import os
import sqlite3
import tarfile
import tempfile
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import aiohttp

from .. import config
from ..registry import Module, register

log = logging.getLogger("fripouille.sauvegarde")

PARIS = ZoneInfo("Europe/Paris")
PAR = os.getenv("FRIPOUILLE_SAUVEGARDE_PAR", "").strip()
DOSSIER_LOCAL = config.BASE_DIR / "sauvegardes"
JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
SQLITE = (".db", ".sqlite", ".sqlite3")

DEFAULTS = {"enabled": False, "heure": "04:30", "derniere": {}}

_en_cours = asyncio.Lock()


def _sources() -> list[tuple[Path, str]]:
    """(chemin, nom dans l'archive). Uniquement ce qui existe."""
    base = config.BASE_DIR
    out = [(config.DATA_DIR, "fripouille-data")]
    for nom in ("taverne.db", "state.json"):
        out.append((base / nom, nom))
    out += [(p, "hub/" + p.name) for p in sorted((base / "hub").glob("*.json"))]
    return [(p, n) for p, n in out if p.exists()]


def _copier_sqlite(src: Path, dst: Path):
    dst.parent.mkdir(parents=True, exist_ok=True)
    a = sqlite3.connect("file:%s?mode=ro" % src, uri=True)
    b = sqlite3.connect(str(dst))
    try:
        a.backup(b)
    finally:
        a.close()
        b.close()


def _fabriquer(cible: Path):
    """Archive cohérente : SQLite via backup(), le reste copié tel quel."""
    with tempfile.TemporaryDirectory() as tmp, tarfile.open(cible, "w:gz") as tar:
        for chemin, nom in _sources():
            fichiers = [chemin] if chemin.is_file() else [p for p in chemin.rglob("*") if p.is_file()]
            for f in fichiers:
                rel = nom if chemin.is_file() else "%s/%s" % (nom, f.relative_to(chemin).as_posix())
                if f.name.endswith(("-wal", "-shm", "-journal", ".tmp")):
                    continue                 # l'état est déjà dans la copie backup()
                if f.suffix in SQLITE:
                    copie = Path(tmp) / rel
                    try:
                        _copier_sqlite(f, copie)
                        tar.add(copie, arcname=rel)
                        continue
                    except sqlite3.Error as exc:
                        log.warning("sqlite %s : %s (copie brute)", f, exc)
                tar.add(f, arcname=rel)


async def _envoyer(fichier: Path, objet: str):
    # Lu en mémoire (quelques dizaines de Mo) : Content-Length connu, pas d'envoi « chunked ».
    contenu = await asyncio.to_thread(fichier.read_bytes)
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=600)) as s:
        async with s.put(PAR + objet, data=contenu, headers={"Content-Type": "application/gzip"}) as r:
            if r.status not in (200, 201):
                raise RuntimeError("Oracle HTTP %s : %s" % (r.status, (await r.text())[:200]))


async def sauvegarder(bot, par: str = "planifiée") -> dict:
    async with _en_cours:
        debut = time.monotonic()
        now = datetime.now(PARIS)
        DOSSIER_LOCAL.mkdir(parents=True, exist_ok=True)
        tmp = DOSSIER_LOCAL / "en-cours.tar.gz"
        etat = {"date": now.isoformat(), "par": par, "ok": False, "taille": 0, "objets": [], "erreur": None}
        archive_ok = False
        try:
            await asyncio.to_thread(_fabriquer, tmp)
            archive_ok = True
            etat["taille"] = tmp.stat().st_size
            if not PAR:
                raise RuntimeError("FRIPOUILLE_SAUVEGARDE_PAR absent du .env : archive gardée sur la VM seulement")
            objets = ["quotidien/%s.tar.gz" % JOURS[now.weekday()]]
            if now.weekday() == 6:
                objets.append("hebdo/semaine-%d.tar.gz" % (now.isocalendar()[1] % 5))
            for o in objets:
                await _envoyer(tmp, o)
            etat["objets"] = objets
            etat["ok"] = True
        except Exception as exc:  # noqa: BLE001
            etat["erreur"] = str(exc)[:300]
            log.error("sauvegarde : %s", exc)
        finally:
            if archive_ok:
                tmp.replace(DOSSIER_LOCAL / "derniere.tar.gz")
            elif tmp.exists():
                tmp.unlink()                # archive incomplète : on garde la précédente
            etat["duree_s"] = round(time.monotonic() - debut, 1)
            bot.store.set("sauvegarde", {"derniere": etat})
        if not etat["ok"]:
            from . import sante              # alerte dans le salon staff (module Santé)
            await sante.alerter(bot, "Sauvegarde en échec", etat["erreur"] or "erreur inconnue")
        return etat


async def _scheduler(bot):
    await bot.wait_until_ready()
    while not bot.is_closed():
        try:
            cfg = bot.store.get("sauvegarde")
            if cfg.get("enabled"):
                now = datetime.now(PARIS)
                h, m = (int(x) for x in str(cfg.get("heure") or "04:30").split(":"))
                derniere = (cfg.get("derniere") or {}).get("date", "")[:10]
                if (now.hour, now.minute) >= (h, m) and derniere != now.strftime("%Y-%m-%d"):
                    await sauvegarder(bot)
        except Exception as exc:  # noqa: BLE001
            log.error("planificateur sauvegarde : %s", exc)
        await asyncio.sleep(60)


def start_scheduler(bot):
    bot.loop.create_task(_scheduler(bot))


# --- Actions dashboard ---
async def action_etat(bot, _payload):
    local = DOSSIER_LOCAL / "derniere.tar.gz"
    return {"ok": True, "par_configure": bool(PAR), "derniere": bot.store.get("sauvegarde").get("derniere") or {},
            "sources": [n for _, n in _sources()],
            "locale": {"taille": local.stat().st_size, "date": datetime.fromtimestamp(local.stat().st_mtime, PARIS).isoformat()}
            if local.exists() else None}


async def action_lancer(bot, payload):
    if _en_cours.locked():
        return {"ok": False, "error": "une sauvegarde est déjà en cours"}
    etat = await sauvegarder(bot, str(payload.get("_acteur") or "dashboard"))
    return {"ok": etat["ok"], "error": etat.get("erreur"), "derniere": etat}


MODULE = register(Module(
    key="sauvegarde",
    label="Sauvegarde",
    defaults=DEFAULTS,
    actions={"etat": action_etat, "lancer": action_lancer},
))
