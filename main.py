"""Point d'entrée : lance un bot par salon (4 connexions vocales en parallèle)."""
import asyncio
import logging
import shutil

import discord
from discord.ext import commands

import config
from commands import setup as setup_commands
from library import Library
from manager import PlayerManager, Slot
from player import VoicePlayer
from temp import PoolBot, TempManager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("bot")

# Intents minimaux : seulement ce qu'il faut pour voir les salons et le vocal.
intents = discord.Intents.none()
intents.guilds = True
intents.voice_states = True

# Réglages communs pour réduire la mémoire (pas de cache membres/messages).
_LIGHT = {
    "chunk_guilds_at_startup": False,
    "member_cache_flags": discord.MemberCacheFlags.none(),
    "max_messages": None,
}


class ChannelClient(discord.Client):
    """Bot secondaire : gère uniquement la lecture dans son salon."""

    def __init__(self, **kwargs):
        super().__init__(intents=intents, **_LIGHT, **kwargs)
        self.player = None

    async def on_ready(self):
        log.info("[%s] connecté : %s", self.player.slot.name, self.user)
        try:
            await self.player.start()
        except Exception as exc:  # noqa: BLE001
            log.error("[%s] autostart : %s", self.player.slot.name, exc)
        await self.player.restore_public()


class PrimaryBot(commands.Bot):
    """Bot principal : son salon + commandes slash + panneau /panel."""

    def __init__(self, manager):
        super().__init__(command_prefix="!", intents=intents, **_LIGHT)
        self.manager = manager
        self.player = None

    async def setup_hook(self):
        await setup_commands(self)
        # Vue persistante des notifs de suggestion (boutons Accepter / Refuser).
        from suggestions import NotifValidationView
        self.add_view(NotifValidationView(self.manager))
        try:
            if config.GUILD_ID:
                guild = discord.Object(id=config.GUILD_ID)
                self.tree.copy_global_to(guild=guild)
                await self.tree.sync(guild=guild)
                log.info("Commandes synchronisées sur le serveur %s.", config.GUILD_ID)
            else:
                await self.tree.sync()
                log.info("Commandes synchronisées globalement (~1h de propagation).")
        except discord.Forbidden:
            log.error(
                "Sync refusé (403). Ré-invite le bot PRINCIPAL avec le scope "
                "'applications.commands' et vérifie GUILD_ID (ID du SERVEUR)."
            )
        except Exception as exc:  # noqa: BLE001
            log.error("Échec sync des commandes : %s", exc)

    async def on_ready(self):
        log.info("[%s] connecté (principal) : %s", self.player.slot.name, self.user)
        try:
            await self.player.start()
        except Exception as exc:  # noqa: BLE001
            log.error("[%s] autostart : %s", self.player.slot.name, exc)
        await self.player.restore_public()


async def _run_client(client, token, name):
    try:
        await client.start(token)
    except discord.LoginFailure:
        log.error("[%s] token invalide — bot ignoré.", name)
    except Exception as exc:  # noqa: BLE001
        log.error("[%s] arrêt : %s", name, exc)


async def _watchdog(manager):
    """Surveille les salons : reconnecte/relance un bot qui a décroché."""
    await asyncio.sleep(90)
    stalls = {}
    while True:
        await asyncio.sleep(30)
        for idx, p in manager.players.items():
            try:
                if not p.active or not p.library.tracks:
                    stalls[idx] = 0
                    continue
                if p.voice is None or not p.voice.is_connected():
                    log.warning("[%s] watchdog : reconnexion", p.slot.name)
                    stalls[idx] = 0
                    await p.start()
                elif not p.is_playing and not p.paused:
                    stalls[idx] = stalls.get(idx, 0) + 1
                    if stalls[idx] >= 2:        # ~60 s de silence anormal
                        log.warning("[%s] watchdog : relance lecture", p.slot.name)
                        stalls[idx] = 0
                        await p.start()
                else:
                    stalls[idx] = 0
            except Exception as exc:  # noqa: BLE001
                log.error("watchdog [%s] : %s", p.slot.name, exc)


async def main():
    if not config.SLOTS:
        raise SystemExit(
            "Aucun salon configuré. Renseigne TOKEN_1..4 + CHANNEL_1..4 dans le .env"
        )

    config.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    # Purge les fichiers des salons temporaires d'une session précédente.
    shutil.rmtree(config.MEDIA_DIR / "temp", ignore_errors=True)

    manager = PlayerManager()
    runners = []

    for position, (index, token, channel_id, name) in enumerate(config.SLOTS):
        slot = Slot(index, channel_id, name)
        library = Library(index)
        if position == 0:
            client = PrimaryBot(manager)   # 1er = bot panneau
            manager.primary_bot = client   # poste les notifs de suggestion
        else:
            client = ChannelClient()
        player = VoicePlayer(client, slot, library, manager)
        client.player = player
        manager.add(player)
        runners.append(_run_client(client, token, name))

    # Bots « flottants » du pool pour les salons temporaires (TempVoice).
    manager.temp = TempManager(manager)
    for i, token in enumerate(config.POOL_TOKENS, start=1):
        bot = PoolBot(manager, intents=intents, **_LIGHT)
        manager.temp.register_bot(bot)
        runners.append(_run_client(bot, token, f"pool-{i}"))

    manager.baker.start()
    asyncio.create_task(_watchdog(manager))

    from webapi import start_web
    await start_web(manager)

    await asyncio.gather(*runners)


if __name__ == "__main__":
    asyncio.run(main())
