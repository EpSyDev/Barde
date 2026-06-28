"""Lecture audio d'un salon vocal : stream YouTube en boucle, robuste aux changements d'URL."""
import asyncio
import logging

import discord
import yt_dlp

import config

log = logging.getLogger("bot.player")

# Extraction du flux audio sans téléchargement.
def _ytdl_opts():
    opts = {
        # Privilégie l'audio opus : Discord l'accepte tel quel (copie sans
        # ré-encodage = quasi 0 CPU).
        "format": "bestaudio[acodec=opus]/bestaudio/best",
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "default_search": "auto",
        "source_address": "0.0.0.0",
        # Télécharge le solveur JS (EJS) pour résoudre les challenges de
        # signature YouTube. Nécessite un runtime JS (deno) installé.
        "remote_components": ["ejs:github"],
    }
    cookies = config.cookies_path()
    if cookies:
        # Cookies d'un compte YouTube : contourne le blocage des IP datacenter.
        opts["cookiefile"] = cookies
    return opts

# -reconnect : FFmpeg reprend le stream si la connexion lâche (utile sur 3H).
FFMPEG_OPTIONS = {
    "before_options": (
        "-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5"
    ),
    "options": "-vn",
}


class VoicePlayer:
    """Gère la lecture en boucle d'une URL dans un salon vocal."""

    def __init__(self, bot, slot, manager):
        self.bot = bot
        self.slot = slot          # objet Slot (index, channel_id, name, url)
        self.manager = manager
        self.voice = None
        self.active = False       # True = ce salon doit jouer en boucle
        self.paused = False
        self._epoch = 0           # invalide les rappels "after" obsolètes
        self._current_title = None
        self._lock = asyncio.Lock()

    # --- État exposé au panneau ---
    @property
    def current_title(self):
        return self._current_title

    @property
    def is_playing(self):
        return bool(self.voice and self.voice.is_playing())

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

    # --- Extraction du flux ---
    async def _extract(self, url):
        loop = asyncio.get_running_loop()

        def run():
            with yt_dlp.YoutubeDL(_ytdl_opts()) as ydl:
                info = ydl.extract_info(url, download=False)
                if "entries" in info:
                    info = info["entries"][0]
                return info["url"], info.get("title", "Inconnu")

        return await loop.run_in_executor(None, run)

    # --- Coeur de la lecture ---
    async def _play_current(self):
        async with self._lock:
            if not self.active or not self.slot.url:
                return
            await self.ensure_connected()

            self._epoch += 1
            my_epoch = self._epoch

            if self.voice.is_playing() or self.voice.is_paused():
                self.voice.stop()  # l'ancien "after" sera ignoré (epoch obsolète)

            stream_url, title = await self._extract(self.slot.url)
            if my_epoch != self._epoch:
                return  # une autre lecture a pris le relais pendant l'extraction

            # from_probe détecte le codec : si la source est déjà en opus,
            # FFmpeg le copie sans ré-encoder (CPU quasi nul). Sinon il
            # ré-encode en repli.
            source = await discord.FFmpegOpusAudio.from_probe(
                stream_url,
                executable=config.FFMPEG_PATH,
                **FFMPEG_OPTIONS,
            )
            self.voice.play(source, after=self._make_after(my_epoch))
            self._current_title = title
            self.paused = False
            log.info("[%s] Lecture : %s", self.slot.name, title)

    def _make_after(self, epoch):
        def after(error):
            if error:
                log.error("[%s] Erreur lecture : %s", self.slot.name, error)
            # On ne relance que si la lecture est toujours d'actualité.
            if not self.active or epoch != self._epoch:
                return
            asyncio.run_coroutine_threadsafe(
                self._play_current(), self.bot.loop
            )
        return after

    # --- Actions ---
    async def start(self):
        """Démarre (ou redémarre) la lecture de l'URL courante."""
        self.active = True
        await self._play_current()

    async def change_url(self, url):
        """Change l'URL et lance immédiatement la lecture."""
        self.slot.url = url
        self.manager.save()
        self.active = True
        await self._play_current()

    async def stop(self):
        """Arrête la lecture (reste connecté au salon)."""
        self.active = False
        self._epoch += 1
        if self.voice and (self.voice.is_playing() or self.voice.is_paused()):
            self.voice.stop()
        self.paused = False
        self._current_title = None

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
