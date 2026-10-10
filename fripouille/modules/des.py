"""Module « Dés » : lanceur de dés pour les soirées Donjons & Dragons (règles 5e).

Deux entrées, même moteur :

- **Panneau** posté dans le salon de jeu (boutons persistants) :
  ligne 1 : d4 · d6 · d8 · d10 · d12           (un clic = un dé, résultat public)
  ligne 2 : d20 · d100 · 🎯 Avantage · 💀 Désavantage · ✍️ Jet libre
  ligne 3 : 🧬 Caractéristiques · ⚰️ Jet contre la mort · ⚔️ Initiative
- **Commande** ``/d jet:1d20+5 mode:avantage raison:"Attaque" secret:oui`` (partout, y
  compris dans le chat d'un salon vocal) et ``/initiative``.

Règles couvertes :
- Expression libre : ``1d8+2d6+3``, ``2d20kh1`` (garder le plus haut), ``4d6kl3`` (garder
  les plus bas), ``2d6r2`` (relancer une fois les dés ≤ 2 — Style de combat « arme à
  deux mains »), ``d%`` = d100. Seuls les 7 dés du jeu sont admis.
- **Avantage / désavantage** : le d20 devient 2d20, on garde le meilleur / le pire.
- **20 naturel** = réussite critique, **1 naturel** = échec critique (sur un d20 seul).
- **Critique (dégâts)** : on lance deux fois plus de dés, le modificateur ne double pas.
- **d100** : affiché comme les deux d10 du jeu (dizaine + unité, 00+0 = 100).
- **Caractéristiques** : 6 × (4d6, on retire le plus faible), avec les modificateurs.
- **Jet contre la mort** : ≥ 10 réussite, < 10 échec, 1 = deux échecs, 20 = 1 PV.
- **Initiative** : tableau partagé ; chacun (ou le MJ pour ses monstres) lance d20+bonus,
  ordre trié, bouton « tour suivant » avec compteur de rounds.
- **Jet secret** (MJ) : visible du seul lanceur, avec un bouton « Révéler ».

Chaque résultat public porte un bouton « 🔁 Relancer » (même jet, au nom de qui clique).
Tirage via ``secrets.SystemRandom`` (aléa du système, pas un PRNG prévisible).
"""
import logging
import re
import secrets

import discord
from discord import app_commands

from ..registry import Module, register

log = logging.getLogger("fripouille.des")

DES = (4, 6, 8, 10, 12, 20, 100)
MAX_DES = 100          # dés par jet (anti-spam)
MAX_EXPR = 60          # longueur d'expression (tient dans un custom_id de bouton)
OR, VERT, ROUGE, GRIS = 0xC9A44A, 0x57F287, 0xED4245, 0x4F545C
_rng = secrets.SystemRandom()

DEFAULTS = {
    "enabled": False,
    "channel_id": "1558518342791331941",
    "panel_message_id": None,
}

MODES = {"n": "", "a": "avantage", "d": "désavantage", "c": "critique"}


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
    if mode in ("a", "d"):
        d20 = next((t for t in termes if t.get("faces") == 20 and t["n"] == 1
                    and t["kh"] is None and t["kl"] is None), None)
        if d20 is None:
            # « +5 » seul en avantage : c'est un test, donc 1d20+5.
            if any(t.get("faces") == 20 for t in termes):
                raise JetInvalide("l'avantage s'applique à un seul d20 (ex. 1d20+5)")
            d20 = {"signe": 1, "n": 1, "faces": 20, "kh": None, "kl": None, "r": None}
            termes.insert(0, d20)
        d20["n"] = 2
        d20["kh" if mode == "a" else "kl"] = 1
    elif mode == "c":
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
    total, lignes, d20_gardes = 0, [], []
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
    return {"total": total, "lignes": lignes, "nat": nat}


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


