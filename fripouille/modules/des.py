"""Module « Dés » : lanceur de dés pour les soirées Donjons & Dragons (règles 5e).

Le MJ gère à l'oral l'avantage, le désavantage et les cas particuliers : l'outil reste
volontairement simple.

- **Panneau** posté dans le salon de jeu (boutons persistants) :
  ligne 1 : d4 · d6 · d8 · d10 · d12          (un clic = un dé, résultat public)
  ligne 2 : d20 · d100 · ✍️ Jet libre · ⚔️ Initiative
- **Commandes** ``/d jet:1d8+3 raison:"Dégâts" critique:oui secret:oui`` (partout, y
  compris dans le chat d'un salon vocal) et ``/initiative``.

Règles couvertes :
- Expression libre : ``1d8+2d6+3``, ``4d6kh3`` / ``2d20kl1`` (garder les meilleurs / les
  pires), ``2d6r2`` (relancer une fois les dés ≤ 2), ``d%`` = d100. Seuls les 7 dés du jeu.
- **20 naturel** = réussite critique, **1 naturel** = échec critique (sur un d20 seul).
- **Critique (dégâts)** : deux fois plus de dés, le modificateur ne double pas.
- **d100** : affiché comme les deux d10 du jeu (dizaine + unité, 00+0 = 100).
- **Initiative** : tableau partagé ; chacun (ou le MJ pour ses monstres) lance d20+bonus,
  ordre trié, « tour suivant » avec compteur de rounds.
- **Jet secret** (MJ) : visible du seul lanceur, avec un bouton « Révéler ».

Chaque résultat public porte « 🔁 Relancer », réservé à celui qui a lancé (son id est
dans le custom_id du bouton). Tirage via ``secrets.SystemRandom``.
"""
import asyncio
import io
import logging
import re
import secrets
import time

import discord
from discord import app_commands

from .. import des_rendu
from ..registry import Module, register

log = logging.getLogger("fripouille.des")

DES = (4, 6, 8, 10, 12, 20, 100)
MAX_DES = 100          # dés par jet (anti-spam)
MAX_EXPR = 60          # longueur d'expression (tient dans un custom_id de bouton)
OR, VERT, ROUGE, GRIS = 0xC9A44A, 0x57F287, 0xED4245, 0x4F545C
_rng = secrets.SystemRandom()
SUSPENSE_S = 1.2       # « 🎲 roule… » avant le résultat : le temps d'un vrai lancer

DEFAULTS = {
    "enabled": False,
    "channel_id": "1558518342791331941",
    "panel_message_id": None,
    "log_channel_id": None,   # salon MJ : journal de tout ce qui se passe à la table
    "log_panel_id": None,     # message « 🧹 Vider le journal » du salon MJ (géré bot)
}

MODES = {"n": "", "c": "critique"}


# ═══════════════════════════ Moteur ═══════════════════════════
class JetInvalide(ValueError):
    pass


_TERME = re.compile(r"([+-])?(?:(\d*)d(\d+|%)((?:k[hl]?\d+|r\d+)*)|(\d+))")
_SUFFIXE = re.compile(r"(kh|kl|k|r)(\d+)")


def _normaliser(expr: str) -> str:
    e = (expr or "").lower().replace(" ", "").replace("dé", "d")
    return e or "1d20"


