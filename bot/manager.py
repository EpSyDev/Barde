"""Orchestration des 4 players."""
import logging

import config
from player import VoicePlayer

log = logging.getLogger("bot.manager")


class Slot:
    """Un salon configuré : position, salon vocal, nom, URL courante."""

    def __init__(self, index, channel_id, name, url=None):
        self.index = index
        self.channel_id = channel_id
        self.name = name
        self.url = url


class PlayerManager:
    def __init__(self, bot):
        self.bot = bot
        self.players = {}  # index (1-4) -> VoicePlayer
        self._load()

    def _load(self):
        state = config.load_state()
        for index, channel_id, default_name in config.CHANNELS:
            saved = state.get(str(index), {})
            slot = Slot(
                index=index,
                channel_id=channel_id,
                name=saved.get("name", default_name),
                url=saved.get("url"),
            )
            self.players[index] = VoicePlayer(self.bot, slot, self)

    def get(self, index):
        return self.players.get(index)

    @property
    def slots(self):
        return [p.slot for p in self.players.values()]

    def save(self):
        config.save_state(self.slots)

    async def autostart(self):
        """Relance automatiquement les salons qui avaient une URL."""
        for player in self.players.values():
            if player.slot.url:
                try:
                    await player.start()
                except Exception as exc:  # noqa: BLE001
                    log.error(
                        "Échec autostart [%s] : %s", player.slot.name, exc
                    )

    async def stop_all(self):
        for player in self.players.values():
            await player.disconnect()
