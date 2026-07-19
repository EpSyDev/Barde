"""Module « Baptême » : générateur de noms interactif.

Un panneau à bouton dans un salon (#bapteme) → parcours **éphémère** (menus) où le
membre choisit sa **race** puis son **trait**, le bot génère un nom (moteur
combinatoire de ``bapteme_data``), le membre **valide** ou **relance**. À la
validation : nom envoyé en **MP**, message d'**événement** dans le coin des voyageurs,
et (option) posé en **pseudo serveur**.

Config (dashboard) : salon du panneau, salon d'événement, textes de l'embed/MP/event,
image, option pseudo. Les pools de noms vivent dans ``bapteme_data`` (fichier maintenu
à la main), pas dans la config — cf. mémoire.

Vue persistante : le bouton du panneau (`bapteme:start`). Le parcours d'après est une
suite de vues éphémères à état (durée de vie = l'interaction), pas besoin de persistance.
"""
import logging

import discord

from ..registry import Module, register
from . import bapteme_data as data
from . import fancy

log = logging.getLogger("fripouille.bapteme")

START_ID = "bapteme:start"
COLOR = 0xC9A44A
NICK_MAX = 32     # limite Discord d'un pseudo

# Chaque race a « sa main » (style Unicode) pour l'immersion — cf. fancy.py.
RACE_STYLE = {"elfe": "script", "nain": "fraktur_bold", "orc": "fraktur", "humain": "smallcaps"}


def _styled(name, race_key):
    return fancy.stylize(name, RACE_STYLE.get(race_key, ""))

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
    "dm_message": "Bienvenue, **{name}**\n`{name_plain}`\nQue ton nom résonne longtemps dans la taverne. 🍺",
    "set_nickname": False,
    "message_id": None,
}


def _cfg(bot):
    return bot.store.get("bapteme")


def _step_embed(title, description):
    return discord.Embed(title=title, description=description, color=COLOR)


def _result_embed(name, race_key):
    styled = _styled(name, race_key)
    return discord.Embed(
        title="🪶 Ton nom",
        description=f"# {styled}\n`{name}`\n\nIl te va comme un gant ? **Valide-le.** Sinon, **relance le sort.**",
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
        await interaction.response.edit_message(
            embed=_result_embed(name, self.race_key),
            view=ResultView(self.race_key, self.values[0], name),
        )


class TraitView(discord.ui.View):
    def __init__(self, race_key):
        super().__init__(timeout=300)
        self.add_item(TraitSelect(race_key))


class ResultView(discord.ui.View):
    def __init__(self, race_key, trait_key, name):
        super().__init__(timeout=300)
        self.race_key = race_key
        self.trait_key = trait_key
        self.name = name

    @discord.ui.button(label="Valider", emoji="✅", style=discord.ButtonStyle.success)
    async def validate(self, interaction, button):
        await _finalize(interaction, self.name, self.race_key)

    @discord.ui.button(label="Relancer", emoji="🎲", style=discord.ButtonStyle.secondary)
    async def reroll(self, interaction, button):
        self.name = data.generate(self.race_key, self.trait_key)
        await interaction.response.edit_message(embed=_result_embed(self.name, self.race_key), view=self)


async def _finalize(interaction, name, race_key):
    bot = interaction.client
    cfg = _cfg(bot)
    member = interaction.user
    styled = _styled(name, race_key)

    def _fmt(text):
        # {name} = nom stylisé (immersion) ; {name_plain} = nom lisible ; {mention} = le membre.
        return (text or "").replace("{name_plain}", name).replace("{name}", styled).replace(
            "{mention}", member.mention
        )

    # Option : poser le nom en pseudo serveur — en CLAIR (lisibilité, recherche, mentions).
    nick_note = ""
    if cfg.get("set_nickname") and isinstance(member, discord.Member):
        try:
            await member.edit(nick=name[:NICK_MAX], reason="Baptême")
        except discord.Forbidden:
            nick_note = "\n*(Je n'ai pas pu poser ton pseudo — permission/hiérarchie.)*"

    # MP au membre.
    dm_ok = True
    try:
        await member.send(_fmt(cfg.get("dm_message")))
    except discord.Forbidden:
        dm_ok = False

    # Message d'événement dans le coin des voyageurs.
    ev_id = cfg.get("event_channel_id")
    channel = bot.get_channel(int(ev_id)) if ev_id else None
    if channel is not None:
        try:
            await channel.send(
                _fmt(cfg.get("event_message")),
                allowed_mentions=discord.AllowedMentions(users=False, roles=False, everyone=False),
            )
        except discord.Forbidden:
            log.error("bapteme : envoi de l'événement refusé")

    confirm = discord.Embed(
        title="🎉 Te voilà baptisé !",
        description=f"# {styled}\n`{name}`\n\n"
        + ("Ton nom t'attend en message privé. 📜" if dm_ok else "⚠️ Tes MP sont fermés — note-le vite !")
        + nick_note,
        color=COLOR,
    )
    await interaction.response.edit_message(embed=confirm, view=None)


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
))