def _parser(expr: str) -> list[dict]:
    """``1d20+5-1d4`` → [{signe, n, faces, kh, kl, r} | {signe, valeur}]."""
    e = _normaliser(expr)
    if len(e) > MAX_EXPR:
        raise JetInvalide(f"jet trop long ({MAX_EXPR} caractères max)")
    termes, pos = [], 0
    while pos < len(e):
        m = _TERME.match(e, pos)
        if not m or m.end() == pos or (pos > 0 and not m.group(1)):
            raise JetInvalide(f"je ne comprends pas « {e[pos:pos + 12]} »")
        signe = -1 if m.group(1) == "-" else 1
        if m.group(5) is not None:
            termes.append({"signe": signe, "valeur": int(m.group(5))})
        else:
            n = int(m.group(2) or 1)
            faces = 100 if m.group(3) == "%" else int(m.group(3))
            if faces not in DES:
                raise JetInvalide(f"d{faces} n'existe pas dans le jeu (d4, d6, d8, d10, d12, d20, d100)")
            t = {"signe": signe, "n": n, "faces": faces, "kh": None, "kl": None, "r": None}
            for suf, val in _SUFFIXE.findall(m.group(4) or ""):
                v = int(val)
                if suf in ("kh", "k"):
                    t["kh"] = v
                elif suf == "kl":
                    t["kl"] = v
                else:
                    t["r"] = v
            if n < 1:
                raise JetInvalide("il faut au moins un dé")
            if t["r"] is not None and t["r"] >= faces:
                raise JetInvalide("la relance ne peut pas couvrir toutes les faces du dé")
            termes.append(t)
        pos = m.end()
    if sum(t.get("n", 0) for t in termes) > MAX_DES:
        raise JetInvalide(f"{MAX_DES} dés maximum par jet")
    if len(termes) > 20:
        raise JetInvalide("20 éléments maximum")
    return termes


def _appliquer_mode(termes: list[dict], mode: str) -> list[dict]:
    """Critique (dégâts) : deux fois plus de dés, le modificateur ne change pas."""
    if mode == "c":
        for t in termes:
            if "faces" in t:
                t["n"] *= 2
                if t["kh"]:
                    t["kh"] *= 2
                if t["kl"]:
                    t["kl"] *= 2
        if sum(t.get("n", 0) for t in termes) > MAX_DES:
            raise JetInvalide(f"{MAX_DES} dés maximum par jet")
    return termes


def _d(faces: int) -> int:
    return _rng.randint(1, faces)


