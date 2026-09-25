"""Module « Économie » : monnaie virtuelle du serveur, pilotée par le dashboard.

Deux moitiés, comme les autres modules :
- **config** (``config.json``, clé ``economie``) : la devise (nom, symbole…), les
  **sources de gains** activables (message, daily) et le **catalogue de la boutique**.
  Édité depuis le dashboard, lu à la volée par le bot.
- **runtime** (ici) : la base transactionnelle SQLite (``economy.db``), le moteur de
  gains (crédit sur message / daily), les commandes slash (``/solde``, ``/donner``,
  ``/daily``, ``/boutique``, ``/inventaire``, ``/classement``, ``/eco`` admin) et la
  boutique interactive.

Le transactionnel vit en **SQLite** (pas dans le JSON de config) : soldes, historique
des mouvements et inventaires y sont écrits ligne par ligne, atomiquement — le JSON,
réécrit en entier à chaque sauvegarde, ne tiendrait pas la fréquence d'écriture.

Point d'entrée public pour les autres systèmes (ex. quêtes) : :func:`crediter`.
"""
from __future__ import annotations

import asyncio
import logging
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import discord
from discord import app_commands

from .. import config
from ..registry import Module, register
from . import bapteme_data

log = logging.getLogger("fripouille.economie")

# --- Schéma de configuration (défauts du dashboard) ---
DEFAULTS = {
    # Catégorie « espace RP » : hors de cette catégorie (et de ses salons), l'économie est
    # entièrement inactive — gains passifs ET commandes membre (/solde, /donner, /daily...).
    # None = pas encore configuré = économie inactive partout (voir _in_rp_category).
    "category_id": None,
    "devise": {
        "nom": "Écus",            # pluriel affiché
        "nom_singulier": "Écu",    # utilisé quand montant == 1 et pas de symbole
        "symbole": "🪙",          # emoji ou caractère ; prioritaire sur le nom
        "symbole_avant": False,    # True → « 🪙 100 », False → « 100 🪙 »
    },
    # Sources de gains : chacune activable + réglable depuis le dashboard. Certaines ont
    # besoin d'un intent Discord supplémentaire (reaction) ou d'un tick périodique (vocal,
    # anciennete) — voir bot.py / start_scheduler.
    "gains": {
        "message": {"enabled": False, "montant": 1, "cooldown": 60},      # cooldown en secondes
        "daily": {"enabled": True, "montant": 100, "cooldown": 86400},    # 24 h par défaut
        "reaction": {"enabled": False, "montant": 1, "cooldown": 60},     # réagir à un message
        "vocal": {"enabled": False, "montant": 5, "minutes": 30},         # toutes les N minutes connecté (hors AFK)
        "bienvenue": {"enabled": False, "montant": 50},                   # arrivée sur le serveur, une fois/compte
        "bapteme": {"enabled": False, "montant": 100},                    # baptême complété, une fois/compte
        "role_jeu": {"enabled": False, "montant": 25},                    # premier rôle-jeu choisi, une fois/compte
        "boost": {"enabled": False, "montant": 200},                      # à chaque nouveau boost du serveur
        # Taverne 3D (jeu MYRHAVEN) : première visite du jour, et « tournée de Brom » sonnée par le hub
        # toutes les 20 min pour les joueurs présents et actifs (plafond TOURNEES_MAX par jour).
        "taverne_visite": {"enabled": False, "montant": 30, "cooldown": 72000},
        "taverne_tournee": {"enabled": False, "montant": 5},
        "ticket_resolu": {"enabled": False, "montant": 30},                # au membre staff qui a pris en charge
        "anciennete": {"enabled": False, "montant": 100, "paliers_jours": [30, 90, 365]},
        "seuil_reactions": {"enabled": False, "montant": 20, "seuil": 10},  # auteur d'un message très réagi
    },
    # Catalogue de la boutique : liste d'articles éditée au dashboard.
    # Article = {id, nom, description, prix, type("role"|"objet"), role_id, stock, enabled, taverne}
    # taverne : objet servi par Brom dans la Taverne 3D (voir action_taverne).
    # stock : None ou -1 = illimité.
    "boutique": [],
    # Récompenses ponctuelles déclenchables depuis d'autres systèmes (ex. le jeu MYRHAVEN),
    # une seule fois par joueur (voir action_crediter_evenement). Clé = event_id arbitraire.
    # Valeur = {"montant": int, "enabled": bool, "label": str}
    "evenements": {},
}

DB_PATH = config.DATA_DIR / "economy.db"


