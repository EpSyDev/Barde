"""Client Grok minimal (API xAI, compatible OpenAI) sans dépendance lourde."""
import asyncio
import logging

import aiohttp

from . import config

log = logging.getLogger("taverne.grok")


async def ask(system_prompt: str, messages: list[dict], *, max_chars: int) -> str | None:
    """Envoie une conversation à Grok et renvoie le texte de réponse (ou None).

    `messages` = liste de {"role": "user"/"assistant", "content": str}.
    """
    if not config.GROK_API_KEY:
        log.error("GROK_API_KEY absente — PNJ muet.")
        return None

    payload = {
        "model": config.GROK_MODEL,
        "messages": [{"role": "system", "content": system_prompt}, *messages],
        "max_tokens": max(64, max_chars // 2),
        "temperature": 0.85,
    }
    headers = {
        "Authorization": f"Bearer {config.GROK_API_KEY}",
        "Content-Type": "application/json",
    }
    url = f"{config.GROK_BASE_URL}/chat/completions"
    try:
        async with aiohttp.ClientSession() as s:
            async with s.post(url, json=payload, headers=headers, timeout=30) as r:
                if r.status != 200:
                    log.error("Grok %s : %s", r.status, (await r.text())[:300])
                    return None
                data = await r.json()
        text = data["choices"][0]["message"]["content"].strip()
        return text[:max_chars]
    except (aiohttp.ClientError, asyncio.TimeoutError, KeyError, IndexError) as exc:
        log.error("Grok échec : %s", exc)
        return None