def _lancer(termes: list[dict]) -> dict:
    """Lance tout. Renvoie {total, lignes, nat} — nat = valeur du d20 si le jet n'en
    garde qu'un (pour les critiques), sinon None."""
    total, lignes, d20_gardes, tous = 0, [], [], []
    for t in termes:
        if "valeur" in t:
            total += t["signe"] * t["valeur"]
            continue
        des = []
        for _ in range(t["n"]):
            v, ancien = _d(t["faces"]), None
            if t["r"] is not None and v <= t["r"]:
                ancien, v = v, _d(t["faces"])
            des.append({"v": v, "ancien": ancien, "garde": True})
        ordre = sorted(range(len(des)), key=lambda i: des[i]["v"])
        if t["kh"] is not None:
            for i in ordre[:max(0, len(des) - t["kh"])]:
                des[i]["garde"] = False
        elif t["kl"] is not None:
            for i in ordre[t["kl"]:]:
                des[i]["garde"] = False
        somme = sum(d["v"] for d in des if d["garde"])
        total += t["signe"] * somme
        if t["faces"] == 20:
            d20_gardes += [d["v"] for d in des if d["garde"]]
        tous += [{"faces": t["faces"], "v": d["v"], "garde": d["garde"]} for d in des]

        def fmt(d):
            s = f"**{d['v']}**" if d["garde"] else f"~~{d['v']}~~"
            if d["ancien"] is not None:
                s = f"~~{d['ancien']}~~→{s}"
            if t["faces"] == 100:
                dz, u = (d["v"] // 10) % 10 * 10, d["v"] % 10
                s += f" ({dz:02d}+{u})"
            return s

        libelle = f"{t['n']}d{t['faces']}"
        if t["kh"] is not None:
            libelle += f" (garde {t['kh']} meilleur{'s' if t['kh'] > 1 else ''})"
        elif t["kl"] is not None:
            libelle += f" (garde {t['kl']} pire{'s' if t['kl'] > 1 else ''})"
        signe = "− " if t["signe"] < 0 else ""
        lignes.append(f"{signe}`{libelle}` : {', '.join(fmt(d) for d in des)}"
                      + (f" = {somme}" if len(des) > 1 else ""))
    mods = sum(t["signe"] * t["valeur"] for t in termes if "valeur" in t)
    if mods:
        lignes.append(f"Modificateur : **{mods:+d}**")
    nat = d20_gardes[0] if len(d20_gardes) == 1 else None
    return {"total": total, "lignes": lignes, "nat": nat, "des": tous}


def _texte_expr(termes: list[dict]) -> str:
    parts = []
    for t in termes:
        if "valeur" in t:
            s = str(t["valeur"])
        else:
            s = f"{t['n']}d{t['faces']}"
            if t["kh"] is not None:
                s += f"kh{t['kh']}"
            if t["kl"] is not None:
                s += f"kl{t['kl']}"
            if t["r"] is not None:
                s += f"r{t['r']}"
        parts.append(("-" if t["signe"] < 0 else "+") + s)
    return "".join(parts).lstrip("+")


def jet(expr: str, mode: str = "n") -> dict:
    """Point d'entrée du moteur : lève JetInvalide si l'expression est incorrecte."""
    termes = _appliquer_mode(_parser(expr), mode)
    r = _lancer(termes)
    r["expr"] = _texte_expr(termes)
    return r


def _options_depuis_texte(txt: str) -> tuple[str, bool]:
    """« critique », « secret », « crit secret »… → (mode, secret)."""
    t = (txt or "").lower()
    return ("c" if "crit" in t else "n"), ("secr" in t or "mj" in t.split())


# ═══════════════════════════ Journal MJ ═══════════════════════════
async def _log(client, texte: str):
    """Trace une action de la table dans le salon MJ (si configuré). Jamais de ping."""
    cid = client.store.get("des").get("log_channel_id")
    channel = client.get_channel(int(cid)) if cid else None
    if channel is None:
        return
    try:
        await channel.send(texte[:2000], allowed_mentions=discord.AllowedMentions.none())
    except discord.HTTPException as exc:
        log.warning("journal MJ : %s", exc)


class ViderConfirmation(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=60)

    @discord.ui.button(label="Oui, tout effacer", emoji="🧹", style=discord.ButtonStyle.danger)
    async def oui(self, interaction: discord.Interaction, _b):
        await interaction.response.edit_message(content="🧹 Nettoyage en cours…", view=None)
        n = await _vider_journal(interaction.client, interaction.channel)
        await interaction.edit_original_response(content=f"🧹 Journal vidé : {n} message(s) supprimé(s).")


class JournalVue(discord.ui.View):
    """Bouton persistant du salon MJ : efface tout le journal de la partie."""

    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Vider le journal", emoji="🧹", style=discord.ButtonStyle.danger,
                       custom_id="des:journal:vider")
    async def vider(self, interaction: discord.Interaction, _b):
        await interaction.response.send_message(
            "Effacer **tous** les logs de la table dans ce salon ? (irréversible)",
            view=ViderConfirmation(), ephemeral=True,
        )


async def _vider_journal(client, channel) -> int:
    """Supprime tous les messages du bot dans le salon MJ, sauf le panneau du journal."""
    garde = client.store.get("des").get("log_panel_id")

    def cible(m):
        return m.author.id == client.user.id and str(m.id) != str(garde)

    try:
        # En masse (permission « Gérer les messages ») ; discord.py bascule seul en
        # suppression unitaire pour les messages de plus de 14 jours.
        return len(await channel.purge(limit=None, check=cible, reason="Fin de partie : journal vidé"))
    except discord.Forbidden:
        n = 0
        async for m in channel.history(limit=None):
            if cible(m):
                try:
                    await m.delete()
                    n += 1
                except discord.HTTPException:
                    pass
        return n


