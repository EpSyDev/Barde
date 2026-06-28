"""Jukebox public : embed posté dans le chat du salon vocal, les membres présents choisissent."""
import logging

import discord

log = logging.getLogger("bot.public")


def fmt_duration(seconds):
    if not seconds:
        return "—"
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def build_public_embed(player) -> discord.Embed:
    cur = player.current
    embed = discord.Embed(
        title=f"🎷  {player.slot.name}",
        color=0x2ECC71 if player.is_playing else 0x95A5A6,
    )
    if cur:
        embed.description = (
            f"**▶️ En lecture**\n## {cur['title']}\n"
            f"⏱️ {fmt_duration(cur.get('duration'))}"
            + ("  •  🔴 live" if cur.get("live") else "")
        )
        if cur.get("thumb"):
            embed.set_thumbnail(url=cur["thumb"])
    else:
        embed.description = "*Aucune musique en cours.*"

    total = len(player.library.tracks)
    embed.set_footer(
        text=f"{total} piste(s) • choisis ci-dessous (réservé aux membres du salon)"
    )
    return embed


class PublicView(discord.ui.View):
    """Sélecteur de piste ouvert aux membres présents dans le salon vocal."""

    def __init__(self, manager, index):
        super().__init__(timeout=None)
        self.manager = manager
        self.index = index
        self._build()

    def _player(self):
        return self.manager.get(self.index)

    def _build(self):
        self.clear_items()
        p = self._player()
        options = [
            discord.SelectOption(
                label=f"{i + 1}. {t['title'][:80]}",
                value=str(i),
                emoji="🔴" if t.get("live") else "🎵",
                default=(t is p.current),
            )
            for i, t in enumerate(p.library.tracks[:25])
        ]
        select = discord.ui.Select(
            placeholder="🎶 Choisir une musique…",
            custom_id=f"public:{self.index}:pick",
            options=options or [discord.SelectOption(label="(aucune piste)", value="-1")],
            disabled=not options,
        )
        select.callback = self._on_pick
        self.add_item(select)

    async def _on_pick(self, interaction: discord.Interaction):
        player = self._player()
        member = interaction.user
        vc = getattr(getattr(member, "voice", None), "channel", None)
        if not vc or vc.id != player.slot.channel_id:
            await interaction.response.send_message(
                "🔇 Rejoins le salon vocal pour choisir sa musique.", ephemeral=True
            )
            return
        pos = int(interaction.data["values"][0])
        if pos < 0 or pos >= len(player.library.tracks):
            await interaction.response.send_message("Piste introuvable.", ephemeral=True)
            return
        await player._play_at(pos)
        self._build()
        await interaction.response.edit_message(embed=build_public_embed(player), view=self)
        await self.manager.refresh_panel()
