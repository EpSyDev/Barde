"""Registre des players (un par salon / par bot)."""
import config


class Slot:
    """Un salon configuré : position, salon vocal, nom, URL courante."""

    def __init__(self, index, channel_id, name, url=None):
        self.index = index
        self.channel_id = channel_id
        self.name = name
        self.url = url


class PlayerManager:
    def __init__(self):
        self.players = {}            # index (1-4) -> VoicePlayer
        self._state = config.load_state()

    def saved_url(self, index):
        return self._state.get(str(index), {}).get("url")

    def add(self, player):
        self.players[player.slot.index] = player

    def get(self, index):
        return self.players.get(index)

    @property
    def slots(self):
        return [self.players[i].slot for i in sorted(self.players)]

    def save(self):
        config.save_state(self.slots)

    async def stop_all(self):
        for player in self.players.values():
            await player.disconnect()
