"""Demandes de pub : la commande ``/pub`` (admins) pose dans un salon un panneau avec un
bouton « Proposer mon serveur ». Le membre y remplit un formulaire (nom, jeux,
présentation, invitation, type · membres), puis peut ajouter une bannière et un logo.

La demande est rangée dans la config du module Messages (``pub_demandes``) ; le
dashboard (Messages → Pub) la charge dans le gabarit de pub : il ne reste qu'à choisir le
salon et publier. Rien n'est posté publiquement sans validation d'un admin.
"""
import asyncio
import io
import logging
import os
import re
import uuid
from datetime import datetime, timezone

import aiohttp
import discord
from discord import app_commands
from PIL import Image

log = logging.getLogger("fripouille.pubdemandes")

# Hébergement des images des membres : ImgBB (clé gratuite). Sans clé, le formulaire
# retombe sur des champs « lien d'image ».
IMGBB_KEY = os.getenv("IMGBB_API_KEY", "").strip()
IMGBB_URL = "https://api.imgbb.com/1/upload"
MAX_OCTETS = 8 * 1024 * 1024
TAILLES = {"banner_url": (1600, 800), "logo_url": (512, 512)}   # dimensions maximales

OUVRIR_ID = "pub:ouvrir"
MAX_DEMANDES = 50
COLOR = 0xC9A44A
LIEN_RE = re.compile(r"^https?://[^\s/$.?#][^\s]*\.[^\s]{2,}$", re.I)
IMG_RE = re.compile(r"^https://\S+$", re.I)


def _demandes(bot) -> list[dict]:
    return list(bot.store.get("messages").get("pub_demandes", []))


def _enregistrer(bot, demandes: list[dict]) -> None:
    bot.store.set("messages", {"pub_demandes": demandes[-MAX_DEMANDES:]})


def _scinder_meta(meta: str) -> tuple[str, str]:
    """« Communautaire · 120 membres » → (« Communautaire », « 120 membres »)."""
    parts = [p.strip() for p in re.split(r"\s*[·|/,;]\s*", meta.strip(), maxsplit=1) if p.strip()]
    if not parts:
        return "", ""
    return (parts[0], parts[1]) if len(parts) > 1 else (parts[0], "")


class PubModal(discord.ui.Modal, title="Proposer mon serveur"):
    nom = discord.ui.TextInput(label="Nom du serveur", max_length=100)
    jeux = discord.ui.TextInput(label="Jeu(x)", placeholder="Ex. Rainbow Six Siege, Valorant", max_length=200)
    description = discord.ui.TextInput(
        label="Présentation", style=discord.TextStyle.paragraph, max_length=700,
        placeholder="Qui êtes-vous, ce que vous proposez, l'ambiance…",
    )
    invitation = discord.ui.TextInput(
        label="Lien pour vous rejoindre (facultatif)", required=False, max_length=200,
        placeholder="Invitation Discord, site, réseau social…",
    )
    meta = discord.ui.TextInput(
        label="Type · nombre de membres", required=False, max_length=100,
        placeholder="Ex. Communautaire · 120 membres",
    )

    async def on_submit(self, interaction: discord.Interaction):
        invite = self.invitation.value.strip()
        if invite and not re.match(r"^https?://", invite, re.I):
            invite = "https://" + invite          # « discord.gg/xyz » ou « monsite.fr » sans schéma
        if invite and not LIEN_RE.match(invite):
            await interaction.response.send_message(
                "❌ Ce lien n'est pas valide. Relance le formulaire (ou laisse le champ vide).",
                ephemeral=True,
            )
            return
        type_, membres = _scinder_meta(self.meta.value or "")
        bot = interaction.client
        demande = {
            "id": uuid.uuid4().hex[:8],
            "user_id": str(interaction.user.id),
            "user_name": interaction.user.display_name[:80],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "pub": {
                "server_name": self.nom.value.strip(),
                "games": self.jeux.value.strip(),
                "type": type_,
                "members": membres,
                "description": self.description.value.strip(),
                "invite_url": invite,
                "banner_url": "",
                "logo_url": "",
            },
        }
        # Une seule demande en attente par membre : la nouvelle remplace l'ancienne.
        demandes = [d for d in _demandes(bot) if d.get("user_id") != demande["user_id"]]
        demandes.append(demande)
        _enregistrer(bot, demandes)
        await interaction.response.send_message(
            "✅ Ta demande est enregistrée, l'équipe va la relire. "
            "Tu peux ajouter une **bannière** et un **logo** (liens d'images) si tu veux.",
            view=ImagesView(demande["id"]), ephemeral=True,
        )


class ImagesModal(discord.ui.Modal, title="Bannière et logo"):
    banniere = discord.ui.TextInput(
        label="Bannière (lien d'image, large)", required=False, max_length=400, placeholder="https://…",
    )
    logo = discord.ui.TextInput(
        label="Logo (lien d'image, carré)", required=False, max_length=400, placeholder="https://…",
    )

    def __init__(self, demande_id: str):
        super().__init__()
        self.demande_id = demande_id

    async def on_submit(self, interaction: discord.Interaction):
        bot = interaction.client
        demandes = _demandes(bot)
        d = next((x for x in demandes if x.get("id") == self.demande_id
                  and x.get("user_id") == str(interaction.user.id)), None)
        if d is None:
            await interaction.response.send_message("❌ Demande introuvable (déjà traitée ?).", ephemeral=True)
            return
        for cle, champ in (("banner_url", self.banniere), ("logo_url", self.logo)):
            v = champ.value.strip()
            if v and not IMG_RE.match(v):
                await interaction.response.send_message(
                    "❌ Les images doivent être des liens https://… Relance le formulaire.", ephemeral=True
                )
                return
            d["pub"][cle] = v
        _enregistrer(bot, demandes)
        await interaction.response.send_message("🖼️ Images enregistrées. Merci !", ephemeral=True)


