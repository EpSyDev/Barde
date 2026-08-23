"""Module « Aide » : commande ``/help`` qui liste les commandes disponibles.

Ne recopie pas une liste à la main (qui finirait par diverger des vraies
commandes) : lit directement l'arbre de commandes du bot au moment de
l'appel, et exclut automatiquement tout ce qui est réservé aux admins
(``default_permissions(administrator=True)``, posé sur ``/ano`` et le
groupe ``/eco``) — pas de liste d'exclusion à maintenir à la main non plus.
"""
import discord
from discord import app_commands

COLOR = 0xC9A44A


def _is_admin_only(cmd: app_commands.Command | app_commands.Group) -> bool:
    perms = getattr(cmd, "default_permissions", None)
    return bool(perms and perms.administrator)


def _public_lines(tree: app_commands.CommandTree, guild: discord.Object | None) -> list[str]:
    commands = tree.get_commands(guild=guild)
    lines = []
    for cmd in sorted(commands, key=lambda c: c.name):
        if _is_admin_only(cmd):
            continue
        if isinstance(cmd, app_commands.Group):
            for sub in sorted(cmd.commands, key=lambda c: c.name):
                if _is_admin_only(sub):
                    continue
                lines.append(f"**/{cmd.name} {sub.name}** — {sub.description}")
            continue
        lines.append(f"**/{cmd.name}** — {cmd.description}")
    return lines


def setup(tree: app_commands.CommandTree, guild: discord.Object | None) -> None:
    """Enregistre ``/help`` sur l'arbre (portée serveur si ``guild`` fourni)."""

    @tree.command(name="help", description="Voir la liste des commandes et ce qu'elles font.", guild=guild)
    async def help_cmd(interaction: discord.Interaction):
        lines = _public_lines(tree, guild)
        embed = discord.Embed(
            title="📖 Commandes disponibles",
            description="\n".join(lines) or "Aucune commande disponible.",
            color=COLOR,
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)
