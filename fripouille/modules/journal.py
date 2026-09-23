"""Module « Journal » : trace ce qui se passe sur le serveur, consultable au dashboard.

Un seul module écoute tous les événements plutôt qu'un log par feature : les autres
modules appellent :func:`record` (modération, économie, tickets, baptême, config), et
``bot.py`` y branche les événements Discord bruts.

Stockage **SQLite** (``journal.db``) avec purge automatique au-delà de
``retention_jours`` — la VM a 1 Go, on ne garde pas l'histoire complète du serveur.
Miroir Discord optionnel : chaque événement peut aussi être publié dans un salon.

Limite assumée : sans l'intent ``message_content``, une suppression de message est
journalisée en métadonnées (qui, où, quand) mais **jamais avec son contenu**.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional

import discord

from .. import config
from ..registry import Module, register

log = logging.getLogger("fripouille.journal")

DB_PATH = config.DATA_DIR / "journal.db"

# Familles d'événements : clé technique → (libellé dashboard, emoji, couleur embed).
KINDS = {
    "membre_arrivee": ("Arrivée", "🚪", 0x7C9A5A),
    "membre_depart": ("Départ", "🚪", 0xB4472F),
    "roles": ("Rôles modifiés", "🎭", 0xC9A44A),
    "pseudo": ("Pseudo modifié", "✏️", 0xC9A44A),
    "message_supprime": ("Message supprimé", "🗑️", 0xD9702F),
    "vocal": ("Vocal", "🔊", 0x7C9A5A),
    "sanction": ("Modération", "⚖️", 0xB4472F),
    "economie": ("Économie", "🪙", 0xC9A44A),
    "bapteme": ("Baptême", "🕯️", 0xE7C66B),
    "ticket": ("Ticket", "🎫", 0x7C9A5A),
    "config": ("Configuration", "⚙", 0x9A7B4A),
}

DEFAULTS = {
    "enabled": True,
    "channel_id": None,              # miroir Discord (optionnel)
    "retention_jours": 30,
    # Familles réellement enregistrées. Les décocher réduit le bruit et les écritures.
    "events": {k: True for k in KINDS},
    # Familles publiées dans le salon Discord (sous-ensemble des précédentes).
    "miroir": {k: k in ("sanction", "membre_arrivee", "membre_depart") for k in KINDS},
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


class JournalDB:
    def __init__(self, path):
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        self._last_purge: Optional[datetime] = None
        self._init()

    def _init(self):
        with self._lock, self._conn:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS events (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts         TEXT NOT NULL,
                    kind       TEXT NOT NULL,
                    actor_id   TEXT,
                    actor_tag  TEXT,
                    target_id  TEXT,
                    target_tag TEXT,
                    summary    TEXT,
                    detail     TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
                CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, ts DESC);
                CREATE INDEX IF NOT EXISTS idx_events_target ON events(target_id, ts DESC);
                """
            )

    def add(self, kind, actor_id, actor_tag, target_id, target_tag, summary, detail) -> int:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "INSERT INTO events(ts, kind, actor_id, actor_tag, target_id, target_tag,"
                " summary, detail) VALUES (?,?,?,?,?,?,?,?)",
                (_now().isoformat(), kind,
                 str(actor_id) if actor_id else None, actor_tag,
                 str(target_id) if target_id else None, target_tag,
                 summary, json.dumps(detail, ensure_ascii=False) if detail else None),
            )
            return int(cur.lastrowid)

    def recent(self, limit=100, kind=None, target_id=None, before_id=None) -> list[sqlite3.Row]:
        sql = "SELECT * FROM events WHERE 1=1"
        args: list = []
        if kind:
            sql += " AND kind = ?"
            args.append(kind)
        if target_id:
            sql += " AND (target_id = ? OR actor_id = ?)"
            args.extend([str(target_id), str(target_id)])
        if before_id:
            sql += " AND id < ?"
            args.append(int(before_id))
        sql += " ORDER BY id DESC LIMIT ?"
        args.append(min(int(limit), 300))
        return self._conn.execute(sql, args).fetchall()

    def counts_since(self, since: datetime) -> dict:
        rows = self._conn.execute(
            "SELECT kind, COUNT(*) AS n FROM events WHERE ts >= ? GROUP BY kind",
            (since.isoformat(),),
        ).fetchall()
        return {r["kind"]: int(r["n"]) for r in rows}

    def purge(self, retention_days: int) -> int:
        """Supprime les événements trop vieux. Au plus une fois par heure."""
        if retention_days <= 0:
            return 0
        if self._last_purge and _now() - self._last_purge < timedelta(hours=1):
            return 0
        self._last_purge = _now()
        floor = (_now() - timedelta(days=retention_days)).isoformat()
        with self._lock, self._conn:
            cur = self._conn.execute("DELETE FROM events WHERE ts < ?", (floor,))
            return cur.rowcount


_db: Optional[JournalDB] = None


def db() -> JournalDB:
    global _db
    if _db is None:
        _db = JournalDB(DB_PATH)
    return _db


def _cfg(bot) -> dict:
    return bot.store.get("journal")


def row_to_dict(row: sqlite3.Row) -> dict:
    detail = None
    if row["detail"]:
        try:
            detail = json.loads(row["detail"])
        except json.JSONDecodeError:
            detail = None
    return {
        "id": int(row["id"]),
        "ts": row["ts"],
        "kind": row["kind"],
        "kind_label": KINDS.get(row["kind"], (row["kind"], "•", 0))[0],
        "actor_id": row["actor_id"],
        "actor_tag": row["actor_tag"] or "",
        "target_id": row["target_id"],
        "target_tag": row["target_tag"] or "",
        "summary": row["summary"] or "",
        "detail": detail,
    }


