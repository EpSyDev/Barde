"""Module « Baptême » : générateur de noms interactif.

Un panneau à bouton dans un salon (#bapteme) → parcours **éphémère** où le membre
choisit sa **race**, son **trait**, puis sa **police** (caractères Unicode stylisés).
Le nom généré (moteur combinatoire de ``bapteme_data``) devient directement son
**pseudo serveur** stylisé. Un message d'**événement** est posté dans le coin des
voyageurs. Pas de MP (trop dépendant des réglages de confidentialité des membres).

Config (dashboard) : salon du panneau, salon d'événement, textes/image du panneau,
message d'événement. Les pools de noms vivent dans ``bapteme_data`` ; les polices
dans ``fancy`` — cf. mémoire.

Vue persistante : le bouton du panneau (`bapteme:start`). Le parcours d'après est une
suite de vues éphémères à état (durée de vie = l'interaction).
"""
import logging
from datetime import datetime, timezone

import discord

from .. import config
from ..registry import Module, register
from . import bapteme_data as data
from . import fancy

log = logging.getLogger("fripouille.bapteme")

START_ID = "bapteme:start"
COLOR = 0xC9A44A
NICK_MAX = 32     # limite Discord d'un pseudo (en codepoints)

# Police proposée par défaut selon la race (l'utilisateur peut en changer).
RACE_STYLE = {"elfe": "script", "nain": "fraktur_bold", "orc": "fraktur", "humain": "smallcaps"}

DEFAULTS = {
    "enabled": False,
    "panel_channel_id": None,
    "event_channel_id": None,
    "panel_title": "Le Baptême du Voyageur",
    "panel_description": (
        "Tu franchis les portes de la taverne sans nom ?\n"
        "Clique ci-dessous et laisse le sort te forger une identité."
    ),
    "panel_image": "",
    "button_label": "Se faire baptiser",
    "event_message": "🕯️ Un nouveau voyageur est baptisé : **{name}** !",
    "message_id": None,
    # Registre des baptisés (géré bot) : {str(user_id): {user,name,pseudo,race,trait,style,at}}.
    # Persisté dans le store → identifie chaque joueur pour l'IA des quêtes plus tard.
    "roster": {},
}


def _cfg(bot):
    return bot.store.get("bapteme")


def _nick(name, style):
    """Nom stylisé ajusté à la limite de pseudo (coupe au dernier mot si trop long)."""
    styled = fancy.stylize(name, style)
    if len(styled) <= NICK_MAX:
        return styled
    cut = name[:NICK_MAX]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return fancy.stylize(cut, style)[:NICK_MAX]


def _step_embed(title, description):
    return discord.Embed(title=title, description=description, color=COLOR)


def _result_embed(name, style):
    styled = fancy.stylize(name, style)
    return discord.Embed(
        title="🪶 Ton nom",
        description=(
            f"# {styled}\n`{name}`\n\n"
            "Choisis ta **police** dans le menu, **relance** le sort si le nom ne te plaît "
            "pas, puis **valide** — il deviendra ton pseudo."
        ),
        color=COLOR,
    )


# --- Parcours éphémère (vues à état, non persistantes) ---
class RaceSelect(discord.ui.Select):
    def __init__(self):
        options = [
            discord.SelectOption(label=label, value=key, emoji=emoji)
            for key, label, emoji in data.race_choices()
        ]
        super().__init__(placeholder="Choisis ta race…", min_values=1, max_values=1, options=options)

    async def callback(self, interaction):
        await interaction.response.edit_message(
            embed=_step_embed("⚗️ Ton tempérament ?", "Ce qui coule dans tes veines forgera ton épithète."),
            view=TraitView(self.values[0]),
        )


class RaceView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=300)
        self.add_item(RaceSelect())


class TraitSelect(discord.ui.Select):
    def __init__(self, race_key):
        self.race_key = race_key
        options = [
            discord.SelectOption(label=label, value=key, emoji=emoji)
            for key, label, emoji in data.trait_choices()
        ]
        super().__init__(placeholder="Choisis ton tempérament…", min_values=1, max_values=1, options=options)

    async def callback(self, interaction):
        name = data.generate(self.race_key, self.values[0])
        style = RACE_STYLE.get(self.race_key, fancy.STYLE_ORDER[0])
        view = ResultView(self.race_key, self.values[0], name, style)
        await interaction.response.edit_message(embed=view.embed(), view=view)


class TraitView(discord.ui.View):
    def __init__(self, race_key):
        super().__init__(timeout=300)
        self.add_item(TraitSelect(race_key))


class StyleSelect(discord.ui.Select):
    def __init__(self, current):
        options = [
            discord.SelectOption(
                label=fancy.STYLE_LABELS[s],
                value=s,
                default=(s == current),
            )
            for s in fancy.STYLE_ORDER
        ]
        super().__init__(placeholder="Choisis ta police…", min_values=1, max_values=1, options=options, row=0)

    async def callback(self, interaction):
        p = self.view
        view = ResultView(p.race_key, p.trait_key, p.name, self.values[0])
        await interaction.response.edit_message(embed=view.embed(), view=view)


class ResultView(discord.ui.View):
    def __init__(self, race_key, trait_key, name, style):
        super().__init__(timeout=300)
        self.race_key = race_key
        self.trait_key = trait_key
        self.name = name
        self.style = style
        self.add_item(StyleSelect(style))

    def embed(self):
        return _result_embed(self.name, self.style)

    @discord.ui.button(label="Valider", emoji="✅", style=discord.ButtonStyle.success, row=1)
    async def validate(self, interaction, button):
        await _finalize(interaction, self.name, self.style, self.race_key, self.trait_key)

    @discord.ui.button(label="Relancer", emoji="🎲", style=discord.ButtonStyle.secondary, row=1)
    async def reroll(self, interaction, button):
        name = data.generate(self.race_key, self.trait_key)
        view = ResultView(self.race_key, self.trait_key, name, self.style)
        await interaction.response.edit_message(embed=view.embed(), view=view)


