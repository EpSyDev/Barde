"""Module « Tickets » : panneau → salon privé membre+staff, prise en charge,
fermeture avec raison, archivage offloadé sur Discord.

Stratégie de stockage (VM 1 Go / disque limité) : AUCUN transcript n'est écrit sur
le disque de la VM. À la fermeture, l'historique du salon est rendu en fichier texte
**en mémoire** et envoyé dans le salon d'archive → c'est Discord qui stocke. Le salon
de ticket est **supprimé** par défaut (évite le plafond de 500 salons/serveur) ;
option pour le verrouiller/garder à la place.

Confort : motifs multiples (menu), prise en charge (claim), anti-doublon (1 ticket
ouvert/membre), numérotation, ping staff optionnel, fermeture avec raison.

Vues persistantes (survivent au restart) : panneau (`tickets:open`) et contrôles de
ticket (`tickets:claim`, `tickets:close`).
"""
import io
import logging
from datetime import datetime, timezone

import discord

from ..registry import Module, register

log = logging.getLogger("fripouille.tickets")

OPEN_ID = "tickets:open"
CLAIM_ID = "tickets:claim"
CLOSE_ID = "tickets:close"
TOPIC_PREFIX = "ticket"     # topic salon = "ticket|opener_id|claimer_id"
TRANSCRIPT_LIMIT = 1000     # messages max archivés (borne mémoire/temps)

DEFAULTS = {
    "enabled": False,
    "panel_channel_id": None,     # salon où poster le panneau
    "category_id": None,          # catégorie où créer les tickets
    "staff_role_id": None,        # rôle staff (accès aux tickets)
    "log_channel_id": None,       # salon d'archive (transcripts)
    "panel_title": "Besoin d'aide ?",
    "panel_description": "Clique ci-dessous pour ouvrir un ticket. Le staff te répondra ici, en privé.",
    "button_label": "Ouvrir un ticket",
    "open_message": "Bonjour {mention} ! Décris ta demande en détail, le staff arrive. 🛎️",
    "ping_staff": True,
    "delete_on_close": True,
    "reasons": [],                # [{id,label,emoji,intro}]
    "message_id": None,           # panneau (géré bot)
    "counter": 0,                 # compteur tickets (géré bot)
}


# --- Helpers ---
def _cfg(bot):
    return bot.store.get("tickets")


def _staff_role(guild, cfg):
    rid = cfg.get("staff_role_id")
    return guild.get_role(int(rid)) if rid else None


def _is_staff(member, cfg):
    staff = _staff_role(member.guild, cfg)
    if staff is None:
        return getattr(member.guild_permissions, "manage_channels", False)
    return staff in getattr(member, "roles", [])


def _parse_topic(topic):
    if not topic or not topic.startswith(TOPIC_PREFIX + "|"):
        return None, None
    parts = topic.split("|")
    opener = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
    claimer = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else None
    return opener, claimer


def _find_open_ticket(category, opener_id):
    for ch in category.text_channels:
        o, _ = _parse_topic(ch.topic)
        if o == opener_id:
            return ch
    return None


def _fmt(text, member):
    return (text or "").replace("{mention}", member.mention).replace("{name}", member.display_name)


# --- Vues ---
class OpenButton(discord.ui.Button):
    def __init__(self, label):
        super().__init__(
            label=(label or "Ouvrir un ticket")[:80], emoji="🎫",
            style=discord.ButtonStyle.success, custom_id=OPEN_ID,
        )

    async def callback(self, interaction):
        await open_ticket(interaction, None)


class ReasonSelect(discord.ui.Select):
    def __init__(self, reasons):
        options = [
            discord.SelectOption(
                label=r["label"][:100], value=r["id"],
                emoji=(r.get("emoji") or "").strip() or None,
                description=(r.get("intro") or "")[:100] or None,
            )
            for r in reasons if r.get("label") and r.get("id")
        ][:25]
        super().__init__(
            placeholder="Choisis un motif pour ouvrir un ticket…",
            custom_id=OPEN_ID, min_values=1, max_values=1,
            options=options or [discord.SelectOption(label="Ouvrir un ticket", value="_")],
        )

    async def callback(self, interaction):
        await open_ticket(interaction, self.values[0])


class PanelView(discord.ui.View):
    def __init__(self, bot):
        super().__init__(timeout=None)
        cfg = _cfg(bot)
        reasons = cfg.get("reasons") or []
        self.add_item(ReasonSelect(reasons) if reasons else OpenButton(cfg.get("button_label")))


