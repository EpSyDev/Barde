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
        view = PanelView(self.bot.manager)
        await interaction.response.send_message(
            embed=build_panel_embed(self.bot.manager, view.selected),
            view=view,
        )
        message = await interaction.original_response()
        self.bot.manager.set_panel(message, view)


async def setup(bot):
    await bot.add_cog(MusicCog(bot))
