"""Module « Sondages » : « À quoi on joue ce week-end ? » — vote à boutons, puis soirée.

Créé depuis le dashboard : question, options (jeux des rôles-jeux ou texte libre), date
de clôture. Le bot poste une carte avec un bouton par option ; chaque membre a **une**
voix, qu'il peut changer jusqu'à la clôture. Les compteurs sont publics et à jour.

À la clôture (automatique ou depuis le dashboard) : résultat publié. Si l'option
« créer la soirée » est cochée, le jeu gagnant devient une **soirée** (module Soirées)
à la date prévue, et le message de résultat pinge ceux qui ont voté pour lui ainsi que
le rôle-jeu correspondant. Égalité : départage au sort, annoncé comme tel.

Config : ``enabled``, ``channel_id``, ``ping_role_id`` (rôle pingé à l'ouverture),
``sondages`` (état, géré par le bot).
"""
import asyncio
import logging
import re
import secrets
import uuid
from datetime import datetime, timezone

import discord

from ..registry import Module, register
from . import soirees

log = logging.getLogger("fripouille.sondages")

MAX_OPTIONS = 20
MAX_CONSERVES = 20
BARRE = 12

DEFAULTS = {"enabled": False, "channel_id": None, "ping_role_id": None, "sondages": []}


def _now():
    return datetime.now(timezone.utc)


def _cfg(bot):
    return bot.store.get("sondages")


def _get(bot, sid):
    return next((s for s in _cfg(bot).get("sondages", []) if s["id"] == sid), None)


def _sauver(bot, s):
    liste = [x for x in _cfg(bot).get("sondages", []) if x["id"] != s["id"]]
    liste.insert(0, s)
    ouverts = [x for x in liste if x["statut"] == "ouvert"]
    clos = [x for x in liste if x["statut"] != "ouvert"][:MAX_CONSERVES]
    bot.store.set("sondages", {"sondages": ouverts + clos})


def _comptes(s) -> dict[str, int]:
    c = {o["id"]: 0 for o in s["options"]}
    for oid in s["votes"].values():
        if oid in c:
            c[oid] += 1
    return c


def _embed(s) -> discord.Embed:
    c = _comptes(s)
    total = sum(c.values())
    lignes = []
    for o in s["options"]:
        n = c[o["id"]]
        plein = round(BARRE * n / total) if total else 0
        gagne = s.get("gagnant") == o["id"]
        lignes.append("%s **%s**\n`%s` %d voix" % ("🏆" if gagne else "▫️", o["label"], "█" * plein + "░" * (BARRE - plein), n))
    clos = s["statut"] != "ouvert"
    fin = int(datetime.fromisoformat(s["fin"]).timestamp())
    e = discord.Embed(title="🗳️ " + s["question"], description="\n".join(lignes)[:4000],
                      color=0x4F545C if clos else 0xC9A44A)
    e.add_field(name="Votants", value=str(total), inline=True)
    e.add_field(name="Clôture" if not clos else "Clos", value="<t:%d:R>" % fin if not clos else "<t:%d:f>" % fin, inline=True)
    if s.get("soiree", {}).get("creer") and not clos:
        e.add_field(name="🎲 À la clé", value="Le gagnant devient une soirée le <t:%d:F>" % int(
            datetime.fromisoformat(s["soiree"]["debut"]).timestamp()), inline=False)
    e.set_footer(text="Une voix par membre, modifiable jusqu'à la clôture · Sondage #%s" % s["id"])
    return e


