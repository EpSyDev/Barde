"""Module « Tâches » : tableau de tâches de l'équipe, directement dans un salon Discord.

Un **panneau** fixe (bouton « ➕ Nouvelle tâche ») ouvre un formulaire : titre,
description, échéance (texte libre). Chaque tâche devient une **carte** dans le salon :

- 🕓 *À faire*    → boutons « 🙋 Je la prends » / « 👤 Attribuer… »
- ✅ *Attribuée*  → un récap auto est posté en réponse à la carte (pinge l'assigné) ;
                    boutons « 🏁 Terminer » / « 👤 Réattribuer… »
- 🏁 *Terminée*   → carte figée, plus de boutons.

Les boutons des cartes sont des ``DynamicItem`` (custom_id ``taches:{action}:{id}``) :
cliquables après redémarrage sans réenregistrer chaque message.

Config :
- ``enabled`` / ``channel_id``
- ``role_ids``          : rôles autorisés à créer / attribuer (vide = tous ceux qui voient
                          le salon). « Je la prends » est ouvert à tous ; « Terminer » est
                          réservé à l'assigné et aux autorisés.
- ``panel_message_id``  : géré par le bot.
- ``taches``            : état des tâches (géré par le bot, hors audit).
"""
import logging
import re
import uuid
from datetime import datetime, timezone

import discord

from .. import config
from ..registry import Module, register

log = logging.getLogger("fripouille.taches")

NOUVELLE_ID = "taches:nouvelle"
MAX_TERMINEES = 100   # tâches terminées conservées (les autres sont oubliées)

DEFAULTS = {
    "enabled": False,
    "channel_id": "1523461501715746987",
    "role_ids": [],
    "panel_message_id": None,
    "taches": [],
}

STATUTS = {
    "a_faire": ("🕓", "À faire", 0xE67E22),
    "attribuee": ("✅", "Attribuée", 0x3498DB),
    "terminee": ("🏁", "Terminée", 0x57F287),
}



def _now():
    return datetime.now(timezone.utc)


def _ts(iso, style="R"):
    try:
        return f"<t:{int(datetime.fromisoformat(iso).timestamp())}:{style}>"
    except (TypeError, ValueError):
        return "—"


# --- État ---
def _cfg(bot):
    return bot.store.get("taches")


def _get(bot, tid):
    return next((t for t in _cfg(bot).get("taches", []) if t.get("id") == tid), None)


def _sauver(bot, tache):
    taches = [t for t in _cfg(bot).get("taches", []) if t.get("id") != tache["id"]]
    taches.insert(0, tache)
    ouvertes = [t for t in taches if t["statut"] != "terminee"]
    finies = [t for t in taches if t["statut"] == "terminee"][:MAX_TERMINEES]
    bot.store.set("taches", {"taches": ouvertes + finies})


def _autorise(member, cfg):
    if not isinstance(member, discord.Member):
        return False
    roles = {str(r) for r in cfg.get("role_ids") or []}
    if not roles or member.guild_permissions.manage_guild:
        return True
    return any(str(r.id) in roles for r in member.roles)


# --- Rendu ---
def _embed(t):
    emoji, libelle, couleur = STATUTS[t["statut"]]
    e = discord.Embed(
        title=f"{emoji}  {t['titre']}"[:256],
        description=t.get("description") or None,
        color=couleur,
    )
    e.add_field(name="Statut", value=libelle, inline=True)
    if t.get("echeance"):
        e.add_field(name="📅 Échéance", value=t["echeance"][:1024], inline=True)
    if t.get("assigne_id"):
        e.add_field(name="👤 Assignée à", value=f"<@{t['assigne_id']}>", inline=True)
    e.add_field(name="✍️ Créée par", value=f"<@{t['auteur_id']}> · {_ts(t['cree'])}", inline=False)
    if t["statut"] == "terminee":
        e.add_field(name="🏁 Terminée", value=_ts(t.get("terminee")), inline=False)
    e.set_footer(text=f"Tâche #{t['id']}")
    return e


class TacheBouton(discord.ui.DynamicItem[discord.ui.Button],
                  template=r"taches:(?P<action>prendre|attribuer|finir):(?P<id>[0-9a-f]+)"):
    LIBELLES = {
        "prendre": ("Je la prends", "🙋", discord.ButtonStyle.success),
        "attribuer": ("Attribuer…", "👤", discord.ButtonStyle.secondary),
        "finir": ("Terminer", "🏁", discord.ButtonStyle.primary),
    }

    def __init__(self, action: str, tid: str, label: str | None = None):
        lib, emoji, style = self.LIBELLES[action]
        super().__init__(discord.ui.Button(
            label=label or lib, emoji=emoji, style=style, custom_id=f"taches:{action}:{tid}",
        ))
        self.action, self.tid = action, tid

    @classmethod
    async def from_custom_id(cls, interaction, item, match: re.Match):
        return cls(match["action"], match["id"])

    async def callback(self, interaction: discord.Interaction):
        await _clic(interaction, self.action, self.tid)


