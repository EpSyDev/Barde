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

import logging
import sqlite3
import threading
import time
from datetime import datetime, timezone
from typing import Optional

import discord
from discord import app_commands

from .. import config
from ..registry import Module, register

log = logging.getLogger("fripouille.economie")

# --- Schéma de configuration (défauts du dashboard) ---
DEFAULTS = {
    "devise": {
        "nom": "Écus",            # pluriel affiché
        "nom_singulier": "Écu",    # utilisé quand montant == 1 et pas de symbole
        "symbole": "🪙",          # emoji ou caractère ; prioritaire sur le nom
        "symbole_avant": False,    # True → « 🪙 100 », False → « 100 🪙 »
    },
    # Sources de gains : chacune activable + réglable depuis le dashboard.
    "gains": {
        "message": {"enabled": False, "montant": 1, "cooldown": 60},      # cooldown en secondes
        "daily": {"enabled": True, "montant": 100, "cooldown": 86400},    # 24 h par défaut
    },
    # Catalogue de la boutique : liste d'articles éditée au dashboard.
    # Article = {id, nom, description, prix, type("role"|"objet"), role_id, stock, enabled}
    # stock : None ou -1 = illimité.
    "boutique": [],
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
        """Crédite (ou débite si ``amount`` < 0) un solde. Renvoie le nouveau solde."""
        amount = int(amount)
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


# ───────────────────────── Moteur de gains ─────────────────────────
# Cooldown anti-spam des gains « message » : en mémoire (repart à zéro au restart,
# acceptable pour de l'anti-spam) — évite un accès disque à chaque message.
_msg_cooldown: dict[int, float] = {}


async def crediter(bot, user_id, amount, reason="système") -> int:
    """Point d'entrée public : crédite un joueur (récompenses, quêtes…). Renvoie le solde."""
    return bot.economy.credit(user_id, amount, reason)


async def on_message(bot, message: discord.Message):
    """Crédite l'auteur d'un message si la source ``message`` est active (avec cooldown)."""
    gains = (_cfg(bot).get("gains") or {}).get("message") or {}
    if not gains.get("enabled"):
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
    prix = _int(item.get("prix"), 0)

    # Rôle déjà possédé ?
    if item.get("type") == "role" and item.get("role_id"):
        role = interaction.guild.get_role(_int(item.get("role_id"))) if interaction.guild else None
        if role and role in getattr(interaction.user, "roles", []):
            await interaction.response.send_message("❌ Tu possèdes déjà ce rôle.", ephemeral=True)
            return

    # Stock ?
    if not _stock_illimite(item) and _int(item.get("stock"), 0) <= 0:
        await interaction.response.send_message("❌ Article en rupture de stock.", ephemeral=True)
        return

    # Débit atomique (vérifie le solde).
    try:
        reste = bot.economy.spend(interaction.user.id, prix, f"achat:{item_id}")
    except ValueError:
        bal = bot.economy.balance(interaction.user.id)
        await interaction.response.send_message(
            f"❌ Solde insuffisant : il te faut **{format_amount(cfg, prix)}** "
            f"(tu as {format_amount(cfg, bal)}).",
            ephemeral=True,
        )
        return

    # Livraison : inventaire + rôle éventuel.
    bot.economy.add_item(interaction.user.id, item_id, 1)
    if item.get("type") == "role" and item.get("role_id") and interaction.guild:
        role = interaction.guild.get_role(_int(item.get("role_id")))
        if role:
            try:
                await interaction.user.add_roles(role, reason="Achat boutique")
            except discord.Forbidden:
                log.error("rôle %s non attribuable (permissions)", role.id)

    # Décrément du stock en config.
    if not _stock_illimite(item):
        item["stock"] = max(0, _int(item.get("stock"), 0) - 1)
        bot.store.set("economie", {"boutique": cfg.get("boutique")})

    await interaction.response.send_message(
        f"✅ Tu as acheté **{item.get('nom', 'Article')}** pour "
        f"**{format_amount(cfg, prix)}**. Il te reste **{format_amount(cfg, reste)}**.",
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
        bot = interaction.client
        cfg = _cfg(bot)
        if membre.bot or membre.id == interaction.user.id:
            await interaction.response.send_message(
                "❌ Destinataire invalide.", ephemeral=True
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

    @tree.command(name="boutique", description="Ouvrir la boutique.", guild=guild)
    async def boutique(interaction: discord.Interaction):
        cfg = _cfg(interaction.client)
        await interaction.response.send_message(
            embed=_shop_embed(cfg), view=ShopView(cfg), ephemeral=True
        )

    @tree.command(name="inventaire", description="Afficher tes articles achetés.", guild=guild)
    async def inventaire(interaction: discord.Interaction):
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


MODULE = register(Module(
    key="economie",
    label="Économie",
    defaults=DEFAULTS,
    apply=None,  # config lue à la volée, rien à répercuter à chaud
    actions={
        "crediter": action_crediter,
        "classement": action_classement,
    },
))
