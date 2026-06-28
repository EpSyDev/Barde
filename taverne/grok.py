"""Client GROQ minimal (inférence Llama, compatible OpenAI) sans dépendance lourde.

Free tier GROQ : on tente le gros modèle puis on bascule sur le léger si quota (429).
"""
import asyncio
import logging

import aiohttp

from . import config

log = logging.getLogger("taverne.grok")


async def ask(system_prompt: str, messages: list[dict], *, max_chars: int) -> str | None:
    """Envoie une conversation à GROQ et renvoie le texte de réponse (ou None).

    `messages` = liste de {"role": "user"/"assistant", "content": str}.
    """
    if not config.GROQ_API_KEY:
        log.error("GROQ_API_KEY absente — PNJ muet.")
        return None

    headers = {
        "Authorization": f"Bearer {config.GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    url = f"{config.GROQ_BASE_URL}/chat/completions"
    body = {
        "messages": [{"role": "system", "content": system_prompt}, *messages],
        "max_tokens": max(64, max_chars // 2),
        "temperature": 0.85,
    }

    try:
        async with aiohttp.ClientSession() as s:
            for model in config.GROQ_MODELS:
                async with s.post(
                    url, json={**body, "model": model}, headers=headers, timeout=30
                ) as r:
                    if r.status == 429:           # quota saturé → modèle suivant
                        log.warning("GROQ 429 sur %s — fallback.", model)
                        continue
                    if r.status != 200:
                        log.error("GROQ %s (%s) : %s", r.status, model, (await r.text())[:300])
                        return None
                    data = await r.json()
                text = data["choices"][0]["message"]["content"].strip()
                return text[:max_chars]
        log.error("Tous les modèles GROQ saturés.")
        return None
    except (aiohttp.ClientError, asyncio.TimeoutError, KeyError, IndexError) as exc:
        log.error("GROQ échec : %s", exc)
        return None
