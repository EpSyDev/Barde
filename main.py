"""Point d'entrée : lance un bot par salon (4 connexions vocales en parallèle)."""
import asyncio
import logging

import discord
from discord.ext import commands

import config
from commands import setup as setup_commands
from manager import PlayerManager, Slot
from player import VoicePlayer
from ui import PanelView

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("bot")

intents = discord.Intents.default()  # voice_states inclus, message_content non requis


class ChannelClient(discord.Client):
    """Bot secondaire : gère uniquement la lecture dans son salon."""

    def __init__(self, **kwargs):
        super().__init__(intents=intents, **kwargs)
        self.player = None

    async def on_ready(self):
        log.info("[%s] connecté : %s", self.player.slot.name, self.user)
        if self.player.slot.url:
            try:
                await self.player.start()
            except Exception as exc:  # noqa: BLE001
                log.error("[%s] autostart : %s", self.player.slot.name, exc)


class PrimaryBot(commands.Bot):
    """Bot principal : son salon + commandes slash + panneau /panel."""

    def __init__(self, manager):
        super().__init__(command_prefix="!", intents=intents)
        self.manager = manager
        self.player = None

    async def setup_hook(self):
        await setup_commands(self)
        self.add_view(PanelView(self.manager))
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
        if self.player.slot.url:
            try:
                await self.player.start()
            except Exception as exc:  # noqa: BLE001
                log.error("[%s] autostart : %s", self.player.slot.name, exc)


async def _run_client(client, token, name):
    try:
        await client.start(token)
    except discord.LoginFailure:
        log.error("[%s] token invalide — bot ignoré.", name)
    except Exception as exc:  # noqa: BLE001
        log.error("[%s] arrêt : %s", name, exc)


async def main():
    if not config.SLOTS:
        raise SystemExit(
            "Aucun salon configuré. Renseigne TOKEN_1..4 + CHANNEL_1..4 dans le .env"
        )

    manager = PlayerManager()
    runners = []

    for position, (index, token, channel_id, name) in enumerate(config.SLOTS):
        slot = Slot(index, channel_id, name, manager.saved_url(index))
        if position == 0:
            client = PrimaryBot(manager)   # 1er = bot panneau
        else:
            client = ChannelClient()
        player = VoicePlayer(client, slot, manager)
        client.player = player
        manager.add(player)
        runners.append(_run_client(client, token, name))

    await asyncio.gather(*runners)


if __name__ == "__main__":
    asyncio.run(main())
