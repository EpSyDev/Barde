"""Panneau de contrôle interactif (/panel) : un salon par ligne de boutons."""
import logging

import discord

import config

log = logging.getLogger("bot.ui")


def is_admin(interaction: discord.Interaction) -> bool:
    """Administrateur du serveur, ou porteur du rôle ADMIN_ROLE_ID."""
    perms = getattr(interaction.user, "guild_permissions", None)
    if perms and perms.administrator:
        return True
    if config.ADMIN_ROLE_ID:
        roles = getattr(interaction.user, "roles", [])
        return any(r.id == config.ADMIN_ROLE_ID for r in roles)
    return False


def build_panel_embed(manager) -> discord.Embed:
    embed = discord.Embed(
        title="🎛️  Panneau Musique",
        description="Un salon par ligne. Clique sur **🎵** pour définir l'URL.",
        color=0x5865F2,
    )
    for index in sorted(manager.players):
        p = manager.get(index)
        if p.is_playing and not p.paused:
            etat = "▶️ En lecture"
        elif p.paused:
            etat = "⏸️ En pause"
        else:
            etat = "⏹️ Arrêté"
        titre = p.current_title or "—"
        embed.add_field(
            name=f"Salon {index} · {p.slot.name}",
            value=f"<#{p.slot.channel_id}>\n{etat}\n🎵 `{titre}`",
            inline=True,
        )
    if not manager.players:
        embed.add_field(
            name="Aucun salon configuré",
            value="Renseigne `CHANNEL_1..4` dans le `.env`.",
            inline=False,
        )
    return embed


class UrlModal(discord.ui.Modal):
    """Saisie d'une URL YouTube pour un salon."""

    def __init__(self, manager, index, panel_message):
        super().__init__(title=f"URL — Salon {index}")
        self.manager = manager
        self.index = index
        self.panel_message = panel_message
        self.url = discord.ui.TextInput(
            label="Lien YouTube",
            placeholder="https://www.youtube.com/watch?v=...",
            required=True,
            max_length=400,
        )
        self.add_item(self.url)

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True, thinking=True)
        player = self.manager.get(self.index)
        try:
            await player.change_url(self.url.value.strip())
        except Exception as exc:  # noqa: BLE001
            await interaction.followup.send(f"❌ Erreur : {exc}", ephemeral=True)
            return
        await interaction.followup.send(
            f"▶️ **{player.slot.name}** : lecture lancée.", ephemeral=True
        )
        if self.panel_message:
            try:
                await self.panel_message.edit(embed=build_panel_embed(self.manager))
            except discord.HTTPException:
                pass


class PanelView(discord.ui.View):
    """Vue persistante : 4 lignes de salons + 1 ligne globale."""

    def __init__(self, manager):
        super().__init__(timeout=None)
        self.manager = manager
        for row, index in enumerate(sorted(manager.players)):
            self._add_slot_row(index, row)
        self._add_global_row(len(manager.players))

    def _add_slot_row(self, index, row):
        slot = self.manager.get(index).slot
        specs = [
            (f"🎵 {slot.name}"[:80], discord.ButtonStyle.primary, "url"),
            ("▶️", discord.ButtonStyle.success, "play"),
            ("⏸️", discord.ButtonStyle.secondary, "pause"),
            ("⏹️", discord.ButtonStyle.danger, "stop"),
        ]
        for label, style, action in specs:
            btn = discord.ui.Button(
                label=label,
                style=style,
                row=row,
                custom_id=f"panel:slot:{index}:{action}",
            )
            btn.callback = self._slot_callback(index, action)
            self.add_item(btn)

    def _add_global_row(self, row):
        refresh = discord.ui.Button(
            label="🔄 Rafraîchir",
            style=discord.ButtonStyle.secondary,
            row=min(row, 4),
            custom_id="panel:global:refresh",
        )
        refresh.callback = self._global_callback("refresh")
        self.add_item(refresh)

        stopall = discord.ui.Button(
            label="📴 Tout couper",
            style=discord.ButtonStyle.danger,
            row=min(row, 4),
            custom_id="panel:global:stopall",
        )
        stopall.callback = self._global_callback("stopall")
        self.add_item(stopall)

    # --- Callbacks ---
    def _slot_callback(self, index, action):
        async def callback(interaction: discord.Interaction):
            if not is_admin(interaction):
                await interaction.response.send_message(
                    "⛔ Réservé aux administrateurs.", ephemeral=True
                )
                return
            player = self.manager.get(index)

            if action == "url":
                await interaction.response.send_modal(
                    UrlModal(self.manager, index, interaction.message)
                )
                return

            if action == "play":
                if not player.slot.url:
                    await interaction.response.send_message(
                        "⚠️ Aucune URL définie. Clique sur 🎵 d'abord.",
                        ephemeral=True,
                    )
                    return
                await interaction.response.defer()
                try:
                    await player.start()
                except Exception as exc:  # noqa: BLE001
                    await interaction.followup.send(f"❌ {exc}", ephemeral=True)
                await interaction.message.edit(
                    embed=build_panel_embed(self.manager)
                )
                return

            if action == "pause":
                if player.paused:
                    await player.resume()
                else:
                    await player.pause()
            elif action == "stop":
                await player.stop()

            await interaction.response.edit_message(
                embed=build_panel_embed(self.manager)
            )

        return callback

    def _global_callback(self, action):
        async def callback(interaction: discord.Interaction):
            if not is_admin(interaction):
                await interaction.response.send_message(
                    "⛔ Réservé aux administrateurs.", ephemeral=True
                )
                return
            if action == "stopall":
                await interaction.response.defer()
                await self.manager.stop_all()
                await interaction.message.edit(
                    embed=build_panel_embed(self.manager)
                )
            else:  # refresh
                await interaction.response.edit_message(
                    embed=build_panel_embed(self.manager)
                )

        return callback
