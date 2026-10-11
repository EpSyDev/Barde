"""Module « Santé » : surveiller la VM (1 Go de RAM) et les services, alerter avant la panne.

Mesures **réelles**, prises chaque minute sans dépendance (``/proc`` + systemd) :
RAM disponible, swap utilisé, CPU (moyenne sur la minute), disque, et pour chaque
service (barde, fripouille, taverne, taverne-hub) : actif ou non, mémoire, redémarrages.
24 h d'historique en mémoire pour les courbes du dashboard.

Alertes dans un salon staff (défaut : le salon d'alerte de la Garde) quand un seuil est
dépassé **5 minutes d'affilée** (un pic isolé n'alerte pas), ou dès qu'un service
tombe ; au plus une alerte par sujet et par heure. Un retour à la normale est signalé.

Config : ``enabled``, ``channel_id``, ``role_id``, ``seuil_ram_mo`` (RAM disponible
minimale), ``seuil_swap_pct``, ``seuil_cpu_pct``, ``seuil_disque_pct``, ``services``.
"""
import asyncio
import logging
import shutil
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

import discord

from ..registry import Module, register

log = logging.getLogger("fripouille.sante")

DEFAULTS = {
    "enabled": False,
    "channel_id": None,
    "role_id": None,
    "seuil_ram_mo": 80,
    "seuil_swap_pct": 85,
    "seuil_cpu_pct": 90,
    "seuil_disque_pct": 90,
    "services": ["barde", "fripouille", "taverne", "taverne-hub"],
}
DUREE_DEPASSEMENT = 5          # mesures consécutives (minutes) avant d'alerter
RELANCE_ALERTE_S = 3600

_historique: deque = deque(maxlen=24 * 60)
_services: dict[str, dict] = {}
_cpu_prec: tuple[int, int] | None = None
_depassements: dict[str, int] = {}
_alertes_envoyees: dict[str, float] = {}
_en_alerte: set[str] = set()


def _meminfo() -> dict[str, int]:
    out = {}
    for ligne in Path("/proc/meminfo").read_text().splitlines():
        k, v = ligne.split(":", 1)
        out[k] = int(v.split()[0])          # kio
    return out


def _cpu() -> float | None:
    global _cpu_prec
    champs = [int(x) for x in Path("/proc/stat").read_text().splitlines()[0].split()[1:]]
    inactif, total = champs[3] + champs[4], sum(champs)
    prec, _cpu_prec = _cpu_prec, (inactif, total)
    if prec is None or total == prec[1]:
        return None
    return round(100 * (1 - (inactif - prec[0]) / (total - prec[1])), 1)


