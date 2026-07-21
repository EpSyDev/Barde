"""Module « Rôles-jeux » : le membre choisit ses jeux et reçoit les rôles
correspondants — rôles qui, côté Discord, ouvrent l'accès aux catégories/salons de
ces jeux (à configurer une fois : @everyone sans « Voir les salons », rôle du jeu
avec « Voir les salons »).

Les jeux sont rangés en **catégories** (FPS, MMORPG, Simulation…), éditables depuis
le dashboard. Chaque catégorie est postée dans le salon comme un bloc : un embed
d'en-tête (emoji + nom + description) suivi de **son propre menu déroulant**. Un
message d'intro optionnel (titre/description) coiffe l'ensemble.

Config (éditée depuis le dashboard) :
- ``enabled``            : module actif.
- ``channel_id``         : salon où poster les menus.
- ``title`` / ``description`` : embed d'intro (optionnel).
- ``categories``         : liste de ``{id, label, emoji, description, placeholder,
                           games:[{id, label, role_id, emoji}]}``.
- ``message_ids``        : ids des messages postés (gérés par le bot).

Chaque menu définit l'ensemble EXACT des rôles-jeux **de sa catégorie** : les rôles
de la catégorie non cochés sont retirés, les cochés ajoutés. Les rôles des autres
catégories (et tout autre rôle) ne sont jamais touchés.
"""
import logging

import discord

from ..registry import Module, register

log = logging.getLogger("fripouille.jeux")

CUSTOM_PREFIX = "jeux:cat:"     # custom_id du menu = jeux:cat:{category_id}
COLOR = 0xC9A44A

DEFAULTS = {
    "enabled": False,
    "channel_id": None,
    "title": "Choisis tes jeux",
    "description": "Sélectionne les jeux auxquels tu joues pour accéder à leurs salons.",
    # categories : [{ id, label, emoji, description, placeholder, games:[{id,label,role_id}] }]
    "categories": [],
    "message_ids": [],   # géré bot : messages postés dans l'ordre (intro puis catégories)
}


# --- Helpers config ---
def _cat_options(cat):
    """Options du menu d'une catégorie (jeux ayant un rôle), plafonnées à 25."""
    options = []
    for g in cat.get("games", []):
        rid = g.get("role_id")
        if not rid:
            continue
        opt = discord.SelectOption(
            label=(g.get("label") or "Jeu")[:100],
            value=str(rid),
        )
        emoji = (g.get("emoji") or "").strip()
        if emoji:
            # str accepté : emoji unicode ou perso « <:nom:id> » (parsé par discord.py).
            try:
                opt.emoji = emoji
            except (ValueError, TypeError):
                log.warning("jeux : emoji invalide « %s » ignoré", emoji)
        options.append(opt)
    return options[:25]


def _cat_role_ids(cat) -> set[int]:
    ids = set()
    for g in cat.get("games", []):
        rid = g.get("role_id")
        if not rid:
            continue
        try:
            ids.add(int(rid))
        except (TypeError, ValueError):
            pass
    return ids


# --- Vues ---
class CategorySelect(discord.ui.Select):
    def __init__(self, cat):
        options = _cat_options(cat)
        label = cat.get("label") or "jeux"
        super().__init__(
            custom_id=CUSTOM_PREFIX + str(cat.get("id")),
            placeholder=((cat.get("placeholder") or f"Choisis tes {label}…"))[:150],
            min_values=0,
            max_values=max(1, len(options)),
            options=options or [discord.SelectOption(label="Aucun jeu configuré", value="_none")],
            disabled=not options,
        )

    async def callback(self, interaction: discord.Interaction):
        await _handle_select(interaction, self.custom_id, self.values)


class CategoryView(discord.ui.View):
    def __init__(self, cat):
        super().__init__(timeout=None)
        self.add_item(CategorySelect(cat))


async def _handle_select(interaction, custom_id, values):
    member = interaction.user
    if not isinstance(member, discord.Member) or interaction.guild is None:
        await interaction.response.send_message("Interaction hors serveur.", ephemeral=True)
        return
    cat_id = custom_id[len(CUSTOM_PREFIX):]
    cfg = interaction.client.store.get("jeux")
    cat = next((c for c in cfg.get("categories", []) if str(c.get("id")) == cat_id), None)
    if cat is None:
        await interaction.response.send_message(
            "Catégorie introuvable (config modifiée depuis ?).", ephemeral=True
        )
        return

    managed = _cat_role_ids(cat)                       # rôles de CETTE catégorie
    chosen = {int(v) for v in values if v != "_none"} & managed
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


# --- Rendu du panneau ---
def _build_blocks(cfg):
    """Liste ordonnée de (embed, view|None) : intro éventuel puis une catégorie/bloc."""
    blocks = []
    title = (cfg.get("title") or "").strip()
    desc = (cfg.get("description") or "").strip()
    if title or desc:
        blocks.append(
            (discord.Embed(title=title or None, description=desc or None, color=COLOR), None)
        )
    for cat in cfg.get("categories", []):
        if not _cat_options(cat):
            continue
        emoji = (cat.get("emoji") or "").strip()
        label = (cat.get("label") or "Jeux").strip()
        header = f"{emoji} {label}".strip()
        embed = discord.Embed(
            title=header,
            description=(cat.get("description") or "").strip() or None,
            color=COLOR,
        )
        blocks.append((embed, CategoryView(cat)))
    return blocks


async def _reconcile(channel, stored, blocks):
    """Édite les messages en place si leur nombre n'a pas changé, sinon supprime et
    repost tout dans l'ordre. Renvoie la nouvelle liste d'ids."""
    if stored and len(stored) == len(blocks) and blocks:
        new_ids, ok = [], True
        for mid, (embed, view) in zip(stored, blocks):
            try:
                msg = await channel.fetch_message(int(mid))
                await msg.edit(embed=embed, view=view)
                new_ids.append(str(msg.id))
            except (discord.NotFound, discord.Forbidden, discord.HTTPException):
                ok = False
                break
        if ok:
            return new_ids

    # Repost complet : purge des anciens messages puis renvoi dans l'ordre.
    for mid in stored:
        try:
            msg = await channel.fetch_message(int(mid))
            await msg.delete()
        except (discord.NotFound, discord.Forbidden, discord.HTTPException):
            pass
    new_ids = []
    for embed, view in blocks:
        sent = await channel.send(embed=embed, view=view)
        new_ids.append(str(sent.id))
    return new_ids


async def apply(bot, cfg):
    """Répercute la config : (re)poste les blocs de catégories dans le salon."""
    if not cfg.get("enabled"):
        return
    channel_id = cfg.get("channel_id")
    if not channel_id:
        return
    channel = bot.get_channel(int(channel_id))
    if channel is None:
        log.warning("jeux : salon %s introuvable", channel_id)
        return

    blocks = _build_blocks(cfg)
    new_ids = await _reconcile(channel, list(cfg.get("message_ids") or []), blocks)
    bot.store.set("jeux", {"message_ids": new_ids})
    for _embed, view in blocks:
        if view is not None:
            bot.add_view(view)


async def setup_persistent(bot):
    """Réenregistre un menu persistant par catégorie (cliquable après un restart)."""
    cfg = bot.store.get("jeux")
    if not cfg.get("enabled"):
        return
    for cat in cfg.get("categories", []):
        if _cat_options(cat):
            bot.add_view(CategoryView(cat))


MODULE = register(Module(
    key="jeux",
    label="Rôles-jeux",
    defaults=DEFAULTS,
    apply=apply,
))
