"""Bot d'intendance « La Fripouille » : plateforme communauté pilotée par le dashboard.

Lancement :  python -m fripouille.bot
Prérequis :
- ``FRIPOUILLE_TOKEN`` dans le .env (token du bot dédié) ;
- intent « Server Members » activé sur le portail développeur Discord ;
- bot invité avec la permission « Gérer les rôles » (ou Administrateur).
"""
import logging

import discord

from . import config, modules, registry, webapi  # noqa: F401  (modules importé = enregistrement)
from .modules import autorole, farewell, jeux, messages, tempvoice, tickets, welcome
from .store import ConfigStore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("fripouille")

# Server Members requis (arrivées + attribution de rôles). Cache membres limité à
# `joined` : indispensable pour détecter la transition pending→validé de l'écran de
# règles (on_member_update a besoin de l'état précédent). Borné aux membres qui
# rejoignent pendant que le bot tourne — pas de chunk du serveur entier au démarrage.
# Voice States : requis par le module « Salons vocaux temporaires » (tempvoice) pour
# détecter les arrivées dans le hub et vider les salons — cache voice activé pour
# pouvoir compter les membres présents dans chaque salon.
intents = discord.Intents.none()
intents.guilds = True
intents.members = True
intents.voice_states = True


class FripouilleBot(discord.Client):
    def __init__(self):
        super().__init__(
            intents=intents,
            chunk_guilds_at_startup=False,
            member_cache_flags=discord.MemberCacheFlags(joined=True, voice=True),
            max_messages=None,
        )
        self.store = ConfigStore()

    async def setup_hook(self):
        await webapi.start_web(self)
        messages.start_scheduler(self)

    async def on_ready(self):
        log.info("La Fripouille connectée : %s", self.user)
        log.info("Modules chargés : %s", ", ".join(registry.all_modules()) or "aucun")
        await jeux.setup_persistent(self)
        await tickets.setup_persistent(self)
        await tempvoice.cleanup(self)

    async def _on_arrival(self, member: discord.Member):
        # Membre réellement arrivé (règles validées, ou pas d'écran de règles).
        await autorole.on_arrival(self, member)
        await welcome.on_arrival(self, member)

    async def on_member_join(self, member: discord.Member):
        if config.GUILD_ID and member.guild.id != config.GUILD_ID:
            return
        # Écran de règles (Membership Screening) : on attend la validation, gérée
        # par on_member_update. Sans écran, member.pending est False → arrivée directe.
        if member.pending:
            log.info("%s en attente de validation des règles", member)
            return
        await self._on_arrival(member)

    async def on_member_update(self, before: discord.Member, after: discord.Member):
        if config.GUILD_ID and after.guild.id != config.GUILD_ID:
            return
        if before.pending and not after.pending:
            await self._on_arrival(after)

    async def on_member_remove(self, member: discord.Member):
        if config.GUILD_ID and member.guild.id != config.GUILD_ID:
            return
        await farewell.on_leave(self, member)

    async def on_voice_state_update(self, member, before, after):
        if config.GUILD_ID and member.guild.id != config.GUILD_ID:
            return
        await tempvoice.on_voice(self, member, before, after)


def main():
    if not config.TOKEN:
        raise SystemExit("FRIPOUILLE_TOKEN absent du .env — bot non lancé.")
    FripouilleBot().run(config.TOKEN)


if __name__ == "__main__":
    main()