def _vue(t):
    if t["statut"] == "terminee":
        return None
    v = discord.ui.View(timeout=None)
    if t["statut"] == "a_faire":
        v.add_item(TacheBouton("prendre", t["id"]))
        v.add_item(TacheBouton("attribuer", t["id"]))
    else:
        v.add_item(TacheBouton("finir", t["id"]))
        v.add_item(TacheBouton("attribuer", t["id"], label="Réattribuer…"))
    return v


async def _maj_carte(bot, t):
    channel = bot.get_channel(int(t["channel_id"]))
    if channel is None or not t.get("message_id"):
        return None
    msg = channel.get_partial_message(int(t["message_id"]))
    try:
        await msg.edit(embed=_embed(t), view=_vue(t))
    except discord.NotFound:
        return None
    return msg


# --- Gestes ---
async def _attribuer(interaction, t, membre: discord.abc.User):
    bot = interaction.client
    t.update(statut="attribuee", assigne_id=str(membre.id),
             attribuee=_now().isoformat(), attribue_par=str(interaction.user.id))
    _sauver(bot, t)
    msg = await _maj_carte(bot, t)
    # Récap auto, en réponse à la carte : seul l'assigné est pingé.
    lignes = [f"✅ <@{membre.id}> prend en charge **{t['titre']}**"]
    if membre.id != interaction.user.id:
        lignes[0] += f" (attribuée par <@{interaction.user.id}>)"
    if t.get("description"):
        resume = t["description"].strip().replace("\n", " ")
        lignes.append(f"> {resume[:180]}{'…' if len(resume) > 180 else ''}")
    if t.get("echeance"):
        lignes.append(f"📅 Échéance : **{t['echeance']}**")
    mentions = discord.AllowedMentions(users=[membre], roles=False, everyone=False)
    try:
        if msg is not None:
            await msg.reply("\n".join(lignes), allowed_mentions=mentions, mention_author=False)
        else:
            await interaction.channel.send("\n".join(lignes), allowed_mentions=mentions)
    except discord.HTTPException as exc:
        log.warning("récap tâche %s : %s", t["id"], exc)


class AttribuerVue(discord.ui.View):
    """Menu éphémère de choix du membre (non persistant)."""

    def __init__(self, tid):
        super().__init__(timeout=120)
        self.tid = tid

    @discord.ui.select(cls=discord.ui.UserSelect, placeholder="Choisis la personne…")
    async def choix(self, interaction: discord.Interaction, select: discord.ui.UserSelect):
        t = _get(interaction.client, self.tid)
        if t is None or t["statut"] == "terminee":
            await interaction.response.edit_message(content="Tâche introuvable ou terminée.", view=None)
            return
        membre = select.values[0]
        if membre.bot:
            await interaction.response.edit_message(content="Pas à un bot 😄", view=self)
            return
        await interaction.response.edit_message(content=f"✅ Attribuée à {membre.mention}.", view=None)
        await _attribuer(interaction, t, membre)


async def _clic(interaction: discord.Interaction, action: str, tid: str):
    bot = interaction.client
    cfg = _cfg(bot)
    t = _get(bot, tid)
    if t is None:
        await interaction.response.send_message("Tâche introuvable (supprimée ?).", ephemeral=True)
        return
    if t["statut"] == "terminee":
        await interaction.response.send_message("Cette tâche est déjà terminée.", ephemeral=True)
        return
    user = interaction.user
    if action == "prendre":
        await interaction.response.defer()
        await _attribuer(interaction, t, user)
    elif action == "attribuer":
        if not _autorise(user, cfg):
            await interaction.response.send_message("Tu n'as pas le droit d'attribuer des tâches.", ephemeral=True)
            return
        await interaction.response.send_message(
            f"À qui confier **{t['titre']}** ?", view=AttribuerVue(tid), ephemeral=True
        )
    elif action == "finir":
        if str(user.id) != t.get("assigne_id") and not _autorise(user, cfg):
            await interaction.response.send_message(
                "Seule la personne assignée (ou un responsable) peut la terminer.", ephemeral=True
            )
            return
        t.update(statut="terminee", terminee=_now().isoformat(), termine_par=str(user.id))
        _sauver(bot, t)
        await interaction.response.edit_message(embed=_embed(t), view=None)


