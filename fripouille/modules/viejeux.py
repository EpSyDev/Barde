"""Module « Vie des jeux » : faire vivre les catégories de jeux du serveur.

Trois mécaniques reliées, qui s'appuient sur les rôles-jeux (module ``jeux``) et la
détection des jeux lancés (module ``enligne``, intent Presence) :

1. **Suggestion** — un membre joue (depuis ``suggestion_delai_min``) à un jeu dont il n'a
   pas le rôle-jeu : le bot lui propose en MP de rejoindre la catégorie, bouton
   « Rejoindre » = rôle donné d'un clic. Une seule fois par membre et par jeu, jamais pour
   les porteurs du rôle « discret » d'En ligne.
2. **Accueil** — un membre prend un rôle-jeu : message de bienvenue dans le salon du jeu,
   qui nomme (sans pinger) ceux qui y jouent déjà.
3. **Qui est chaud ?** — panneau fixe dans le salon de chaque jeu. Un clic poste une carte
   « X cherche des joueurs » qui pinge le rôle-jeu (au plus une fois toutes les
   ``lfg_cooldown_min`` minutes par jeu). Au premier partant, un salon vocal temporaire
   s'ouvre dans la catégorie (supprimé une fois vide, comme les vocaux temporaires).

Le salon d'un jeu est **détecté** : premier salon textuel de la catégorie que le rôle-jeu
peut voir (permission explicite). L'action ``creer_categorie`` crée une catégorie
réservée au rôle (texte + vocal) pour les jeux qui n'en ont pas.

Config : ``enabled``, ``suggestion_actif``, ``suggestion_delai_min``, ``accueil_actif``,
``lfg_actif``, ``lfg_cooldown_min``, ``lfg_duree_h`` ; ``panneaux`` = état géré par le bot
(``{role_id: {channel_id, message_id}}``).
"""
import asyncio
import logging
import re
import sqlite3
import threading
import time

import discord

from .. import config
from ..registry import Module, register
from . import enligne

log = logging.getLogger("fripouille.viejeux")

DB_PATH = config.DATA_DIR / "viejeux.db"
VERT, OR, GRIS = 0x57F287, 0xC9A44A, 0x4F545C

DEFAULTS = {
    "enabled": False,
    "suggestion_actif": True,
    "suggestion_delai_min": 10,
    "accueil_actif": True,
    "lfg_actif": True,
    "lfg_cooldown_min": 60,
    "lfg_duree_h": 3,
    "panneaux": {},
}

_conn: sqlite3.Connection | None = None
_verrou_db = threading.Lock()
_attente: dict[tuple[int, str], asyncio.Task] = {}     # (membre, rôle) → suggestion en attente
_accueillis: dict[tuple[int, str], float] = {}         # anti-répétition de l'accueil (24 h)
_derniers_pings: dict[str, float] = {}                 # rôle → dernier ping LFG
_derniere_carte: dict[int, float] = {}                 # membre → dernière carte LFG (anti-spam)
_cartes: dict[int, dict] = {}                          # message → carte LFG vivante
_vocaux: dict[int, float] = {}                         # vocal créé → date (nettoyage si jamais rejoint)


def _db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _conn.execute("CREATE TABLE IF NOT EXISTS suggestions (user_id TEXT NOT NULL, role_id TEXT NOT NULL,"
                      " ts INTEGER NOT NULL, PRIMARY KEY (user_id, role_id))")
    return _conn


def _deja_suggere(uid, rid) -> bool:
    with _verrou_db:
        return _db().execute("SELECT 1 FROM suggestions WHERE user_id=? AND role_id=?",
                             (str(uid), str(rid))).fetchone() is not None


def _marquer_suggere(uid, rid):
    with _verrou_db:
        _db().execute("INSERT OR IGNORE INTO suggestions VALUES (?, ?, ?)", (str(uid), str(rid), int(time.time())))
        _db().commit()


def _cfg(bot):
    return bot.store.get("viejeux")


def _guild(bot):
    if config.GUILD_ID:
        return bot.get_guild(config.GUILD_ID)
    return bot.guilds[0] if bot.guilds else None


