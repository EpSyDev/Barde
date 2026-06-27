"""Commandes slash : /panel (centre de contrôle) + raccourcis."""
import discord
from discord import app_commands
from discord.ext import commands

from ui import PanelView, build_panel_embed, is_admin


class MusicCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(
        name="panel",
        description="Ouvre le panneau de contrôle musique (admin).",
    )
    async def panel(self, interaction: discord.Interaction):
        if not is_admin(interaction):
            await interaction.response.send_message(
                "⛔ Réservé aux administrateurs.", ephemeral=True
            )
            return
        await interaction.response.send_message(
            embed=build_panel_embed(self.bot.manager),
            view=PanelView(self.bot.manager),
        )

    @app_commands.command(
        name="play",
        description="Lance une URL YouTube dans un salon (1 à 4).",
    )
    @app_commands.describe(salon="Numéro du salon (1-4)", url="Lien YouTube")
    async def play(
        self,
        interaction: discord.Interaction,
        salon: app_commands.Range[int, 1, 4],
        url: str,
    ):
        if not is_admin(interaction):
            await interaction.response.send_message(
                "⛔ Réservé aux administrateurs.", ephemeral=True
            )
            return
        player = self.bot.manager.get(salon)
        if player is None:
            await interaction.response.send_message(
                f"⚠️ Salon {salon} non configuré.", ephemeral=True
            )
            return
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            await player.change_url(url.strip())
        except Exception as exc:  # noqa: BLE001
            await interaction.followup.send(f"❌ Erreur : {exc}", ephemeral=True)
            return
        await interaction.followup.send(
            f"▶️ **{player.slot.name}** : lecture lancée.", ephemeral=True
        )

    @app_commands.command(name="stop", description="Arrête un salon (1 à 4).")
    @app_commands.describe(salon="Numéro du salon (1-4)")
    async def stop(
        self,
        interaction: discord.Interaction,
        salon: app_commands.Range[int, 1, 4],
    ):
        if not is_admin(interaction):
            await interaction.response.send_message(
                "⛔ Réservé aux administrateurs.", ephemeral=True
            )
            return
        player = self.bot.manager.get(salon)
        if player is None:
            await interaction.response.send_message(
                f"⚠️ Salon {salon} non configuré.", ephemeral=True
            )
            return
        await player.stop()
        await interaction.response.send_message(
            f"⏹️ **{player.slot.name}** arrêté.", ephemeral=True
        )

    @app_commands.command(name="status", description="État des 4 salons.")
    async def status(self, interaction: discord.Interaction):
        await interaction.response.send_message(
            embed=build_panel_embed(self.bot.manager), ephemeral=True
        )


async def setup(bot):
    await bot.add_cog(MusicCog(bot))
