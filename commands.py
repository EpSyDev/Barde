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

    @app_commands.command(
        name="barde",
        description="Invoque un barde dans ton salon vocal pour mettre ta musique.",
    )
    async def barde(self, interaction: discord.Interaction):
        temp = getattr(self.bot.manager, "temp", None)
        if temp is None or not temp.pool:
            await interaction.response.send_message(
                "Aucun barde libre n'est configuré sur ce serveur.", ephemeral=True
            )
            return
        res = await temp.summon(interaction.user)
        messages = {
            "no_voice": "🔇 Rejoins d'abord un salon vocal.",
            "radio_channel": "Ce salon a déjà son barde attitré — /barde sert aux salons temporaires.",
            "pool_full": "⏳ Tous les bardes sont occupés. Réessaie quand un salon se libère.",
            "no_access": "Le barde n'a pas accès à ce salon (vérifie ses permissions).",
            "error": "Impossible d'invoquer un barde ici pour le moment.",
        }
        if isinstance(res, str):
            await interaction.response.send_message(messages[res], ephemeral=True)
        else:
            await interaction.response.send_message(
                f"🎶 Barde prêt dans <#{res.channel_id}> ! Ajoute tes musiques via le panneau du salon.",
                ephemeral=True,
            )


async def setup(bot):
    await bot.add_cog(MusicCog(bot))