# --- Jeux & salons ---
def jeux_roles(bot) -> dict[str, dict]:
    """role_id → {label, emoji} pour tous les jeux déclarés dans Rôles-jeux."""
    out = {}
    for cat in bot.store.get("jeux").get("categories", []):
        for g in cat.get("games", []):
            rid = str(g.get("role_id") or "")
            if rid and rid not in out:
                out[rid] = {"label": g.get("label") or "Jeu", "emoji": (g.get("emoji") or "").strip()}
    return out


def _voit(ow: discord.PermissionOverwrite) -> bool:
    return ow is not None and ow.view_channel is True


def salon_du_jeu(guild: discord.Guild, role: discord.Role):
    """(catégorie, salon textuel) du jeu : la catégorie ouverte explicitement au rôle, ou à
    défaut un salon textuel ouvert au rôle. (None, None) si rien n'est trouvé."""
    for cat in guild.categories:
        if _voit(cat.overwrites.get(role)):
            textes = [c for c in cat.text_channels if c.permissions_for(role).view_channel]
            if textes:
                return cat, textes[0]
    for ch in guild.text_channels:
        if _voit(ch.overwrites.get(role)):
            return ch.category, ch
    return None, None


# --- 1. Suggestion de catégorie ---
class Rejoindre(discord.ui.DynamicItem[discord.ui.Button], template=r"viejeux:rejoindre:(?P<r>\d+)"):
    def __init__(self, rid: int, label: str = "Rejoindre la catégorie"):
        super().__init__(discord.ui.Button(label=label[:80], emoji="🎮", style=discord.ButtonStyle.success,
                                           custom_id="viejeux:rejoindre:%d" % rid))
        self.rid = rid

    @classmethod
    async def from_custom_id(cls, interaction, item, match: re.Match):
        return cls(int(match["r"]))

    async def callback(self, interaction: discord.Interaction):
        guild = _guild(interaction.client)
        membre = guild.get_member(interaction.user.id) if guild else None
        role = guild.get_role(self.rid) if guild else None
        if membre is None or role is None:
            await interaction.response.send_message("Ce jeu n'est plus proposé sur le serveur.", ephemeral=True)
            return
        if role in membre.roles:
            await interaction.response.send_message("Tu y es déjà 😉", ephemeral=True)
            return
        try:
            await membre.add_roles(role, reason="Vie des jeux : suggestion acceptée")
        except discord.HTTPException:
            await interaction.response.send_message("Je n'ai pas pu te donner le rôle (permissions).", ephemeral=True)
            return
        _, salon = salon_du_jeu(guild, role)
        lien = " Rendez-vous dans %s !" % salon.mention if salon else ""
        await interaction.response.edit_message(view=None)
        await interaction.followup.send("✅ Bienvenue chez les joueurs de **%s** !%s" % (role.name, lien))


async def _suggerer_plus_tard(bot, guild_id, member_id, cle_jeu, rid, delai):
    try:
        await asyncio.sleep(delai)
        guild = bot.get_guild(guild_id)
        membre = guild.get_member(member_id) if guild else None
        role = guild.get_role(int(rid)) if guild else None
        if membre is None or role is None or role in membre.roles or _deja_suggere(member_id, rid):
            return
        if cle_jeu not in enligne._jeux(membre, bot.store.get("enligne")):
            return                          # il a arrêté entre-temps : pas de suggestion
        _marquer_suggere(member_id, rid)
        info = jeux_roles(bot).get(str(rid), {"label": role.name})
        e = discord.Embed(
            title="🎮 Tu joues à %s ?" % info["label"],
            description=("Sur **%s**, les joueurs de **%s** ont leur coin : un salon pour s'organiser, un vocal, "
                         "et des partenaires de jeu.\nRejoins-les d'un clic — tu pourras repartir quand tu veux "
                         "depuis le menu des rôles-jeux." % (guild.name, info["label"])),
            color=OR,
        )
        v = discord.ui.View(timeout=None)
        v.add_item(Rejoindre(int(rid)))
        try:
            await membre.send(embed=e, view=v)
            log.info("suggestion %s → %s", membre, info["label"])
        except discord.HTTPException:
            pass                            # MP fermés : on ne réessaiera pas
    except asyncio.CancelledError:
        pass
    except Exception as exc:  # noqa: BLE001
        log.error("suggestion : %s", exc)
    finally:
        _attente.pop((member_id, str(rid)), None)


