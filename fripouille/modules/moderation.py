"""Module « Modération » : avertissements, exclusions temporaires, expulsions, bannissements.

Même moule que les autres modules (config dashboard + runtime bot), avec une base
**SQLite dédiée** (``moderation.db``) : comme l'économie, l'historique des sanctions
s'écrit ligne par ligne et ne tiendrait pas dans le JSON de config réécrit en entier.

Deux portes d'entrée, une seule mécanique :
- **Discord** : ``/avertir``, ``/sanctions``, ``/lever`` (réservées aux modérateurs) ;
- **dashboard** : actions ``sanctionner`` / ``lever`` / ``historique`` / ``liste``.

L'escalade automatique (N avertissements actifs → exclusion) est appliquée après
chaque avertissement, quelle que soit la porte d'entrée. Un avertissement « expire »
au bout de ``warn_expire_jours`` : il reste dans l'historique mais ne compte plus.
"""
from __future__ import annotations

import logging
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional

import discord
from discord import app_commands

from .. import config
from ..registry import Module, register

log = logging.getLogger("fripouille.moderation")

DB_PATH = config.DATA_DIR / "moderation.db"

# Types de sanction. `note` n'a aucun effet Discord : c'est une observation interne.
KINDS = ("note", "warn", "timeout", "kick", "ban", "unban")
# Durée maximale d'un timeout Discord (contrainte API : 28 jours).
MAX_TIMEOUT_MINUTES = 28 * 24 * 60