async def _poster_panneau_journal(bot, cfg):
    cid = cfg.get("log_channel_id")
    channel = bot.get_channel(int(cid)) if cid else None
    if channel is None:
        return
    e = discord.Embed(
        title="📜 Journal de la table",
        description="Chaque jet, initiative et tour de la table de jeu est consigné ici.\n"
                    "Partie terminée ? **🧹 Vider le journal** efface tous les logs (ce message reste).",
        color=GRIS,
    )
    pid = cfg.get("log_panel_id")
    if pid:
        try:
            await channel.get_partial_message(int(pid)).edit(embed=e, view=JournalVue())
            return
        except discord.HTTPException:
            pass
    msg = await channel.send(embed=e, view=JournalVue())
    try:
        await msg.pin(reason="Panneau du journal MJ")
    except discord.HTTPException:
        pass
    bot.store.set("des", {"log_panel_id": str(msg.id)})


def _qui(user) -> str:
    return f"**{user.display_name}**"


# ═══════════════════════════ Rendu ═══════════════════════════
def _embed_jet(user, r: dict, mode: str, raison: str = "", secret: bool = False) -> discord.Embed:
    couleur, ligne_crit = OR, None
    if r["nat"] == 20 and mode != "c":
        couleur, ligne_crit = VERT, "✨ **20 naturel — réussite critique !**"
    elif r["nat"] == 1 and mode != "c":
        couleur, ligne_crit = ROUGE, "💥 **1 naturel — échec critique !**"
    titre = f"🎲 {raison}" if raison else "🎲 Jet de dés"
    if MODES[mode]:
        titre += f" · {MODES[mode]}"
    corps = [*r["lignes"], f"# {r['total']}"]
    if ligne_crit:
        corps.append(ligne_crit)
    e = discord.Embed(title=titre[:256], description="\n".join(corps)[:4000], color=couleur)
    e.set_author(name=f"{user.display_name}{' (jet secret)' if secret else ''}",
                 icon_url=user.display_avatar.url)
    e.set_footer(text=r["expr"] + (" · dégâts critiques : dés doublés" if mode == "c" else ""))
    return e


class Relancer(discord.ui.DynamicItem[discord.ui.Button],
               template=r"des:re:(?P<u>\d+):(?P<m>[nc]):(?P<e>.+)"):
    """« 🔁 Relancer » : refait le même jet, uniquement pour celui qui l'a lancé."""

    def __init__(self, uid: int, mode: str, expr: str):
        super().__init__(discord.ui.Button(
            label="Relancer", emoji="🔁", style=discord.ButtonStyle.secondary,
            custom_id=f"des:re:{uid}:{mode}:{expr}"[:100],
        ))
        self.uid, self.mode, self.expr = uid, mode, expr

    @classmethod
    async def from_custom_id(cls, interaction, item, match: re.Match):
        return cls(int(match["u"]), match["m"], match["e"])

    async def callback(self, interaction: discord.Interaction):
        if interaction.user.id != self.uid:
            await interaction.response.send_message(
                "🎲 Ce jet n'est pas le tien : seul son lanceur peut le relancer.", ephemeral=True)
            return
        await _repondre_jet(interaction, self.expr, self.mode, relance=True)


def _vue_relancer(uid: int, expr: str, mode: str) -> discord.ui.View:
    v = discord.ui.View(timeout=None)
    v.add_item(Relancer(uid, mode, expr))
    return v


class Reveler(discord.ui.View):
    """Sous un jet secret : publie le même résultat dans le salon."""

    def __init__(self, embed: discord.Embed, png: bytes | None):
        super().__init__(timeout=3600)
        self.embed, self.png = embed, png

    @discord.ui.button(label="Révéler à la table", emoji="📢", style=discord.ButtonStyle.primary)
    async def reveler(self, interaction: discord.Interaction, _b):
        e = self.embed.copy()
        e.set_author(name=f"{interaction.user.display_name} (jet secret révélé)",
                     icon_url=interaction.user.display_avatar.url)
        await interaction.response.edit_message(view=None)
        if self.png:
            await interaction.followup.send(embed=e, file=discord.File(io.BytesIO(self.png), "jet.png"))
        else:
            await interaction.followup.send(embed=e)
        await _log(interaction.client, f"📢 {_qui(interaction.user)} révèle son jet secret à la table.")


