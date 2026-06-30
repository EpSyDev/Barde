"""Bot Discord dédié à l'ARG : écoute les salons des PNJ et les fait répondre.

Lancement :  python -m taverne.bot
Nécessite PNJ_TOKEN dans le .env + l'intent « Message Content » activé sur le
portail développeur Discord pour ce bot.
"""
import logging

import discord

from . import ambient, config, db, personas
from .engine import handle_message

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("taverne")

intents = discord.Intents.none()
intents.guilds = True
intents.guild_messages = True
intents.message_content = True


class TaverneBot(discord.Client):
    def __init__(self):
        super().__init__(
            intents=intents,
            chunk_guilds_at_startup=False,
            member_cache_flags=discord.MemberCacheFlags.none(),
            max_messages=None,
        )
        self.routes: dict[int, personas.Persona] = {}
        self.ambient = ambient.Ambient(self)

    async def on_ready(self):
        self.routes = personas.by_channel_id()
        if not self.routes:
            log.warning(
                "Aucun salon PNJ configuré. Renseigne les variables "
                "PNJ_*_CHANNEL dans le .env."
            )
        else:
            for cid, p in self.routes.items():
                log.info("PNJ actif : %s ← salon %s", p.name, cid)
        log.info("Taverne connectée : %s", self.user)
        await self.ambient.startup_check()
        self.ambient.start()

    async def on_message(self, message: discord.Message):
        if message.author.bot or message.webhook_id:
            return
        # Salon « coin des voyageurs » : mode ambiance (et pas de routage PNJ).
        if config.AMBIENT_CHANNEL and message.channel.id == config.AMBIENT_CHANNEL:
            await self.ambient.handle_message(message)
            return
        persona = self.routes.get(message.channel.id)
        if persona is None:
            return
        try:
            await handle_message(message, persona)
        except Exception as exc:  # noqa: BLE001
            log.error("handle_message (%s) : %s", persona.key, exc)


def main():
    if not config.PNJ_TOKEN:
        raise SystemExit("PNJ_TOKEN absent du .env — bot ARG non lancé.")
    if not config.GROQ_API_KEY:
        raise SystemExit("GROQ_API_KEY absente du .env — les PNJ seraient muets.")
    db.init()
    TaverneBot().run(config.PNJ_TOKEN)


if __name__ == "__main__":
    main()