DEFAULTS = {
    "enabled": False,
    "log_channel_id": None,          # salon où publier chaque sanction
    "warn_expire_jours": 90,         # au-delà, l'avertissement ne compte plus dans l'escalade
    "timeout_defaut_minutes": 60,
    "notifier_membre": True,         # MP au membre sanctionné
    "raisons": [                     # motifs proposés dans le dashboard et les commandes
        "Spam / flood",
        "Propos déplacés",
        "Publicité non sollicitée",
        "Hors-sujet répété",
        "Non-respect du RP",
    ],
    # Escalade : au N-ième avertissement actif, applique automatiquement l'action.
    "escalade": [
        {"warns": 3, "action": "timeout", "minutes": 60},
        {"warns": 5, "action": "timeout", "minutes": 1440},
    ],
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _parse(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


# ───────────────────────── Base des sanctions ─────────────────────────
class ModerationDB:
    def __init__(self, path):
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        self._init()

    def _init(self):
        with self._lock, self._conn:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS sanctions (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id     TEXT NOT NULL,
                    user_tag    TEXT,
                    kind        TEXT NOT NULL,
                    reason      TEXT,
                    moderator   TEXT,
                    ts          TEXT NOT NULL,
                    expires_ts  TEXT,
                    active      INTEGER NOT NULL DEFAULT 1,
                    lifted_ts   TEXT,
                    lifted_by   TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_sanctions_user ON sanctions(user_id);
                CREATE INDEX IF NOT EXISTS idx_sanctions_ts ON sanctions(ts DESC);
                """
            )

    def add(self, user_id, user_tag, kind, reason, moderator, expires: Optional[datetime]) -> int:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "INSERT INTO sanctions(user_id, user_tag, kind, reason, moderator, ts, expires_ts) "
                "VALUES (?,?,?,?,?,?,?)",
                (str(user_id), user_tag, kind, reason, moderator, _iso(_now()), _iso(expires)),
            )
            return int(cur.lastrowid)

    def get(self, sanction_id) -> Optional[sqlite3.Row]:
        return self._conn.execute(
            "SELECT * FROM sanctions WHERE id = ?", (int(sanction_id),)
        ).fetchone()

    def lift(self, sanction_id, by) -> bool:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "UPDATE sanctions SET active = 0, lifted_ts = ?, lifted_by = ? "
                "WHERE id = ? AND active = 1",
                (_iso(_now()), by, int(sanction_id)),
            )
            return cur.rowcount > 0

    def history(self, user_id, limit=100) -> list[sqlite3.Row]:
        return self._conn.execute(
            "SELECT * FROM sanctions WHERE user_id = ? ORDER BY ts DESC LIMIT ?",
            (str(user_id), int(limit)),
        ).fetchall()

    def recent(self, limit=60, kind=None, only_active=False) -> list[sqlite3.Row]:
        sql = "SELECT * FROM sanctions WHERE 1=1"
        args: list = []
        if kind:
            sql += " AND kind = ?"
            args.append(kind)
        if only_active:
            sql += " AND active = 1"
        sql += " ORDER BY ts DESC LIMIT ?"
        args.append(int(limit))
        return self._conn.execute(sql, args).fetchall()

    def active_warns(self, user_id, expire_days: int) -> int:
        """Avertissements encore comptabilisés dans l'escalade (non levés, non expirés)."""
        floor = _iso(_now() - timedelta(days=max(0, int(expire_days)))) if expire_days else ""
        return int(self._conn.execute(
            "SELECT COUNT(*) AS n FROM sanctions "
            "WHERE user_id = ? AND kind = 'warn' AND active = 1 AND ts >= ?",
            (str(user_id), floor),
        ).fetchone()["n"])

    def counts(self, since: Optional[datetime] = None) -> dict:
        sql = "SELECT kind, COUNT(*) AS n FROM sanctions"
        args: list = []
        if since:
            sql += " WHERE ts >= ?"
            args.append(_iso(since))
        sql += " GROUP BY kind"
        rows = self._conn.execute(sql, args).fetchall()
        return {r["kind"]: int(r["n"]) for r in rows}

    def top_offenders(self, limit=5) -> list[sqlite3.Row]:
        return self._conn.execute(
            "SELECT user_id, user_tag, COUNT(*) AS n FROM sanctions "
            "WHERE kind != 'note' GROUP BY user_id ORDER BY n DESC LIMIT ?",
            (int(limit),),
        ).fetchall()


_db: Optional[ModerationDB] = None


def db() -> ModerationDB:
    global _db
    if _db is None:
        _db = ModerationDB(DB_PATH)
    return _db


# ───────────────────────── Helpers ─────────────────────────
def _cfg(bot) -> dict:
    return bot.store.get("moderation")


def _guild(bot) -> Optional[discord.Guild]:
    return bot.get_guild(config.GUILD_ID) if config.GUILD_ID else None


def row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": int(row["id"]),
        "user_id": row["user_id"],
        "user_tag": row["user_tag"] or "",
        "kind": row["kind"],
        "reason": row["reason"] or "",
        "moderator": row["moderator"] or "",
        "ts": row["ts"],
        "expires_ts": row["expires_ts"],
        "active": bool(row["active"]),
        "lifted_ts": row["lifted_ts"],
        "lifted_by": row["lifted_by"] or "",
    }


KIND_LABEL = {
    "note": "Observation",
    "warn": "Avertissement",
    "timeout": "Exclusion temporaire",
    "kick": "Expulsion",
    "ban": "Bannissement",
    "unban": "Levée de bannissement",
}
KIND_COLOR = {
    "note": 0x7C9A5A,
    "warn": 0xC9A44A,
    "timeout": 0xD9702F,
    "kick": 0xB4472F,
    "ban": 0x8B2E1C,
    "unban": 0x7C9A5A,
}


async def _log_embed(bot, cfg, entry: dict):
    """Publie la sanction dans le salon de logs de modération, s'il est configuré."""
    channel_id = cfg.get("log_channel_id")
    if not channel_id:
        return
    channel = bot.get_channel(int(channel_id))
    if channel is None:
        return
    embed = discord.Embed(
        title=f"⚖️ {KIND_LABEL.get(entry['kind'], entry['kind'])}",
        description=entry["reason"] or "*aucun motif*",
        color=KIND_COLOR.get(entry["kind"], 0xC9A44A),
        timestamp=_now(),
    )
    embed.add_field(name="Membre", value=f"<@{entry['user_id']}>", inline=True)
    embed.add_field(name="Tavernier", value=entry["moderator"] or "—", inline=True)
    if entry.get("expires_ts"):
        dt = _parse(entry["expires_ts"])
        if dt:
            embed.add_field(name="Jusqu'au", value=f"<t:{int(dt.timestamp())}:f>", inline=True)
    embed.set_footer(text=f"Sanction #{entry['id']}")
    try:
        await channel.send(embed=embed)
    except discord.HTTPException:
        log.warning("moderation : envoi du log impossible")


async def _notify(bot, cfg, member: Optional[discord.Member], entry: dict):
    """Prévient le membre en message privé (échec silencieux : MP souvent fermés)."""
    if not cfg.get("notifier_membre") or member is None or entry["kind"] == "note":
        return
    guild = _guild(bot)
    embed = discord.Embed(
        title=f"⚖️ {KIND_LABEL.get(entry['kind'], entry['kind'])}",
        description=entry["reason"] or "*aucun motif communiqué*",
        color=KIND_COLOR.get(entry["kind"], 0xC9A44A),
    )
    if guild:
        embed.set_author(name=guild.name, icon_url=guild.icon.url if guild.icon else None)
    if entry.get("expires_ts"):
        dt = _parse(entry["expires_ts"])
        if dt:
            embed.add_field(name="Jusqu'au", value=f"<t:{int(dt.timestamp())}:f>")
    try:
        await member.send(embed=embed)
    except (discord.Forbidden, discord.HTTPException):
        pass


async def _apply_discord(bot, kind: str, user_id: int, reason: str,
                         minutes: Optional[int]) -> tuple[bool, str]:
    """Exécute l'effet Discord de la sanction. Renvoie (ok, message d'erreur)."""
    guild = _guild(bot)
    if guild is None:
        return False, "serveur introuvable"
    audit = f"{reason or 'sans motif'} (La Fripouille)"
    try:
        if kind in ("note", "warn"):
            return True, ""
        if kind == "timeout":
            member = guild.get_member(user_id) or await guild.fetch_member(user_id)
            until = _now() + timedelta(minutes=minutes or 60)
            await member.timeout(until, reason=audit)
            return True, ""
        if kind == "kick":
            member = guild.get_member(user_id) or await guild.fetch_member(user_id)
            await member.kick(reason=audit)
            return True, ""
        if kind == "ban":
            await guild.ban(discord.Object(id=user_id), reason=audit, delete_message_days=0)
            return True, ""
        if kind == "unban":
            await guild.unban(discord.Object(id=user_id), reason=audit)
            return True, ""
    except discord.Forbidden:
        return False, "permission refusée (rôle du bot trop bas ?)"
    except discord.NotFound:
        return False, "membre introuvable"
    except discord.HTTPException as exc:
        return False, f"Discord a refusé : {exc.text or exc.status}"
    return False, "type de sanction inconnu"


async def sanction(bot, user_id, kind: str, reason: str, moderator: str,
                   minutes: Optional[int] = None, escalade: bool = True) -> dict:
    """Cœur unique : applique l'effet Discord, enregistre, notifie, journalise, escalade."""
    from . import journal  # import tardif : évite une boucle d'import au chargement

    if kind not in KINDS:
        raise ValueError("type de sanction inconnu")
    cfg = _cfg(bot)
    user_id = int(user_id)
    guild = _guild(bot)
    member = guild.get_member(user_id) if guild else None

    if kind == "timeout":
        minutes = max(1, min(int(minutes or cfg.get("timeout_defaut_minutes") or 60),
                             MAX_TIMEOUT_MINUTES))

    ok, err = await _apply_discord(bot, kind, user_id, reason, minutes)
    if not ok:
        return {"ok": False, "error": err}

    expires = _now() + timedelta(minutes=minutes) if kind == "timeout" and minutes else None
    tag = str(member) if member else str(user_id)
    sanction_id = db().add(user_id, tag, kind, reason, moderator, expires)
    entry = row_to_dict(db().get(sanction_id))

    await _notify(bot, cfg, member, entry)
    await _log_embed(bot, cfg, entry)
    await journal.record(
        bot, "sanction",
        summary=f"{KIND_LABEL.get(kind, kind)} — {tag}",
        actor_tag=moderator, target_id=str(user_id), target_tag=tag,
        detail={"kind": kind, "reason": reason, "sanction_id": sanction_id},
    )

    result = {"ok": True, "sanction": entry}
    if kind == "warn" and escalade:
        auto = await _escalade(bot, cfg, user_id, moderator)
        if auto:
            result["escalade"] = auto
    return result


async def _escalade(bot, cfg, user_id, moderator) -> Optional[dict]:
    """Applique le palier d'escalade atteint, s'il y en a un pour ce nombre d'avertissements."""
    rules = cfg.get("escalade") or []
    if not rules:
        return None
    total = db().active_warns(user_id, cfg.get("warn_expire_jours") or 0)
    rule = next((r for r in rules if int(r.get("warns") or 0) == total), None)
    if rule is None:
        return None
    action = str(rule.get("action") or "timeout")
    if action not in ("timeout", "kick", "ban"):
        return None
    res = await sanction(
        bot, user_id, action,
        f"Escalade automatique : {total} avertissements actifs",
        f"{moderator} → escalade", rule.get("minutes"), escalade=False,
    )
    return res.get("sanction") if res.get("ok") else None


async def lift(bot, sanction_id, by: str) -> dict:
    """Lève une sanction : annule l'effet Discord encore en cours, puis la désactive."""
    from . import journal

    row = db().get(sanction_id)
    if row is None:
        return {"ok": False, "error": "sanction introuvable"}
    if not row["active"]:
        return {"ok": False, "error": "sanction déjà levée"}

    kind = row["kind"]
    guild = _guild(bot)
    if guild is not None:
        try:
            if kind == "timeout":
                member = guild.get_member(int(row["user_id"]))
                if member is not None:
                    await member.timeout(None, reason=f"Levée par {by}")
            elif kind == "ban":
                await guild.unban(discord.Object(id=int(row["user_id"])),
                                  reason=f"Levée par {by}")
        except discord.NotFound:
            pass  # déjà expiré côté Discord : on désactive quand même en base
        except discord.Forbidden:
            return {"ok": False, "error": "permission refusée"}

    db().lift(sanction_id, by)
    entry = row_to_dict(db().get(sanction_id))
    await journal.record(
        bot, "sanction",
        summary=f"Levée — {KIND_LABEL.get(kind, kind)} de {row['user_tag'] or row['user_id']}",
        actor_tag=by, target_id=row["user_id"], target_tag=row["user_tag"],
        detail={"kind": "lift", "sanction_id": int(sanction_id)},
    )
    return {"ok": True, "sanction": entry}


# ───────────────────────── Actions dashboard ─────────────────────────
async def action_sanctionner(bot, payload) -> dict:
    user_id = payload.get("user_id")
    if not user_id:
        raise ValueError("user_id requis")
    return await sanction(
        bot, user_id,
        str(payload.get("kind") or "warn"),
        str(payload.get("reason") or "").strip(),
        str(payload.get("moderator") or payload.get("_acteur") or "Dashboard"),
        payload.get("minutes"),
    )


async def action_lever(bot, payload) -> dict:
    sanction_id = payload.get("id")
    if sanction_id is None:
        raise ValueError("id requis")
    return await lift(bot, sanction_id,
                      str(payload.get("moderator") or payload.get("_acteur") or "Dashboard"))


async def action_historique(bot, payload) -> dict:
    user_id = payload.get("user_id")
    if not user_id:
        raise ValueError("user_id requis")
    rows = db().history(user_id, int(payload.get("limit") or 100))
    cfg = _cfg(bot)
    return {
        "sanctions": [row_to_dict(r) for r in rows],
        "warns_actifs": db().active_warns(user_id, cfg.get("warn_expire_jours") or 0),
    }


async def action_liste(bot, payload) -> dict:
    rows = db().recent(
        int(payload.get("limit") or 60),
        payload.get("kind") or None,
        bool(payload.get("actives")),
    )
    return {"sanctions": [row_to_dict(r) for r in rows]}


async def action_stats(bot, payload) -> dict:
    since = _now() - timedelta(days=int(payload.get("jours") or 30))
    return {
        "total": db().counts(),
        "periode": db().counts(since),
        "jours": int(payload.get("jours") or 30),
        "recidivistes": [
            {"user_id": r["user_id"], "user_tag": r["user_tag"] or "", "n": int(r["n"])}
            for r in db().top_offenders()
        ],
    }


# ───────────────────────── Commandes Discord ─────────────────────────
def setup(tree: app_commands.CommandTree, guild: Optional[discord.Object]) -> None:
    """Commandes réservées aux membres ayant la permission « Exclure des membres »."""

    @tree.command(name="avertir", description="Avertir un membre (modération)", guild=guild)
    @app_commands.describe(membre="Le membre à avertir", motif="Raison de l'avertissement")
    @app_commands.default_permissions(moderate_members=True)
    async def avertir(interaction: discord.Interaction, membre: discord.Member, motif: str):
        if not _cfg(interaction.client).get("enabled"):
            await interaction.response.send_message(
                "La modération n'est pas activée.", ephemeral=True)
            return
        res = await sanction(interaction.client, membre.id, "warn", motif, str(interaction.user))
        if not res.get("ok"):
            await interaction.response.send_message(
                f"Échec : {res.get('error')}", ephemeral=True)
            return
        total = db().active_warns(
            membre.id, _cfg(interaction.client).get("warn_expire_jours") or 0)
        suite = ""
        if res.get("escalade"):
            suite = f"\nEscalade appliquée : **{KIND_LABEL.get(res['escalade']['kind'])}**."
        await interaction.response.send_message(
            f"⚖️ {membre.mention} averti — {total} avertissement(s) actif(s).{suite}",
            ephemeral=True)

    @tree.command(name="sanctions", description="Historique de modération d'un membre", guild=guild)
    @app_commands.describe(membre="Le membre à consulter")
    @app_commands.default_permissions(moderate_members=True)
    async def sanctions_cmd(interaction: discord.Interaction, membre: discord.Member):
        rows = db().history(membre.id, 15)
        if not rows:
            await interaction.response.send_message(
                f"Aucune sanction pour {membre.mention}. Un ange.", ephemeral=True)
            return
        embed = discord.Embed(
            title=f"Registre de {membre.display_name}",
            color=0xC9A44A,
        )
        for r in rows[:10]:
            dt = _parse(r["ts"])
            stamp = f"<t:{int(dt.timestamp())}:R>" if dt else r["ts"]
            statut = "" if r["active"] else " *(levée)*"
            embed.add_field(
                name=f"#{r['id']} · {KIND_LABEL.get(r['kind'], r['kind'])}{statut}",
                value=f"{r['reason'] or '*sans motif*'}\n{stamp} — par {r['moderator'] or '—'}",
                inline=False,
            )
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @tree.command(name="lever", description="Lever une sanction par son numéro", guild=guild)
    @app_commands.describe(numero="Numéro de la sanction (visible dans /sanctions)")
    @app_commands.default_permissions(moderate_members=True)
    async def lever_cmd(interaction: discord.Interaction, numero: int):
        res = await lift(interaction.client, numero, str(interaction.user))
        msg = (f"Sanction #{numero} levée." if res.get("ok")
               else f"Échec : {res.get('error')}")
        await interaction.response.send_message(msg, ephemeral=True)


MODULE = register(Module(
    key="moderation",
    label="Modération",
    defaults=DEFAULTS,
    apply=None,  # config lue à la volée
    actions={
        "sanctionner": action_sanctionner,
        "lever": action_lever,
        "historique": action_historique,
        "liste": action_liste,
        "stats": action_stats,
    },
))
