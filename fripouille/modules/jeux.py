"""Module « Rôles-jeux » : menu déroulant où chaque membre choisit ses jeux et
reçoit les rôles correspondants — rôles qui, côté Discord, ouvrent l'accès aux
catégories/salons de ces jeux (à configurer une fois sur la catégorie : @everyone
sans « Voir les salons », rôle du jeu avec « Voir les salons »).

Config (éditée depuis le dashboard) :
- ``enabled``            : module actif.
- ``channel_id``         : salon où poster le menu.
- ``title`` / ``description`` : contenu de l'embed.
- ``games``              : liste de ``{id, label, emoji, role_id}``.
- ``message_id``         : id du message posté (géré par le bot, pas édité à la main).

Le menu définit l'ensemble EXACT des rôles-jeux du membre : à chaque validation, les
rôles-jeux non cochés sont retirés, les cochés ajoutés. Les autres rôles ne sont
jamais touchés.
"""
import logging

import discord

from ..registry import Module, register

log = logging.getLogger("fripouille.jeux")

SELECT_CUSTOM_ID = "jeux:select"

DEFAULTS = {
    "enabled": False,
    "channel_id": None,
    "title": "Choisis tes jeux",
    "description": "Sélectionne les jeux auxquels tu joues pour accéder à leurs salons.",
    "games": [],
    "message_id": None,
}


def _game_role_ids(cfg) -> set[int]:
    ids = set()
    for g in cfg.get("games", []):
        rid = g.get("role_id")
        if rid:
            try:
                ids.add(int(rid))
            except (TypeError, ValueError):
                pass
    return ids


def _build_options(cfg):
    options = []
    for g in cfg.get("games", []):
        rid = g.get("role_id")
        if not rid:
            continue
        emoji = (g.get("emoji") or "").strip() or None
        options.append(discord.SelectOption(
            label=(g.get("label") or "Jeu")[:100],
            value=str(rid),
            emoji=emoji,
        ))
    return options[:25]


class GamesSelect(discord.ui.Select):
    def __init__(self, bot):
        self.bot = bot
        options = _build_options(bot.store.get("jeux"))
        super().__init__(
            custom_id=SELECT_CUSTOM_ID,
            placeholder="Choisis tes jeux…",
            min_values=0,
            max_values=max(1, len(options)),
            options=options or [discord.SelectOption(label="Aucun jeu configuré", value="_none")],
            disabled=not options,
        )

    async def callback(self, interaction: discord.Interaction):
        member = interaction.user
        if not isinstance(member, discord.Member) or interaction.guild is None:
            await interaction.response.send_message("Interaction hors serveur.", ephemeral=True)
            return
        cfg = self.bot.store.get("jeux")
        managed = _game_role_ids(cfg)
        chosen = {int(v) for v in self.values if v != "_none"} & managed
        have = {r.id for r in member.roles}

        added, removed, failed = [], [], False
        for rid in chosen - have:
            role = interaction.guild.get_role(rid)
            if role:
                try:
                    await member.add_roles(role, reason="Rôles-jeux (La Fripouille)")
                    added.append(role.name)
                except discord.Forbidden:
                    failed = True
        for rid in (managed & have) - chosen:
            role = interaction.guild.get_role(rid)
            if role:
                try:
                    await member.remove_roles(role, reason="Rôles-jeux (La Fripouille)")
                    removed.append(role.name)
                except discord.Forbidden:
                    failed = True

        parts = []
        if added:
            parts.append("✅ Ajouté : " + ", ".join(added))
        if removed:
            parts.append("➖ Retiré : " + ", ".join(removed))
        if not parts:
            parts.append("Aucun changement.")
        if failed:
            parts.append("⚠️ Certains rôles n'ont pu être modifiés (hiérarchie ?).")
        await interaction.response.send_message("\n".join(parts), ephemeral=True)


class GamesView(discord.ui.View):
    def __init__(self, bot):
        super().__init__(timeout=None)
        self.add_item(GamesSelect(bot))


def _embed(cfg):
    return discord.Embed(
        title=cfg.get("title") or "Choisis tes jeux",
        description=cfg.get("description") or "",
        color=0xC9A44A,
    )


async def apply(bot, cfg):
    """Répercute la config : (re)poste ou met à jour le menu dans le salon configuré."""
    channel_id = cfg.get("channel_id")
    if not cfg.get("enabled") or not channel_id:
        return
    channel = bot.get_channel(int(channel_id))
    if channel is None:
        log.warning("jeux : salon %s introuvable", channel_id)
        return

    view = GamesView(bot)
    embed = _embed(cfg)
    msg = None
    message_id = cfg.get("message_id")
    if message_id:
        try:
            msg = await channel.fetch_message(int(message_id))
        except (discord.NotFound, discord.Forbidden):
            msg = None

    if msg is not None:
        await msg.edit(embed=embed, view=view)
    else:
        sent = await channel.send(embed=embed, view=view)
        bot.store.set("jeux", {"message_id": str(sent.id)})
    bot.add_view(view)


async def setup_persistent(bot):
    """Enregistre la vue persistante au démarrage (menu cliquable après un restart)."""
    cfg = bot.store.get("jeux")
    if cfg.get("enabled") and cfg.get("games"):
        bot.add_view(GamesView(bot))


MODULE = register(Module(
    key="jeux",
    label="Rôles-jeux",
    defaults=DEFAULTS,
    apply=apply,
))
