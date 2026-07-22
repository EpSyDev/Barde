"""Module « Anonyme » : commande slash ``/ano`` réservée aux administrateurs.

Permet à un admin de faire écrire un message par La Fripouille elle-même :
l'auteur réel reste anonyme — rien dans le salon n'indique qui a lancé la commande.

La saisie passe par une fenêtre (modal) plutôt que par un paramètre de commande :
le contenu du message n'apparaît donc jamais en clair dans l'interface de saisie
de la slash command. Le salon cible est le salon courant par défaut, ou un salon
choisi explicitement.
"""
import logging

import discord
from discord import app_commands

log = logging.getLogger("fripouille.anonyme")

MAX_LEN = 2000  # limite Discord d'un message texte


class AnoModal(discord.ui.Modal, title="Message anonyme"):
    message = discord.ui.TextInput(
        label="Message",
        style=discord.TextStyle.paragraph,
        placeholder="Ce message sera posté par La Fripouille, sans mention de son auteur…",
        max_length=MAX_LEN,
        required=True,
    )

    def __init__(self, channel: discord.abc.Messageable):
        super().__init__()
        self._channel = channel

    async def on_submit(self, interaction: discord.Interaction):
        try:
            await self._channel.send(str(self.message.value))
        except discord.Forbidden:
            await interaction.response.send_message(
                "❌ Je n'ai pas la permission d'écrire dans ce salon.", ephemeral=True
            )
            return
        except discord.HTTPException as exc:  # noqa: BLE001
            log.error("envoi anonyme échoué : %s", exc)
            await interaction.response.send_message(
                f"❌ Échec de l'envoi : {exc}", ephemeral=True
            )
            return
        await interaction.response.send_message(
            f"✅ Message anonyme posté dans {self._channel.mention}.", ephemeral=True
        )


def setup(tree: app_commands.CommandTree, guild: discord.Object | None) -> None:
    """Enregistre la commande ``/ano`` sur l'arbre (portée serveur si ``guild`` fourni)."""

    @tree.command(
        name="ano",
        description="Écrire un message anonyme posté par La Fripouille (admins).",
        guild=guild,
    )
    @app_commands.describe(salon="Salon où poster (par défaut : le salon courant)")
    @app_commands.default_permissions(administrator=True)
    async def ano(  # noqa: D401
        interaction: discord.Interaction,
        salon: discord.TextChannel | None = None,
    ):
        # Garde-fou serveur : la commande ne s'utilise qu'en salon.
        channel = salon or interaction.channel
        if channel is None or not isinstance(channel, discord.abc.Messageable):
            await interaction.response.send_message(
                "❌ Utilise cette commande dans un salon.", ephemeral=True
            )
            return
        await interaction.response.send_modal(AnoModal(channel))