async def on_presence_update(bot, before: discord.Member, after: discord.Member):
    cfg = _cfg(bot)
    if not cfg.get("enabled") or not cfg.get("suggestion_actif") or after.bot:
        return
    cfg_el = bot.store.get("enligne")
    optout = cfg_el.get("optout_role_id")
    if optout and any(str(r.id) == str(optout) for r in after.roles):
        return
    apres = enligne._jeux(after, cfg_el)
    nouveaux = apres.keys() - enligne._jeux(before, cfg_el).keys()
    roles_membre = {str(r.id) for r in after.roles}
    for k in nouveaux:
        act = apres[k]
        rid = enligne._role_jeu(bot, getattr(act, "name", "") or "")
        if not rid or rid in roles_membre or (after.id, rid) in _attente or _deja_suggere(after.id, rid):
            continue
        delai = max(1, int(cfg.get("suggestion_delai_min") or 10)) * 60
        _attente[(after.id, rid)] = asyncio.create_task(
            _suggerer_plus_tard(bot, after.guild.id, after.id, k, rid, delai))


# --- 2. Accueil dans la catégorie ---
async def on_member_update(bot, before: discord.Member, after: discord.Member):
    cfg = _cfg(bot)
    if not cfg.get("enabled") or not cfg.get("accueil_actif") or after.bot:
        return
    ajoutes = {r for r in after.roles if r not in before.roles}
    if not ajoutes:
        return
    jeux = jeux_roles(bot)
    for role in ajoutes:
        if str(role.id) not in jeux:
            continue
        cle = (after.id, str(role.id))
        if time.time() - _accueillis.get(cle, 0) < 86400:
            continue
        _accueillis[cle] = time.time()
        _, salon = salon_du_jeu(after.guild, role)
        if salon is None:
            continue
        autres = [m for m in role.members if m.id != after.id and not m.bot]
        info = jeux[str(role.id)]
        if autres:
            noms = ", ".join("**%s**" % m.display_name for m in autres[:8])
            reste = " et %d autre(s)" % (len(autres) - 8) if len(autres) > 8 else ""
            ligne = "Vous êtes maintenant %d à jouer à %s ici : %s%s — fais signe !" % (
                len(autres) + 1, info["label"], noms, reste)
        else:
            ligne = "Tu es le premier joueur de %s ici : lance un « 🙋 Qui est chaud ? » pour en attirer d'autres !" % info["label"]
        try:
            await salon.send("%s %s rejoint les joueurs de **%s** ! %s" % (info["emoji"] or "🎮", after.mention, info["label"], ligne),
                             allowed_mentions=discord.AllowedMentions(users=[after], roles=False, everyone=False))
            await _replacer_panneau(bot, role, salon)
        except discord.HTTPException as exc:
            log.warning("accueil %s : %s", info["label"], exc)


# --- 3. Qui est chaud ? ---
QUAND = {"now": "maintenant", "soir": "ce soir"}


def _panneau_embed(label):
    return discord.Embed(
        title="🙋 Envie de jouer à %s ?" % label,
        description=("Un clic prévient les joueurs de **%s**. Dès que quelqu'un répond, un salon vocal "
                     "s'ouvre ici et se referme tout seul une fois vide." % label),
        color=OR,
    )


class Chercher(discord.ui.DynamicItem[discord.ui.Button], template=r"viejeux:lfg:(?P<q>now|soir):(?P<r>\d+)"):
    def __init__(self, quand: str, rid: int):
        super().__init__(discord.ui.Button(
            label="Maintenant" if quand == "now" else "Ce soir", emoji="🎮" if quand == "now" else "🌙",
            style=discord.ButtonStyle.success if quand == "now" else discord.ButtonStyle.primary,
            custom_id="viejeux:lfg:%s:%d" % (quand, rid)))
        self.quand, self.rid = quand, rid

    @classmethod
    async def from_custom_id(cls, interaction, item, match: re.Match):
        return cls(match["q"], int(match["r"]))

    async def callback(self, interaction: discord.Interaction):
        await _chercher(interaction, self.quand, self.rid)


class Partant(discord.ui.DynamicItem[discord.ui.Button], template=r"viejeux:partant"):
    def __init__(self):
        super().__init__(discord.ui.Button(label="Je suis chaud", emoji="✋", style=discord.ButtonStyle.success,
                                           custom_id="viejeux:partant"))

    @classmethod
    async def from_custom_id(cls, interaction, item, match: re.Match):
        return cls()

    async def callback(self, interaction: discord.Interaction):
        await _partant(interaction)


