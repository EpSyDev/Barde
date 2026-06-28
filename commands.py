"""Commande slash /panel."""
import discord
from discord import app_commands
from discord.ext import commands

from ui import PanelView, build_panel_embed, is_admin


class MusicCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(
        name="panel",
        description="Ouvre le panneau des Bardes (admin).",
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


async def setup(bot):
    await bot.add_cog(MusicCog(bot))
