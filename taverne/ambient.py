"""Moteur du mode ambiance : fait vivre le « coin des voyageurs ».

Une boucle de fond « réfléchit » à intervalle régulier et, de temps en temps seulement,
joue une SCÈNE tirée au sort dans la banque (`ambient_content.py`) :

  • monologue      — une voix (PNJ ou voyageur) lâche une réplique d'ambiance ;
  • saynète        — deux voix échangent (PNJ↔PNJ, voyageur↔voyageur…) ;
  • interpellation — un PNJ/voyageur s'adresse à un membre récemment actif ({membre}).

Garde-fous : plage horaire, plafond quotidien, écart mini entre scènes, et surtout
anti-interruption (on ne parle que dans un petit silence, jamais en coupant une
conversation humaine). Si un membre répond à une interpellation, on bascule sur une
réaction live GROQ, bornée (quelques échanges) puis le personnage « reprend la route ».

Aucune scène ne parle de la quête : la banque est écrite pour ça.
"""
import asyncio
import logging
import os
import random
import time
from datetime import datetime

import discord
from discord.ext import tasks

from . import ambient_content as bank
from . import config, grok, personas, webhooks

log = logging.getLogger("taverne.ambient")

_PERSONA_BY_KEY = {p.key: p for p in personas.PERSONAS}
_ANON_TOKENS = ("voyageur", "voyageur1", "voyageur2")


# ─── Outils purs ─────────────────────────────────────────────────────────────

def _avatar(env_name: str) -> str | None:
    return os.getenv(env_name, "").strip() or None


def _local_now() -> datetime:
    """Heure locale dans le fuseau configuré (repli sur l'heure système)."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo(config.AMBIENT_TZ))
    except Exception:  # noqa: BLE001  (tzdata absent, fuseau inconnu…)
        return datetime.now()


def _typing_delay(text: str) -> float:
    """Petit délai « le temps d'écrire », proportionnel à la longueur (1–7 s)."""
    return min(7.0, 1.0 + len(text) / 45.0)


def _random_traveler(used: set[str]) -> bank.Voice:
    pool = [v for v in bank.TRAVELERS if v.name not in used] or bank.TRAVELERS
    return random.choice(pool)


def _resolve_voice(token: str, used: set[str]) -> tuple[str, str | None, str | None]:
    """token → (nom affiché, url avatar, key PNJ ou None pour un voyageur)."""
    p = _PERSONA_BY_KEY.get(token)
    if p is not None:
        return p.name, _avatar(p.avatar_env), p.key
    v = bank.TRAVELERS_BY_KEY.get(token)
    if v is None and token in _ANON_TOKENS:
        v = _random_traveler(used)
    if v is not None:
        used.add(v.name)
        return v.name, _avatar(v.avatar_env), None
    return token, None, None  # repli défensif


def _solo_pool() -> list[tuple[str, str]]:
    """Toutes les répliques solo : monologues + signatures propres des voyageurs."""
    pool = [(m.by, m.text) for m in bank.MONOLOGUES]
    for key, v in bank.TRAVELERS_BY_KEY.items():
        pool.extend((key, sg.text) for sg in v.lines)
    return pool


_SOLO_POOL = _solo_pool()


def _traveler_system(token: str, name: str) -> str:
    """Prompt système « comptoir » pour un voyageur (réaction live)."""
    v = bank.TRAVELERS_BY_KEY.get(token)
    flavor = v.lines[0].text if (v and v.lines) else ""
    extra = (
        f"Tu es « {name} », un voyageur de passage au comptoir du coin des voyageurs. "
        f"Tu papotes, sans plus. Pour le ton : {flavor}"
    )
    return f"{bank.AMBIENT_LORE}\n\n--- TON PERSONNAGE, AU COMPTOIR ---\n{extra}"


# ─── Le metteur en scène ─────────────────────────────────────────────────────

