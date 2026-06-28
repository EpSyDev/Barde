"""État persistant de l'ARG : progression des joueurs, drapeaux de quête (SQLite)."""
import sqlite3
import threading
import time

from . import config

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def init():
    global _conn
    _conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
    _conn.execute("PRAGMA journal_mode=WAL")
    _conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS flags (
            user_id INTEGER NOT NULL,
            flag    TEXT    NOT NULL,
            value   TEXT,
            ts      INTEGER NOT NULL,
            PRIMARY KEY (user_id, flag)
        );
        CREATE TABLE IF NOT EXISTS journal (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            pnj     TEXT    NOT NULL,
            kind    TEXT    NOT NULL,   -- 'in' (joueur) / 'out' (pnj)
            content TEXT    NOT NULL,
            ts      INTEGER NOT NULL
        );
        """
    )
    _conn.commit()


def set_flag(user_id: int, flag: str, value: str = "1"):
    with _lock:
        _conn.execute(
            "INSERT INTO flags(user_id,flag,value,ts) VALUES(?,?,?,?) "
            "ON CONFLICT(user_id,flag) DO UPDATE SET value=excluded.value, ts=excluded.ts",
            (user_id, flag, value, int(time.time())),
        )
        _conn.commit()


def get_flag(user_id: int, flag: str) -> str | None:
    with _lock:
        row = _conn.execute(
            "SELECT value FROM flags WHERE user_id=? AND flag=?", (user_id, flag)
        ).fetchone()
    return row[0] if row else None


def has_flag(user_id: int, flag: str) -> bool:
    return get_flag(user_id, flag) is not None


def count_flag(flag: str) -> int:
    """Nombre de joueurs distincts ayant ce drapeau (portes collectives)."""
    with _lock:
        row = _conn.execute(
            "SELECT COUNT(*) FROM flags WHERE flag=?", (flag,)
        ).fetchone()
    return row[0] if row else 0


def log_exchange(user_id: int, pnj: str, kind: str, content: str):
    with _lock:
        _conn.execute(
            "INSERT INTO journal(user_id,pnj,kind,content,ts) VALUES(?,?,?,?,?)",
            (user_id, pnj, kind, content[:2000], int(time.time())),
        )
        _conn.commit()


def recent_exchanges(user_id: int, pnj: str, limit: int) -> list[tuple[str, str]]:
    """Derniers échanges (kind, content) entre ce joueur et ce PNJ, ordre chrono."""
    with _lock:
        rows = _conn.execute(
            "SELECT kind,content FROM journal WHERE user_id=? AND pnj=? "
            "ORDER BY id DESC LIMIT ?",
            (user_id, pnj, limit),
        ).fetchall()
    return list(reversed(rows))