async def _repondre_jet(interaction: discord.Interaction, expr: str, mode: str = "n",
                        raison: str = "", secret: bool = False, relance: bool = False):
    try:
        r = jet(expr, mode)
    except JetInvalide as exc:
        await interaction.response.send_message(f"⚠️ {exc}", ephemeral=True)
        return
    e = _embed_jet(interaction.user, r, mode, raison, secret)
    # 1) le dé « roule » ; 2) on dessine pendant ce temps (hors boucle asyncio) ;
    # 3) le résultat remplace le message, image comprise.
    debut = time.monotonic()
    await interaction.response.send_message(
        f"🎲 *{interaction.user.display_name} lance les dés… ça roule…*", ephemeral=secret)
    try:
        png = await asyncio.to_thread(des_rendu.rendre, r["des"], r["nat"] if mode != "c" else None)
    except Exception as exc:  # noqa: BLE001 — sans image, le jet reste valable
        log.warning("rendu des dés : %s", exc)
        png = None
    await asyncio.sleep(max(0.0, SUSPENSE_S - (time.monotonic() - debut)))
    fichiers = []
    if png:
        e.set_image(url="attachment://jet.png")
        fichiers = [discord.File(io.BytesIO(png), "jet.png")]
    # L'expression est relancée telle que tapée (avant le mode) : on garde la forme brute.
    vue = Reveler(e, png) if secret else _vue_relancer(interaction.user.id, _normaliser(expr)[:MAX_EXPR], mode)
    await interaction.edit_original_response(content=None, embed=e, attachments=fichiers, view=vue)
    marques = [m for m, ok in (("🔒 secret", secret), ("🔁 relance", relance),
                                ("💥 critique", mode == "c")) if ok]
    nat = ""
    if r["nat"] == 20:
        nat = " ✨ 20 naturel"
    elif r["nat"] == 1:
        nat = " 💀 1 naturel"
    await _log(interaction.client,
               f"🎲 {_qui(interaction.user)}{f' · {raison}' if raison else ''} · `{r['expr']}` → "
               f"**{r['total']}**{nat}{' · ' + ', '.join(marques) if marques else ''}"
               f" · <#{interaction.channel_id}>")


# ═══════════════════════════ Initiative ═══════════════════════════
# message_id → {auteur, entrees:[{cle, nom, total, d20, bonus}], tour, round, close}
_initiatives: dict[int, dict] = {}


def _embed_initiative(s: dict) -> discord.Embed:
    if not s["entrees"]:
        corps = "*Personne n'a encore lancé. Cliquez sur 🎲 !*"
    else:
        lignes = []
        for i, en in enumerate(s["entrees"]):
            fl = "▶️" if s["round"] and i == s["tour"] else f"`{i + 1}.`"
            lignes.append(f"{fl} **{en['nom']}** — **{en['total']}** "
                          f"*(d20 {en['d20']} {en['bonus']:+d})*")
        corps = "\n".join(lignes)
    titre = "⚔️ Initiative" + (f" — round {s['round']}" if s["round"] else "")
    if s["close"]:
        titre += " (combat terminé)"
    e = discord.Embed(title=titre, description=corps, color=GRIS if s["close"] else ROUGE)
    e.set_footer(text="Égalité : le plus gros bonus passe devant. Le MJ ajoute ses créatures en "
                      "leur donnant un nom. ⏭️ : le MJ, ou le joueur dont c'est le tour.")
    return e