async def _lire_services(noms: list[str]) -> dict[str, dict]:
    if not noms:
        return {}
    proc = await asyncio.create_subprocess_exec(
        "systemctl", "show", "-p", "Id", "-p", "ActiveState", "-p", "MemoryCurrent", "-p", "NRestarts",
        *["%s.service" % n for n in noms],
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    sortie, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
    out = {}
    for bloc in sortie.decode().strip().split("\n\n"):
        d = dict(l.split("=", 1) for l in bloc.splitlines() if "=" in l)
        nom = d.get("Id", "").removesuffix(".service")
        if not nom:
            continue
        mem = d.get("MemoryCurrent", "")
        out[nom] = {"actif": d.get("ActiveState") == "active", "etat": d.get("ActiveState"),
                    "memoire_mo": round(int(mem) / 1048576) if mem.isdigit() else None,
                    "redemarrages": int(d["NRestarts"]) if d.get("NRestarts", "").isdigit() else None}
    return out


async def mesurer(bot) -> dict | None:
    try:
        mi = _meminfo()
    except OSError:
        return None                          # pas sous Linux (poste de dev)
    swap_total = mi.get("SwapTotal", 0)
    disque = shutil.disk_usage("/")
    m = {
        "t": datetime.now(timezone.utc).isoformat(),
        "ram_totale_mo": round(mi["MemTotal"] / 1024),
        "ram_dispo_mo": round(mi.get("MemAvailable", 0) / 1024),
        "swap_mo": round((swap_total - mi.get("SwapFree", 0)) / 1024),
        "swap_pct": round(100 * (swap_total - mi.get("SwapFree", 0)) / swap_total, 1) if swap_total else 0,
        "cpu_pct": _cpu(),
        "disque_pct": round(100 * disque.used / disque.total, 1),
        "disque_libre_go": round(disque.free / 1e9, 1),
    }
    try:
        _services.update(await _lire_services(list(bot.store.get("sante").get("services") or [])))
    except Exception as exc:  # noqa: BLE001
        log.warning("services : %s", exc)
    _historique.append(m)
    return m


# --- Alertes ---
async def alerter(bot, titre: str, texte: str, couleur=0xED4245):
    """Message dans le salon staff (utilisé aussi par la Sauvegarde)."""
    cfg = bot.store.get("sante")
    cid = cfg.get("channel_id") or bot.store.get("garde").get("alert_channel_id")
    channel = bot.get_channel(int(cid)) if cid else None
    if channel is None:
        log.warning("santé (pas de salon) : %s — %s", titre, texte)
        return
    role = cfg.get("role_id")
    e = discord.Embed(title="🩺 " + titre, description=texte, color=couleur, timestamp=datetime.now(timezone.utc))
    try:
        await channel.send(content=("<@&%s>" % role) if role and couleur == 0xED4245 else None, embed=e,
                           allowed_mentions=discord.AllowedMentions(roles=[discord.Object(int(role))]) if role else discord.AllowedMentions.none())
    except discord.HTTPException as exc:
        log.error("alerte santé : %s", exc)


async def _verifier(bot, m: dict):
    cfg = bot.store.get("sante")
    conditions = {
        "ram": (m["ram_dispo_mo"] < int(cfg.get("seuil_ram_mo") or 80),
                "RAM presque pleine : %d Mo disponibles sur %d." % (m["ram_dispo_mo"], m["ram_totale_mo"])),
        "swap": (m["swap_pct"] > float(cfg.get("seuil_swap_pct") or 85),
                 "Swap à %s %% (%d Mo) : la VM ralentit." % (m["swap_pct"], m["swap_mo"])),
        "cpu": (m["cpu_pct"] is not None and m["cpu_pct"] > float(cfg.get("seuil_cpu_pct") or 90),
                "CPU à %s %% depuis %d minutes." % (m["cpu_pct"], DUREE_DEPASSEMENT)),
        "disque": (m["disque_pct"] > float(cfg.get("seuil_disque_pct") or 90),
                   "Disque plein à %s %% (%s Go libres)." % (m["disque_pct"], m["disque_libre_go"])),
    }
    for nom, s in _services.items():
        conditions["service:" + nom] = (not s["actif"], "Le service **%s** est arrêté (%s)." % (nom, s["etat"]))
    for cle, (depasse, texte) in conditions.items():
        if depasse:
            _depassements[cle] = _depassements.get(cle, 0) + 1
            immediat = cle.startswith("service:")
            if (immediat or _depassements[cle] >= DUREE_DEPASSEMENT) and \
                    time.time() - _alertes_envoyees.get(cle, 0) > RELANCE_ALERTE_S:
                _alertes_envoyees[cle] = time.time()
                _en_alerte.add(cle)
                await alerter(bot, "Alerte VM", texte)
        else:
            _depassements[cle] = 0
            if cle in _en_alerte:
                _en_alerte.discard(cle)
                await alerter(bot, "Retour à la normale", "« %s » est revenu dans les clous." % cle, 0x57F287)


async def _boucle(bot):
    await bot.wait_until_ready()
    while not bot.is_closed():
        try:
            m = await mesurer(bot)
            if m is None:
                return
            if bot.store.get("sante").get("enabled"):
                await _verifier(bot, m)
        except Exception as exc:  # noqa: BLE001
            log.error("santé : %s", exc)
        await asyncio.sleep(60)


def start_scheduler(bot):
    bot.loop.create_task(_boucle(bot))


# --- Actions dashboard ---
async def action_etat(bot, _payload):
    pas = max(1, len(_historique) // 144)          # ~144 points sur 24 h pour les courbes
    return {"ok": True, "actuel": _historique[-1] if _historique else None,
            "historique": list(_historique)[::pas], "services": _services, "en_alerte": sorted(_en_alerte)}


async def action_tester(bot, _payload):
    await alerter(bot, "Test", "Alerte de test du module Santé.", 0x3498DB)
    return {"ok": True}


MODULE = register(Module(
    key="sante",
    label="Santé",
    defaults=DEFAULTS,
    actions={"etat": action_etat, "tester": action_tester},
))