def _mode_depuis_texte(txt: str) -> tuple[str, bool]:
    """« avantage », « dés », « crit secret »… → (mode, secret)."""
    t = (txt or "").lower()
    secret = "secr" in t or "mj" in t.split()
    if "désav" in t or "desav" in t or "dis" in t:
        return "d", secret
    if "av" in t:
        return "a", secret
    if "crit" in t:
        return "c", secret
    return "n", secret


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


class Relancer(discord.ui.DynamicItem[discord.ui.Button], template=r"des:re:(?P<m>[nadc]):(?P<e>.+)"):
    def __init__(self, mode: str, expr: str):
        super().__init__(discord.ui.Button(
            label="Relancer", emoji="🔁", style=discord.ButtonStyle.secondary,
            custom_id=f"des:re:{mode}:{expr}"[:100],
        ))
        self.mode, self.expr = mode, expr

    @classmethod
    async def from_custom_id(cls, interaction, item, match: re.Match):
        return cls(match["m"], match["e"])

    async def callback(self, interaction: discord.Interaction):
        await _repondre_jet(interaction, self.expr, self.mode)


def _vue_relancer(expr: str, mode: str) -> discord.ui.View:
    v = discord.ui.View(timeout=None)
    v.add_item(Relancer(mode, expr))
    return v


class Reveler(discord.ui.View):
    """Sous un jet secret : publie le même résultat dans le salon."""

    def __init__(self, embed: discord.Embed):
        super().__init__(timeout=3600)
        self.embed = embed

    @discord.ui.button(label="Révéler à la table", emoji="📢", style=discord.ButtonStyle.primary)
    async def reveler(self, interaction: discord.Interaction, _b):
        e = self.embed.copy()
        e.set_author(name=f"{interaction.user.display_name} (jet secret révélé)",
                     icon_url=interaction.user.display_avatar.url)
        await interaction.response.edit_message(view=None)
        await interaction.followup.send(embed=e)


async def _repondre_jet(interaction: discord.Interaction, expr: str, mode: str = "n",
                        raison: str = "", secret: bool = False):
    try:
        r = jet(expr, mode)
    except JetInvalide as exc:
        await interaction.response.send_message(f"⚠️ {exc}", ephemeral=True)
        return
    e = _embed_jet(interaction.user, r, mode, raison, secret)
    if secret:
        await interaction.response.send_message(embed=e, view=Reveler(e), ephemeral=True)
    else:
        # L'expression est relancée telle que tapée (avant le mode) : on garde la forme brute.
        await interaction.response.send_message(embed=e, view=_vue_relancer(_normaliser(expr)[:MAX_EXPR], mode))


# ═══════════════════════════ Jets spéciaux ═══════════════════════════
async def _caracteristiques(interaction: discord.Interaction):
    lignes, scores = [], []
    for i in range(6):
        des = sorted((_d(6) for _ in range(4)), reverse=True)
        score = sum(des[:3])
        scores.append(score)
        mod = (score - 10) // 2
        lignes.append(f"`#{i + 1}` {', '.join(f'**{d}**' for d in des[:3])}, ~~{des[3]}~~ → "
                      f"**{score}** ({mod:+d})")
    tri = sorted(scores, reverse=True)
    lignes.append(f"\nÀ répartir : **{' · '.join(map(str, tri))}** — total {sum(scores)}")
    e = discord.Embed(title="🧬 Caractéristiques (4d6, on retire le plus faible)",
                      description="\n".join(lignes), color=OR)
    e.set_author(name=interaction.user.display_name, icon_url=interaction.user.display_avatar.url)
    await interaction.response.send_message(embed=e)