async def _finalize(interaction, name, style, race_key, trait_key):
    bot = interaction.client
    cfg = _cfg(bot)
    member = interaction.user
    styled = fancy.stylize(name, style)

    # Le pseudo serveur devient le nom stylisé (c'est la livraison, plus de MP).
    nick_ok = True
    if isinstance(member, discord.Member):
        try:
            await member.edit(nick=_nick(name, style), reason="Baptême")
        except discord.Forbidden:
            nick_ok = False

    # Registre persistant : ID Discord → identité choisie (pour l'IA des quêtes).
    roster = dict(cfg.get("roster") or {})
    roster[str(member.id)] = {
        "user": member.name,
        "name": name,
        "pseudo": styled,
        "race": race_key,
        "trait": trait_key,
        "style": style,
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    bot.store.set("bapteme", {"roster": roster})

    # Message d'événement dans le coin des voyageurs.
    ev_id = cfg.get("event_channel_id")
    channel = bot.get_channel(int(ev_id)) if ev_id else None
    if channel is not None:
        text = (cfg.get("event_message") or "").replace("{name_plain}", name).replace(
            "{name}", styled
        ).replace("{mention}", member.mention)
        try:
            await channel.send(
                text,
                allowed_mentions=discord.AllowedMentions(users=False, roles=False, everyone=False),
            )
        except discord.Forbidden:
            log.error("bapteme : envoi de l'événement refusé")

    confirm = discord.Embed(
        title="🎉 Te voilà baptisé !",
        description=f"# {styled}\n`{name}`\n\n"
        + (
            "Ton nouveau pseudo est posé. 📜"
            if nick_ok
            else "⚠️ Je n'ai pas pu changer ton pseudo (permission/hiérarchie), mais voici ton nom."
        ),
        color=COLOR,
    )
    await interaction.response.edit_message(embed=confirm, view=None)


# --- Import des baptisés antérieurs au registre ---
async def backfill(bot, payload):
    """Reconstruit des fiches pour les membres portant déjà un pseudo stylisé mais
    absents du registre (baptêmes faits avant l'ajout du roster). Race/tempérament
    irrécupérables (jamais stockés) → laissés vides ; nom déduit en inversant la police."""
    guild = bot.get_guild(config.GUILD_ID) if config.GUILD_ID else None
    if guild is None:
        raise ValueError("serveur introuvable")
    if not guild.chunked:
        await guild.chunk()   # récupère tous les membres (intent Server Members)

    roster = dict(_cfg(bot).get("roster") or {})
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    added = 0
    for member in guild.members:
        if member.bot or str(member.id) in roster:
            continue
        nick = member.nick
        if not nick:
            continue
        style, plain = fancy.destylize(nick)
        if style is None:          # pseudo non stylisé → pas un baptisé
            continue
        roster[str(member.id)] = {
            "user": member.name,
            "name": plain,
            "pseudo": nick,
            "race": "",
            "trait": "",
            "style": style,
            "at": now,
            "source": "import",
        }
        added += 1

    if added:
        bot.store.set("bapteme", {"roster": roster})
    return {"added": added, "total": len(roster)}


# --- Panneau (vue persistante) ---
class BaptizeButton(discord.ui.Button):
    def __init__(self, label):
        super().__init__(
            label=(label or "Se faire baptiser")[:80], emoji="🕯️",
            style=discord.ButtonStyle.primary, custom_id=START_ID,
        )

    async def callback(self, interaction):
        await interaction.response.send_message(
            embed=_step_embed("✨ Le Baptême", "De quel peuple es-tu ? Choisis, et le sort fera le reste."),
            view=RaceView(), ephemeral=True,
        )


class PanelView(discord.ui.View):
    def __init__(self, label):
        super().__init__(timeout=None)
        self.add_item(BaptizeButton(label))


# --- Cycle de vie ---
async def apply(bot, cfg):
    if not cfg.get("enabled") or not cfg.get("panel_channel_id"):
        return
    channel = bot.get_channel(int(cfg["panel_channel_id"]))
    if channel is None:
        log.warning("bapteme : salon du panneau introuvable")
        return
    embed = discord.Embed(
        title=cfg.get("panel_title") or "Le Baptême du Voyageur",
        description=cfg.get("panel_description") or "",
        color=COLOR,
    )
    if (cfg.get("panel_image") or "").strip():
        embed.set_image(url=cfg["panel_image"].strip())
    view = PanelView(cfg.get("button_label"))

    msg = None
    mid = cfg.get("message_id")
    if mid:
        try:
            msg = await channel.fetch_message(int(mid))
        except (discord.NotFound, discord.Forbidden):
            msg = None
    if msg is not None:
        await msg.edit(embed=embed, view=view)
    else:
        sent = await channel.send(embed=embed, view=view)
        bot.store.set("bapteme", {"message_id": str(sent.id)})
    bot.add_view(view)


async def setup_persistent(bot):
    cfg = _cfg(bot)
    if cfg.get("enabled"):
        bot.add_view(PanelView(cfg.get("button_label")))


MODULE = register(Module(
    key="bapteme",
    label="Baptême",
    defaults=DEFAULTS,
    apply=apply,
    actions={"backfill": backfill},
))