def _vue_panneau(rid: int):
    v = discord.ui.View(timeout=None)
    v.add_item(Chercher("now", rid))
    v.add_item(Chercher("soir", rid))
    return v


def _carte_embed(c):
    partants = ", ".join("<@%d>" % u for u in c["partants"])
    e = discord.Embed(title="🎮 %s cherche des joueurs — %s" % (c["auteur_nom"], c["label"]),
                      color=VERT if not c.get("close") else GRIS)
    e.add_field(name="Quand", value=QUAND[c["quand"]], inline=True)
    e.add_field(name="✋ Partants (%d)" % len(c["partants"]), value=partants or "—", inline=False)
    if c.get("vocal_id"):
        e.add_field(name="🔊 Vocal", value="<#%d>" % c["vocal_id"], inline=False)
    if c.get("close"):
        e.set_footer(text="Recherche terminée")
    return e


async def _replacer_panneau(bot, role: discord.Role, salon: discord.TextChannel):
    """Garde le panneau « Qui est chaud ? » en bas du salon du jeu (s'il y en a un)."""
    cfg = _cfg(bot)
    if not cfg.get("lfg_actif"):
        return
    panneaux = dict(cfg.get("panneaux") or {})
    p = panneaux.get(str(role.id))
    if not p or str(p.get("channel_id")) != str(salon.id):
        return
    try:
        await salon.get_partial_message(int(p["message_id"])).delete()
    except discord.HTTPException:
        pass
    label = jeux_roles(bot).get(str(role.id), {"label": role.name})["label"]
    msg = await salon.send(embed=_panneau_embed(label), view=_vue_panneau(role.id))
    panneaux[str(role.id)] = {"channel_id": str(salon.id), "message_id": str(msg.id)}
    bot.store.set("viejeux", {"panneaux": panneaux})


async def _chercher(interaction: discord.Interaction, quand: str, rid: int):
    bot = interaction.client
    cfg = _cfg(bot)
    role = interaction.guild.get_role(rid) if interaction.guild else None
    if not cfg.get("enabled") or not cfg.get("lfg_actif") or role is None:
        await interaction.response.send_message("La recherche de joueurs est désactivée.", ephemeral=True)
        return
    uid = interaction.user.id
    if time.time() - _derniere_carte.get(uid, 0) < 600:
        await interaction.response.send_message("Tu as déjà lancé une recherche il y a peu — patiente un peu 😉", ephemeral=True)
        return
    _derniere_carte[uid] = time.time()
    label = jeux_roles(bot).get(str(rid), {"label": role.name})["label"]
    c = {"auteur": uid, "auteur_nom": interaction.user.display_name, "role_id": rid, "label": label,
         "quand": quand, "partants": [uid], "vocal_id": None, "cree": time.time(),
         "categorie_id": interaction.channel.category_id, "channel_id": interaction.channel.id}
    contenu, mentions = None, discord.AllowedMentions.none()
    cooldown = max(0, int(cfg.get("lfg_cooldown_min") or 0)) * 60
    if time.time() - _derniers_pings.get(str(rid), 0) >= cooldown:
        _derniers_pings[str(rid)] = time.time()
        contenu = "%s — **%s** cherche des joueurs pour %s !" % (role.mention, interaction.user.display_name, QUAND[quand])
        mentions = discord.AllowedMentions(roles=[role])
    v = discord.ui.View(timeout=None)
    v.add_item(Partant())
    await interaction.response.send_message(content=contenu, embed=_carte_embed(c), view=v, allowed_mentions=mentions)
    msg = await interaction.original_response()
    _cartes[msg.id] = c
    if len(_cartes) > 200:
        for k in list(_cartes)[:-200]:
            del _cartes[k]
    try:
        await _replacer_panneau(bot, role, interaction.channel)
    except discord.HTTPException:
        pass


async def _ouvrir_vocal(bot, guild, c):
    cat = guild.get_channel(c["categorie_id"]) if c.get("categorie_id") else None
    try:
        vocal = await guild.create_voice_channel("🎮 %s" % c["label"][:80], category=cat,
                                                 reason="Vie des jeux : partie lancée")
    except discord.HTTPException as exc:
        log.warning("vocal LFG : %s", exc)
        return None
    # Même cycle de vie que les vocaux temporaires : supprimé une fois vidé.
    owners = dict(bot.store.get("tempvoice").get("owners") or {})
    owners[str(vocal.id)] = c["auteur"]
    bot.store.set("tempvoice", {"owners": owners})
    _vocaux[vocal.id] = time.time()
    return vocal


