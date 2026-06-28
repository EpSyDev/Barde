"""Panneau /panel : sélecteur de salon + boutons, embed aéré, auto-rafraîchi."""
import logging

import discord

import config

log = logging.getLogger("bot.ui")


def is_admin(interaction: discord.Interaction) -> bool:
    perms = getattr(interaction.user, "guild_permissions", None)
    if perms and perms.administrator:
        return True
    if config.ADMIN_ROLE_ID:
        roles = getattr(interaction.user, "roles", [])
        return any(r.id == config.ADMIN_ROLE_ID for r in roles)
    return False


def _bar(pct, width=12):
    pct = max(0, min(100, int(pct)))
    filled = round(pct / 100 * width)
    return "▓" * filled + "░" * (width - filled)


def _status_line(manager, index):
    """Ligne d'activité : téléchargement en cours, ou file d'attente."""
    pct = manager.baker.progress.get(index)
    if pct is not None:
        return f"⏳ Téléchargement  `{_bar(pct)}`  {pct}%"
    pend = manager.baker.pending(index)
    if pend:
        return f"⏳ En préparation… ({pend} en file)"
    return None


def build_panel_embed(manager, selected=None) -> discord.Embed:
    if selected is None and manager.indexes:
        selected = manager.indexes[0]

    embed = discord.Embed(
        title="🎛️  Panneau des Bardes",
        description="*Choisis un salon dans le menu, puis pilote-le avec les boutons.*\n​",
        color=0x5865F2,
    )

    for index in manager.indexes:
        p = manager.get(index)
        lib = p.library
        if p.is_playing and not p.paused:
            etat = "🟢 En lecture"
        elif p.paused:
            etat = "🟠 En pause"
        else:
            etat = "🔴 Arrêté"
        mode = "🔀 Aléatoire" if lib.shuffle else "🔁 Boucle"
        flag = "  ⬅️ **sélectionné**" if index == selected else ""

        value = (
            f"📺 <#{p.slot.channel_id}>\n"
            f"🎶 **{p.current_title or '—'}**\n"
            f"🗂️ {len(lib.tracks)} piste(s) • {mode} • {etat}"
        )
        status = _status_line(manager, index)
        if status:
            value += f"\n{status}"
        value += "\n​"   # espace en bas pour aérer

        embed.add_field(name=f"🎷 Salon {index} — {p.slot.name}{flag}", value=value, inline=False)

    if selected:
        p = manager.get(selected)
        lines = []
        for i, t in enumerate(p.library.tracks[:12]):
            mark = "▶️ " if t is p.current else f"`{i + 1:>2}.` "
            live = " 🔴 live" if t.get("live") else ""
            lines.append(f"{mark}{t['title'][:58]}{live}")
        more = len(p.library.tracks) - 12
        if more > 0:
            lines.append(f"*… et {more} autre(s)*")
        embed.add_field(
            name=f"📋 File d'attente — {p.slot.name}",
            value="\n".join(lines) or "*Vide — clique ➕ Ajouter pour lancer une musique.*",
            inline=False,
        )

    embed.set_footer(text="Bardes • radios locales • lecture sans ré-encodage (≈ 0 CPU)")
    return embed


class UrlModal(discord.ui.Modal):
    def __init__(self, manager, index, panel_message):
        super().__init__(title=f"Ajouter une piste — salon {index}")
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
        await self.manager.baker.enqueue(self.index, self.url.value.strip())
        await interaction.followup.send(
            "⏳ Préparation lancée — la progression s'affiche sur le panneau, "
            "et la piste démarrera dès qu'elle est prête.",
            ephemeral=True,
        )


class PanelView(discord.ui.View):
    def __init__(self, manager):
        super().__init__(timeout=None)
        self.manager = manager
        self.selected = manager.indexes[0] if manager.indexes else None
        self._build()

    def _build(self):
        select = discord.ui.Select(
            placeholder="🎷 Choisir un salon à piloter…",
            custom_id="panel:select",
            row=0,
            options=[
                discord.SelectOption(
                    label=f"Salon {i} · {self.manager.get(i).slot.name}"[:100],
                    value=str(i),
                    emoji="🎶",
                    default=(i == self.selected),
                )
                for i in self.manager.indexes
            ] or [discord.SelectOption(label="—", value="0")],
        )
        select.callback = self._on_select
        self.add_item(select)

        actions = [
            ("➕ Ajouter", discord.ButtonStyle.success, "add", 1),
            ("⏯️ Lecture / Pause", discord.ButtonStyle.primary, "playpause", 1),
            ("⏭️ Suivant", discord.ButtonStyle.secondary, "skip", 1),
            ("⏹️ Stop", discord.ButtonStyle.danger, "stop", 1),
            ("🔀 Aléatoire", discord.ButtonStyle.secondary, "shuffle", 2),
            ("📋 Voir la file", discord.ButtonStyle.secondary, "queue", 2),
            ("🗑️ Vider", discord.ButtonStyle.danger, "clear", 2),
            ("🔄 Rafraîchir", discord.ButtonStyle.secondary, "refresh", 2),
        ]
        for label, style, action, row in actions:
            btn = discord.ui.Button(
                label=label, style=style, row=row, custom_id=f"panel:{action}",
            )
            btn.callback = self._make_cb(action)
            self.add_item(btn)

    def _embed(self):
        return build_panel_embed(self.manager, self.selected)

    async def _on_select(self, interaction: discord.Interaction):
        if not is_admin(interaction):
            await interaction.response.send_message("⛔ Réservé aux admins.", ephemeral=True)
            return
        self.selected = int(interaction.data["values"][0])
        self.manager.set_panel(interaction.message, self)
        await interaction.response.edit_message(embed=self._embed(), view=self)

    def _make_cb(self, action):
        async def callback(interaction: discord.Interaction):
            if not is_admin(interaction):
                await interaction.response.send_message("⛔ Réservé aux admins.", ephemeral=True)
                return
            if self.selected is None:
                await interaction.response.send_message("Aucun salon configuré.", ephemeral=True)
                return
            self.manager.set_panel(interaction.message, self)
            player = self.manager.get(self.selected)

            if action == "add":
                await interaction.response.send_modal(
                    UrlModal(self.manager, self.selected, interaction.message)
                )
                return

            if action == "queue":
                await self._show_queue(interaction, player)
                return

            if action == "playpause":
                if player.is_playing:
                    await player.pause()
                elif player.paused:
                    await player.resume()
                else:
                    await player.start()
            elif action == "skip":
                await player.skip()
            elif action == "stop":
                await player.stop()
            elif action == "shuffle":
                await player.toggle_shuffle()
            elif action == "clear":
                await player.stop()
                player.library.clear()

            await interaction.response.edit_message(embed=self._embed(), view=self)

        return callback

    async def _show_queue(self, interaction, player):
        lines = []
        for i, t in enumerate(player.library.tracks):
            mark = "▶️" if t is player.current else f"{i + 1}."
            live = " 🔴 (live)" if t.get("live") else ""
            lines.append(f"{mark} {t['title']}{live}")
        text = "\n".join(lines) or "*File vide.*"
        embed = discord.Embed(
            title=f"📋 File complète — {player.slot.name}",
            description=text[:4000],
            color=0x5865F2,
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)
