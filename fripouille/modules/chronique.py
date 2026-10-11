"""Module « Chronique » : le récap de la semaine, posté dans le salon du scribe.

Uniquement des **chiffres mesurés** (aucune narration, aucune estimation) :
- arrivées / départs (journal), avec les noms des nouveaux ;
- messages, membres actifs, les plus bavards (statistiques) ;
- temps passé en vocal et les plus présents (journal : arrivée → départ du vocal) ;
- jeux les plus joués (En ligne → statistiques) ;
- catégories les plus vivantes (statistiques par catégorie) ;
- soirées jouées et à venir (module Soirées).
Chaque rubrique sans donnée est simplement omise.

Publication automatique une fois par semaine (jour + heure de Paris), aperçu et
publication immédiate depuis le dashboard.

Config : ``enabled``, ``channel_id``, ``jour`` (0 = lundi … 6 = dimanche), ``heure``
(« HH:MM »), ``derniere`` (date de la dernière publication auto — état interne).
"""
import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import discord

from .. import config
from ..registry import Module, register
from . import journal, stats

log = logging.getLogger("fripouille.chronique")

PARIS = ZoneInfo("Europe/Paris")
OR = 0xC9A44A
MAX_SESSION_VOCALE = timedelta(hours=12)

DEFAULTS = {
    "enabled": False,
    "channel_id": "1558887050399449158",
    "jour": 6,
    "heure": "18:00",
    "derniere": "",
}


def _guild(bot):
    if config.GUILD_ID:
        return bot.get_guild(config.GUILD_ID)
    return bot.guilds[0] if bot.guilds else None


def _nom(guild, uid, defaut="?"):
    m = guild.get_member(int(uid)) if guild and uid and str(uid).isdigit() else None
    return m.display_name if m else defaut