class Voter(discord.ui.DynamicItem[discord.ui.Button], template=r"sondage:(?P<s>[0-9a-f]{6}):(?P<o>[0-9a-f]{4})"):
    def __init__(self, sid: str, oid: str, label: str = "Option"):
        super().__init__(discord.ui.Button(label=label[:80], style=discord.ButtonStyle.secondary,
                                           custom_id="sondage:%s:%s" % (sid, oid)))
        self.sid, self.oid = sid, oid

    @classmethod
    async def from_custom_id(cls, interaction, item, match: re.Match):
        return cls(match["s"], match["o"])

    async def callback(self, interaction: discord.Interaction):
        bot = interaction.client
        s = _get(bot, self.sid)
        if s is None or s["statut"] != "ouvert":
            await interaction.response.send_message("Ce sondage est clos.", ephemeral=True)
            return
        option = next((o for o in s["options"] if o["id"] == self.oid), None)
        if option is None:
            await interaction.response.send_message("Option introuvable.", ephemeral=True)
            return
        uid = str(interaction.user.id)
        if s["votes"].get(uid) == self.oid:
            del s["votes"][uid]
            retour = "Voix retirée."
        else:
            retour = "🗳️ Voix pour **%s** enregistrée%s." % (option["label"], " (changée)" if uid in s["votes"] else "")
            s["votes"][uid] = self.oid
        _sauver(bot, s)
        await interaction.response.edit_message(embed=_embed(s))
        await interaction.followup.send(retour, ephemeral=True)


def _vue(s):
    if s["statut"] != "ouvert":
        return None
    v = discord.ui.View(timeout=None)
    for o in s["options"]:
        v.add_item(Voter(s["id"], o["id"], o["label"]))
    return v


async def _maj_carte(bot, s):
    ch = bot.get_channel(int(s["channel_id"]))
    if ch is None or not s.get("message_id"):
        return
    try:
        await ch.get_partial_message(int(s["message_id"])).edit(embed=_embed(s), view=_vue(s))
    except discord.HTTPException as exc:
        log.warning("carte sondage %s : %s", s["id"], exc)


async def cloturer(bot, s) -> dict:
    s["statut"] = "clos"
    c = _comptes(s)
    meilleur = max(c.values()) if c else 0
    ex_aequo = [oid for oid, n in c.items() if n == meilleur and n > 0]
    au_sort = len(ex_aequo) > 1
    s["gagnant"] = secrets.choice(ex_aequo) if ex_aequo else None
    _sauver(bot, s)
    await _maj_carte(bot, s)
    ch = bot.get_channel(int(s["channel_id"]))
    if ch is None:
        return {"ok": True}
    if not s["gagnant"]:
        await ch.send("🗳️ Sondage « %s » clos : aucune voix." % s["question"])
        return {"ok": True}
    g = next(o for o in s["options"] if o["id"] == s["gagnant"])
    votants = [int(u) for u, oid in s["votes"].items() if oid == g["id"]]
    texte = "🏆 **%s** l'emporte avec %d voix%s !" % (g["label"], meilleur, " (égalité départagée au sort)" if au_sort else "")
    soiree_info = ""
    sv = s.get("soiree") or {}
    if sv.get("creer"):
        try:
            r = await soirees._creer(bot, {"titre": "Soirée %s" % g["label"], "jeu": g["label"],
                                           "description": "Choisie par vote : %d voix." % meilleur,
                                           "debut": sv["debut"], "max": sv.get("max") or 0, "ping": False,
                                           "_acteur": "sondage"})
            canal = soirees._cfg(bot).get("channel_id")
            soiree_info = "\n🎲 La soirée est ouverte aux inscriptions%s — <t:%d:F>." % (
                " dans <#%s>" % canal if canal else "", int(datetime.fromisoformat(sv["debut"]).timestamp()))
            s["soiree_id"] = r.get("id")
            _sauver(bot, s)
        except ValueError as exc:
            soiree_info = "\n⚠️ Soirée non créée : %s." % exc
    mentions = " ".join("<@%d>" % u for u in votants[:30])
    role = "<@&%s> " % g["role_id"] if g.get("role_id") else ""
    await ch.send("%s%s%s\n%s" % (role, texte, soiree_info, mentions),
                  allowed_mentions=discord.AllowedMentions(
                      users=[discord.Object(u) for u in votants[:30]],
                      roles=[discord.Object(int(g["role_id"]))] if g.get("role_id") else False))
    return {"ok": True, "gagnant": g["label"]}


async def _scheduler(bot):
    await bot.wait_until_ready()
    while not bot.is_closed():
        try:
            for s in list(_cfg(bot).get("sondages", [])):
                if s["statut"] == "ouvert" and datetime.fromisoformat(s["fin"]) <= _now():
                    await cloturer(bot, s)
        except Exception as exc:  # noqa: BLE001
            log.error("sondages : %s", exc)
        await asyncio.sleep(30)


