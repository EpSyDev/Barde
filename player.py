"""Lecture d'un salon : playlist locale en boucle (copie opus = ~0 CPU), live en repli streaming."""
import asyncio
import logging
import random

import discord
import yt_dlp

import config

log = logging.getLogger("bot.player")

# Reconnexion FFmpeg (utile uniquement pour les flux live en streaming).
STREAM_BEFORE = "-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5"


class VoicePlayer:
    """Joue la playlist de son salon en boucle ; un fichier à la fois."""

    def __init__(self, client, slot, library, manager):
        self.bot = client
        self.slot = slot
        self.library = library
        self.manager = manager
        self.voice = None
        self.active = False
        self.paused = False
        self.pos = 0
        self._epoch = 0
        self._current = None
        self._lock = asyncio.Lock()

    # --- État exposé au panneau ---
    @property
    def current(self):
        return self._current

    @property
    def current_title(self):
        return self._current.get("title") if self._current else None

    @property
    def is_playing(self):
        return bool(self.voice and self.voice.is_playing())

    @property
    def queue_len(self):
        return len(self.library.tracks)

    # --- Connexion ---
    async def ensure_connected(self):
        channel = self.bot.get_channel(self.slot.channel_id)
        if channel is None:
            raise RuntimeError(f"Salon introuvable (id {self.slot.channel_id}).")
        if self.voice is None or not self.voice.is_connected():
            self.voice = await channel.connect(reconnect=True, self_deaf=True)
        elif self.voice.channel.id != channel.id:
            await self.voice.move_to(channel)
        return self.voice

    async def _extract_stream(self, url):
        loop = asyncio.get_running_loop()

        def run():
            with yt_dlp.YoutubeDL(config.ytdl_base_opts()) as ydl:
                info = ydl.extract_info(url, download=False)
                if "entries" in info:
                    info = info["entries"][0]
                return info["url"]

        return await loop.run_in_executor(None, run)

    def _next_pos(self):
        n = len(self.library.tracks)
        if n == 0:
            return None
        if self.library.shuffle and n > 1:
            nxt = random.randrange(n)
            while nxt == self.pos:
                nxt = random.randrange(n)
            return nxt
        return (self.pos + 1) % n

    # --- Actions ---
    async def start(self):
        self.active = True
        await self.ensure_connected()
        if self.library.tracks:
            # Reprise : on repart à la position mémorisée (sinon au début).
            start_pos = self.library.pos
            if not 0 <= start_pos < len(self.library.tracks):
                start_pos = 0
            await self._play_at(start_pos)

    async def notify_added(self):
        """Appelé par le baker quand une piste est prête."""
        if self.active and not self.is_playing and self.library.tracks:
            await self._play_at(len(self.library.tracks) - 1)

    async def skip(self):
        nxt = self._next_pos()
        if nxt is not None:
            await self._play_at(nxt)

    async def toggle_shuffle(self):
        self.library.set_shuffle(not self.library.shuffle)

    async def stop(self):
        self.active = False
        self._epoch += 1
        if self.voice and (self.voice.is_playing() or self.voice.is_paused()):
            self.voice.stop()
        self.paused = False
        self._current = None

    async def pause(self):
        if self.voice and self.voice.is_playing():
            self.voice.pause()
            self.paused = True

    async def resume(self):
        if self.voice and self.voice.is_paused():
            self.voice.resume()
            self.paused = False

    async def disconnect(self):
        await self.stop()
        if self.voice and self.voice.is_connected():
            await self.voice.disconnect()
        self.voice = None

    # --- Coeur de lecture ---
    async def _play_at(self, pos):
        async with self._lock:
            if not self.active or not self.library.tracks:
                return
            pos %= len(self.library.tracks)
            self.pos = pos
            self.library.set_pos(pos)   # mémorise pour la reprise au reboot
            track = self.library.tracks[pos]
            await self.ensure_connected()

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
                # Fichier local opus → copie directe (aucun ré-encodage).
                source = discord.FFmpegOpusAudio(
                    self.library.path(track), codec="copy",
                    executable=config.FFMPEG_PATH, options="-vn",
                )

            self.voice.play(source, after=self._make_after(my_epoch))
            self._current = track
            self.paused = False
            log.info("[%s] ▶ %s", self.slot.name, track.get("title"))

    def _make_after(self, epoch):
        def after(error):
            if error:
                log.error("[%s] erreur lecture : %s", self.slot.name, error)
            if not self.active or epoch != self._epoch:
                return
            nxt = self._next_pos()
            if nxt is None:
                return
            asyncio.run_coroutine_threadsafe(self._play_at(nxt), self.bot.loop)
        return after