async def _jet_mort(interaction: discord.Interaction):
    v = _d(20)
    if v == 20:
        txt, c = "✨ **20 naturel** : tu reprends conscience avec **1 PV** !", VERT
    elif v == 1:
        txt, c = "💀 **1 naturel** : compte **deux échecs**.", ROUGE
    elif v >= 10:
        txt, c = "✅ **Réussite** (10 ou plus).", VERT
    else:
        txt, c = "❌ **Échec** (moins de 10).", ROUGE
    e = discord.Embed(title="⚰️ Jet de sauvegarde contre la mort",
                      description=f"# {v}\n{txt}\n-# 3 réussites = stabilisé · 3 échecs = mort", color=c)
    e.set_author(name=interaction.user.display_name, icon_url=interaction.user.display_avatar.url)
    await interaction.response.send_message(embed=e)


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
    e.set_footer(text="Égalité : le plus gros bonus passe devant. "
                      "Le MJ peut ajouter ses monstres en leur donnant un nom.")
    return e


class InitiativeModal(discord.ui.Modal, title="Mon initiative"):
    bonus = discord.ui.TextInput(label="Bonus d'initiative (modificateur de DEX…)", default="0", max_length=4)
    nom = discord.ui.TextInput(label="Nom (vide = toi ; ex. « Gobelin 1 » pour le MJ)",
                               required=False, max_length=40)
    mode = discord.ui.TextInput(label="Avantage ? (vide, « avantage » ou « désavantage »)",
                                required=False, max_length=12)

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
        m, _ = _mode_depuis_texte(str(self.mode))
        des = [_d(20), _d(20)] if m in ("a", "d") else [_d(20)]
        d20 = max(des) if m == "a" else min(des)
        nom = str(self.nom).strip() or interaction.user.display_name
        cle = f"{interaction.user.id}:{nom.lower()}"
        s["entrees"] = [en for en in s["entrees"] if en["cle"] != cle]
        s["entrees"].append({"cle": cle, "nom": nom, "total": d20 + b, "d20": d20, "bonus": b})
        s["entrees"].sort(key=lambda en: (en["total"], en["bonus"], _rng.random()), reverse=True)
        await interaction.response.edit_message(embed=_embed_initiative(s))


def _peut_mener(interaction, s) -> bool:
    perms = getattr(interaction.user, "guild_permissions", None)
    return interaction.user.id == s["auteur"] or bool(perms and perms.manage_messages)


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
        if not _peut_mener(interaction, s):
            await interaction.response.send_message("Seul le MJ (qui a lancé le combat) avance les tours.", ephemeral=True)
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
    if len(_initiatives) > 20:   # borne mémoire : on oublie les plus anciens
        for k in list(_initiatives)[:-20]:
            del _initiatives[k]


# ═══════════════════════════ Panneau ═══════════════════════════
class BonusModal(discord.ui.Modal):
    bonus = discord.ui.TextInput(label="Bonus (ex. 5, -1, ou 1d4+5 avec Bénédiction)",
                                 required=False, max_length=30, placeholder="0")
    raison = discord.ui.TextInput(label="Pour quoi ? (facultatif)", required=False, max_length=60,
                                  placeholder="Attaque à l'épée, Perception, JS Sagesse…")

    def __init__(self, mode: str):
        super().__init__(title="Jet avec avantage" if mode == "a" else "Jet avec désavantage")
        self.mode = mode

    async def on_submit(self, interaction: discord.Interaction):
        b = str(self.bonus).replace(" ", "")
        expr = "1d20" + (b if b.startswith(("+", "-")) else f"+{b}" if b else "")
        await _repondre_jet(interaction, expr, self.mode, str(self.raison).strip())


