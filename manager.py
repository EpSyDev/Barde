"""Registre des salons : players, librairies, baker."""
from baker import Baker


class Slot:
    def __init__(self, index, channel_id, name):
        self.index = index
        self.channel_id = channel_id
        self.name = name


class PlayerManager:
    def __init__(self):
        self.players = {}       # index -> VoicePlayer
        self.libraries = {}     # index -> Library
        self.baker = Baker(self)

    def add(self, player):
        self.players[player.slot.index] = player
        self.libraries[player.slot.index] = player.library

    def get(self, index):
        return self.players.get(index)

    @property
    def indexes(self):
        return sorted(self.players)

    async def stop_all(self):
        for player in self.players.values():
            await player.disconnect()
