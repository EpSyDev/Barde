"""Registre des salons : players, librairies, baker."""
from baker import Baker
from settings import Settings


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
        self.settings = Settings()
        self.primary_bot = None          # bot principal : poste les notifs de suggestion
        self.suggest_cooldowns = {}      # user_id → timestamp dernière suggestion
        self.temp = None                 # TempManager : salons temporaires (pool de bots)

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

    async def post_suggestion(self, suggester, url, origin_index) -> bool:
        """Poste une suggestion (via le bot principal) dans le salon de notif configuré."""
        notif_id = self.settings.get("notif_channel_id")
        if not notif_id or self.primary_bot is None:
            return False
        channel = self.primary_bot.get_channel(int(notif_id))
        if channel is None:
            return False
        try:
            meta = await self.baker.probe(url)
        except Exception:  # noqa: BLE001
            meta = None      # lien invalide/injoignable : on notifie quand même avec l'URL
        from suggestions import NotifValidationView, build_suggestion_embed
        try:
            await channel.send(
                embed=build_suggestion_embed(self, suggester, url, origin_index, meta),
                view=NotifValidationView(self),
            )
        except Exception:  # noqa: BLE001
            return False
        return True

    async def stop_all(self):
        for player in self.players.values():
            await player.disconnect()