class LibreModal(discord.ui.Modal, title="Jet libre"):
    expr = discord.ui.TextInput(label="Jet", max_length=MAX_EXPR,
                                placeholder="1d20+5 · 1d8+2d6+3 · 4d6kh3 · 2d6r2 · d100")
    raison = discord.ui.TextInput(label="Pour quoi ? (facultatif)", required=False, max_length=60,
                                  placeholder="Dégâts de l'arc, Boule de feu…")
    options = discord.ui.TextInput(label="Options (facultatif)", required=False, max_length=30,
                                   placeholder="avantage · désavantage · critique · secret")

    async def on_submit(self, interaction: discord.Interaction):
        mode, secret = _mode_depuis_texte(str(self.options))
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
            ("Avantage", "🎯", "des:adv", 1, discord.ButtonStyle.success, self._modal(lambda: BonusModal("a"))),
            ("Désavantage", "💀", "des:dis", 1, discord.ButtonStyle.danger, self._modal(lambda: BonusModal("d"))),
            ("Jet libre", "✍️", "des:libre", 2, discord.ButtonStyle.primary, self._modal(LibreModal)),
            ("Caractéristiques", "🧬", "des:carac", 2, discord.ButtonStyle.secondary, _caracteristiques),
            ("Jet contre la mort", "⚰️", "des:mort", 2, discord.ButtonStyle.secondary, _jet_mort),
            ("Initiative", "⚔️", "des:ini", 2, discord.ButtonStyle.danger, _ouvrir_initiative),
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
            "**Un clic = un dé.** Pour un test avec bonus : 🎯 / 💀 (avantage, désavantage) "
            "ou ✍️ **Jet libre**.\n\n"
            "**Écrire un jet**\n"
            "`1d20+5` test ou attaque · `1d8+2d6+3` dégâts combinés\n"
            "`4d6kh3` garder les 3 meilleurs · `2d20kl1` garder le pire\n"
            "`2d6r2` relancer une fois les 1-2 · `d100` percentile\n"
            "Options : **avantage**, **désavantage**, **critique** (dés de dégâts doublés), "
            "**secret** (jet du MJ, visible de lui seul).\n\n"
            "**Raccourci** : `/d jet:1d20+5 mode:avantage raison:Attaque` — marche aussi dans le "
            "chat du salon vocal.\n"
            "-# 20 naturel = réussite critique · 1 naturel = échec critique · 🔁 sous chaque "
            "résultat pour relancer le même jet"
        ),
        color=OR,
    )


# ═══════════════════════════ Commandes slash ═══════════════════════════
def setup(tree: app_commands.CommandTree, guild) -> None:
    @tree.command(name="d", description="Lancer des dés (D&D) : 1d20+5, 1d8+2d6+3, 4d6kh3…", guild=guild)
    @app_commands.describe(
        jet="Le jet : 1d20+5, 2d6+3, 4d6kh3, d100… (défaut : 1d20)",
        mode="Avantage, désavantage ou critique (dés de dégâts doublés)",
        raison="Pour quoi ? (Attaque, Perception, Boule de feu…)",
        secret="Jet secret : toi seul vois le résultat (MJ)",
    )
    @app_commands.choices(mode=[
        app_commands.Choice(name="normal", value="n"),
        app_commands.Choice(name="avantage", value="a"),
        app_commands.Choice(name="désavantage", value="d"),
        app_commands.Choice(name="critique (dégâts doublés)", value="c"),
    ])
    async def d_cmd(interaction: discord.Interaction, jet: str = "1d20",
                    mode: app_commands.Choice[str] | None = None, raison: str = "",
                    secret: bool = False):
        await _repondre_jet(interaction, jet, mode.value if mode else "n", raison[:60], secret)

    @tree.command(name="initiative", description="Ouvrir un tableau d'initiative pour un combat.", guild=guild)
    async def init_cmd(interaction: discord.Interaction):
        await _ouvrir_initiative(interaction)


def setup_persistent(bot):
    bot.add_view(PanneauVue())
    bot.add_view(InitiativeVue())
    bot.add_dynamic_items(Relancer)


async def apply(bot, cfg):
    """Poste (ou met à jour) le panneau dans le salon de jeu."""
    if not cfg.get("enabled") or not cfg.get("channel_id"):
        return
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


MODULE = register(Module(
    key="des",
    label="Dés (D&D)",
    defaults=DEFAULTS,
    apply=apply,
))