def _duree(minutes: float) -> str:
    m = int(round(minutes))
    return "%d h %02d" % (m // 60, m % 60) if m >= 60 else "%d min" % m


def _vocal(debut: datetime, fin: datetime) -> dict[str, float]:
    """Minutes en vocal par membre, en appariant « rejoint » → « quitte » du journal."""
    rows = journal.db().periode(("vocal",), debut - MAX_SESSION_VOCALE, fin)
    ouverts: dict[str, datetime] = {}
    minutes: dict[str, float] = defaultdict(float)
    for r in rows:
        uid, ts = r["target_id"], datetime.fromisoformat(r["ts"])
        if " rejoint " in (r["summary"] or ""):
            ouverts[uid] = ts
        elif uid in ouverts:
            a = max(ouverts.pop(uid), debut)
            if ts > a and ts - a <= MAX_SESSION_VOCALE:
                minutes[uid] += (ts - a).total_seconds() / 60
    return minutes


def composer(bot) -> dict:
    """Contenu de la chronique des 7 derniers jours : {titre, rubriques:[{nom, valeur}]}."""
    guild = _guild(bot)
    fin = datetime.now(timezone.utc)
    debut = fin - timedelta(days=7)
    paris_debut = debut.astimezone(PARIS)
    jour_debut = paris_debut.strftime("%Y-%m-%d")
    rubriques = []

    # 👋 Arrivées / départs
    ev = journal.db().periode(("membre_arrivee", "membre_depart"), debut, fin)
    arrivees = [r for r in ev if r["kind"] == "membre_arrivee"]
    departs = [r for r in ev if r["kind"] == "membre_depart"]
    if arrivees or departs:
        lignes = ["**%d** arrivée(s) · **%d** départ(s)" % (len(arrivees), len(departs))]
        if arrivees:
            noms = [_nom(guild, r["target_id"], (r["target_tag"] or "?").split("#")[0]) for r in arrivees]
            lignes.append("Bienvenue à " + ", ".join(noms[:15]) + (" …" if len(noms) > 15 else ""))
        rubriques.append({"nom": "👋 Arrivées", "valeur": "\n".join(lignes)})

    # 💬 Activité écrite
    resume = None
    try:
        stats._vider_tampon()
        with stats._verrou:
            c = stats._db()
            messages = c.execute("SELECT COALESCE(SUM(n),0) FROM msg_heure WHERE jour >= ?", (jour_debut,)).fetchone()[0]
            actifs = c.execute("SELECT COUNT(DISTINCT user_id) FROM actifs WHERE jour >= ?", (jour_debut,)).fetchone()[0]
            bavards = c.execute("SELECT user_id, SUM(n) t FROM actifs WHERE jour >= ? GROUP BY user_id "
                                "ORDER BY t DESC LIMIT 3", (jour_debut,)).fetchall()
            jeux = c.execute("SELECT jeu, SUM(minutes) m FROM jeux WHERE jour >= ? GROUP BY jeu "
                             "ORDER BY m DESC LIMIT 5", (jour_debut,)).fetchall()
            joueurs = dict(c.execute("SELECT jeu, COUNT(DISTINCT user_id) FROM jeu_joueurs WHERE jour >= ? "
                                     "GROUP BY jeu", (jour_debut,)))
        resume = (messages, actifs, bavards, jeux, joueurs)
    except Exception as exc:  # noqa: BLE001
        log.warning("chronique — stats indisponibles : %s", exc)
    if resume and resume[0]:
        messages, actifs, bavards, jeux, joueurs = resume
        lignes = ["**%s** messages · **%d** membres actifs" % (format(messages, ",").replace(",", " "), actifs)]
        if bavards:
            lignes.append("Les plus bavards : " + ", ".join(
                "%s (%d)" % (_nom(guild, u), t) for u, t in bavards))
        rubriques.append({"nom": "💬 Ça a parlé", "valeur": "\n".join(lignes)})

    # 🔊 Vocal
    voix = _vocal(debut, fin)
    total = sum(voix.values())
    if total >= 1:
        top = sorted(voix.items(), key=lambda kv: kv[1], reverse=True)[:3]
        rubriques.append({"nom": "🔊 En vocal", "valeur": "**%s** passées en vocal à %d\nLes plus présents : %s" % (
            _duree(total), len(voix), ", ".join("%s (%s)" % (_nom(guild, u), _duree(m)) for u, m in top))})

    # 🎮 Jeux
    if resume and resume[3]:
        _, _, _, jeux, joueurs = resume
        rubriques.append({"nom": "🎮 Les jeux de la semaine", "valeur": "\n".join(
            "%d. **%s** — %s · %d joueur(s)" % (i + 1, j, _duree(m), joueurs.get(j, 0))
            for i, (j, m) in enumerate(jeux))})

    # 🗂️ Catégories
    try:
        cats = [c for c in stats.par_categorie(bot, jour_debut)
                if (c["messages"] or c["minutes_vocal"]) and c["id"] != stats.SANS_CATEGORIE][:3]
    except Exception as exc:  # noqa: BLE001
        log.warning("chronique — catégories : %s", exc)
        cats = []
    if cats:
        rubriques.append({"nom": "🗂️ Les coins les plus animés", "valeur": "\n".join(
            "%d. **%s** — %d message(s), %s de vocal, %d membre(s)" % (
                i + 1, c["nom"], c["messages"], _duree(c["minutes_vocal"]), c["actifs"])
            for i, c in enumerate(cats))})

    # 🎲 Soirées
    soirees = bot.store.get("soirees").get("soirees", [])
    passees, a_venir = [], []
    for s in soirees:
        try:
            d = datetime.fromisoformat(s["debut"])
        except (KeyError, ValueError):
            continue
        if s.get("statut") != "annulee" and debut <= d <= fin:
            passees.append((d, s))
        elif s.get("statut") == "a_venir" and fin < d <= fin + timedelta(days=7):
            a_venir.append((d, s))
    if passees or a_venir:
        lignes = ["✅ **%s** — %d inscrit(s)" % (s["titre"], len(s.get("inscrits", []))) for _, s in sorted(passees, key=lambda x: x[0])]
        lignes += ["📅 **%s** — <t:%d:F>" % (s["titre"], int(d.timestamp())) for d, s in sorted(a_venir, key=lambda x: x[0])]
        rubriques.append({"nom": "🎲 Soirées", "valeur": "\n".join(lignes)})

    du, au = paris_debut.strftime("%d/%m"), fin.astimezone(PARIS).strftime("%d/%m")
    return {"titre": "📜 La semaine à la Taverne — du %s au %s" % (du, au), "rubriques": rubriques}


def _embed(contenu: dict) -> discord.Embed:
    e = discord.Embed(title=contenu["titre"], color=OR)
    if not contenu["rubriques"]:
        e.description = "Une semaine bien calme : rien à consigner."
    for r in contenu["rubriques"]:
        e.add_field(name=r["nom"], value=r["valeur"][:1024], inline=False)
    e.set_footer(text="Chiffres relevés par La Fripouille")
    return e


async def publier(bot) -> int:
    cfg = bot.store.get("chronique")
    channel = bot.get_channel(int(cfg["channel_id"])) if cfg.get("channel_id") else None
    if channel is None:
        raise ValueError("salon de la chronique introuvable")
    msg = await channel.send(embed=_embed(composer(bot)), allowed_mentions=discord.AllowedMentions.none())
    return msg.id


async def _scheduler(bot):
    await bot.wait_until_ready()
    while not bot.is_closed():
        try:
            cfg = bot.store.get("chronique")
            if cfg.get("enabled"):
                now = datetime.now(PARIS)
                h, m = (int(x) for x in str(cfg.get("heure") or "18:00").split(":"))
                auj = now.strftime("%Y-%m-%d")
                if (now.weekday() == int(cfg.get("jour", 6)) and (now.hour, now.minute) >= (h, m)
                        and cfg.get("derniere") != auj):
                    bot.store.set("chronique", {"derniere": auj})   # avant : pas de double envoi
                    await publier(bot)
                    log.info("chronique publiée")
        except Exception as exc:  # noqa: BLE001
            log.error("chronique : %s", exc)
        await asyncio.sleep(60)


async def apply(bot, cfg):
    """À l'activation un jour de publication après l'heure : pas d'envoi immédiat."""
    if not cfg.get("enabled") or cfg.get("derniere"):
        return
    now = datetime.now(PARIS)
    try:
        h, m = (int(x) for x in str(cfg.get("heure") or "18:00").split(":"))
    except ValueError:
        return
    if now.weekday() == int(cfg.get("jour", 6)) and (now.hour, now.minute) >= (h, m):
        bot.store.set("chronique", {"derniere": now.strftime("%Y-%m-%d")})


def start_scheduler(bot):
    bot.loop.create_task(_scheduler(bot))


# --- Actions dashboard ---
async def action_apercu(bot, _payload):
    return {"ok": True, **composer(bot)}


async def action_publier(bot, _payload):
    try:
        await publier(bot)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    except discord.Forbidden:
        return {"ok": False, "error": "le bot ne peut pas écrire dans ce salon"}
    return {"ok": True}


MODULE = register(Module(
    key="chronique",
    label="Chronique",
    defaults=DEFAULTS,
    apply=apply,
    actions={"apercu": action_apercu, "publier": action_publier},
))