async def record(bot, kind: str, summary: str, actor_id=None, actor_tag=None,
                 target_id=None, target_tag=None, detail=None) -> None:
    """Enregistre un événement. Sans effet si le module ou la famille est désactivée.

    Ne lève jamais : un échec de journalisation ne doit pas casser l'action journalisée.
    """
    try:
        cfg = _cfg(bot)
        if not cfg.get("enabled") or not (cfg.get("events") or {}).get(kind, True):
            return
        db().add(kind, actor_id, actor_tag, target_id, target_tag, summary, detail)
        db().purge(int(cfg.get("retention_jours") or 30))
        if (cfg.get("miroir") or {}).get(kind) and cfg.get("channel_id"):
            await _mirror(bot, cfg, kind, summary, target_id, actor_tag, detail)
    except Exception:  # noqa: BLE001 — journalisation best-effort
        log.exception("journal : enregistrement impossible (%s)", kind)


async def _mirror(bot, cfg, kind, summary, target_id, actor_tag, detail):
    channel = bot.get_channel(int(cfg["channel_id"]))
    if channel is None:
        return
    label, emoji, color = KINDS.get(kind, (kind, "•", 0xC9A44A))
    embed = discord.Embed(
        title=f"{emoji} {label}", description=summary, color=color, timestamp=_now())
    if target_id:
        embed.add_field(name="Membre", value=f"<@{target_id}>", inline=True)
    if actor_tag:
        embed.add_field(name="Par", value=actor_tag, inline=True)
    if detail:
        extrait = ", ".join(f"{k} : {v}" for k, v in list(detail.items())[:4])
        if extrait:
            embed.set_footer(text=extrait[:200])
    try:
        await channel.send(embed=embed)
    except discord.HTTPException:
        pass


# ───────────────────────── Écouteurs Discord (branchés depuis bot.py) ────────────────
async def on_member_join(bot, member: discord.Member):
    await record(bot, "membre_arrivee", f"{member} a poussé la porte",
                 target_id=member.id, target_tag=str(member),
                 detail={"compte créé": member.created_at.strftime("%d/%m/%Y")})


async def on_member_remove(bot, member: discord.Member):
    roles = [r.name for r in getattr(member, "roles", []) if r.name != "@everyone"]
    await record(bot, "membre_depart", f"{member} a quitté la taverne",
                 target_id=member.id, target_tag=str(member),
                 detail={"rôles": ", ".join(roles[:6]) or "aucun"})


async def on_member_update(bot, before: discord.Member, after: discord.Member):
    gained = [r for r in after.roles if r not in before.roles]
    lost = [r for r in before.roles if r not in after.roles]
    if gained or lost:
        parts = []
        if gained:
            parts.append("+ " + ", ".join(r.name for r in gained))
        if lost:
            parts.append("− " + ", ".join(r.name for r in lost))
        await record(bot, "roles", f"{after} : {' · '.join(parts)}",
                     target_id=after.id, target_tag=str(after))
    if before.nick != after.nick:
        await record(bot, "pseudo",
                     f"{after} : « {before.nick or before.name} » → « {after.nick or after.name} »",
                     target_id=after.id, target_tag=str(after))


async def on_raw_message_delete(bot, payload):
    # Sans intent message_content, on journalise les métadonnées, jamais le contenu.
    channel = bot.get_channel(payload.channel_id)
    where = f"#{channel.name}" if isinstance(channel, discord.TextChannel) else "un salon"
    await record(bot, "message_supprime", f"Un message a été supprimé dans {where}",
                 detail={"salon": where, "message": str(payload.message_id)})


async def on_voice(bot, member, before, after):
    if before.channel is None and after.channel is not None:
        await record(bot, "vocal", f"{member} rejoint « {after.channel.name} »",
                     target_id=member.id, target_tag=str(member))
    elif before.channel is not None and after.channel is None:
        await record(bot, "vocal", f"{member} quitte « {before.channel.name} »",
                     target_id=member.id, target_tag=str(member))


# ───────────────────────── Actions dashboard ─────────────────────────
async def action_flux(bot, payload) -> dict:
    rows = db().recent(
        int(payload.get("limit") or 80),
        payload.get("kind") or None,
        payload.get("user_id") or None,
        payload.get("before_id") or None,
    )
    return {
        "events": [row_to_dict(r) for r in rows],
        "kinds": {k: v[0] for k, v in KINDS.items()},
    }


async def action_resume(bot, payload) -> dict:
    """Compteurs par famille sur les dernières 24 h — alimente l'accueil."""
    return {
        "jour": db().counts_since(_now() - timedelta(hours=24)),
        "semaine": db().counts_since(_now() - timedelta(days=7)),
    }


async def action_purger(bot, payload) -> dict:
    jours = int(payload.get("jours") or 0)
    if jours <= 0:
        raise ValueError("jours requis (> 0)")
    db()._last_purge = None  # purge manuelle : on court-circuite l'anti-rebond horaire
    return {"supprimes": db().purge(jours)}


MODULE = register(Module(
    key="journal",
    label="Journal",
    defaults=DEFAULTS,
    apply=None,
    actions={
        "flux": action_flux,
        "resume": action_resume,
        "purger": action_purger,
    },
))
