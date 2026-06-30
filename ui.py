"""Panneau /panel : sélecteur de salon + boutons, embed aéré, auto-rafraîchi."""
import logging

import discord

import config
from public import SeekModal

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
            ("🗂️ Gérer la file", discord.ButtonStyle.secondary, "manage", 2),
            ("🗑️ Vider", discord.ButtonStyle.danger, "clear", 2),
            ("🔄 Rafraîchir", discord.ButtonStyle.secondary, "refresh", 2),
            ("⏩ Position", discord.ButtonStyle.secondary, "seek", 3),
            ("📢 Publier le jukebox dans le salon", discord.ButtonStyle.success, "publish", 3),
            ("📮 Salon de notif", discord.ButtonStyle.secondary, "notifchan", 4),
        ]
        for label, style, action, row in actions:
            btn = discord.ui.Button(
                label=label, style=style, row=row, custom_id=f"panel:{action}",
            )
            btn.callback = self._make_cb(action)
            self.add_item(btn)

    def _embed(self):
        return build_panel_embed(self.manager, self.selected)

    def _sync_select(self):
        """Aligne l'option 'par défaut' du menu sur le salon sélectionné."""
        for child in self.children:
            if isinstance(child, discord.ui.Select) and child.custom_id == "panel:select":
                for opt in child.options:
                    opt.default = (opt.value == str(self.selected))

    async def _on_select(self, interaction: discord.Interaction):
        if not is_admin(interaction):
            await interaction.response.send_message("⛔ Réservé aux admins.", ephemeral=True)
            return
        self.selected = int(interaction.data["values"][0])
        self.manager.set_panel(interaction.message, self)
        self._sync_select()
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

            if action == "manage":
                view = ManageView(self.manager, self.selected)
                await interaction.response.send_message(
                    embed=view.embed(), view=view, ephemeral=True
                )
                return

            if action == "seek":
                if player.current and not player.current.get("live"):
                    await interaction.response.send_modal(SeekModal(player))
                else:
                    await interaction.response.send_message(
                        "Aucune piste locale en cours (seek indisponible sur les live).",
                        ephemeral=True,
                    )
                return

            if action == "notifchan":
                cur = self.manager.settings.get("notif_channel_id")
                txt = (
                    f"Salon actuel : <#{cur}>" if cur
                    else "Aucun salon de notif configuré pour l'instant."
                )
                await interaction.response.send_message(
                    f"📮 {txt}\nChoisis le salon qui recevra les suggestions des membres :",
                    view=NotifChannelView(self.manager),
                    ephemeral=True,
                )
                return

            if action == "publish":
                await player.publish_public()
                await interaction.response.send_message(
                    f"📢 Jukebox publié dans **{player.slot.name}**.", ephemeral=True
                )
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

            await player.refresh_public()
            self._sync_select()
            await interaction.response.edit_message(embed=self._embed(), view=self)

        return callback

class NotifChannelView(discord.ui.View):
    """Sélecteur natif de salon pour les notifs de suggestion (éphémère)."""

    def __init__(self, manager):
        super().__init__(timeout=180)
        self.manager = manager
        select = discord.ui.ChannelSelect(
            placeholder="Choisir le salon de notification…",
            min_values=1,
            max_values=1,
        )
        select.callback = self._on_pick
        self.add_item(select)

    async def _on_pick(self, interaction: discord.Interaction):
        if not is_admin(interaction):
            await interaction.response.send_message("⛔ Réservé aux admins.", ephemeral=True)
            return
        channel_id = int(interaction.data["values"][0])
        channel = interaction.client.get_channel(channel_id)
        if not hasattr(channel, "send"):
            await interaction.response.edit_message(
                content="⚠️ Ce salon ne peut pas recevoir de message. Choisis un salon textuel.",
                view=self,
            )
            return
        self.manager.settings.set("notif_channel_id", channel_id)
        await interaction.response.edit_message(
            content=f"✅ Salon de notif réglé sur <#{channel_id}>.", view=None
        )


class ManageView(discord.ui.View):
    """Gestion de la file d'un salon : retirer / monter / descendre une piste (éphémère)."""

    def __init__(self, manager, index):
        super().__init__(timeout=180)
        self.manager = manager
        self.index = index
        self.sel = None          # position sélectionnée dans la file
        self._build()

    def _player(self):
        return self.manager.get(self.index)

    def embed(self):
        p = self._player()
        lines = []
        for i, t in enumerate(p.library.tracks[:25]):
            mark = "▶️" if t is p.current else f"`{i + 1:>2}.`"
            cur = " ⬅️" if i == self.sel else ""
            live = " 🔴" if t.get("live") else ""
            lines.append(f"{mark} {t['title'][:60]}{live}{cur}")
        more = len(p.library.tracks) - 25
        if more > 0:
            lines.append(f"*… +{more} (non listées)*")
        return discord.Embed(
            title=f"🗂️ Gérer la file — {p.slot.name}",
            description="\n".join(lines) or "*File vide.*",
            color=0x5865F2,
        ).set_footer(text="Choisis une piste puis : Retirer · Monter · Descendre")

    def _build(self):
        self.clear_items()
        p = self._player()
        options = [
            discord.SelectOption(
                label=f"{i + 1}. {t['title'][:80]}",
                value=str(i),
                default=(i == self.sel),
            )
            for i, t in enumerate(p.library.tracks[:25])
        ]
        select = discord.ui.Select(
            placeholder="Choisir une piste…",
            options=options or [discord.SelectOption(label="(file vide)", value="-1")],
            disabled=not options,
            row=0,
        )
        select.callback = self._on_pick
        self.add_item(select)

        for label, style, action in [
            ("🗑️ Retirer", discord.ButtonStyle.danger, "remove"),
            ("⬆️ Monter", discord.ButtonStyle.secondary, "up"),
            ("⬇️ Descendre", discord.ButtonStyle.secondary, "down"),
        ]:
            btn = discord.ui.Button(label=label, style=style, row=1)
            btn.callback = self._make_cb(action)
            self.add_item(btn)

    async def _on_pick(self, interaction: discord.Interaction):
        if not is_admin(interaction):
            await interaction.response.send_message("⛔ Réservé aux admins.", ephemeral=True)
            return
        self.sel = int(interaction.data["values"][0])
        self._build()
        await interaction.response.edit_message(embed=self.embed(), view=self)

    def _make_cb(self, action):
        async def callback(interaction: discord.Interaction):
            if not is_admin(interaction):
                await interaction.response.send_message("⛔ Réservé aux admins.", ephemeral=True)
                return
            if self.sel is None or self.sel < 0:
                await interaction.response.send_message(
                    "Choisis d'abord une piste dans le menu.", ephemeral=True
                )
                return
            lib = self._player().library
            if action == "remove":
                lib.remove(self.sel)
                self.sel = None
            elif action == "up":
                self.sel = lib.move(self.sel, -1)
            elif action == "down":
                self.sel = lib.move(self.sel, +1)
            self._build()
            await interaction.response.edit_message(embed=self.embed(), view=self)
            await self._player().refresh_public()
            await self.manager.refresh_panel()

        return callback