class InitiativeModal(discord.ui.Modal, title="Mon initiative"):
    # Discord : libellés de 45 caractères max (sinon le formulaire est refusé).
    bonus = discord.ui.TextInput(label="Bonus d'initiative", default="0", max_length=4,
                                 placeholder="Modificateur de DEX, ex. 2 ou -1")
    nom = discord.ui.TextInput(label="Nom (vide = toi)", required=False, max_length=40,
                               placeholder="Pour le MJ : « Gobelin 1 », « Dragon »…")

    def __init__(self, message_id: int):
        super().__init__()
        self.message_id = message_id

    async def on_submit(self, interaction: discord.Interaction):
        s = _initiatives.get(self.message_id)
        if s is None or s["close"]:
            await interaction.response.send_message("Ce combat n'est plus suivi.", ephemeral=True)
            return
        try:
            b = int(str(self.bonus).replace(" ", "") or 0)
        except ValueError:
            await interaction.response.send_message("⚠️ Le bonus doit être un nombre (ex. 2 ou -1).", ephemeral=True)
            return
        d20 = _d(20)
        nom = str(self.nom).strip() or interaction.user.display_name
        cle = f"{interaction.user.id}:{nom.lower()}"
        s["entrees"] = [en for en in s["entrees"] if en["cle"] != cle]
        s["entrees"].append({"cle": cle, "uid": interaction.user.id, "nom": nom,
                             "total": d20 + b, "d20": d20, "bonus": b})
        s["entrees"].sort(key=lambda en: (en["total"], en["bonus"], _rng.random()), reverse=True)
        await interaction.response.edit_message(embed=_embed_initiative(s))
        par = "" if nom == interaction.user.display_name else f" (par {_qui(interaction.user)})"
        await _log(interaction.client,
                   f"⚔️ Initiative · **{nom}**{par} → **{d20 + b}** (d20 {d20} {b:+d})")


def _peut_mener(interaction, s) -> bool:
    """Le MJ = celui qui a ouvert l'initiative."""
    return interaction.user.id == s["auteur"]


def _peut_avancer(interaction, s) -> bool:
    """Tour suivant : le MJ toujours (ses créatures, et pour débloquer) ; un joueur
    seulement pendant SON tour, une fois le combat commencé."""
    if _peut_mener(interaction, s):
        return True
    if not s["round"] or not s["entrees"]:
        return False
    return s["entrees"][s["tour"]].get("uid") == interaction.user.id


