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
from .modules import autorole
from .store import ConfigStore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("fripouille")

# Server Members requis (arrivées + attribution de rôles). Pas de cache membres en
# mémoire : l'événement fournit le Member et l'ajout de rôle n'a pas besoin du cache
# → empreinte RAM minimale (seul le cache de présence grossirait, non utilisé ici).
intents = discord.Intents.none()
intents.guilds = True
intents.members = True


class FripouilleBot(discord.Client):
    def __init__(self):
        super().__init__(
            intents=intents,
            chunk_guilds_at_startup=False,
            member_cache_flags=discord.MemberCacheFlags.none(),
            max_messages=None,
        )
        self.store = ConfigStore()

    async def setup_hook(self):
        await webapi.start_web(self)

    async def on_ready(self):
        log.info("La Fripouille connectée : %s", self.user)
        log.info("Modules chargés : %s", ", ".join(registry.all_modules()) or "aucun")

    async def on_member_join(self, member: discord.Member):
        if config.GUILD_ID and member.guild.id != config.GUILD_ID:
            return
        await autorole.on_member_join(self, member)


def main():
    if not config.TOKEN:
        raise SystemExit("FRIPOUILLE_TOKEN absent du .env — bot non lancé.")
    FripouilleBot().run(config.TOKEN)


if __name__ == "__main__":
    main()
