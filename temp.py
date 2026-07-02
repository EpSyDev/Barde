"""Salons temporaires (TempVoice) : bots « flottants » du pool.

Un membre lance /barde dans son salon temporaire → un bot libre le rejoint et
joue les URLs de son choix (téléchargement + lecture immédiate, SANS validation).
Quand le dernier humain quitte le salon, le bot se déconnecte, vide la file et
supprime les fichiers. Isolé du système radio (players/libraries fixes).
"""
import asyncio
import logging
import shutil

import discord

import config
from public import fmt_duration

log = logging.getLogger("bot.temp")

STREAM_BEFORE = "-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5"


class TempSession:
    """Session musicale éphémère dans un salon vocal temporaire."""

    def __init__(self, bot, channel_id, manager):
        self.bot = bot
        self.channel_id = channel_id
        self.manager = manager
        self.voice = None
        self.queue = []          # pistes en attente
        self.current = None
        self.dir = config.MEDIA_DIR / "temp" / str(channel_id)
        self.panel_message = None
        self._lock = asyncio.Lock()
        self._epoch = 0

    # --- Cycle de vie ---
    async def open(self):
        self.dir.mkdir(parents=True, exist_ok=True)
        channel = self.bot.get_channel(self.channel_id)
        self.voice = await channel.connect(self_deaf=True)
        self.panel_message = await channel.send(embed=self.embed(), view=TempView(self))

    async def cleanup(self):
        self._epoch += 1
        try:
            if self.voice and self.voice.is_connected():
                if self.voice.is_playing() or self.voice.is_paused():
                    self.voice.stop()
                await self.voice.disconnect()
        except Exception:  # noqa: BLE001
            pass
        self.voice = None
        if self.panel_message:
            try:
                await self.panel_message.delete()
            except Exception:  # noqa: BLE001
                pass
            self.panel_message = None
        shutil.rmtree(self.dir, ignore_errors=True)

    # --- File & lecture ---
    async def add(self, track):
        self.queue.append(track)
        playing = self.voice and (self.voice.is_playing() or self.voice.is_paused())
        if not playing:
            await self.play_next()
        else:
            await self.refresh_panel()

    async def play_next(self):
        async with self._lock:
            channel = self.bot.get_channel(self.channel_id)
            if channel is None:
                return
            if not self.queue:
                self.current = None
                await self.refresh_panel()
                return
            track = self.queue.pop(0)
            self.current = track
            if self.voice is None or not self.voice.is_connected():
                self.voice = await channel.connect(self_deaf=True)

            self._epoch += 1
            my_epoch = self._epoch
            if self.voice.is_playing() or self.voice.is_paused():
                self.voice.stop()

            if track.get("live"):
                stream_url = await self._extract_stream(track["url"])
                if my_epoch != self._epoch:
                    return
                source = discord.FFmpegOpusAudio(
                    stream_url, bitrate=96, executable=config.FFMPEG_PATH,
                    before_options=STREAM_BEFORE, options="-vn",
                )
            else:
                source = discord.FFmpegOpusAudio(
                    track["file"], codec="copy", executable=config.FFMPEG_PATH,
                    options="-vn",
                )
            self.voice.play(source, after=self._after(my_epoch))
        await self.refresh_panel()

    async def skip(self):
        if self.voice and (self.voice.is_playing() or self.voice.is_paused()):
            self.voice.stop()      # déclenche _after → play_next
        else:
            await self.play_next()

    async def _extract_stream(self, url):
        import yt_dlp
        loop = asyncio.get_running_loop()

        def run():
            with yt_dlp.YoutubeDL(config.ytdl_base_opts()) as ydl:
                info = ydl.extract_info(url, download=False)
                if "entries" in info:
                    info = info["entries"][0]
                return info["url"]

        return await loop.run_in_executor(None, run)

    def _after(self, epoch):
        def cb(error):
            if error:
                log.error("[temp %s] lecture : %s", self.channel_id, error)
            if epoch != self._epoch:
                return
            asyncio.run_coroutine_threadsafe(self.play_next(), self.bot.loop)
        return cb

    # --- Affichage ---
    def embed(self):
        e = discord.Embed(title="🎶 Barde éphémère", color=0x9B59B6)
        if self.current:
            live = " 🔴 live" if self.current.get("live") else ""
            e.description = f"**▶️ En lecture**\n## {self.current['title']}{live}"
            if self.current.get("thumb"):
                e.set_thumbnail(url=self.current["thumb"])
        else:
            e.description = "*File vide — clique ➕ Ajouter pour lancer une musique.*"
        if self.queue:
            lines = []
            for i, t in enumerate(self.queue[:10]):
                dur = f" ({fmt_duration(t['duration'])})" if t.get("duration") else ""
                lines.append(f"`{i + 1}.` {t['title'][:55]}{dur}")
            more = len(self.queue) - 10
            if more > 0:
                lines.append(f"*… +{more}*")
            e.add_field(name="🗂️ File d'attente", value="\n".join(lines), inline=False)
        e.set_footer(text="Réservé aux membres du salon • tout disparaît quand le salon se vide.")
        return e

    async def refresh_panel(self):
        if not self.panel_message:
            return
        try:
            await self.panel_message.edit(embed=self.embed(), view=TempView(self))
        except discord.HTTPException:
            self.panel_message = None