# ───────────────────────── Base transactionnelle ─────────────────────────
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class EconomyDB:
    """Accès SQLite. Un seul fichier, aucune dépendance externe (stdlib ``sqlite3``).

    Toutes les écritures passent par un verrou + un contexte de transaction : les
    opérations (crédit, dépense, transfert) sont atomiques et sûres en concurrence.
    """

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
                CREATE TABLE IF NOT EXISTS balances (
                    user_id TEXT PRIMARY KEY,
                    amount  INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS transactions (
                    id      INTEGER PRIMARY KEY AUTOINCREMENT,
                    from_id TEXT,
                    to_id   TEXT,
                    amount  INTEGER NOT NULL,
                    reason  TEXT,
                    ts      TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS inventories (
                    user_id     TEXT NOT NULL,
                    item_id     TEXT NOT NULL,
                    qty         INTEGER NOT NULL DEFAULT 0,
                    acquired_ts TEXT,
                    PRIMARY KEY (user_id, item_id)
                );
                CREATE TABLE IF NOT EXISTS cooldowns (
                    user_id TEXT NOT NULL,
                    kind    TEXT NOT NULL,
                    last_ts TEXT NOT NULL,
                    PRIMARY KEY (user_id, kind)
                );
                CREATE TABLE IF NOT EXISTS account_flags (
                    user_id TEXT PRIMARY KEY,
                    frozen  INTEGER NOT NULL DEFAULT 0,
                    note    TEXT,
                    ts      TEXT,
                    by_who  TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_tx_ts ON transactions(ts DESC);
                CREATE INDEX IF NOT EXISTS idx_tx_to ON transactions(to_id, ts DESC);
                """
            )

    # --- Soldes ---
    def balance(self, user_id) -> int:
        row = self._conn.execute(
            "SELECT amount FROM balances WHERE user_id = ?", (str(user_id),)
        ).fetchone()
        return int(row["amount"]) if row else 0

    def _log_tx(self, from_id, to_id, amount, reason):
        self._conn.execute(
            "INSERT INTO transactions(from_id, to_id, amount, reason, ts) VALUES (?,?,?,?,?)",
            (str(from_id) if from_id else None,
             str(to_id) if to_id else None,
             int(amount), reason, _now_iso()),
        )

    def credit(self, user_id, amount, reason, from_id=None) -> int:
        """Crédite (ou débite si ``amount`` < 0) un solde. Renvoie le nouveau solde.

        Un compte **gelé** ne gagne rien : le crédit est ignoré silencieusement (le
        gain est simplement perdu, pas mis en attente). Les ajustements de trésorerie
        passent par ``force=True`` via :meth:`adjust`.
        """
        amount = int(amount)
        if self.is_frozen(user_id):
            return self.balance(user_id)
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO balances(user_id, amount) VALUES (?, ?) "
                "ON CONFLICT(user_id) DO UPDATE SET amount = amount + excluded.amount",
                (str(user_id), amount),
            )
            self._log_tx(from_id, user_id, amount, reason)
            return self.balance(user_id)

    def spend(self, user_id, amount, reason) -> int:
        """Débite ``amount`` (> 0) si le solde suffit, atomiquement. Renvoie le solde restant.

        Lève :class:`ValueError` si le solde est insuffisant.
        """
        amount = int(amount)
        if amount <= 0:
            raise ValueError("montant invalide")
        if self.is_frozen(user_id):
            raise ValueError("compte gelé")
        with self._lock, self._conn:
            row = self._conn.execute(
                "SELECT amount FROM balances WHERE user_id = ?", (str(user_id),)
            ).fetchone()
            bal = int(row["amount"]) if row else 0
            if bal < amount:
                raise ValueError("solde insuffisant")
            self._conn.execute(
                "UPDATE balances SET amount = amount - ? WHERE user_id = ?",
                (amount, str(user_id)),
            )
            self._log_tx(user_id, None, -amount, reason)
            return bal - amount

    def transfer(self, from_id, to_id, amount, reason):
        """Transfère ``amount`` de ``from_id`` vers ``to_id``, atomiquement."""
        amount = int(amount)
        if amount <= 0:
            raise ValueError("montant invalide")
        if self.is_frozen(from_id) or self.is_frozen(to_id):
            raise ValueError("compte gelé")
        with self._lock, self._conn:
            row = self._conn.execute(
                "SELECT amount FROM balances WHERE user_id = ?", (str(from_id),)
            ).fetchone()
            bal = int(row["amount"]) if row else 0
            if bal < amount:
                raise ValueError("solde insuffisant")
            self._conn.execute(
                "UPDATE balances SET amount = amount - ? WHERE user_id = ?",
                (amount, str(from_id)),
            )
            self._conn.execute(
                "INSERT INTO balances(user_id, amount) VALUES (?, ?) "
                "ON CONFLICT(user_id) DO UPDATE SET amount = amount + excluded.amount",
                (str(to_id), amount),
            )
            self._log_tx(from_id, to_id, amount, reason)

    # --- Inventaires ---
    def add_item(self, user_id, item_id, qty=1):
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO inventories(user_id, item_id, qty, acquired_ts) VALUES (?,?,?,?) "
                "ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + excluded.qty",
                (str(user_id), str(item_id), int(qty), _now_iso()),
            )

    def inventory(self, user_id) -> list[sqlite3.Row]:
        return self._conn.execute(
            "SELECT item_id, qty FROM inventories WHERE user_id = ? AND qty > 0 ORDER BY acquired_ts",
            (str(user_id),),
        ).fetchall()

    def has_item(self, user_id, item_id) -> bool:
        row = self._conn.execute(
            "SELECT qty FROM inventories WHERE user_id = ? AND item_id = ?",
            (str(user_id), str(item_id)),
        ).fetchone()
        return bool(row and int(row["qty"]) > 0)

    # --- Classement ---
    def leaderboard(self, limit=10) -> list[sqlite3.Row]:
        return self._conn.execute(
            "SELECT user_id, amount FROM balances WHERE amount > 0 ORDER BY amount DESC LIMIT ?",
            (int(limit),),
        ).fetchall()

    # --- Cooldowns persistants (daily…) ---
    def get_cooldown(self, user_id, kind) -> Optional[datetime]:
        row = self._conn.execute(
            "SELECT last_ts FROM cooldowns WHERE user_id = ? AND kind = ?",
            (str(user_id), kind),
        ).fetchone()
        if not row:
            return None
        try:
            return datetime.fromisoformat(row["last_ts"])
        except ValueError:
            return None

    def set_cooldown(self, user_id, kind, when: datetime):
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO cooldowns(user_id, kind, last_ts) VALUES (?,?,?) "
                "ON CONFLICT(user_id, kind) DO UPDATE SET last_ts = excluded.last_ts",
                (str(user_id), kind, when.isoformat()),
            )

    # --- Gel de compte (anti-triche) ---
    def is_frozen(self, user_id) -> bool:
        row = self._conn.execute(
            "SELECT frozen FROM account_flags WHERE user_id = ?", (str(user_id),)
        ).fetchone()
        return bool(row and int(row["frozen"]))

    def set_frozen(self, user_id, frozen: bool, note: str = "", by: str = "") -> bool:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO account_flags(user_id, frozen, note, ts, by_who) VALUES (?,?,?,?,?) "
                "ON CONFLICT(user_id) DO UPDATE SET frozen = excluded.frozen, "
                "note = excluded.note, ts = excluded.ts, by_who = excluded.by_who",
                (str(user_id), 1 if frozen else 0, note, _now_iso(), by),
            )
        return frozen

    def frozen_accounts(self) -> list[sqlite3.Row]:
        return self._conn.execute(
            "SELECT user_id, note, ts, by_who FROM account_flags WHERE frozen = 1 ORDER BY ts DESC"
        ).fetchall()

    # --- Trésorerie : lecture seule, tout est mesuré, rien n'est estimé ---
    def money_supply(self) -> dict:
        row = self._conn.execute(
            "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS holders, "
            "COALESCE(MAX(amount), 0) AS max FROM balances WHERE amount > 0"
        ).fetchone()
        total, holders = int(row["total"]), int(row["holders"])
        median = 0
        if holders:
            mid = self._conn.execute(
                "SELECT amount FROM balances WHERE amount > 0 ORDER BY amount "
                "LIMIT 1 OFFSET ?", (holders // 2,),
            ).fetchone()
            median = int(mid["amount"]) if mid else 0
        return {
            "total": total,
            "porteurs": holders,
            "moyenne": round(total / holders, 1) if holders else 0,
            "mediane": median,
            "max": int(row["max"]),
        }

    def flows_since(self, since: datetime) -> dict:
        """Entrées (création de monnaie) et sorties (dépenses) par source, depuis ``since``.

        La source est le préfixe de ``reason`` (``gain:message`` → ``gain``) — les
        crédits/débits d'admin et d'événements sont donc isolés d'un coup d'œil.
        """
        rows = self._conn.execute(
            "SELECT reason, amount FROM transactions WHERE ts >= ?", (since.isoformat(),)
        ).fetchall()
        entrees: dict[str, int] = {}
        sorties: dict[str, int] = {}
        for r in rows:
            reason = r["reason"] or "inconnu"
            amount = int(r["amount"])
            bucket = entrees if amount > 0 else sorties
            bucket[reason] = bucket.get(reason, 0) + abs(amount)
        return {
            "entrees": dict(sorted(entrees.items(), key=lambda kv: -kv[1])),
            "sorties": dict(sorted(sorties.items(), key=lambda kv: -kv[1])),
            "total_entrees": sum(entrees.values()),
            "total_sorties": sum(sorties.values()),
        }

    def top_earners(self, since: datetime, limit=10) -> list[dict]:
        rows = self._conn.execute(
            "SELECT to_id AS user_id, SUM(amount) AS gagne, COUNT(*) AS n "
            "FROM transactions WHERE ts >= ? AND amount > 0 AND to_id IS NOT NULL "
            "GROUP BY to_id ORDER BY gagne DESC LIMIT ?",
            (since.isoformat(), int(limit)),
        ).fetchall()
        return [{"user_id": r["user_id"], "gagne": int(r["gagne"]), "mouvements": int(r["n"])}
                for r in rows]

    def anomalies(self, since: datetime, factor: float = 10.0, floor: int = 50) -> list[dict]:
        """Comptes dont les gains sur la période dépassent ``factor`` × la médiane.

        Ce n'est pas un verdict : c'est un écart mesuré, à regarder. ``floor`` évite
        de signaler tout le monde quand la médiane est proche de zéro.
        """
        earners = self.top_earners(since, limit=200)
        if len(earners) < 4:
            return []
        gains = sorted(e["gagne"] for e in earners)
        median = gains[len(gains) // 2] or 1
        seuil = max(median * factor, floor)
        return [
            {**e, "mediane": median, "seuil": int(seuil), "ratio": round(e["gagne"] / median, 1)}
            for e in earners if e["gagne"] >= seuil
        ]

    def transactions(self, limit=60, user_id=None, before_id=None) -> list[dict]:
        sql = "SELECT * FROM transactions WHERE 1=1"
        args: list = []
        if user_id:
            sql += " AND (to_id = ? OR from_id = ?)"
            args.extend([str(user_id), str(user_id)])
        if before_id:
            sql += " AND id < ?"
            args.append(int(before_id))
        sql += " ORDER BY id DESC LIMIT ?"
        args.append(min(int(limit), 300))
        rows = self._conn.execute(sql, args).fetchall()
        return [{"id": int(r["id"]), "from_id": r["from_id"], "to_id": r["to_id"],
                 "amount": int(r["amount"]), "reason": r["reason"] or "", "ts": r["ts"]}
                for r in rows]

    def revert(self, tx_id: int, by: str) -> dict:
        """Annule une transaction par **compensation** (on n'efface jamais une ligne).

        Le solde peut devenir négatif si les écus ont déjà été dépensés : c'est voulu,
        ça rend la dette visible plutôt que de la faire disparaître.
        """
        row = self._conn.execute(
            "SELECT * FROM transactions WHERE id = ?", (int(tx_id),)
        ).fetchone()
        if row is None:
            raise ValueError("transaction introuvable")
        if (row["reason"] or "").startswith("annulation:"):
            raise ValueError("cette ligne est déjà une annulation")
        amount, target = int(row["amount"]), row["to_id"] or row["from_id"]
        if not target:
            raise ValueError("transaction sans destinataire")
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO balances(user_id, amount) VALUES (?, ?) "
                "ON CONFLICT(user_id) DO UPDATE SET amount = amount + excluded.amount",
                (str(target), -amount),
            )
            self._log_tx(None, target, -amount, f"annulation:{tx_id} par {by}")
        return {"user_id": target, "montant": -amount, "solde": self.balance(target)}

    def adjust(self, user_id, amount: int, reason: str) -> int:
        """Ajustement de trésorerie : passe outre le gel (sinon on ne pourrait pas
        corriger le solde d'un compte qu'on vient de geler)."""
        amount = int(amount)
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO balances(user_id, amount) VALUES (?, ?) "
                "ON CONFLICT(user_id) DO UPDATE SET amount = amount + excluded.amount",
                (str(user_id), amount),
            )
            self._log_tx(None, user_id, amount, reason)
        return self.balance(user_id)


# ───────────────────────── Helpers config / format ─────────────────────────
def _int(v, default=0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _cfg(bot) -> dict:
    return bot.store.get("economie")


def format_amount(cfg: dict, amount: int) -> str:
    """Rend un montant avec la devise configurée (ex. « 1 500 🪙 » ou « 5 Écus »)."""
    d = cfg.get("devise") or {}
    sym = (d.get("symbole") or "").strip()
    n = f"{int(amount):,}".replace(",", " ")  # séparateur de milliers = espace fine
    if sym:
        return f"{sym} {n}" if d.get("symbole_avant") else f"{n} {sym}"
    if abs(int(amount)) == 1:
        label = (d.get("nom_singulier") or d.get("nom") or "point").strip()
    else:
        label = (d.get("nom") or "points").strip()
    return f"{n} {label}"


def _find_item(cfg: dict, item_id: str) -> Optional[dict]:
    for it in cfg.get("boutique") or []:
        if str(it.get("id")) == str(item_id):
            return it
    return None


def _stock_illimite(item: dict) -> bool:
    s = item.get("stock")
    return s is None or _int(s, -1) < 0


# ───────────────────────── Garde « espace RP » (catégorie + rôle de race) ─────────────────────────
def _has_race_role(member) -> bool:
    """Rôle de race = baptisé (voir bapteme.py). Les rôles de race sont la même liste que
    celle utilisée pour restreindre l'accès au jeu MYRHAVEN — une seule source de vérité."""
    if not isinstance(member, discord.Member):
        return False
    race_ids = bapteme_data.all_race_role_ids()
    return any(r.id in race_ids for r in member.roles)


def _in_rp_category(bot, channel) -> bool:
    """Le salon (texte ou vocal) appartient-il à la catégorie RP configurée ? Pas de
    catégorie réglée au dashboard = économie inactive partout, par sécurité (pas de
    fallback « partout »)."""
    cat_id = _cfg(bot).get("category_id")
    if not cat_id or channel is None:
        return False
    return getattr(channel, "category_id", None) == _int(cat_id, 0)


def _resolve_member(bot, member_id):
    """Résout un ID en `discord.Member` (handlers déclenchés hors contexte Discord direct,
    ex. baptême/rôle-jeu qui ne reçoivent qu'un ID)."""
    guild = bot.get_guild(config.GUILD_ID) if config.GUILD_ID else None
    return guild.get_member(int(member_id)) if guild else None


async def _require_rp(interaction: discord.Interaction) -> bool:
    """Garde commune aux commandes membre : salon dans la catégorie RP + rôle de race.
    Répond et renvoie False si bloqué. Pas utilisée par le groupe /eco (outil admin)."""
    bot = interaction.client
    if not _in_rp_category(bot, interaction.channel):
        await interaction.response.send_message(
            "❌ Cette commande n'est utilisable que dans l'espace RP.", ephemeral=True
        )
        return False
    if not _has_race_role(interaction.user):
        await interaction.response.send_message(
            "❌ Il te faut un rôle de race (fais-toi baptiser) pour accéder à l'économie.",
            ephemeral=True,
        )
        return False
    return True


# ───────────────────────── Moteur de gains ─────────────────────────
# Cooldown anti-spam des gains « message » : en mémoire (repart à zéro au restart,
# acceptable pour de l'anti-spam) — évite un accès disque à chaque message.
_msg_cooldown: dict[int, float] = {}


async def crediter(bot, user_id, amount, reason="système") -> int:
    """Point d'entrée public : crédite un joueur (récompenses, quêtes…). Renvoie le solde."""
    return bot.economy.credit(user_id, amount, reason)


async def on_message(bot, message: discord.Message):
    """Crédite l'auteur d'un message si la source ``message`` est active (avec cooldown),
    dans l'espace RP et pour un membre ayant un rôle de race."""
    gains = (_cfg(bot).get("gains") or {}).get("message") or {}
    if not gains.get("enabled"):
        return
    if not _in_rp_category(bot, message.channel) or not _has_race_role(message.author):
        return
    montant = _int(gains.get("montant"), 0)
    if montant <= 0:
        return
    cooldown = _int(gains.get("cooldown"), 60)
    now = time.monotonic()
    last = _msg_cooldown.get(message.author.id, 0.0)
    if now - last < cooldown:
        return
    _msg_cooldown[message.author.id] = now
    try:
        bot.economy.credit(message.author.id, montant, "gain:message")
    except Exception as exc:  # noqa: BLE001
        log.error("gain message échoué : %s", exc)


# ───────────────────────── Autres déclencheurs Discord ─────────────────────────
# Cooldown anti-spam du gain « réaction » — même doctrine que _msg_cooldown (en mémoire).
_reaction_cooldown: dict[int, float] = {}
# Minutes accumulées en vocal depuis le dernier crédit — en mémoire (repart à zéro au
# restart, acceptable : au pire quelques minutes de progression perdues).
_voice_minutes: dict[int, int] = {}


def _gain_cfg(bot, key: str) -> dict:
    return (_cfg(bot).get("gains") or {}).get(key) or {}


async def _credit_once(bot, user_id, kind: str, montant: int, reason: str) -> bool:
    """Crédite une seule fois, jamais rejoué (même mécanisme que l'anti-rejeu de
    `crediter_evenement`) — renvoie True si crédité, False si déjà accordé."""
    if bot.economy.get_cooldown(user_id, kind) is not None:
        return False
    bot.economy.credit(user_id, montant, reason)
    bot.economy.set_cooldown(user_id, kind, datetime.now(timezone.utc))
    return True


async def on_reaction_add(bot, payload) -> None:
    """Gain « réaction » (générique, cooldown anti-spam) + bonus seuil pour l'auteur du
    message réagi. Appelé depuis `on_raw_reaction_add` (intent ``reactions``). Les deux
    exigent le salon dans l'espace RP ; le rôle de race est vérifié séparément pour
    chaque bénéficiaire (le réacteur, puis l'auteur du message pour le bonus seuil)."""
    if payload.guild_id is None or (config.GUILD_ID and payload.guild_id != config.GUILD_ID):
        return
    member = payload.member
    if member is None or member.bot:
        return
    channel = bot.get_channel(payload.channel_id)
    if not _in_rp_category(bot, channel):
        return

    reaction_cfg = _gain_cfg(bot, "reaction")
    if reaction_cfg.get("enabled") and _has_race_role(member):
        montant = _int(reaction_cfg.get("montant"), 0)
        cooldown = _int(reaction_cfg.get("cooldown"), 60)
        now = time.monotonic()
        last = _reaction_cooldown.get(member.id, 0.0)
        if montant > 0 and now - last >= cooldown:
            _reaction_cooldown[member.id] = now
            try:
                bot.economy.credit(member.id, montant, "gain:reaction")
            except Exception as exc:  # noqa: BLE001
                log.error("gain réaction échoué : %s", exc)

    seuil_cfg = _gain_cfg(bot, "seuil_reactions")
    if seuil_cfg.get("enabled"):
        montant = _int(seuil_cfg.get("montant"), 0)
        seuil = _int(seuil_cfg.get("seuil"), 10)
        if montant <= 0 or seuil <= 0:
            return
        try:
            msg_channel = channel or await bot.fetch_channel(payload.channel_id)
            message = await msg_channel.fetch_message(payload.message_id)
        except (discord.NotFound, discord.Forbidden):
            return
        if message.author.bot or not _has_race_role(message.author):
            return
        total = sum(r.count for r in message.reactions)
        if total >= seuil:
            await _credit_once(bot, message.author.id, f"seuil:{message.id}", montant, "gain:seuil_reactions")


async def on_arrival(bot, member) -> None:
    """Bonus de bienvenue — une seule fois par compte, même en cas de départ puis retour.
    Exige un rôle de race comme tout le reste de l'économie : en pratique ne se déclenchera
    plus tant qu'un nouvel arrivant n'est pas encore baptisé (délibéré, pas de dérogation)."""
    cfg = _gain_cfg(bot, "bienvenue")
    montant = _int(cfg.get("montant"), 0)
    if cfg.get("enabled") and montant > 0 and _has_race_role(member):
        await _credit_once(bot, member.id, "bienvenue", montant, "gain:bienvenue")


async def on_bapteme(bot, member_id) -> None:
    """Bonus de baptême complété — une seule fois par compte (un re-baptême ne recrédite pas).
    Le rôle de race est déjà posé avant cet appel (voir `_finalize` dans bapteme.py), donc la
    garde passe naturellement."""
    cfg = _gain_cfg(bot, "bapteme")
    montant = _int(cfg.get("montant"), 0)
    member = _resolve_member(bot, member_id)
    if cfg.get("enabled") and montant > 0 and member and _has_race_role(member):
        await _credit_once(bot, member_id, "bapteme", montant, "gain:bapteme")


async def on_role_jeu_added(bot, member_id) -> None:
    """Bonus du premier rôle-jeu choisi — une seule fois, malgré le toggle ajout/retrait."""
    cfg = _gain_cfg(bot, "role_jeu")
    montant = _int(cfg.get("montant"), 0)
    member = _resolve_member(bot, member_id)
    if cfg.get("enabled") and montant > 0 and member and _has_race_role(member):
        await _credit_once(bot, member_id, "role_jeu", montant, "gain:role_jeu")


async def on_boost(bot, member) -> None:
    """Bonus de boost serveur — crédité à chaque transition « ne boostait pas → boost »."""
    cfg = _gain_cfg(bot, "boost")
    montant = _int(cfg.get("montant"), 0)
    if cfg.get("enabled") and montant > 0 and _has_race_role(member):
        bot.economy.credit(member.id, montant, "gain:boost")


async def on_ticket_resolved(bot, claimer_id) -> None:
    """Bonus au membre staff qui a pris en charge (claim) le ticket avant sa fermeture.
    Soumis à la même garde « rôle de race » que le reste (choix explicite, sans exception) —
    un membre staff sans rôle de race ne touchera pas ce bonus."""
    cfg = _gain_cfg(bot, "ticket_resolu")
    montant = _int(cfg.get("montant"), 0)
    member = _resolve_member(bot, claimer_id)
    if cfg.get("enabled") and montant > 0 and member and _has_race_role(member):
        bot.economy.credit(claimer_id, montant, "gain:ticket_resolu")


# ───────────────────────── Tick périodique (vocal + ancienneté) ─────────────────────────
async def _tick(bot) -> None:
    gains = _cfg(bot).get("gains") or {}
    guild = bot.get_guild(config.GUILD_ID) if config.GUILD_ID else None
    if guild is None:
        return

    vocal_cfg = gains.get("vocal") or {}
    if vocal_cfg.get("enabled"):
        montant = _int(vocal_cfg.get("montant"), 0)
        minutes_needed = max(1, _int(vocal_cfg.get("minutes"), 30))
        afk = guild.afk_channel
        for channel in guild.voice_channels:
            if afk and channel.id == afk.id:
                continue
            if not _in_rp_category(bot, channel):
                continue
            for member in channel.members:
                if member.bot or not _has_race_role(member):
                    continue
                total = _voice_minutes.get(member.id, 0) + 1
                if total >= minutes_needed:
                    total -= minutes_needed
                    if montant > 0:
                        try:
                            bot.economy.credit(member.id, montant, "gain:vocal")
                        except Exception as exc:  # noqa: BLE001
                            log.error("gain vocal échoué : %s", exc)
                _voice_minutes[member.id] = total

    anciennete_cfg = gains.get("anciennete") or {}
    if anciennete_cfg.get("enabled"):
        montant = _int(anciennete_cfg.get("montant"), 0)
        paliers = [j for j in (anciennete_cfg.get("paliers_jours") or []) if _int(j, 0) > 0]
        if montant > 0 and paliers:
            if not guild.chunked:
                await guild.chunk()
            now = datetime.now(timezone.utc)
            for member in guild.members:
                if member.bot or not member.joined_at or not _has_race_role(member):
                    continue
                age_days = (now - member.joined_at).days
                for jours in paliers:
                    jours = _int(jours, 0)
                    if age_days >= jours:
                        await _credit_once(
                            bot, member.id, f"anciennete:{jours}", montant, f"gain:anciennete:{jours}"
                        )


async def _scheduler(bot) -> None:
    await bot.wait_until_ready()
    while not bot.is_closed():
        try:
            await _tick(bot)
        except Exception as exc:  # noqa: BLE001
            log.error("scheduler économie : %s", exc)
        await asyncio.sleep(60)


def start_scheduler(bot) -> None:
    """Démarre le tick vocal/ancienneté — à appeler depuis setup_hook, après install()."""
    bot.loop.create_task(_scheduler(bot))


class PurchaseError(Exception):
    """Erreur métier d'achat ; ``code`` ∈ {introuvable, stock, solde} pour que chaque
    appelant (Discord, API HTTP) compose son propre message."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _execute_purchase(bot, cfg: dict, user_id, item_id: str) -> tuple[dict, int]:
    """Débite, livre (inventaire + décrément stock), renvoie ``(item, solde_restant)``.

    Ne gère pas l'attribution de rôle Discord (pas de contexte ``guild`` ici) : à
    l'appelant de le faire si ``item['type'] == 'role'``. Partagée entre la commande
    Discord ``/boutique`` et l'action HTTP ``acheter`` (ex. achats depuis le jeu).
    """
    item = _find_item(cfg, item_id)
    if not item or not item.get("enabled"):
        raise PurchaseError("introuvable")
    if not _stock_illimite(item) and _int(item.get("stock"), 0) <= 0:
        raise PurchaseError("stock")
    prix = _int(item.get("prix"), 0)
    try:
        reste = bot.economy.spend(user_id, prix, f"achat:{item_id}")
    except ValueError:
        raise PurchaseError("solde")
    bot.economy.add_item(user_id, item_id, 1)
    if not _stock_illimite(item):
        item["stock"] = max(0, _int(item.get("stock"), 0) - 1)
        bot.store.set("economie", {"boutique": cfg.get("boutique")})
    return item, reste


# ───────────────────────── Boutique interactive ─────────────────────────
def _shop_embed(cfg: dict) -> discord.Embed:
    embed = discord.Embed(
        title="🛒 Boutique",
        description="Choisis un article dans le menu ci-dessous pour l'acheter.",
        color=0xC9A44A,
    )
    items = [i for i in (cfg.get("boutique") or []) if i.get("enabled")]
    if not items:
        embed.description = "La boutique est vide pour le moment."
        return embed
    for it in items[:25]:
        stock = "∞" if _stock_illimite(it) else str(_int(it.get("stock"), 0))
        kind = "🎭 Rôle" if it.get("type") == "role" else "📦 Objet"
        desc = (it.get("description") or "").strip()
        embed.add_field(
            name=f"{it.get('nom', 'Article')} — {format_amount(cfg, _int(it.get('prix'), 0))}",
            value=f"{kind} · stock : {stock}" + (f"\n{desc}" if desc else ""),
            inline=False,
        )
    return embed


class _ShopSelect(discord.ui.Select):
    def __init__(self, cfg: dict):
        items = [i for i in (cfg.get("boutique") or []) if i.get("enabled")][:25]
        options = [
            discord.SelectOption(
                label=(it.get("nom") or "Article")[:100],
                value=str(it.get("id")),
                description=f"{format_amount(cfg, _int(it.get('prix'), 0))}"[:100],
            )
            for it in items
        ]
        super().__init__(
            placeholder="Acheter un article…",
            options=options or [discord.SelectOption(label="Boutique vide", value="_none")],
            disabled=not options,
        )

    async def callback(self, interaction: discord.Interaction):
        await _purchase(interaction, self.values[0])


class ShopView(discord.ui.View):
    def __init__(self, cfg: dict):
        super().__init__(timeout=120)
        self.add_item(_ShopSelect(cfg))


async def _purchase(interaction: discord.Interaction, item_id: str):
    bot = interaction.client
    cfg = _cfg(bot)
    item = _find_item(cfg, item_id)
    if not item or not item.get("enabled"):
        await interaction.response.send_message("❌ Article introuvable.", ephemeral=True)
        return

    # Rôle déjà possédé ?
    if item.get("type") == "role" and item.get("role_id"):
        role = interaction.guild.get_role(_int(item.get("role_id"))) if interaction.guild else None
        if role and role in getattr(interaction.user, "roles", []):
            await interaction.response.send_message("❌ Tu possèdes déjà ce rôle.", ephemeral=True)
            return

    try:
        item, reste = _execute_purchase(bot, cfg, interaction.user.id, item_id)
    except PurchaseError as exc:
        if exc.code == "stock":
            await interaction.response.send_message("❌ Article en rupture de stock.", ephemeral=True)
        elif exc.code == "solde":
            bal = bot.economy.balance(interaction.user.id)
            await interaction.response.send_message(
                f"❌ Solde insuffisant : il te faut **{format_amount(cfg, _int(item.get('prix'), 0))}** "
                f"(tu as {format_amount(cfg, bal)}).",
                ephemeral=True,
            )
        else:
            await interaction.response.send_message("❌ Article introuvable.", ephemeral=True)
        return

    # Rôle éventuel (attribution possible seulement depuis ce contexte Discord).
    if item.get("type") == "role" and item.get("role_id") and interaction.guild:
        role = interaction.guild.get_role(_int(item.get("role_id")))
        if role:
            try:
                await interaction.user.add_roles(role, reason="Achat boutique")
            except discord.Forbidden:
                log.error("rôle %s non attribuable (permissions)", role.id)

    await interaction.response.send_message(
        f"✅ Tu as acheté **{item.get('nom', 'Article')}** pour "
        f"**{format_amount(cfg, _int(item.get('prix'), 0))}**. Il te reste **{format_amount(cfg, reste)}**.",
        ephemeral=True,
    )


# ───────────────────────── Commandes slash ─────────────────────────
def _cooldown_left(last: Optional[datetime], seconds: int) -> int:
    """Secondes restantes avant réutilisation (0 si dispo)."""
    if not last:
        return 0
    elapsed = (datetime.now(timezone.utc) - last).total_seconds()
    return max(0, int(seconds - elapsed))


def _human_duration(seconds: int) -> str:
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    parts = []
    if h:
        parts.append(f"{h} h")
    if m:
        parts.append(f"{m} min")
    if s and not h:
        parts.append(f"{s} s")
    return " ".join(parts) or "quelques secondes"


def setup(tree: app_commands.CommandTree, guild: Optional[discord.Object]) -> None:
    """Enregistre les commandes du module sur l'arbre (portée serveur si ``guild``)."""

    @tree.command(name="solde", description="Afficher ton solde (ou celui d'un membre).", guild=guild)
    @app_commands.describe(membre="Membre dont voir le solde (par défaut : toi)")
    async def solde(interaction: discord.Interaction, membre: Optional[discord.Member] = None):
        if not await _require_rp(interaction):
            return
        bot = interaction.client
        cfg = _cfg(bot)
        cible = membre or interaction.user
        bal = bot.economy.balance(cible.id)
        who = "Tu possèdes" if cible.id == interaction.user.id else f"{cible.display_name} possède"
        await interaction.response.send_message(
            f"💰 {who} **{format_amount(cfg, bal)}**.", ephemeral=True
        )

    @tree.command(name="donner", description="Donner de la monnaie à un membre.", guild=guild)
    @app_commands.describe(membre="Destinataire", montant="Montant à donner")
    async def donner(interaction: discord.Interaction, membre: discord.Member, montant: int):
        if not await _require_rp(interaction):
            return
        bot = interaction.client
        cfg = _cfg(bot)
        if membre.bot or membre.id == interaction.user.id:
            await interaction.response.send_message(
                "❌ Destinataire invalide.", ephemeral=True
            )
            return
        if not _has_race_role(membre):
            await interaction.response.send_message(
                "❌ Ce membre n'a pas de rôle de race.", ephemeral=True
            )
            return
        if montant <= 0:
            await interaction.response.send_message("❌ Montant invalide.", ephemeral=True)
            return
        try:
            bot.economy.transfer(interaction.user.id, membre.id, montant, "don")
        except ValueError:
            await interaction.response.send_message("❌ Solde insuffisant.", ephemeral=True)
            return
        await interaction.response.send_message(
            f"🤝 {interaction.user.mention} a donné **{format_amount(cfg, montant)}** "
            f"à {membre.mention}."
        )

    @tree.command(name="daily", description="Récupérer ta récompense quotidienne.", guild=guild)
    async def daily(interaction: discord.Interaction):
        if not await _require_rp(interaction):
            return
        bot = interaction.client
        cfg = _cfg(bot)
        gains = (cfg.get("gains") or {}).get("daily") or {}
        if not gains.get("enabled"):
            await interaction.response.send_message(
                "❌ La récompense quotidienne est désactivée.", ephemeral=True
            )
            return
        montant = _int(gains.get("montant"), 0)
        cooldown = _int(gains.get("cooldown"), 86400)
        last = bot.economy.get_cooldown(interaction.user.id, "daily")
        reste = _cooldown_left(last, cooldown)
        if reste > 0:
            await interaction.response.send_message(
                f"⏳ Déjà récupérée. Reviens dans **{_human_duration(reste)}**.", ephemeral=True
            )
            return
        new_bal = bot.economy.credit(interaction.user.id, montant, "gain:daily")
        bot.economy.set_cooldown(interaction.user.id, "daily", datetime.now(timezone.utc))
        await interaction.response.send_message(
            f"🎁 Tu as reçu **{format_amount(cfg, montant)}** ! "
            f"Nouveau solde : **{format_amount(cfg, new_bal)}**.", ephemeral=True
        )

    @tree.command(
        name="progression",
        description="Voir ta progression vers les prochains gains passifs (vocal, ancienneté).",
        guild=guild,
    )
    async def progression(interaction: discord.Interaction):
        if not await _require_rp(interaction):
            return
        bot = interaction.client
        gains = _cfg(bot).get("gains") or {}
        member = interaction.user
        lines: list[str] = []

        vocal_cfg = gains.get("vocal") or {}
        if vocal_cfg.get("enabled"):
            minutes_needed = max(1, _int(vocal_cfg.get("minutes"), 30))
            current = _voice_minutes.get(member.id, 0)
            reste = max(0, minutes_needed - current)
            lines.append(f"🎙️ Vocal : {current}/{minutes_needed} min — encore **{reste} min** avant le prochain gain.")

        anciennete_cfg = gains.get("anciennete") or {}
        paliers = sorted({_int(j, 0) for j in (anciennete_cfg.get("paliers_jours") or []) if _int(j, 0) > 0})
        if anciennete_cfg.get("enabled") and paliers and isinstance(member, discord.Member) and member.joined_at:
            age_days = (datetime.now(timezone.utc) - member.joined_at).days
            prochain = next((j for j in paliers if age_days < j), None)
            if prochain is not None:
                lines.append(f"📆 Ancienneté : {age_days} j — prochain palier dans **{prochain - age_days} j** ({prochain} j).")
            else:
                lines.append(f"📆 Ancienneté : {age_days} j — tous les paliers actuels sont atteints.")

        if not lines:
            lines.append("Aucune source de gain à progression n'est activée pour l'instant.")

        embed = discord.Embed(title="📈 Ta progression", description="\n".join(lines), color=0xC9A44A)
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @tree.command(name="boutique", description="Ouvrir la boutique.", guild=guild)
    async def boutique(interaction: discord.Interaction):
        if not await _require_rp(interaction):
            return
        cfg = _cfg(interaction.client)
        await interaction.response.send_message(
            embed=_shop_embed(cfg), view=ShopView(cfg), ephemeral=True
        )

    @tree.command(name="inventaire", description="Afficher tes articles achetés.", guild=guild)
    async def inventaire(interaction: discord.Interaction):
        if not await _require_rp(interaction):
            return
        bot = interaction.client
        cfg = _cfg(bot)
        rows = bot.economy.inventory(interaction.user.id)
        if not rows:
            await interaction.response.send_message(
                "🎒 Ton inventaire est vide.", ephemeral=True
            )
            return
        catalog = {str(i.get("id")): i for i in (cfg.get("boutique") or [])}
        lines = [
            f"• **{catalog.get(r['item_id'], {}).get('nom', r['item_id'])}** × {r['qty']}"
            for r in rows
        ]
        embed = discord.Embed(
            title="🎒 Ton inventaire", description="\n".join(lines), color=0xC9A44A
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @tree.command(name="classement", description="Top des plus riches.", guild=guild)
    async def classement(interaction: discord.Interaction):
        if not await _require_rp(interaction):
            return
        bot = interaction.client
        cfg = _cfg(bot)
        rows = bot.economy.leaderboard(10)
        if not rows:
            await interaction.response.send_message(
                "📊 Personne n'a encore de monnaie.", ephemeral=True
            )
            return
        medals = ["🥇", "🥈", "🥉"]
        lines = []
        for i, r in enumerate(rows):
            rank = medals[i] if i < 3 else f"**{i + 1}.**"
            member = interaction.guild.get_member(int(r["user_id"])) if interaction.guild else None
            name = member.display_name if member else f"Utilisateur {r['user_id']}"
            lines.append(f"{rank} {name} — {format_amount(cfg, r['amount'])}")
        embed = discord.Embed(
            title="📊 Classement", description="\n".join(lines), color=0xC9A44A
        )
        await interaction.response.send_message(embed=embed)

    # --- Administration ---
    eco = app_commands.Group(
        name="eco",
        description="Administration de l'économie (admins).",
        guild_only=True,
        default_permissions=discord.Permissions(administrator=True),
    )

    @eco.command(name="crediter", description="Créditer un membre.")
    @app_commands.describe(membre="Membre à créditer", montant="Montant", raison="Raison (optionnel)")
    async def eco_crediter(
        interaction: discord.Interaction, membre: discord.Member, montant: int,
        raison: Optional[str] = None,
    ):
        bot = interaction.client
        cfg = _cfg(bot)
        new_bal = bot.economy.credit(membre.id, montant, raison or "admin:crédit")
        await interaction.response.send_message(
            f"✅ {membre.mention} : {format_amount(cfg, montant)} "
            f"(solde : **{format_amount(cfg, new_bal)}**).", ephemeral=True
        )

    @eco.command(name="retirer", description="Retirer de la monnaie à un membre.")
    @app_commands.describe(membre="Membre", montant="Montant à retirer", raison="Raison (optionnel)")
    async def eco_retirer(
        interaction: discord.Interaction, membre: discord.Member, montant: int,
        raison: Optional[str] = None,
    ):
        if montant <= 0:
            await interaction.response.send_message("❌ Montant invalide.", ephemeral=True)
            return
        bot = interaction.client
        cfg = _cfg(bot)
        new_bal = bot.economy.credit(membre.id, -montant, raison or "admin:retrait")
        await interaction.response.send_message(
            f"✅ {membre.mention} : −{format_amount(cfg, montant)} "
            f"(solde : **{format_amount(cfg, new_bal)}**).", ephemeral=True
        )

    tree.add_command(eco, guild=guild)


def install(bot, guild: Optional[discord.Object]) -> None:
    """Crée la base et enregistre les commandes. Appelé depuis ``setup_hook`` du bot."""
    bot.economy = EconomyDB(DB_PATH)
    setup(bot.tree, guild)


# ───────────────────────── Actions dashboard ─────────────────────────
async def action_crediter(bot, payload) -> dict:
    user_id = payload.get("user_id")
    montant = _int(payload.get("montant"), 0)
    if not user_id or montant == 0:
        raise ValueError("user_id et montant requis")
    new_bal = bot.economy.credit(user_id, montant, payload.get("raison") or "dashboard")
    return {"ok": True, "balance": new_bal}


async def action_classement(bot, payload) -> dict:
    limit = _int(payload.get("limit"), 10)
    rows = bot.economy.leaderboard(limit)
    return {"ok": True, "classement": [dict(r) for r in rows]}


async def action_solde(bot, payload) -> dict:
    """Lecture de solde pour un système externe (ex. le jeu MYRHAVEN)."""
    user_id = payload.get("user_id")
    if not user_id:
        raise ValueError("user_id requis")
    return {"ok": True, "balance": bot.economy.balance(user_id)}


async def action_taverne(bot, payload) -> dict:
    """Carte de Brom dans la Taverne 3D : articles « objet » en vente marqués ``taverne``
    au dashboard, la devise pour l'affichage et, si ``user_id`` est fourni, le solde.
    L'achat reste ``acheter`` (prix résolu ici, jamais par l'appelant)."""
    cfg = _cfg(bot)
    carte = [
        {
            "id": str(it.get("id")),
            "nom": it.get("nom") or "",
            "description": it.get("description") or "",
            "prix": _int(it.get("prix"), 0),
            "epuise": not _stock_illimite(it) and _int(it.get("stock"), 0) <= 0,
        }
        for it in (cfg.get("boutique") or [])
        if it.get("enabled") and it.get("type") == "objet" and it.get("taverne")
    ]
    out = {"ok": True, "devise": cfg.get("devise") or {}, "carte": carte}
    user_id = payload.get("user_id")
    if user_id:
        out["balance"] = bot.economy.balance(user_id)
    return out


TOURNEES_MAX = 6  # tournées créditées par joueur et par jour (anti-AFK)


def _jour() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def action_visite_taverne(bot, payload) -> dict:
    """Première visite de la Taverne 3D dans la fenêtre ``cooldown`` (20 h par défaut) :
    crédite ``gains.taverne_visite``. Appelée par le jeu via le dashboard (session Discord)."""
    user_id = payload.get("user_id")
    if not user_id:
        raise ValueError("user_id requis")
    rule = (_cfg(bot).get("gains") or {}).get("taverne_visite") or {}
    if not rule.get("enabled") or _int(rule.get("montant"), 0) <= 0:
        return {"ok": False, "error": "inactif"}
    member = _resolve_member(bot, user_id)
    if not member or not _has_race_role(member):
        return {"ok": False, "error": "role_requis"}
    now = datetime.now(timezone.utc)
    last = bot.economy.get_cooldown(user_id, "taverne_visite")
    cd = max(3600, _int(rule.get("cooldown"), 72000))
    if last and (now - last).total_seconds() < cd:
        return {"ok": False, "error": "deja", "prochaine": int(cd - (now - last).total_seconds())}
    bot.economy.set_cooldown(user_id, "taverne_visite", now)
    montant = _int(rule.get("montant"), 0)
    bal = bot.economy.credit(user_id, montant, "taverne:visite")
    return {"ok": True, "montant": montant, "balance": bal}


async def action_tournee(bot, payload) -> dict:
    """Tournée de Brom : appelée par le hub temps réel (serveur de confiance, jeton API) avec la
    liste des joueurs présents ET actifs. Crédite ``gains.taverne_tournee`` à chacun, au plus
    ``TOURNEES_MAX`` fois par jour et par joueur (créneaux ``tournee1..N`` datés du jour)."""
    ids = [str(u) for u in (payload.get("user_ids") or [])][:100]
    rule = (_cfg(bot).get("gains") or {}).get("taverne_tournee") or {}
    montant = _int(rule.get("montant"), 0)
    if not rule.get("enabled") or montant <= 0:
        return {"ok": True, "montant": 0, "credites": []}
    jour, credites = _jour(), []
    for uid in dict.fromkeys(ids):
        member = _resolve_member(bot, uid)
        if not member or not _has_race_role(member):
            continue
        slot = None
        for k in range(1, TOURNEES_MAX + 1):
            last = bot.economy.get_cooldown(uid, f"tournee{k}")
            if not last or last.strftime("%Y-%m-%d") != jour:
                slot = k
                break
        if slot is None:
            continue
        bot.economy.set_cooldown(uid, f"tournee{slot}", datetime.now(timezone.utc))
        bot.economy.credit(uid, montant, "taverne:tournee")
        credites.append(uid)
    return {"ok": True, "montant": montant, "credites": credites}


async def action_crediter_evenement(bot, payload) -> dict:
    """Crédite une récompense d'``evenements`` — une seule fois par joueur et par
    ``event_id`` (anti-rejeu via le même mécanisme de cooldown que ``/daily``), pour
    qu'un système externe (le jeu) ne puisse jamais faire farmer la monnaie en
    rejouant la requête."""
    user_id = payload.get("user_id")
    event_id = str(payload.get("event_id") or "")
    if not user_id or not event_id:
        raise ValueError("user_id et event_id requis")
    member = _resolve_member(bot, user_id)
    if not member or not _has_race_role(member):
        return {"ok": False, "error": "role_requis"}
    cfg = _cfg(bot)
    evt = (cfg.get("evenements") or {}).get(event_id)
    if not evt or not evt.get("enabled"):
        return {"ok": False, "error": "evenement_inconnu"}
    if bot.economy.get_cooldown(user_id, f"evt:{event_id}") is not None:
        return {"ok": False, "error": "deja_recompense", "balance": bot.economy.balance(user_id)}
    montant = _int(evt.get("montant"), 0)
    new_bal = bot.economy.credit(user_id, montant, f"evenement:{event_id}")
    bot.economy.set_cooldown(user_id, f"evt:{event_id}", datetime.now(timezone.utc))
    return {"ok": True, "balance": new_bal, "montant": montant}


async def action_acheter(bot, payload) -> dict:
    """Achat boutique déclenché hors Discord (ex. depuis le jeu). Le prix vient
    toujours du catalogue du bot, jamais de l'appelant. Les articles de type
    ``role`` sont refusés ici (pas de contexte serveur/membre en HTTP) — à acheter
    sur Discord."""
    user_id = payload.get("user_id")
    item_id = str(payload.get("item_id") or "")
    if not user_id or not item_id:
        raise ValueError("user_id et item_id requis")
    member = _resolve_member(bot, user_id)
    if not member or not _has_race_role(member):
        return {"ok": False, "error": "role_requis"}
    cfg = _cfg(bot)
    item = _find_item(cfg, item_id)
    if item and item.get("type") == "role":
        return {"ok": False, "error": "type_non_supporte"}
    try:
        item, reste = _execute_purchase(bot, cfg, user_id, item_id)
    except PurchaseError as exc:
        return {"ok": False, "error": exc.code}
    return {"ok": True, "balance": reste, "item": {"id": item.get("id"), "nom": item.get("nom")}}


# ───────────────────────── Trésorerie (dashboard) ─────────────────────────
def _tag(bot, user_id) -> str:
    member = _resolve_member(bot, user_id)
    return str(member) if member else str(user_id)


async def action_tresorerie(bot, payload) -> dict:
    """Photo chiffrée de l'économie : masse monétaire, flux, écarts, comptes gelés.

    Tout est calculé depuis la base — aucun indicateur composite inventé.
    """
    heures = max(1, min(int(payload.get("heures") or 24), 24 * 30))
    since = datetime.now(timezone.utc) - timedelta(hours=heures)
    db = bot.economy
    flux = db.flows_since(since)
    top = db.top_earners(since, int(payload.get("top") or 10))
    anomalies = db.anomalies(since, float(payload.get("facteur") or 10))
    frozen = db.frozen_accounts()
    return {
        "heures": heures,
        "masse": db.money_supply(),
        "flux": flux,
        "top_gains": [{**e, "tag": _tag(bot, e["user_id"])} for e in top],
        "anomalies": [{**a, "tag": _tag(bot, a["user_id"])} for a in anomalies],
        "geles": [{"user_id": r["user_id"], "tag": _tag(bot, r["user_id"]),
                   "note": r["note"] or "", "ts": r["ts"], "par": r["by_who"] or ""}
                  for r in frozen],
        "devise": _cfg(bot).get("devise", DEFAULTS["devise"]),
    }


async def action_mouvements(bot, payload) -> dict:
    rows = bot.economy.transactions(
        int(payload.get("limit") or 60),
        payload.get("user_id") or None,
        payload.get("before_id") or None,
    )
    tags = {}
    for r in rows:
        for uid in (r["from_id"], r["to_id"]):
            if uid and uid not in tags:
                tags[uid] = _tag(bot, uid)
    return {"mouvements": rows, "tags": tags}


async def action_annuler(bot, payload) -> dict:
    """Annulation par compensation d'une transaction suspecte."""
    from . import journal

    tx_id = payload.get("id")
    if tx_id is None:
        raise ValueError("id requis")
    par = str(payload.get("par") or payload.get("_acteur") or "Dashboard")
    res = bot.economy.revert(int(tx_id), par)
    await journal.record(
        bot, "economie", f"Transaction #{tx_id} annulée ({res['montant']:+d})",
        actor_tag=par, target_id=res["user_id"], target_tag=_tag(bot, res["user_id"]),
        detail={"transaction": int(tx_id), "nouveau solde": res["solde"]},
    )
    return {"ok": True, **res}


async def action_geler(bot, payload) -> dict:
    """Gèle (ou dégèle) un compte : plus aucun gain ni dépense tant qu'il l'est."""
    from . import journal

    user_id = payload.get("user_id")
    if not user_id:
        raise ValueError("user_id requis")
    frozen = bool(payload.get("gele", True))
    par = str(payload.get("par") or payload.get("_acteur") or "Dashboard")
    note = str(payload.get("note") or "")
    bot.economy.set_frozen(user_id, frozen, note, par)
    await journal.record(
        bot, "economie",
        f"Compte {'gelé' if frozen else 'dégelé'} — {_tag(bot, user_id)}",
        actor_tag=par, target_id=str(user_id), target_tag=_tag(bot, user_id),
        detail={"motif": note} if note else None,
    )
    return {"ok": True, "gele": frozen, "solde": bot.economy.balance(user_id)}


async def action_ajuster(bot, payload) -> dict:
    """Correction manuelle d'un solde (passe outre le gel, toujours tracée)."""
    from . import journal

    user_id = payload.get("user_id")
    montant = payload.get("montant")
    if not user_id or montant is None:
        raise ValueError("user_id et montant requis")
    par = str(payload.get("par") or payload.get("_acteur") or "Dashboard")
    motif = str(payload.get("motif") or "correction")
    solde = bot.economy.adjust(user_id, int(montant), f"tresorerie:{motif} par {par}")
    await journal.record(
        bot, "economie", f"Ajustement {int(montant):+d} — {_tag(bot, user_id)}",
        actor_tag=par, target_id=str(user_id), target_tag=_tag(bot, user_id),
        detail={"motif": motif, "nouveau solde": solde},
    )
    return {"ok": True, "solde": solde}


MODULE = register(Module(
    key="economie",
    label="Économie",
    defaults=DEFAULTS,
    apply=None,  # config lue à la volée, rien à répercuter à chaud
    actions={
        "crediter": action_crediter,
        "classement": action_classement,
        "solde": action_solde,
        "crediter_evenement": action_crediter_evenement,
        "acheter": action_acheter,
        "taverne": action_taverne,
        "visite_taverne": action_visite_taverne,
        "tournee": action_tournee,
        "tresorerie": action_tresorerie,
        "mouvements": action_mouvements,
        "annuler": action_annuler,
        "geler": action_geler,
        "ajuster": action_ajuster,
    },
))