def start_scheduler(bot):
    bot.loop.create_task(_scheduler(bot))


def setup_persistent(bot):
    bot.add_dynamic_items(Voter)


def _date(v, nom):
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("%s invalide" % nom)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


# --- Actions dashboard ---
async def action_creer(bot, payload):
    try:
        cfg = _cfg(bot)
        if not cfg.get("enabled"):
            raise ValueError("module désactivé (active-le et enregistre)")
        ch = bot.get_channel(int(cfg["channel_id"])) if cfg.get("channel_id") else None
        if ch is None:
            raise ValueError("salon du sondage non configuré")
        question = str(payload.get("question") or "").strip()[:200]
        if not question:
            raise ValueError("question obligatoire")
        options = []
        for o in (payload.get("options") or [])[:MAX_OPTIONS]:
            label = str((o or {}).get("label") or "").strip()[:80]
            rid = str(o.get("role_id") or "")
            if label and label.lower() not in {x["label"].lower() for x in options}:
                options.append({"id": uuid.uuid4().hex[:4], "label": label, "role_id": rid if rid.isdigit() else ""})
        if len(options) < 2:
            raise ValueError("il faut au moins deux options")
        fin = _date(payload.get("fin"), "date de clôture")
        if fin <= _now():
            raise ValueError("la clôture doit être dans le futur")
        sv = payload.get("soiree") or {}
        soiree = {"creer": False}
        if sv.get("creer"):
            debut = _date(sv.get("debut"), "date de la soirée")
            if debut <= fin:
                raise ValueError("la soirée doit avoir lieu après la clôture du vote")
            soiree = {"creer": True, "debut": debut.isoformat(), "max": max(0, min(int(sv.get("max") or 0), 100))}
        s = {"id": uuid.uuid4().hex[:6], "question": question, "options": options, "votes": {},
             "channel_id": str(ch.id), "message_id": None, "fin": fin.isoformat(), "statut": "ouvert",
             "soiree": soiree, "gagnant": None, "cree_par": str(payload.get("_acteur") or "")[:80]}
        role = cfg.get("ping_role_id") if payload.get("ping") else None
        msg = await ch.send(content="<@&%s> — à vous de voter !" % role if role else None, embed=_embed(s), view=_vue(s),
                            allowed_mentions=discord.AllowedMentions(roles=[discord.Object(int(role))]) if role else discord.AllowedMentions.none())
        s["message_id"] = str(msg.id)
        _sauver(bot, s)
        return {"ok": True, "id": s["id"]}
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    except discord.Forbidden:
        return {"ok": False, "error": "le bot ne peut pas écrire dans ce salon"}


async def action_cloturer(bot, payload):
    s = _get(bot, str(payload.get("id") or ""))
    if s is None or s["statut"] != "ouvert":
        return {"ok": False, "error": "sondage introuvable ou déjà clos"}
    return await cloturer(bot, s)


async def action_annuler(bot, payload):
    s = _get(bot, str(payload.get("id") or ""))
    if s is None:
        return {"ok": False, "error": "sondage introuvable"}
    ch = bot.get_channel(int(s["channel_id"]))
    if ch is not None and s.get("message_id"):
        try:
            await ch.get_partial_message(int(s["message_id"])).delete()
        except discord.HTTPException:
            pass
    bot.store.set("sondages", {"sondages": [x for x in _cfg(bot).get("sondages", []) if x["id"] != s["id"]]})
    return {"ok": True}


async def action_liste(bot, _payload):
    out = []
    for s in _cfg(bot).get("sondages", []):
        c = _comptes(s)
        out.append({k: s[k] for k in ("id", "question", "fin", "statut", "gagnant", "soiree")} |
                   {"options": [{**o, "voix": c.get(o["id"], 0)} for o in s["options"]], "votants": len(s["votes"])})
    return {"ok": True, "sondages": out}


MODULE = register(Module(
    key="sondages",
    label="Sondages",
    defaults=DEFAULTS,
    actions={"creer": action_creer, "cloturer": action_cloturer, "annuler": action_annuler, "liste": action_liste},
))