class TempUrlModal(discord.ui.Modal):
    def __init__(self, session):
        super().__init__(title="Ajouter une musique")
        self.session = session
        self.url = discord.ui.TextInput(
            label="Lien (YouTube…)",
            placeholder="https://www.youtube.com/watch?v=...",
            required=True,
            max_length=400,
        )
        self.add_item(self.url)

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            track = await self.session.manager.baker.fetch(
                self.url.value.strip(), self.session.dir
            )
        except Exception as exc:  # noqa: BLE001
            log.error("[temp %s] fetch : %s", self.session.channel_id, exc)
            track = None
        if not track:
            await interaction.followup.send(
                "⚠️ Impossible de récupérer cette piste (lien invalide ou indisponible).",
                ephemeral=True,
            )
            return
        await self.session.add(track)
        await interaction.followup.send(f"🎵 **{track['title']}** ajoutée.", ephemeral=True)


class TempView(discord.ui.View):
    """Panneau du salon temporaire : ajouter / suivant / stop (membres présents)."""

    def __init__(self, session):
        super().__init__(timeout=None)
        self.session = session
        self._build()

    def _build(self):
        for label, style, action in [
            ("➕ Ajouter", discord.ButtonStyle.success, "add"),
            ("⏭️ Suivant", discord.ButtonStyle.secondary, "skip"),
            ("⏹️ Stop", discord.ButtonStyle.danger, "stop"),
        ]:
            btn = discord.ui.Button(label=label, style=style)
            btn.callback = self._make_cb(action)
            self.add_item(btn)

    def _check_vc(self, interaction: discord.Interaction):
        vc = getattr(getattr(interaction.user, "voice", None), "channel", None)
        return vc and vc.id == self.session.channel_id

    def _make_cb(self, action):
        async def callback(interaction: discord.Interaction):
            if not self._check_vc(interaction):
                await interaction.response.send_message(
                    "🔇 Rejoins le salon pour piloter la musique.", ephemeral=True
                )
                return
            if action == "add":
                await interaction.response.send_modal(TempUrlModal(self.session))
            elif action == "skip":
                await interaction.response.defer()
                await self.session.skip()
            elif action == "stop":
                await interaction.response.send_message(
                    "⏹️ Barde congédié, file nettoyée.", ephemeral=True
                )
                await self.session.manager.temp.close(self.session.channel_id)

        return callback


class PoolBot(discord.Client):
    """Bot flottant : rejoint un salon temporaire à la demande, se nettoie quand il se vide."""

    def __init__(self, manager, **kwargs):
        super().__init__(**kwargs)
        self.manager = manager
        self.session = None

    async def on_ready(self):
        log.info("[pool] barde libre connecté : %s", self.user)

    async def on_voice_state_update(self, member, before, after):
        s = self.session
        if s is None or member.bot:
            return
        left = (
            before.channel and before.channel.id == s.channel_id
            and (after.channel is None or after.channel.id != s.channel_id)
        )
        if not left:
            return
        channel = self.get_channel(s.channel_id)
        if channel is None or not any(not m.bot for m in channel.members):
            await self.manager.temp.close(s.channel_id)

    async def on_guild_channel_delete(self, channel):
        s = self.session
        if s and channel.id == s.channel_id:
            await self.manager.temp.close(s.channel_id)


class TempManager:
    """Alloue les bots du pool aux salons temporaires et suit les sessions actives."""

    def __init__(self, manager):
        self.manager = manager
        self.pool = []                 # PoolBot
        self.sessions = {}             # channel_id -> TempSession

    def register_bot(self, bot):
        self.pool.append(bot)

    def _free_bot(self):
        for b in self.pool:
            if b.session is None and b.is_ready():
                return b
        return None

    async def summon(self, member):
        vc = getattr(getattr(member, "voice", None), "channel", None)
        if vc is None:
            return "no_voice"
        if vc.id in self.sessions:
            return self.sessions[vc.id]           # déjà actif
        if vc.id in {p.slot.channel_id for p in self.manager.players.values()}:
            return "radio_channel"
        bot = self._free_bot()
        if bot is None:
            return "pool_full"
        if bot.get_channel(vc.id) is None:
            return "no_access"
        session = TempSession(bot, vc.id, self.manager)
        self.sessions[vc.id] = session
        bot.session = session
        try:
            await session.open()
        except Exception as exc:  # noqa: BLE001
            log.error("[temp] ouverture salon %s : %s", vc.id, exc)
            self.sessions.pop(vc.id, None)
            bot.session = None
            await session.cleanup()
            return "error"
        return session

    async def close(self, channel_id):
        session = self.sessions.pop(channel_id, None)
        if session is None:
            return
        session.bot.session = None
        await session.cleanup()

    async def close_all(self):
        for cid in list(self.sessions):
            await self.close(cid)
