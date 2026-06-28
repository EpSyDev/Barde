"""File de préparation : télécharge + normalise/remuxe les pistes en local (tâche de fond)."""
import asyncio
import logging
import os
import time
import uuid

import yt_dlp

import config

log = logging.getLogger("bot.baker")


def _low_priority():
    if hasattr(os, "nice"):
        try:
            os.nice(19)
        except OSError:
            pass


class Baker:
    """Traite une seule préparation à la fois, en arrière-plan."""

    def __init__(self, manager):
        self.manager = manager
        self.queue = asyncio.Queue()
        self._pending = {}        # index -> nb de jobs en attente/en cours
        self.progress = {}        # index -> % de téléchargement en cours
        self._task = None
        self._loop = None
        self._last_refresh = 0.0

    def start(self):
        self._loop = asyncio.get_running_loop()
        self._task = asyncio.create_task(self._worker())

    def pending(self, index):
        return self._pending.get(index, 0)

    async def enqueue(self, index, url):
        self._pending[index] = self._pending.get(index, 0) + 1
        await self.queue.put((index, url))
        await self.manager.refresh_panel()

    async def _worker(self):
        while True:
            index, url = await self.queue.get()
            try:
                await self._bake(index, url)
            except Exception as exc:  # noqa: BLE001
                log.error("[slot %s] préparation échouée (%s) : %s", index, url, exc)
            finally:
                self._pending[index] = max(0, self._pending.get(index, 0) - 1)
                self.progress.pop(index, None)
                self.queue.task_done()
                await self.manager.refresh_panel()

    # --- Hooks de progression ---
    def _hook(self, index):
        def hook(d):
            status = d.get("status")
            if status == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate")
                if total:
                    self.progress[index] = int(d.get("downloaded_bytes", 0) * 100 / total)
                    self._throttled_refresh()
            elif status == "finished":
                self.progress[index] = 100
                self._throttled_refresh()
        return hook

    def _throttled_refresh(self):
        now = time.monotonic()
        if self._loop and now - self._last_refresh >= 2:
            self._last_refresh = now
            asyncio.run_coroutine_threadsafe(self.manager.refresh_panel(), self._loop)

    # --- Extraction ---
    async def _list_entries(self, url):
        """Retourne la liste des vidéos (déplie une playlist, sinon 1 seule URL)."""
        loop = asyncio.get_running_loop()

        def run():
            opts = config.ytdl_base_opts()
            opts["noplaylist"] = False
            opts["extract_flat"] = "in_playlist"
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
            if info.get("entries"):
                urls = [
                    (e.get("url") or e.get("webpage_url") or e.get("id"))
                    for e in info["entries"] if e
                ]
                return [u for u in urls if u][: config.PLAYLIST_LIMIT]
            return [url]

        return await loop.run_in_executor(None, run)

    async def _ydl(self, url, download, outtmpl=None, index=None):
        loop = asyncio.get_running_loop()

        def run():
            opts = config.ytdl_base_opts()
            if download:
                opts["outtmpl"] = outtmpl
                if index is not None:
                    opts["progress_hooks"] = [self._hook(index)]
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=download)
                if "entries" in info:
                    info = info["entries"][0]
                return info, (ydl.prepare_filename(info) if download else None)

        return await loop.run_in_executor(None, run)

    # --- Préparation ---
    async def _bake(self, index, url):
        for video_url in await self._list_entries(url):
            try:
                await self._bake_one(index, video_url)
            except Exception as exc:  # noqa: BLE001
                log.error("[slot %s] piste échouée (%s) : %s", index, video_url, exc)

    async def _bake_one(self, index, url):
        lib = self.manager.libraries[index]
        info, _ = await self._ydl(url, download=False)
        title = info.get("title", "Inconnu")
        await self.manager.refresh_panel()

        meta = {"thumb": info.get("thumbnail"), "duration": info.get("duration")}
        if info.get("is_live"):
            lib.add({"title": title, "url": url, "file": None, "live": True, **meta})
        else:
            tid = uuid.uuid4().hex[:12]
            _, downloaded = await self._ydl(
                url, download=True,
                outtmpl=str(lib.dir / f"{tid}.%(ext)s"), index=index,
            )
            out = str(lib.dir / f"{tid}.ogg")
            await self._process(downloaded, out, duration=info.get("duration"))
            if downloaded and os.path.exists(downloaded) and downloaded != out:
                try:
                    os.remove(downloaded)
                except OSError:
                    pass
            lib.add({"title": title, "url": url, "file": f"{tid}.ogg", "live": False, **meta})

        log.info("[slot %s] prêt : %s", index, title)
        await self.manager.players[index].notify_added()

    async def _process(self, src, dst, duration=None):
        """Normalise si activé ET durée raisonnable (≤30 min), sinon copie directe."""
        normalize = config.NORMALIZE and (duration is None or duration <= 1800)
        if normalize:
            ok = await self._run_ffmpeg(src, dst, [
                "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
                "-c:a", "libopus", "-b:a", "96k", "-ar", "48000", "-ac", "2",
                "-threads", "1",
            ])
            if ok:
                return

        if await self._run_ffmpeg(src, dst, ["-c:a", "copy"]):
            return
        await self._run_ffmpeg(src, dst, [
            "-c:a", "libopus", "-b:a", "96k", "-ar", "48000", "-ac", "2", "-threads", "1",
        ])

    async def _run_ffmpeg(self, src, dst, codec_args):
        kwargs = {}
        if hasattr(os, "nice"):
            kwargs["preexec_fn"] = _low_priority
        proc = await asyncio.create_subprocess_exec(
            config.FFMPEG_PATH, "-y", "-i", src, "-vn", *codec_args, dst,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            **kwargs,
        )
        return await proc.wait() == 0
