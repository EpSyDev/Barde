"""Point d'entrée du bot."""
import logging

import discord
from discord.ext import commands

import config
from commands import setup as setup_commands
from manager import PlayerManager
from ui import PanelView

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("bot")

intents = discord.Intents.default()  # voice_states inclus, message_content non requis


class MusicBot(commands.Bot):
    def __init__(self):
        super().__init__(command_prefix="!", intents=intents)
        self.manager = None
        self._started = False

    async def setup_hook(self):
        self.manager = PlayerManager(self)
        await setup_commands(self)
        # Vue persistante : les boutons restent actifs après un redémarrage.
        self.add_view(PanelView(self.manager))

        if config.GUILD_ID:
            guild = discord.Object(id=config.GUILD_ID)
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
            log.info("Commandes synchronisées sur le serveur %s.", config.GUILD_ID)
        else:
            await self.tree.sync()
            log.info("Commandes synchronisées globalement (propagation ~1h).")

    async def on_ready(self):
        log.info("Connecté : %s (id %s)", self.user, self.user.id)
        if not self._started:
            self._started = True
            await self.manager.autostart()


def main():
    if not config.TOKEN:
        raise SystemExit("DISCORD_TOKEN manquant dans le .env")
    MusicBot().run(config.TOKEN, log_handler=None)


if __name__ == "__main__":
    main()