def _preparer_image(brut: bytes, cle: str) -> tuple[bytes, str]:
    """Vérifie que c'est bien une image, la réduit et la ré-encode (retire aussi les
    métadonnées). Renvoie (octets, nom de fichier)."""
    img = Image.open(io.BytesIO(brut))
    img.load()
    img.thumbnail(TAILLES[cle], Image.LANCZOS)
    out = io.BytesIO()
    if cle == "logo_url":
        img.convert("RGBA").save(out, "PNG", optimize=True)
        return out.getvalue(), "logo.png"
    img.convert("RGB").save(out, "JPEG", quality=88, optimize=True)
    return out.getvalue(), "banniere.jpg"


async def _heberger(octets: bytes, nom: str) -> str:
    """Envoie l'image sur ImgBB et renvoie son URL directe."""
    form = aiohttp.FormData()
    form.add_field("image", octets, filename=nom)
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as s:
        async with s.post(IMGBB_URL, params={"key": IMGBB_KEY}, data=form) as r:
            if r.status != 200:
                raise ValueError(f"hébergeur : HTTP {r.status}")
            return (await r.json())["data"]["url"]


class FichiersModal(discord.ui.Modal, title="Bannière et logo"):
    banniere = discord.ui.Label(
        text="Bannière (image large, facultative)",
        component=discord.ui.FileUpload(required=False, min_values=0, max_values=1),
    )
    logo = discord.ui.Label(
        text="Logo (image carrée, facultative)",
        component=discord.ui.FileUpload(required=False, min_values=0, max_values=1),
    )

    def __init__(self, demande_id: str):
        super().__init__()
        self.demande_id = demande_id

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        urls, erreurs = {}, []
        for cle, label in (("banner_url", self.banniere), ("logo_url", self.logo)):
            fichiers = label.component.values
            if not fichiers:
                continue
            f = fichiers[0]
            if f.size > MAX_OCTETS:
                erreurs.append(f"{f.filename} dépasse 8 Mo")
                continue
            try:
                octets, nom = await asyncio.to_thread(_preparer_image, await f.read(), cle)
                urls[cle] = await _heberger(octets, nom)
            except (OSError, ValueError, aiohttp.ClientError, TimeoutError, KeyError) as exc:
                log.warning("pub : image %s refusée (%s)", f.filename, exc)
                erreurs.append(f"{f.filename} n'est pas une image valide ou l'envoi a échoué")
        demandes = _demandes(bot)
        d = next((x for x in demandes if x.get("id") == self.demande_id
                  and x.get("user_id") == str(interaction.user.id)), None)
        if d is None:
            await interaction.followup.send("❌ Demande introuvable (déjà traitée ?).", ephemeral=True)
            return
        d["pub"].update(urls)
        _enregistrer(bot, demandes)
        msg = "🖼️ Images enregistrées. Merci !" if urls else "Aucune image enregistrée."
        if erreurs:
            msg += "\n⚠️ " + " · ".join(erreurs)
        await interaction.followup.send(msg, ephemeral=True)


class ImagesView(discord.ui.View):
    def __init__(self, demande_id: str):
        super().__init__(timeout=900)
        self.demande_id = demande_id

    @discord.ui.button(label="🖼️ Ajouter bannière / logo", style=discord.ButtonStyle.secondary)
    async def images(self, interaction: discord.Interaction, _button: discord.ui.Button):
        modal = FichiersModal(self.demande_id) if IMGBB_KEY else ImagesModal(self.demande_id)
        await interaction.response.send_modal(modal)


class PanneauView(discord.ui.View):
    """Bouton persistant du panneau posé par /pub."""
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="📣 Proposer mon serveur", style=discord.ButtonStyle.primary, custom_id=OUVRIR_ID)
    async def ouvrir(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await interaction.response.send_modal(PubModal())


def setup(tree: app_commands.CommandTree, guild: discord.Object | None) -> None:
    @tree.command(
        name="pub",
        description="Poser ici le panneau « Proposer mon serveur » (admins).",
        guild=guild,
    )
    @app_commands.default_permissions(administrator=True)
    async def pub(interaction: discord.Interaction):
        perms = getattr(interaction.user, "guild_permissions", None)
        if perms is None or not perms.administrator:
            await interaction.response.send_message("❌ Réservé aux administrateurs.", ephemeral=True)
            return
        channel = interaction.channel
        if channel is None or not isinstance(channel, discord.abc.Messageable):
            await interaction.response.send_message("❌ Utilise cette commande dans un salon.", ephemeral=True)
            return
        embed = discord.Embed(
            title="📣 Proposer mon serveur",
            description=(
                "Tu as un serveur à faire connaître ? Clique sur le bouton, remplis le formulaire "
                "(nom, jeux, présentation, lien pour vous rejoindre) et l'équipe s'occupe de la publication.\n\n"
                "-# Chaque demande est relue avant d'être publiée."
            ),
            color=COLOR,
        )
        await channel.send(embed=embed, view=PanneauView())
        await interaction.response.send_message("✅ Panneau posé.", ephemeral=True)


def setup_persistent(bot) -> None:
    bot.add_view(PanneauView())


# --- Actions dashboard (branchées sur le module Messages) ---
async def action_demande_supprimer(bot, payload):
    did = str(payload.get("id") or "")
    if not did:
        raise ValueError("demande manquante")
    _enregistrer(bot, [d for d in _demandes(bot) if d.get("id") != did])
    return {"ok": True}