async def _partant(interaction: discord.Interaction):
    bot = interaction.client
    c = _cartes.get(interaction.message.id)
    duree = max(1, int(_cfg(bot).get("lfg_duree_h") or 3)) * 3600
    if c is None or c.get("close") or time.time() - c["cree"] > duree:
        await interaction.response.send_message("Cette recherche est terminée — relance-en une avec le panneau !", ephemeral=True)
        return
    uid = interaction.user.id
    if uid in c["partants"]:
        await interaction.response.send_message("Tu es déjà dans la partie 😉", ephemeral=True)
        return
    c["partants"].append(uid)
    if c["vocal_id"] is None and interaction.guild is not None:
        vocal = await _ouvrir_vocal(bot, interaction.guild, c)
        c["vocal_id"] = vocal.id if vocal else None
    await interaction.response.edit_message(embed=_carte_embed(c))
    vocal_txt = " Le vocal est ouvert : <#%d>" % c["vocal_id"] if c["vocal_id"] else ""
    await interaction.followup.send("✋ <@%d> est chaud ! <@%d>%s" % (uid, c["auteur"], vocal_txt),
                                    allowed_mentions=discord.AllowedMentions(users=[discord.Object(c["auteur"])]))


async def _menage(bot):
    """Toutes les 5 min : clôt les cartes expirées, supprime les vocaux jamais rejoints."""
    await bot.wait_until_ready()
    while not bot.is_closed():
        try:
            duree = max(1, int(_cfg(bot).get("lfg_duree_h") or 3)) * 3600
            for mid, c in list(_cartes.items()):
                if not c.get("close") and time.time() - c["cree"] > duree:
                    c["close"] = True
                    salon = bot.get_channel(c["channel_id"])
                    if salon is not None:
                        try:
                            await salon.get_partial_message(mid).edit(embed=_carte_embed(c), view=None)
                        except discord.HTTPException:
                            pass
            for vid, t in list(_vocaux.items()):
                ch = bot.get_channel(vid)
                if ch is None:
                    _vocaux.pop(vid, None)
                elif time.time() - t > 1200 and not [m for m in ch.members if not m.bot]:
                    try:
                        await ch.delete(reason="Vocal de partie jamais rejoint")
                    except discord.HTTPException:
                        pass
                    _vocaux.pop(vid, None)
                elif [m for m in ch.members if not m.bot]:
                    _vocaux.pop(vid, None)      # rejoint : tempvoice prend le relais
        except Exception as exc:  # noqa: BLE001
            log.error("ménage vie des jeux : %s", exc)
        await asyncio.sleep(300)


def start_scheduler(bot):
    bot.loop.create_task(_menage(bot))


def setup_persistent(bot):
    bot.add_dynamic_items(Rejoindre, Chercher, Partant)


# --- Actions dashboard ---
async def action_etat(bot, _payload):
    guild = _guild(bot)
    panneaux = _cfg(bot).get("panneaux") or {}
    jeux = []
    for rid, info in jeux_roles(bot).items():
        role = guild.get_role(int(rid)) if guild else None
        cat, salon = salon_du_jeu(guild, role) if role else (None, None)
        jeux.append({"role_id": rid, "label": info["label"], "emoji": info["emoji"],
                     "membres": len([m for m in role.members if not m.bot]) if role else 0,
                     "role_existe": role is not None,
                     "categorie": cat.name if cat else None,
                     "salon": {"id": str(salon.id), "nom": salon.name} if salon else None,
                     "panneau": bool(panneaux.get(rid))})
    jeux.sort(key=lambda j: -j["membres"])
    perms = {}
    if guild and guild.me:
        p = guild.me.guild_permissions
        perms = {"manage_channels": p.manage_channels, "manage_roles": p.manage_roles}
    with _verrou_db:
        nb = _db().execute("SELECT COUNT(*) FROM suggestions").fetchone()[0]
    return {"ok": True, "jeux": jeux, "perms": perms, "presences": config.PRESENCES, "suggestions": nb}