class ClaimButton(discord.ui.Button):
    def __init__(self):
        super().__init__(
            label="Prendre en charge", emoji="🙋",
            style=discord.ButtonStyle.primary, custom_id=CLAIM_ID,
        )

    async def callback(self, interaction):
        await claim_ticket(interaction)


class CloseButton(discord.ui.Button):
    def __init__(self):
        super().__init__(
            label="Fermer", emoji="🔒",
            style=discord.ButtonStyle.danger, custom_id=CLOSE_ID,
        )

    async def callback(self, interaction):
        await interaction.response.send_modal(CloseModal())


class TicketControls(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        self.add_item(ClaimButton())
        self.add_item(CloseButton())


class CloseModal(discord.ui.Modal, title="Fermer le ticket"):
    reason = discord.ui.TextInput(
        label="Raison (optionnel)", required=False,
        style=discord.TextStyle.paragraph, max_length=500,
    )

    async def on_submit(self, interaction):
        await close_ticket(interaction, str(self.reason))


# --- Actions ---
async def open_ticket(interaction, reason_id):
    bot = interaction.client
    cfg = _cfg(bot)
    guild = interaction.guild
    if guild is None:
        return
    category = bot.get_channel(int(cfg["category_id"])) if cfg.get("category_id") else None
    if not isinstance(category, discord.CategoryChannel):
        await interaction.response.send_message(
            "Tickets mal configurés (catégorie manquante). Préviens un admin.", ephemeral=True
        )
        return

    existing = _find_open_ticket(category, interaction.user.id)
    if existing:
        await interaction.response.send_message(
            f"Tu as déjà un ticket ouvert : {existing.mention}", ephemeral=True
        )
        return

    await interaction.response.defer(ephemeral=True, thinking=True)
    counter = int(cfg.get("counter") or 0) + 1
    bot.store.set("tickets", {"counter": counter})

    staff = _staff_role(guild, cfg)
    overwrites = {
        guild.default_role: discord.PermissionOverwrite(view_channel=False),
        interaction.user: discord.PermissionOverwrite(
            view_channel=True, send_messages=True, attach_files=True, embed_links=True
        ),
        guild.me: discord.PermissionOverwrite(
            view_channel=True, send_messages=True, manage_channels=True
        ),
    }
    if staff:
        overwrites[staff] = discord.PermissionOverwrite(view_channel=True, send_messages=True)

    try:
        channel = await guild.create_text_channel(
            name=f"ticket-{counter:04d}", category=category, overwrites=overwrites,
            topic=f"{TOPIC_PREFIX}|{interaction.user.id}|",
            reason=f"Ticket de {interaction.user}",
        )
    except discord.Forbidden:
        await interaction.followup.send(
            "Je n'ai pas la permission de créer le salon (il me faut « Gérer les salons »).",
            ephemeral=True,
        )
        return

    reason_obj = next(
        (r for r in (cfg.get("reasons") or []) if r.get("id") == reason_id), None
    )
    intro = _fmt((reason_obj.get("intro") if reason_obj else "") or cfg.get("open_message"), interaction.user)
    embed = discord.Embed(title=f"🎫 Ticket #{counter:04d}", description=intro, color=0xC9A44A)
    embed.add_field(name="Ouvert par", value=interaction.user.mention, inline=True)
    if reason_obj:
        embed.add_field(name="Motif", value=reason_obj["label"], inline=True)

    content = staff.mention if (cfg.get("ping_staff") and staff) else None
    await channel.send(
        content=content, embed=embed, view=TicketControls(),
        allowed_mentions=discord.AllowedMentions(roles=True, users=True, everyone=False),
    )
    await interaction.followup.send(f"Ton ticket est ouvert : {channel.mention}", ephemeral=True)


async def claim_ticket(interaction):
    cfg = _cfg(interaction.client)
    if not _is_staff(interaction.user, cfg):
        await interaction.response.send_message("Réservé au staff.", ephemeral=True)
        return
    opener, _ = _parse_topic(interaction.channel.topic)
    try:
        await interaction.channel.edit(topic=f"{TOPIC_PREFIX}|{opener or ''}|{interaction.user.id}")
    except discord.Forbidden:
        pass
    await interaction.response.send_message(
        f"🙋 Ticket pris en charge par {interaction.user.mention}."
    )


async def _build_transcript(channel):
    lines = [f"Transcript — #{channel.name}", f"(archivé le {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC)", ""]
    count = 0
    async for msg in channel.history(limit=TRANSCRIPT_LIMIT, oldest_first=True):
        count += 1
        ts = msg.created_at.strftime("%Y-%m-%d %H:%M")
        content = msg.content or ""
        if msg.embeds:
            content += " [embed]"
        if msg.attachments:
            content += " " + " ".join(a.url for a in msg.attachments)
        lines.append(f"[{ts}] {msg.author}: {content}")
    if count >= TRANSCRIPT_LIMIT:
        lines.append(f"\n… (tronqué à {TRANSCRIPT_LIMIT} messages)")
    return "\n".join(lines), count


async def close_ticket(interaction, reason):
    bot = interaction.client
    cfg = _cfg(bot)
    channel = interaction.channel
    opener_id, claimer_id = _parse_topic(getattr(channel, "topic", None))
    if opener_id is None:
        await interaction.response.send_message("Ce salon n'est pas un ticket.", ephemeral=True)
        return
    if not _is_staff(interaction.user, cfg) and interaction.user.id != opener_id:
        await interaction.response.send_message(
            "Réservé au staff ou à l'auteur du ticket.", ephemeral=True
        )
        return

    await interaction.response.send_message("🔒 Fermeture du ticket — archivage en cours…")

    log_channel = bot.get_channel(int(cfg["log_channel_id"])) if cfg.get("log_channel_id") else None
    if log_channel is not None:
        try:
            transcript, count = await _build_transcript(channel)
            summary = discord.Embed(
                title=f"🗃️ Ticket archivé — {channel.name}",
                color=0x8A6A3B, timestamp=datetime.now(timezone.utc),
            )
            summary.add_field(name="Ouvert par", value=f"<@{opener_id}>", inline=True)
            summary.add_field(name="Fermé par", value=interaction.user.mention, inline=True)
            if claimer_id:
                summary.add_field(name="Pris en charge par", value=f"<@{claimer_id}>", inline=True)
            summary.add_field(name="Messages", value=str(count), inline=True)
            if reason.strip():
                summary.add_field(name="Raison", value=reason[:1000], inline=False)
            file = discord.File(io.BytesIO(transcript.encode("utf-8")), filename=f"{channel.name}.txt")
            await log_channel.send(embed=summary, file=file)
        except discord.Forbidden:
            log.error("tickets : archive refusée dans le salon de log")
        except Exception as exc:  # noqa: BLE001
            log.error("tickets : échec transcript : %s", exc)

    if cfg.get("delete_on_close", True):
        try:
            await channel.delete(reason=f"Ticket fermé par {interaction.user}")
        except discord.Forbidden:
            log.error("tickets : suppression du salon refusée")
    else:
        try:
            opener = interaction.guild.get_member(opener_id)
            if opener:
                await channel.set_permissions(opener, overwrite=None)
            await channel.edit(name=f"closed-{channel.name}"[:100])
        except discord.Forbidden:
            pass


# --- Cycle de vie ---
async def apply(bot, cfg):
    if not cfg.get("enabled") or not cfg.get("panel_channel_id"):
        return
    channel = bot.get_channel(int(cfg["panel_channel_id"]))
    if channel is None:
        log.warning("tickets : salon du panneau introuvable")
        return
    embed = discord.Embed(
        title=cfg.get("panel_title") or "Besoin d'aide ?",
        description=cfg.get("panel_description") or "",
        color=0xC9A44A,
    )
    view = PanelView(bot)
    msg = None
    mid = cfg.get("message_id")
    if mid:
        try:
            msg = await channel.fetch_message(int(mid))
        except (discord.NotFound, discord.Forbidden):
            msg = None
    if msg is not None:
        await msg.edit(embed=embed, view=view)
    else:
        sent = await channel.send(embed=embed, view=view)
        bot.store.set("tickets", {"message_id": str(sent.id)})
    bot.add_view(view)


async def setup_persistent(bot):
    if _cfg(bot).get("enabled"):
        bot.add_view(PanelView(bot))
    bot.add_view(TicketControls())   # pour les tickets déjà ouverts


MODULE = register(Module(
    key="tickets",
    label="Tickets",
    defaults=DEFAULTS,
    apply=apply,
))