class NouvelleModal(discord.ui.Modal, title="Nouvelle tâche"):
    titre = discord.ui.TextInput(label="Titre", max_length=100, placeholder="Ex. Refaire la bannière du serveur")
    description = discord.ui.TextInput(
        label="Description", style=discord.TextStyle.paragraph, required=False, max_length=1000,
        placeholder="Ce qu'il faut faire, liens utiles…",
    )
    echeance = discord.ui.TextInput(
        label="Échéance (facultatif)", required=False, max_length=60, placeholder="Ex. vendredi soir",
    )

    async def on_submit(self, interaction: discord.Interaction):
        bot = interaction.client
        t = {
            "id": uuid.uuid4().hex[:6],
            "titre": str(self.titre).strip(),
            "description": str(self.description).strip(),
            "echeance": str(self.echeance).strip(),
            "statut": "a_faire",
            "auteur_id": str(interaction.user.id),
            "assigne_id": None,
            "channel_id": str(interaction.channel_id),
            "message_id": None,
            "cree": _now().isoformat(),
        }
        await interaction.response.send_message("📋 Tâche créée.", ephemeral=True)
        msg = await interaction.channel.send(embed=_embed(t), view=_vue(t))
        t["message_id"] = str(msg.id)
        _sauver(bot, t)
        await _replacer_panneau(bot)


class PanneauVue(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Nouvelle tâche", emoji="➕", style=discord.ButtonStyle.success,
                       custom_id=NOUVELLE_ID)
    async def nouvelle(self, interaction: discord.Interaction, _b):
        if not _autorise(interaction.user, _cfg(interaction.client)):
            await interaction.response.send_message("Tu n'as pas le droit de créer des tâches.", ephemeral=True)
            return
        await interaction.response.send_modal(NouvelleModal())


def _panneau_embed():
    return discord.Embed(
        title="📋 Tâches de l'équipe",
        description=(
            "Crée une tâche avec **➕ Nouvelle tâche**, puis prends-la (**🙋**) ou confie-la (**👤**).\n"
            "-# 🕓 à faire · ✅ attribuée · 🏁 terminée"
        ),
        color=0xC9A44A,
    )


async def _replacer_panneau(bot):
    """Garde le panneau en bas du salon : supprime l'ancien et le reposte."""
    cfg = _cfg(bot)
    channel = bot.get_channel(int(cfg["channel_id"])) if cfg.get("channel_id") else None
    if channel is None:
        return
    ancien = cfg.get("panel_message_id")
    if ancien:
        try:
            await channel.get_partial_message(int(ancien)).delete()
        except discord.HTTPException:
            pass
    msg = await channel.send(embed=_panneau_embed(), view=PanneauVue())
    bot.store.set("taches", {"panel_message_id": str(msg.id)})


async def apply(bot, cfg):
    if not cfg.get("enabled") or not cfg.get("channel_id"):
        return
    channel = bot.get_channel(int(cfg["channel_id"]))
    if channel is None:
        log.warning("taches : salon %s introuvable", cfg["channel_id"])
        return
    pid = cfg.get("panel_message_id")
    if pid:
        try:
            await channel.get_partial_message(int(pid)).edit(embed=_panneau_embed(), view=PanneauVue())
            return
        except discord.HTTPException:
            pass
    await _replacer_panneau(bot)


def setup_persistent(bot):
    bot.add_view(PanneauVue())
    bot.add_dynamic_items(TacheBouton)


# --- Actions dashboard ---
async def action_supprimer(bot, payload):
    t = _get(bot, str(payload.get("id") or ""))
    if t is None:
        raise ValueError("tâche introuvable")
    channel = bot.get_channel(int(t["channel_id"]))
    if channel is not None and t.get("message_id"):
        try:
            await channel.get_partial_message(int(t["message_id"])).delete()
        except discord.HTTPException:
            pass
    bot.store.set("taches", {"taches": [x for x in _cfg(bot).get("taches", []) if x["id"] != t["id"]]})
    return {"ok": True}


async def action_liste(bot, _payload):
    """Tâches avec noms affichables (le dashboard ne connaît pas les pseudos)."""
    guild = bot.get_guild(config.GUILD_ID) if config.GUILD_ID else None

    def nom(uid):
        if not uid:
            return None
        m = guild.get_member(int(uid)) if guild else None
        return m.display_name if m else f"#{uid}"

    return {"ok": True, "taches": [
        {**t, "auteur": nom(t.get("auteur_id")), "assigne": nom(t.get("assigne_id"))}
        for t in _cfg(bot).get("taches", [])
    ]}


MODULE = register(Module(
    key="taches",
    label="Tâches",
    defaults=DEFAULTS,
    apply=apply,
    actions={"liste": action_liste, "supprimer": action_supprimer},
))
