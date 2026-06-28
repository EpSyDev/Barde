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
        self.panel_message = None
        self.panel_view = None

    def add(self, player):
        self.players[player.slot.index] = player
        self.libraries[player.slot.index] = player.library

    def get(self, index):
        return self.players.get(index)

    @property
    def indexes(self):
        return sorted(self.players)

    def set_panel(self, message, view):
        """Mémorise le dernier panneau affiché pour le rafraîchir automatiquement."""
        self.panel_message = message
        self.panel_view = view

    async def refresh_panel(self):
        if not self.panel_message:
            return
        from ui import build_panel_embed
        try:
            selected = self.panel_view.selected if self.panel_view else None
            await self.panel_message.edit(embed=build_panel_embed(self, selected))
        except Exception:  # noqa: BLE001
            pass

    async def stop_all(self):
        for player in self.players.values():
            await player.disconnect()
