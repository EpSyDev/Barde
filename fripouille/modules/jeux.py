"""Module « Rôles-jeux » : le membre choisit ses jeux et reçoit les rôles
correspondants — rôles qui, côté Discord, ouvrent l'accès aux catégories/salons de
ces jeux (à configurer une fois : @everyone sans « Voir les salons », rôle du jeu
avec « Voir les salons »).

Les jeux sont rangés en **catégories** (FPS, MMORPG, Simulation…), éditables depuis
le dashboard. Chaque catégorie est postée dans le salon comme un bloc : un embed
d'en-tête (emoji + nom + description) suivi d'une **grille de boutons** — un bouton
par jeu (avec son logo-emoji). Un clic prend/retire le rôle du jeu, avec une
confirmation éphémère ; aucun menu déroulant, donc rien qui déborde à l'ouverture.
Un message d'intro optionnel (titre/description) coiffe l'ensemble.

Config (éditée depuis le dashboard) :
- ``enabled``            : module actif.
- ``channel_id``         : salon où poster les blocs.
- ``title`` / ``description`` : embed d'intro (optionnel).
- ``categories``         : liste de ``{id, label, emoji, description, placeholder,
                           games:[{id, label, role_id, emoji}]}``.
- ``message_ids``        : ids des messages postés (gérés par le bot).

Chaque bouton bascule le rôle de SON jeu (toggle indépendant) : cliquer l'ajoute,
recliquer le retire. Aucun autre rôle n'est touché. (``placeholder`` n'est plus
utilisé côté rendu — conservé pour compat config.)
"""
import logging

import discord

from ..registry import Module, register

log = logging.getLogger("fripouille.jeux")

ROLE_PREFIX = "jeux:role:"      # custom_id du bouton = jeux:role:{role_id}
MAX_BUTTONS = 25                # une View Discord = 5×5 boutons max
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
def _cat_games(cat):
    """Jeux d'une catégorie ayant un rôle, plafonnés à 25 (limite d'une View)."""
    return [g for g in cat.get("games", []) if g.get("role_id")][:MAX_BUTTONS]


# --- Vues ---
class GameButton(discord.ui.Button):
    """Bouton d'un jeu : bascule (toggle) le rôle correspondant au clic."""
    def __init__(self, game):
        super().__init__(
            style=discord.ButtonStyle.secondary,
            label=(game.get("label") or "Jeu")[:80],
            emoji=(game.get("emoji") or "").strip() or None,
            custom_id=ROLE_PREFIX + str(game.get("role_id")),
        )

    async def callback(self, interaction: discord.Interaction):
        await _toggle_role(interaction, self.custom_id[len(ROLE_PREFIX):])


class CategoryButtonsView(discord.ui.View):
    def __init__(self, cat):
        super().__init__(timeout=None)
        for g in _cat_games(cat):
            self.add_item(GameButton(g))


async def _toggle_role(interaction, role_id):
    member = interaction.user
    if not isinstance(member, discord.Member) or interaction.guild is None:
        await interaction.response.send_message("Interaction hors serveur.", ephemeral=True)
        return
    try:
        rid = int(role_id)
    except (TypeError, ValueError):
        await interaction.response.send_message("Rôle invalide.", ephemeral=True)
        return
    role = interaction.guild.get_role(rid)
    if role is None:
        await interaction.response.send_message(
            "Rôle introuvable (config modifiée depuis ?).", ephemeral=True
        )
        return
    try:
        if role in member.roles:
            await member.remove_roles(role, reason="Rôles-jeux (La Fripouille)")
            await interaction.response.send_message(
                f"➖ **{role.name}** retiré — ses salons se referment.", ephemeral=True
            )
        else:
            await member.add_roles(role, reason="Rôles-jeux (La Fripouille)")
            await interaction.response.send_message(
                f"✅ **{role.name}** ajouté — accès à ses salons débloqué.", ephemeral=True
            )
    except discord.Forbidden:
        await interaction.response.send_message(
            "⚠️ Je n'ai pas pu modifier ce rôle (hiérarchie : mon rôle doit être au-dessus).",
            ephemeral=True,
        )


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
        if not _cat_games(cat):
            continue
        emoji = (cat.get("emoji") or "").strip()
        label = (cat.get("label") or "Jeux").strip()
        header = f"{emoji} {label}".strip()
        embed = discord.Embed(
            title=header,
            description=(cat.get("description") or "").strip() or None,
            color=COLOR,
        )
        blocks.append((embed, CategoryButtonsView(cat)))
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
    """Réenregistre les boutons persistants par catégorie (cliquables après restart)."""
    cfg = bot.store.get("jeux")
    if not cfg.get("enabled"):
        return
    for cat in cfg.get("categories", []):
        if _cat_games(cat):
            bot.add_view(CategoryButtonsView(cat))


MODULE = register(Module(
    key="jeux",
    label="Rôles-jeux",
    defaults=DEFAULTS,
    apply=apply,
))
