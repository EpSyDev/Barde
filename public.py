"""Jukebox public : embed posté dans le chat du salon vocal, les membres présents choisissent."""
import logging
import time

import discord

import config

log = logging.getLogger("bot.public")


def fmt_duration(seconds):
    if not seconds:
        return "—"
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def parse_seek(text: str):
    """Convertit '1:23:45', '83:00' ou '5400' en secondes. Retourne None si invalide."""
    text = text.strip()
    parts = text.split(":")
    try:
        if len(parts) == 1:
            return max(0, int(parts[0]))
        if len(parts) == 2:
            return max(0, int(parts[0]) * 60 + int(parts[1]))
        if len(parts) == 3:
            return max(0, int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2]))
    except ValueError:
        pass
    return None


def build_public_embed(player) -> discord.Embed:
    cur = player.current
    embed = discord.Embed(
        title=f"🎷  {player.slot.name}",
        color=0x2ECC71 if player.is_playing else 0x95A5A6,
    )
    if cur:
        dur = cur.get("duration")
        pos = player.current_position
        if dur:
            time_str = f"{fmt_duration(pos)} / {fmt_duration(dur)}"
        elif pos:
            time_str = fmt_duration(pos)
        else:
            time_str = "—"
        embed.description = (
            f"**▶️ En lecture**\n## {cur['title']}\n"
            f"⏱️ {time_str}"
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


class SeekModal(discord.ui.Modal):
    """Modal de saisie de position (partagé entre panel admin et jukebox public)."""

    def __init__(self, player):
        super().__init__(title=f"Avancer dans la piste — {player.slot.name}")
        self.player = player
        self.time_input = discord.ui.TextInput(
            label="Position (ex : 1:23:45  ou  83:00  ou  5400)",
            placeholder="H:MM:SS",
            required=True,
            max_length=10,
        )
        self.add_item(self.time_input)

    async def on_submit(self, interaction: discord.Interaction):
        seconds = parse_seek(self.time_input.value)
        if seconds is None:
            await interaction.response.send_message(
                "Format invalide. Exemples : `1:23:45`, `83:00`, `5400` (secondes).",
                ephemeral=True,
            )
            return
        await self.player.seek(seconds)
        await interaction.response.send_message(
            f"⏩ Saut à **{fmt_duration(seconds)}**.", ephemeral=True
        )


class DjModal(discord.ui.Modal):
    """Modal de proposition de piste (salon DJ uniquement)."""

    def __init__(self, player):
        super().__init__(title=f"Proposer une piste — {player.slot.name}")
        self.player = player
        self.url_input = discord.ui.TextInput(
            label="Lien YouTube",
            placeholder="https://www.youtube.com/watch?v=...",
            required=True,
            max_length=400,
        )
        self.add_item(self.url_input)

    async def on_submit(self, interaction: discord.Interaction):
        user_id = interaction.user.id
        now = time.time()
        remaining = int(config.DJ_COOLDOWN - (now - self.player.dj_cooldowns.get(user_id, 0)))
        if remaining > 0:
            m, s = divmod(remaining, 60)
            await interaction.response.send_message(
                f"⏳ Tu pourras proposer une nouvelle piste dans **{m}min {s:02d}s**.",
                ephemeral=True,
            )
            return
        self.player.dj_cooldowns[user_id] = now
        await self.player.manager.baker.enqueue(
            self.player.slot.index, self.url_input.value.strip()
        )
        await interaction.response.send_message(
            "🎵 Piste proposée ! Elle apparaîtra dans la file dès le téléchargement terminé.",
            ephemeral=True,
        )


class SuggestModal(discord.ui.Modal):
    """Modal de suggestion (soumise à validation admin, ouverte à tous)."""

    def __init__(self, manager, index):
        super().__init__(title="Suggérer une musique")
        self.manager = manager
        self.index = index
        self.url_input = discord.ui.TextInput(
            label="Lien de la musique (YouTube…)",
            placeholder="https://www.youtube.com/watch?v=...",
            required=True,
            max_length=400,
        )
        self.add_item(self.url_input)

    async def on_submit(self, interaction: discord.Interaction):
        now = time.time()
        last = self.manager.suggest_cooldowns.get(interaction.user.id, 0)
        remaining = int(config.SUGGEST_COOLDOWN - (now - last))
        if remaining > 0:
            m, s = divmod(remaining, 60)
            await interaction.response.send_message(
                f"⏳ Patiente encore **{m}min {s:02d}s** avant une nouvelle suggestion.",
                ephemeral=True,
            )
            return
        ok = await self.manager.post_suggestion(
            interaction.user, self.url_input.value.strip(), self.index
        )
        if not ok:
            await interaction.response.send_message(
                "⚠️ Aucun salon de notification n'est configuré. Préviens un admin.",
                ephemeral=True,
            )
            return
        self.manager.suggest_cooldowns[interaction.user.id] = now
        await interaction.response.send_message(
            "✅ Ta suggestion a été transmise aux organisateurs. Merci !", ephemeral=True
        )


class PublicView(discord.ui.View):
    """Sélecteur de piste + seek, ouvert aux membres présents dans le salon vocal."""

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
            row=0,
        )
        select.callback = self._on_pick
        self.add_item(select)

        seek_btn = discord.ui.Button(
            label="⏩ Position",
            style=discord.ButtonStyle.secondary,
            custom_id=f"public:{self.index}:seek",
            disabled=not bool(p.current and not p.current.get("live")),
            row=1,
        )
        seek_btn.callback = self._on_seek
        self.add_item(seek_btn)

        suggest_btn = discord.ui.Button(
            label="🎵 Suggérer une muzik",
            style=discord.ButtonStyle.primary,
            custom_id=f"public:{self.index}:suggest",
            row=2,
        )
        suggest_btn.callback = self._on_suggest
        self.add_item(suggest_btn)

        if config.DJ_SLOT and self.index == config.DJ_SLOT:
            dj_btn = discord.ui.Button(
                label="➕ Proposer une piste",
                style=discord.ButtonStyle.primary,
                custom_id=f"public:{self.index}:dj",
                row=1,
            )
            dj_btn.callback = self._on_dj
            self.add_item(dj_btn)

    def _check_vc(self, interaction: discord.Interaction):
        player = self._player()
        member = interaction.user
        vc = getattr(getattr(member, "voice", None), "channel", None)
        return vc and vc.id == player.slot.channel_id

    async def _on_pick(self, interaction: discord.Interaction):
        if not self._check_vc(interaction):
            await interaction.response.send_message(
                "🔇 Rejoins le salon vocal pour choisir sa musique.", ephemeral=True
            )
            return
        player = self._player()
        pos = int(interaction.data["values"][0])
        if pos < 0 or pos >= len(player.library.tracks):
            await interaction.response.send_message("Piste introuvable.", ephemeral=True)
            return
        await player._play_at(pos)
        self._build()
        await interaction.response.edit_message(embed=build_public_embed(player), view=self)
        await self.manager.refresh_panel()

    async def _on_seek(self, interaction: discord.Interaction):
        if not self._check_vc(interaction):
            await interaction.response.send_message(
                "🔇 Rejoins le salon vocal pour avancer dans la musique.", ephemeral=True
            )
            return
        await interaction.response.send_modal(SeekModal(self._player()))

    async def _on_dj(self, interaction: discord.Interaction):
        if not self._check_vc(interaction):
            await interaction.response.send_message(
                "🔇 Rejoins le salon vocal pour proposer une piste.", ephemeral=True
            )
            return
        await interaction.response.send_modal(DjModal(self._player()))

    async def _on_suggest(self, interaction: discord.Interaction):
        await interaction.response.send_modal(SuggestModal(self.manager, self.index))
