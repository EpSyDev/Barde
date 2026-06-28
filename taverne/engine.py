"""Coeur de l'ARG : route un message de joueur vers le bon PNJ et fait répondre Grok."""
import logging
import re
import time

import discord

from . import config, db, grok, quests, webhooks
from .personas import Persona

log = logging.getLogger("taverne.engine")

# Marqueur invisible émis par un PNJ gardien quand le joueur résout son épreuve.
_SOLVED = re.compile(r"\[\[\s*SOLVED\s*\]\]", re.IGNORECASE)

# Anti-spam par (user_id, persona) → timestamp dernière réponse.
_cooldowns: dict[tuple[int, str], float] = {}


def _cooldown_ok(user_id: int, persona: Persona) -> bool:
    key = (user_id, persona.key)
    now = time.time()
    if now - _cooldowns.get(key, 0) < config.PNJ_COOLDOWN:
        return False
    _cooldowns[key] = now
    return True


def _build_messages(user_id: int, persona: Persona, new_text: str) -> list[dict]:
    """Reconstruit la conversation récente (mémoire du PNJ) depuis le journal."""
    history = db.recent_exchanges(user_id, persona.key, config.PNJ_CONTEXT_MESSAGES)
    msgs = [
        {"role": "user" if kind == "in" else "assistant", "content": content}
        for kind, content in history
    ]
    msgs.append({"role": "user", "content": new_text})
    return msgs


async def handle_message(message: discord.Message, persona: Persona):
    """Appelé quand un membre écrit dans le salon d'un PNJ."""
    user_id = message.author.id
    text = message.content.strip()
    if not text:
        return
    if not _cooldown_ok(user_id, persona):
        return

    async with message.channel.typing():
        msgs = _build_messages(user_id, persona, text)
        reply = await grok.ask(
            persona.system_prompt(), msgs, max_chars=config.PNJ_MAX_CHARS
        )

    if not reply:
        return

    # Épreuve résolue ? On retire le marqueur du texte avant de l'afficher.
    solved = bool(_SOLVED.search(reply))
    if solved:
        reply = _SOLVED.sub("", reply).strip()

    db.log_exchange(user_id, persona.key, "in", text)
    db.log_exchange(user_id, persona.key, "out", reply)
    if reply:
        await webhooks.speak(message.channel, persona, reply)

    if solved and not db.has_flag(user_id, f"solved:{persona.key}"):
        member = message.author
        if isinstance(member, discord.Member):
            await quests.trigger_solve(member, persona.key)
