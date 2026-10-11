"""Module « Statistiques » : la vie du serveur en chiffres, sans heuristique inventée.

Tout est **mesuré** (jamais deviné) et agrégé par jour / heure de Paris — aucun contenu
de message n'est lu ni stocké :
- arrivées et départs par jour ;
- messages par jour et par heure (heures de pointe), membres actifs (≥ 1 message) ;
- jeux les plus joués : minutes cumulées, sessions et joueurs distincts, alimentés par le
  module « En ligne » (qui suit les parties via les présences).

Les compteurs de messages sont tamponnés en mémoire et écrits toutes les 60 s dans
``stats.db`` (SQLite) ; un redémarrage perd au plus une minute de messages.

Config : ``enabled`` (collecte) et ``retention_jours`` (purge de l'historique).
"""
import asyncio
import logging
import sqlite3
import threading
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import discord

from .. import config
from ..registry import Module, register

log = logging.getLogger("fripouille.stats")

PARIS = ZoneInfo("Europe/Paris")
DB_PATH = config.DATA_DIR / "stats.db"
DEFAULTS = {"enabled": True, "retention_jours": 400}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS flux (jour TEXT PRIMARY KEY, arrivees INTEGER NOT NULL DEFAULT 0,
                                 departs INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS msg_heure (jour TEXT NOT NULL, heure INTEGER NOT NULL,
                                      n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (jour, heure));
CREATE TABLE IF NOT EXISTS actifs (jour TEXT NOT NULL, user_id TEXT NOT NULL,
                                   n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (jour, user_id));
CREATE TABLE IF NOT EXISTS jeux (jour TEXT NOT NULL, jeu TEXT NOT NULL, minutes REAL NOT NULL DEFAULT 0,
                                 sessions INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (jour, jeu));
CREATE TABLE IF NOT EXISTS jeu_joueurs (jour TEXT NOT NULL, jeu TEXT NOT NULL, user_id TEXT NOT NULL,
                                        PRIMARY KEY (jour, jeu, user_id));
"""

_conn: sqlite3.Connection | None = None
_verrou = threading.Lock()
_tampon_msg: dict[tuple[str, int], int] = defaultdict(int)       # (jour, heure) → n
_tampon_actifs: dict[tuple[str, str], int] = defaultdict(int)    # (jour, user) → n


def _db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _conn.executescript(_SCHEMA)
    return _conn


def _maintenant() -> datetime:
    return datetime.now(PARIS)


def _jour(dt: datetime | None = None) -> str:
    return (dt or _maintenant()).strftime("%Y-%m-%d")


def _actif(bot) -> bool:
    return bool(bot.store.get("stats").get("enabled"))


# --- Collecte ---
def on_join(bot, member: discord.Member):
    if member.bot or not _actif(bot):
        return
    with _verrou:
        _db().execute("INSERT INTO flux (jour, arrivees) VALUES (?, 1) "
                      "ON CONFLICT(jour) DO UPDATE SET arrivees = arrivees + 1", (_jour(),))
        _db().commit()


def on_leave(bot, member: discord.Member):
    if member.bot or not _actif(bot):
        return
    with _verrou:
        _db().execute("INSERT INTO flux (jour, departs) VALUES (?, 1) "
                      "ON CONFLICT(jour) DO UPDATE SET departs = departs + 1", (_jour(),))
        _db().commit()


def on_message(bot, message: discord.Message):
    if not _actif(bot):
        return
    now = _maintenant()
    _tampon_msg[(_jour(now), now.hour)] += 1
    _tampon_actifs[(_jour(now), str(message.author.id))] += 1


def enregistrer_jeu(bot, nom: str, minutes: float, user_id: int):
    """Appelé par « En ligne » quand un joueur quitte une partie."""
    if not _actif(bot) or not nom or minutes <= 0:
        return
    j = _jour()
    with _verrou:
        c = _db()
        c.execute("INSERT INTO jeux (jour, jeu, minutes, sessions) VALUES (?, ?, ?, 1) "
                  "ON CONFLICT(jour, jeu) DO UPDATE SET minutes = minutes + ?, sessions = sessions + 1",
                  (j, nom, minutes, minutes))
        c.execute("INSERT OR IGNORE INTO jeu_joueurs (jour, jeu, user_id) VALUES (?, ?, ?)",
                  (j, nom, str(user_id)))
        c.commit()


def _vider_tampon():
    if not _tampon_msg and not _tampon_actifs:
        return
    msgs, act = dict(_tampon_msg), dict(_tampon_actifs)
    _tampon_msg.clear()
    _tampon_actifs.clear()
    with _verrou:
        c = _db()
        for (jour, heure), n in msgs.items():
            c.execute("INSERT INTO msg_heure (jour, heure, n) VALUES (?, ?, ?) "
                      "ON CONFLICT(jour, heure) DO UPDATE SET n = n + ?", (jour, heure, n, n))
        for (jour, uid), n in act.items():
            c.execute("INSERT INTO actifs (jour, user_id, n) VALUES (?, ?, ?) "
                      "ON CONFLICT(jour, user_id) DO UPDATE SET n = n + ?", (jour, uid, n, n))
        c.commit()


async def _boucle(bot):
    await bot.wait_until_ready()
    dernier_menage = ""
    while not bot.is_closed():
        try:
            _vider_tampon()
            auj = _jour()
            if auj != dernier_menage:
                dernier_menage = auj
                retention = max(30, int(bot.store.get("stats").get("retention_jours") or 400))
                limite = _jour(_maintenant() - timedelta(days=retention))
                with _verrou:
                    c = _db()
                    for t in ("flux", "msg_heure", "actifs", "jeux", "jeu_joueurs"):
                        c.execute("DELETE FROM %s WHERE jour < ?" % t, (limite,))
                    c.commit()
        except Exception as exc:  # noqa: BLE001
            log.error("stats : %s", exc)
        await asyncio.sleep(60)


def start_scheduler(bot):
    bot.loop.create_task(_boucle(bot))


# --- Lecture ---
async def action_resume(bot, payload):
    try:
        jours = max(1, min(int(payload.get("jours") or 30), 365))
    except (TypeError, ValueError):
        jours = 30
    _vider_tampon()   # chiffres à la seconde près
    debut = _jour(_maintenant() - timedelta(days=jours - 1))
    axe = [_jour(_maintenant() - timedelta(days=i)) for i in range(jours - 1, -1, -1)]
    with _verrou:
        c = _db()
        flux = {j: (a, d) for j, a, d in c.execute(
            "SELECT jour, arrivees, departs FROM flux WHERE jour >= ?", (debut,))}
        msgs_jour = dict(c.execute(
            "SELECT jour, SUM(n) FROM msg_heure WHERE jour >= ? GROUP BY jour", (debut,)))
        heures = dict(c.execute(
            "SELECT heure, SUM(n) FROM msg_heure WHERE jour >= ? GROUP BY heure", (debut,)))
        actifs_jour = dict(c.execute(
            "SELECT jour, COUNT(*) FROM actifs WHERE jour >= ? GROUP BY jour", (debut,)))
        actifs_total = c.execute(
            "SELECT COUNT(DISTINCT user_id) FROM actifs WHERE jour >= ?", (debut,)).fetchone()[0]
        top_actifs = c.execute(
            "SELECT user_id, SUM(n) AS t FROM actifs WHERE jour >= ? GROUP BY user_id "
            "ORDER BY t DESC LIMIT 5", (debut,)).fetchall()
        jeux = c.execute(
            "SELECT jeu, SUM(minutes), SUM(sessions) FROM jeux WHERE jour >= ? GROUP BY jeu "
            "ORDER BY SUM(minutes) DESC LIMIT 10", (debut,)).fetchall()
        joueurs = dict(c.execute(
            "SELECT jeu, COUNT(DISTINCT user_id) FROM jeu_joueurs WHERE jour >= ? GROUP BY jeu", (debut,)))

    guild = bot.get_guild(config.GUILD_ID) if config.GUILD_ID else None

    def nom(uid):
        m = guild.get_member(int(uid)) if guild else None
        return m.display_name if m else "#%s" % uid

    arrivees = sum(v[0] for v in flux.values())
    departs = sum(v[1] for v in flux.values())
    return {
        "ok": True, "jours": jours,
        "membres": guild.member_count if guild else None,
        "totaux": {"arrivees": arrivees, "departs": departs, "solde": arrivees - departs,
                   "messages": sum(msgs_jour.values()), "actifs": actifs_total},
        "par_jour": [{"jour": j, "arrivees": flux.get(j, (0, 0))[0], "departs": flux.get(j, (0, 0))[1],
                      "messages": int(msgs_jour.get(j, 0)), "actifs": int(actifs_jour.get(j, 0))}
                     for j in axe],
        "heures": [int(heures.get(h, 0)) for h in range(24)],
        "top_actifs": [{"nom": nom(u), "messages": int(t)} for u, t in top_actifs],
        "jeux": [{"nom": j, "minutes": round(m), "sessions": int(s), "joueurs": int(joueurs.get(j, 0))}
                 for j, m, s in jeux],
    }


MODULE = register(Module(
    key="stats",
    label="Statistiques",
    defaults=DEFAULTS,
    actions={"resume": action_resume},
))