async def action_poster_panneaux(bot, _payload):
    """Poste (ou remet en bas) le panneau « Qui est chaud ? » dans le salon de chaque jeu."""
    guild = _guild(bot)
    if guild is None:
        return {"ok": False, "error": "serveur introuvable"}
    panneaux = dict(_cfg(bot).get("panneaux") or {})
    postes, sans_salon = 0, []
    for rid, info in jeux_roles(bot).items():
        role = guild.get_role(int(rid))
        _, salon = salon_du_jeu(guild, role) if role else (None, None)
        if salon is None:
            sans_salon.append(info["label"])
            continue
        ancien = panneaux.get(rid)
        if ancien:
            ch = guild.get_channel(int(ancien["channel_id"]))
            if ch is not None:
                try:
                    await ch.get_partial_message(int(ancien["message_id"])).delete()
                except discord.HTTPException:
                    pass
        try:
            msg = await salon.send(embed=_panneau_embed(info["label"]), view=_vue_panneau(int(rid)))
        except discord.HTTPException as exc:
            sans_salon.append("%s (%s)" % (info["label"], exc.text or exc.status))
            continue
        panneaux[rid] = {"channel_id": str(salon.id), "message_id": str(msg.id)}
        postes += 1
    bot.store.set("viejeux", {"panneaux": panneaux})
    return {"ok": True, "postes": postes, "sans_salon": sans_salon}


async def action_retirer_panneaux(bot, _payload):
    guild = _guild(bot)
    for p in (_cfg(bot).get("panneaux") or {}).values():
        ch = guild.get_channel(int(p["channel_id"])) if guild else None
        if ch is not None:
            try:
                await ch.get_partial_message(int(p["message_id"])).delete()
            except discord.HTTPException:
                pass
    bot.store.set("viejeux", {"panneaux": {}})
    return {"ok": True}


async def action_creer_categorie(bot, payload):
    """Catégorie réservée au rôle-jeu : @everyone ne voit pas, le rôle et le bot voient.
    Un salon textuel + un vocal."""
    guild = _guild(bot)
    rid = str(payload.get("role_id") or "")
    info = jeux_roles(bot).get(rid)
    role = guild.get_role(int(rid)) if guild and rid.isdigit() else None
    if role is None or info is None:
        return {"ok": False, "error": "jeu ou rôle introuvable"}
    cat, _ = salon_du_jeu(guild, role)
    if cat is not None:
        return {"ok": False, "error": "ce jeu a déjà sa catégorie (%s)" % cat.name}
    nom = ("%s %s" % (info["emoji"], info["label"])).strip()[:100]
    ow = {
        guild.default_role: discord.PermissionOverwrite(view_channel=False),
        role: discord.PermissionOverwrite(view_channel=True),
        guild.me: discord.PermissionOverwrite(view_channel=True, send_messages=True, manage_channels=True,
                                              manage_messages=True, connect=True),
    }
    raison = "Vie des jeux : catégorie de %s (%s)" % (info["label"], payload.get("_acteur") or "dashboard")
    slug = re.sub(r"[^a-z0-9]+", "-", info["label"].lower()).strip("-")[:60] or "discussion"
    try:
        cat = await guild.create_category(nom, overwrites=ow, reason=raison)
        salon = await guild.create_text_channel("💬・%s" % slug, category=cat, reason=raison)
        await guild.create_voice_channel("🔊 %s" % info["label"][:90], category=cat, reason=raison)
    except discord.Forbidden:
        return {"ok": False, "error": "permission « Gérer les salons » manquante pour La Fripouille"}
    except discord.HTTPException as exc:
        return {"ok": False, "error": "Discord : %s" % exc}
    if _cfg(bot).get("enabled") and _cfg(bot).get("lfg_actif"):
        msg = await salon.send(embed=_panneau_embed(info["label"]), view=_vue_panneau(role.id))
        panneaux = dict(_cfg(bot).get("panneaux") or {})
        panneaux[rid] = {"channel_id": str(salon.id), "message_id": str(msg.id)}
        bot.store.set("viejeux", {"panneaux": panneaux})
    return {"ok": True, "categorie": cat.name, "salon": salon.name}


MODULE = register(Module(
    key="viejeux",
    label="Vie des jeux",
    defaults=DEFAULTS,
    actions={"etat": action_etat, "poster_panneaux": action_poster_panneaux,
             "retirer_panneaux": action_retirer_panneaux, "creer_categorie": action_creer_categorie},
))