class InitiativeVue(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    async def _session(self, interaction):
        s = _initiatives.get(interaction.message.id)
        if s is None:
            await interaction.response.send_message(
                "Ce tableau n'est plus suivi (redémarrage du bot) — relance ⚔️ Initiative.", ephemeral=True)
        return s

    @discord.ui.button(label="Lancer mon initiative", emoji="🎲", style=discord.ButtonStyle.success,
                       custom_id="des:ini:lancer")
    async def lancer(self, interaction: discord.Interaction, _b):
        s = await self._session(interaction)
        if s is not None:
            await interaction.response.send_modal(InitiativeModal(interaction.message.id))

    @discord.ui.button(label="Tour suivant", emoji="⏭️", style=discord.ButtonStyle.primary,
                       custom_id="des:ini:suivant")
    async def suivant(self, interaction: discord.Interaction, _b):
        s = await self._session(interaction)
        if s is None:
            return
        if not _peut_avancer(interaction, s):
            msg = ("Seul le MJ lance le premier tour." if not s["round"]
                   else "Ce n'est pas ton tour : tu pourras passer la main quand ce sera le tien.")
            await interaction.response.send_message(f"⏳ {msg}", ephemeral=True)
            return
        if not s["entrees"]:
            await interaction.response.send_message("Personne n'a lancé son initiative.", ephemeral=True)
            return
        if not s["round"]:
            s["round"], s["tour"] = 1, 0
        else:
            s["tour"] += 1
            if s["tour"] >= len(s["entrees"]):
                s["tour"], s["round"] = 0, s["round"] + 1
        await interaction.response.edit_message(embed=_embed_initiative(s))
        await _log(interaction.client,
                   f"⏭️ Round {s['round']} — au tour de **{s['entrees'][s['tour']]['nom']}**"
                   f" (passé par {_qui(interaction.user)})")

    @discord.ui.button(label="Fin du combat", emoji="🏳️", style=discord.ButtonStyle.secondary,
                       custom_id="des:ini:clore")
    async def clore(self, interaction: discord.Interaction, _b):
        s = await self._session(interaction)
        if s is None:
            return
        if not _peut_mener(interaction, s):
            await interaction.response.send_message("Seul le MJ peut clore le combat.", ephemeral=True)
            return
        s["close"] = True
        await interaction.response.edit_message(embed=_embed_initiative(s), view=None)
        await _log(interaction.client, f"🏳️ Combat terminé par {_qui(interaction.user)}"
                                       f" après {s['round']} round(s).")
        _initiatives.pop(interaction.message.id, None)


async def _ouvrir_initiative(interaction: discord.Interaction):
    s = {"auteur": interaction.user.id, "entrees": [], "tour": 0, "round": 0, "close": False}
    await interaction.response.send_message(
        content=f"⚔️ **Jet d'initiative !** lancé par {interaction.user.mention} — chacun clique sur 🎲.",
        embed=_embed_initiative(s), view=InitiativeVue(),
        allowed_mentions=discord.AllowedMentions.none(),
    )
    msg = await interaction.original_response()
    _initiatives[msg.id] = s
    await _log(interaction.client, f"⚔️ {_qui(interaction.user)} ouvre une initiative (MJ du combat) · {msg.jump_url}")
    if len(_initiatives) > 20:   # borne mémoire : on oublie les plus anciens
        for k in list(_initiatives)[:-20]:
            del _initiatives[k]


# ═══════════════════════════ Panneau ═══════════════════════════
class LibreModal(discord.ui.Modal, title="Jet libre"):
    expr = discord.ui.TextInput(label="Jet", max_length=MAX_EXPR,
                                placeholder="1d20+5 · 1d8+2d6+3 · 4d6kh3 · 2d6r2 · d100")
    raison = discord.ui.TextInput(label="Pour quoi ? (facultatif)", required=False, max_length=60,
                                  placeholder="Dégâts de l'arc, Boule de feu…")
    options = discord.ui.TextInput(label="Options (facultatif)", required=False, max_length=30,
                                   placeholder="critique (dégâts doublés) · secret (MJ)")

    async def on_submit(self, interaction: discord.Interaction):
        mode, secret = _options_depuis_texte(str(self.options))
        await _repondre_jet(interaction, str(self.expr), mode, str(self.raison).strip(), secret)


def _btn(label, emoji, cid, row, style=discord.ButtonStyle.secondary):
    return discord.ui.Button(label=label, emoji=emoji, custom_id=cid, row=row, style=style)


class PanneauVue(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        for i, f in enumerate(DES):
            b = _btn(f"d{f}", "🎲", f"des:d:{f}", 0 if i < 5 else 1,
                     discord.ButtonStyle.primary if f == 20 else discord.ButtonStyle.secondary)
            b.callback = self._de(f)
            self.add_item(b)
        for label, emoji, cid, row, style, cb in (
            ("Jet libre", "✍️", "des:libre", 1, discord.ButtonStyle.success, self._modal(LibreModal)),
            ("Initiative", "⚔️", "des:ini", 1, discord.ButtonStyle.danger, _ouvrir_initiative),
        ):
            b = _btn(label, emoji, cid, row, style)
            b.callback = cb
            self.add_item(b)

    @staticmethod
    def _de(faces):
        async def cb(interaction):
            await _repondre_jet(interaction, f"1d{faces}")
        return cb

    @staticmethod
    def _modal(fabrique):
        async def cb(interaction):
            await interaction.response.send_modal(fabrique())
        return cb


def _panneau_embed() -> discord.Embed:
    return discord.Embed(
        title="🎲 Table de dés — Donjons & Dragons",
        description=(
            "**Un clic = un dé.** Pour un jet avec bonus ou plusieurs dés : ✍️ **Jet libre**.\n\n"
            "**Écrire un jet**\n"
            "`1d20+5` test ou attaque · `1d8+2d6+3` dégâts combinés\n"
            "`4d6kh3` garder les 3 meilleurs · `2d6r2` relancer une fois les 1-2 · `d100`\n"
            "Options : **critique** (dés de dégâts doublés), **secret** (jet du MJ, visible de lui seul).\n\n"
            "**Raccourci** : `/d jet:1d8+3 raison:Dégâts` — marche aussi dans le chat du salon vocal.\n"
            "⚔️ **Initiative** : ouvre le tableau du combat, chacun y lance son d20 + bonus.\n"
            "-# 20 naturel = réussite critique · 1 naturel = échec critique · 🔁 pour relancer son propre jet"
        ),
        color=OR,
    )


# ═══════════════════════════ Commandes slash ═══════════════════════════
def setup(tree: app_commands.CommandTree, guild) -> None:
    @tree.command(name="d", description="Lancer des dés (D&D) : 1d20+5, 1d8+2d6+3, 4d6kh3…", guild=guild)
    @app_commands.describe(
        jet="Le jet : 1d20+5, 2d6+3, 4d6kh3, d100… (défaut : 1d20)",
        raison="Pour quoi ? (Attaque, Perception, Boule de feu…)",
        critique="Coup critique : les dés de dégâts sont doublés (pas le modificateur)",
        secret="Jet secret : toi seul vois le résultat (MJ)",
    )
    async def d_cmd(interaction: discord.Interaction, jet: str = "1d20", raison: str = "",
                    critique: bool = False, secret: bool = False):
        await _repondre_jet(interaction, jet, "c" if critique else "n", raison[:60], secret)

    @tree.command(name="initiative", description="Ouvrir un tableau d'initiative pour un combat.", guild=guild)
    async def init_cmd(interaction: discord.Interaction):
        await _ouvrir_initiative(interaction)


def setup_persistent(bot):
    bot.add_view(PanneauVue())
    bot.add_view(InitiativeVue())
    bot.add_view(JournalVue())
    bot.add_dynamic_items(Relancer)


async def apply(bot, cfg):
    """Poste (ou met à jour) le panneau dans le salon de jeu, et celui du journal MJ."""
    if not cfg.get("enabled") or not cfg.get("channel_id"):
        return
    await _poster_panneau_journal(bot, cfg)
    channel = bot.get_channel(int(cfg["channel_id"]))
    if channel is None:
        log.warning("des : salon %s introuvable", cfg["channel_id"])
        return
    pid = cfg.get("panel_message_id")
    if pid:
        try:
            await channel.get_partial_message(int(pid)).edit(embed=_panneau_embed(), view=PanneauVue())
            return
        except discord.HTTPException:
            pass
    msg = await channel.send(embed=_panneau_embed(), view=PanneauVue())
    try:
        await msg.pin(reason="Panneau de dés")
    except discord.HTTPException:
        pass
    bot.store.set("des", {"panel_message_id": str(msg.id)})


# ═══════════════════════════ Piste 3D (dashboard) ═══════════════════════════
async def action_jet(bot, payload):
    """Jet tiré ICI (même moteur, même aléa système) pour la piste de dés 3D : le
    navigateur ne fait qu'animer des dés qui tombent sur ce résultat — impossible à
    truquer côté client. Consigné dans le journal du MJ."""
    expr = str(payload.get("expr") or "1d20")[:MAX_EXPR]
    mode = "c" if payload.get("critique") else "n"
    raison = str(payload.get("raison") or "")[:60]
    try:
        r = jet(expr, mode)
    except JetInvalide as exc:
        raise ValueError(str(exc))
    qui = str(payload.get("_acteur") or "?")[:40]
    await _log(bot, f"🎲 **{qui}** (piste 3D){f' · {raison}' if raison else ''} · `{r['expr']}` → "
                    f"**{r['total']}**{' ✨ 20 naturel' if r['nat'] == 20 else ' 💀 1 naturel' if r['nat'] == 1 else ''}")
    return {"ok": True, "total": r["total"], "expr": r["expr"], "nat": r["nat"] if mode != "c" else None,
            "des": r["des"], "lignes": r["lignes"]}


MODULE = register(Module(
    key="des",
    label="Dés (D&D)",
    defaults=DEFAULTS,
    apply=apply,
    actions={"jet": action_jet},
))