class Ambient:
    """État + boucle du mode ambiance, branché sur un bot discord.Client."""

    def __init__(self, bot: discord.Client):
        self.bot = bot
        self.last_human = 0.0
        self.last_author: discord.abc.User | None = None
        self.last_post = 0.0
        self.count_today = 0
        self.day: str | None = None
        # member_id → {name, avatar, system, expires, exchanges}
        self.pending: dict[int, dict] = {}

    # -- démarrage / diagnostic ----------------------------------------------
    async def startup_check(self):
        cid = config.AMBIENT_CHANNEL
        if not config.AMBIENT_ENABLED:
            log.info("Mode ambiance DÉSACTIVÉ (AMBIENT_ENABLED=0).")
            return
        if not cid:
            log.warning("AMBIENT_CHANNEL non défini — mode ambiance inactif.")
            return
        ch = self.bot.get_channel(cid)
        if ch is None:
            log.warning("⚠ Salon ambiance %s INTROUVABLE — le bot est-il bien sur ce "
                        "serveur ? (mode ambiance inactif)", cid)
            return
        me = ch.guild.me
        perms = ch.permissions_for(me)
        log.info("Mode ambiance : salon #%s (%s) — vue=%s envoi=%s webhooks=%s",
                 ch, cid, perms.view_channel, perms.send_messages, perms.manage_webhooks)
        if not (perms.view_channel and perms.send_messages and perms.manage_webhooks):
            log.warning("⚠ Permissions insuffisantes sur #%s : 'Gérer les webhooks' est "
                        "requis pour faire parler les PNJ.", ch)

    def start(self):
        if config.AMBIENT_ENABLED and config.AMBIENT_CHANNEL and not self.tick.is_running():
            self.last_post = time.time()      # pas de scène dans l'heure qui suit le boot
            self.tick.start()

    # -- entrée des messages du salon ----------------------------------------
    async def handle_message(self, message: discord.Message):
        """Appelé pour chaque message HUMAIN du salon ambiance."""
        self.last_human = time.time()
        self.last_author = message.author
        await self._maybe_react(message)

    async def _maybe_react(self, message: discord.Message):
        st = self.pending.get(message.author.id)
        if not st:
            return
        if time.time() > st["expires"]:
            self.pending.pop(message.author.id, None)
            return
        reply = await grok.ask(
            st["system"],
            [{"role": "user", "content": message.content[:500]}],
            max_chars=config.PNJ_MAX_CHARS,
        )
        if not reply:
            return
        await webhooks.speak_as(message.channel, st["name"], st["avatar"], reply)
        st["exchanges"] += 1
        if st["exchanges"] >= config.AMBIENT_REACT_MAX_EXCHANGES:
            self.pending.pop(message.author.id, None)
        else:
            st["expires"] = time.time() + config.AMBIENT_REACT_WINDOW_SECONDS

    # -- la boucle ------------------------------------------------------------
    @tasks.loop(seconds=config.AMBIENT_TICK_SECONDS)
    async def tick(self):
        try:
            await self._tick()
        except Exception as exc:  # noqa: BLE001
            log.error("tick ambiance : %s", exc)

    @tick.before_loop
    async def _before(self):
        await self.bot.wait_until_ready()

    def _roll_day(self):
        today = _local_now().strftime("%Y-%m-%d")
        if today != self.day:
            self.day = today
            self.count_today = 0

    def _in_hours(self) -> bool:
        h = _local_now().hour
        s, e = config.AMBIENT_HOUR_START, config.AMBIENT_HOUR_END
        return s <= h < e if s <= e else (h >= s or h < e)

    def _recent_member(self) -> discord.Member | None:
        a = self.last_author
        if a is None or a.bot or not isinstance(a, discord.Member):
            return None
        if time.time() - self.last_human > config.AMBIENT_AUTHOR_RECENT_SECONDS:
            return None
        return a

    async def _tick(self):
        if not (config.AMBIENT_ENABLED and config.AMBIENT_CHANNEL):
            return
        self._roll_day()
        if self.count_today >= config.AMBIENT_DAILY_CAP:
            return
        if not self._in_hours():
            return
        now = time.time()
        if now - self.last_post < config.AMBIENT_MIN_GAP_SECONDS:
            return
        # anti-interruption : un humain vient de parler → on laisse le silence se poser.
        if self.last_human and (now - self.last_human) < config.AMBIENT_LULL_SECONDS:
            return
        if random.random() > config.AMBIENT_PROBA:
            return
        channel = self.bot.get_channel(config.AMBIENT_CHANNEL)
        if channel is None:
            return
        await self._perform(channel)
        self.last_post = time.time()
        self.count_today += 1

    async def _perform(self, channel: discord.TextChannel):
        kinds, weights = ["mono", "scene"], [0.50, 0.35]
        member = self._recent_member()
        if member is not None:
            kinds.append("hail")
            weights.append(0.15)
        kind = random.choices(kinds, weights)[0]
        if kind == "mono":
            await self._do_mono(channel)
        elif kind == "scene":
            await self._do_scene(channel)
        else:
            await self._do_hail(channel, member)

    async def _do_mono(self, channel):
        token, text = random.choice(_SOLO_POOL)
        name, avatar, _ = _resolve_voice(token, set())
        await webhooks.speak_as(channel, name, avatar, text)
        log.info("ambiance · monologue (%s)", name)

    async def _do_scene(self, channel):
        scene = random.choice(bank.SCENES)
        used: set[str] = set()
        cast: dict[str, tuple[str, str | None, str | None]] = {}
        for line in scene.turns:                       # distribue les rôles une fois
            if line.by not in cast:
                cast[line.by] = _resolve_voice(line.by, used)
        log.info("ambiance · saynète '%s' (%d répliques)", scene.title, len(scene.turns))
        for i, line in enumerate(scene.turns):
            name, avatar, _ = cast[line.by]
            if i:
                await asyncio.sleep(_typing_delay(line.text))
            await webhooks.speak_as(channel, name, avatar, line.text)

    async def _do_hail(self, channel, member: discord.Member):
        hail = random.choice(bank.HAILS)
        name, avatar, pkey = _resolve_voice(hail.by, set())
        if config.AMBIENT_PING:
            text = hail.text.format(membre=member.mention)
            sent = await webhooks.speak_as(channel, name, avatar, text, mention=member)
        else:
            text = hail.text.format(membre=member.display_name)
            sent = await webhooks.speak_as(channel, name, avatar, text)
        if not sent:
            return
        system = bank.ambient_system_prompt(pkey) if pkey else _traveler_system(hail.by, name)
        self.pending[member.id] = {
            "name": name,
            "avatar": avatar,
            "system": system,
            "expires": time.time() + config.AMBIENT_REACT_WINDOW_SECONDS,
            "exchanges": 0,
        }
        log.info("ambiance · interpellation de %s par %s", member, name)
