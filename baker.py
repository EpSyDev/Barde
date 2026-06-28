"""File de préparation : télécharge + remuxe les pistes en local (tâche de fond)."""
import asyncio
import logging
import os
import uuid

import yt_dlp

import config

log = logging.getLogger("bot.baker")


class Baker:
    """Traite une seule préparation à la fois, en arrière-plan."""

    def __init__(self, manager):
        self.manager = manager
        self.queue = asyncio.Queue()
        self._pending = {}     # index -> nb de jobs en attente/en cours
        self._task = None

    def start(self):
        self._task = asyncio.create_task(self._worker())

    def pending(self, index):
        return self._pending.get(index, 0)

    async def enqueue(self, index, url):
        self._pending[index] = self._pending.get(index, 0) + 1
        await self.queue.put((index, url))

    async def _worker(self):
        while True:
            index, url = await self.queue.get()
            try:
                await self._bake(index, url)
            except Exception as exc:  # noqa: BLE001
                log.error("[slot %s] préparation échouée (%s) : %s", index, url, exc)
            finally:
                self._pending[index] = max(0, self._pending.get(index, 0) - 1)
                self.queue.task_done()

    async def _ydl(self, url, download, outtmpl=None):
        loop = asyncio.get_running_loop()

        def run():
            opts = config.ytdl_base_opts()
            if download:
                opts["outtmpl"] = outtmpl
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=download)
                if "entries" in info:
                    info = info["entries"][0]
                return info, (ydl.prepare_filename(info) if download else None)

        return await loop.run_in_executor(None, run)

    async def _bake(self, index, url):
        lib = self.manager.libraries[index]
        info, _ = await self._ydl(url, download=False)
        title = info.get("title", "Inconnu")

        if info.get("is_live"):
            # Un live ne se télécharge pas : on le jouera en streaming.
            lib.add({"title": title, "url": url, "file": None, "live": True})
        else:
            tid = uuid.uuid4().hex[:12]
            _, downloaded = await self._ydl(
                url, download=True, outtmpl=str(lib.dir / f"{tid}.%(ext)s")
            )
            out = str(lib.dir / f"{tid}.ogg")
            await self._remux(downloaded, out)
            if downloaded and os.path.exists(downloaded) and downloaded != out:
                try:
                    os.remove(downloaded)
                except OSError:
                    pass
            lib.add({"title": title, "url": url, "file": f"{tid}.ogg", "live": False})

        log.info("[slot %s] prêt : %s", index, title)
        await self.manager.players[index].notify_added()

    async def _remux(self, src, dst):
        """Copie l'audio opus dans un conteneur ogg (sans ré-encoder)."""
        if await self._run_ffmpeg(src, dst, ["-c:a", "copy"]):
            return
        # Repli : ré-encodage si la copie échoue (source non-opus).
        await self._run_ffmpeg(
            src, dst,
            ["-c:a", "libopus", "-b:a", "96k", "-ar", "48000", "-ac", "2"],
        )

    async def _run_ffmpeg(self, src, dst, codec_args):
        proc = await asyncio.create_subprocess_exec(
            config.FFMPEG_PATH, "-y", "-i", src, "-vn", *codec_args, dst,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        return await proc.wait() == 0
