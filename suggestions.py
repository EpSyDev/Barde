"""Suggestions des membres : embed de notif + validation admin (Accepter / Refuser)."""
import logging

import discord

from ui import is_admin

log = logging.getLogger("bot.suggestions")


def build_suggestion_embed(manager, suggester, url, origin_index) -> discord.Embed:
    player = manager.get(origin_index)
    name = player.slot.name if player else f"Salon {origin_index}"
    embed = discord.Embed(
        title="🎵 Nouvelle suggestion musicale",
        color=0xF1C40F,
    )
    embed.add_field(name="Proposé par", value=suggester.mention, inline=True)
    embed.add_field(name="Salon d'origine", value=name, inline=True)
    embed.add_field(name="Lien", value=url, inline=False)
    embed.set_footer(text=f"suggest • slot {origin_index}")
    return embed


def _extract(message):
    """Relit l'URL et le salon d'origine depuis l'embed (vue persistante sans état)."""
    url, origin = None, None
    if not message.embeds:
        return url, origin
    embed = message.embeds[0]
    for f in embed.fields:
        if f.name == "Lien":
            url = f.value
    footer = (embed.footer.text or "") if embed.footer else ""
    if "slot" in footer:
        try:
            origin = int(footer.rsplit("slot", 1)[1].strip())
        except ValueError:
            pass
    return url, origin


class NotifValidationView(discord.ui.View):
    """Boutons Accepter / Refuser sous chaque notif (persistante, gérée par le bot principal)."""

    def __init__(self, manager):
        super().__init__(timeout=None)
        self.manager = manager

    @discord.ui.button(
        label="✅ Accepter", style=discord.ButtonStyle.success, custom_id="suggest:accept"
    )
    async def accept(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not is_admin(interaction):
            await interaction.response.send_message("⛔ Réservé aux admins.", ephemeral=True)
            return
        url, origin = _extract(interaction.message)
        if not url:
            await interaction.response.send_message("Lien introuvable.", ephemeral=True)
            return
        view = AcceptSlotView(self.manager, url, origin, interaction.message)
        await interaction.response.send_message(
            "Choisis le salon où télécharger la piste, puis confirme :",
            view=view,
            ephemeral=True,
        )

    @discord.ui.button(
        label="❌ Refuser", style=discord.ButtonStyle.danger, custom_id="suggest:refuse"
    )
    async def refuse(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not is_admin(interaction):
            await interaction.response.send_message("⛔ Réservé aux admins.", ephemeral=True)
            return
        embed = interaction.message.embeds[0]
        embed.color = 0xE74C3C
        embed.title = "❌ Suggestion refusée"
        embed.set_footer(text=f"Refusée par {interaction.user.display_name}")
        await interaction.response.edit_message(embed=embed, view=None)


class AcceptSlotView(discord.ui.View):
    """Sélecteur de salon de destination (pré-réglé sur l'origine) + confirmation (éphémère)."""

    def __init__(self, manager, url, origin, notif_message):
        super().__init__(timeout=180)
        self.manager = manager
        self.url = url
        self.notif_message = notif_message
        indexes = manager.indexes
        self.chosen = origin if origin in indexes else (indexes[0] if indexes else None)

        select = discord.ui.Select(
            placeholder="Salon de destination…",
            options=[
                discord.SelectOption(
                    label=f"Salon {i} · {manager.get(i).slot.name}"[:100],
                    value=str(i),
                    default=(i == self.chosen),
                )
                for i in indexes
            ]
            or [discord.SelectOption(label="(aucun salon)", value="-1")],
            disabled=not indexes,
            row=0,
        )
        select.callback = self._on_pick
        self.add_item(select)

    async def _on_pick(self, interaction: discord.Interaction):
        self.chosen = int(interaction.data["values"][0])
        await interaction.response.defer()

    @discord.ui.button(
        label="✅ Confirmer le téléchargement", style=discord.ButtonStyle.success, row=1
    )
    async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
        if self.chosen is None or self.chosen < 0:
            await interaction.response.send_message("Aucun salon disponible.", ephemeral=True)
            return
        name = self.manager.get(self.chosen).slot.name
        await self.manager.baker.enqueue(self.chosen, self.url)
        try:
            embed = self.notif_message.embeds[0]
            embed.color = 0x2ECC71
            embed.title = "✅ Suggestion acceptée"
            embed.set_footer(text=f"Acceptée par {interaction.user.display_name} → {name}")
            await self.notif_message.edit(embed=embed, view=None)
        except discord.HTTPException:
            pass
        await interaction.response.edit_message(
            content=f"✅ Téléchargement lancé dans **{name}**.", view=None
        )
