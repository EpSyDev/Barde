"""Fausses « polices » pour Discord.

Discord n'autorise PAS de vraie police dans les messages. Mais on peut remplacer
chaque lettre par son équivalent **Unicode stylisé** (blocs *Mathematical Alphanumeric
Symbols*, petites capitales…). C'est exactement ce que font les « générateurs de
police » en ligne : des caractères, pas une police → rendu natif partout dans Discord.

⚠️ À réserver aux **NOMS/TITRES courts** :
- les lettres **accentuées** (é, à, ê…) n'ont pas d'équivalent stylisé → on les
  normalise vers leur lettre de base avant transformation (é → e) ;
- ces caractères sont **illisibles par les lecteurs d'écran** et non cherchables :
  jamais pour du corps de texte, seulement pour l'immersion sur un nom.
"""
import unicodedata


def _build(upper_base, lower_base, exc=None):
    """Table A-Z/a-z à partir des codepoints de base + exceptions (blocs à trous)."""
    m = {}
    for i in range(26):
        m[chr(ord("A") + i)] = chr(upper_base + i)
        m[chr(ord("a") + i)] = chr(lower_base + i)
    m.update(exc or {})
    return m


# Gothique (fraktur) — trous comblés par le bloc Letterlike Symbols.
FRAKTUR = _build(0x1D504, 0x1D51E, exc={
    "C": "ℭ", "H": "ℌ", "I": "ℑ", "R": "ℜ", "Z": "ℨ"})
FRAKTUR_BOLD = _build(0x1D56C, 0x1D586)              # fraktur gras, sans trou
SCRIPT = _build(0x1D49C, 0x1D4B6, exc={              # cursive/élégant
    "B": "ℬ", "E": "ℰ", "F": "ℱ", "H": "ℋ", "I": "ℐ",
    "L": "ℒ", "M": "ℳ", "R": "ℛ",
    "e": "ℯ", "g": "ℊ", "o": "ℴ"})
BOLD = _build(0x1D400, 0x1D41A)                      # gras sérif

# Petites capitales (bloc phonétique, irrégulier ; s et x sans forme dédiée).
_SMALLCAPS_LOWER = {
    "a": "ᴀ", "b": "ʙ", "c": "ᴄ", "d": "ᴅ", "e": "ᴇ", "f": "ꜰ", "g": "ɢ", "h": "ʜ",
    "i": "ɪ", "j": "ᴊ", "k": "ᴋ", "l": "ʟ", "m": "ᴍ", "n": "ɴ", "o": "ᴏ", "p": "ᴘ",
    "q": "ǫ", "r": "ʀ", "s": "s", "t": "ᴛ", "u": "ᴜ", "v": "ᴠ", "w": "ᴡ", "x": "x",
    "y": "ʏ", "z": "ᴢ",
}
SMALLCAPS = dict(_SMALLCAPS_LOWER)
SMALLCAPS.update({k.upper(): v for k, v in _SMALLCAPS_LOWER.items()})

STYLES = {
    "fraktur": FRAKTUR,
    "fraktur_bold": FRAKTUR_BOLD,
    "script": SCRIPT,
    "bold": BOLD,
    "smallcaps": SMALLCAPS,
}

# Libellés + ordre d'affichage (menus dashboard/Discord).
STYLE_LABELS = {
    "script": "Cursive",
    "fraktur": "Gothique",
    "fraktur_bold": "Gothique gras",
    "smallcaps": "Petites capitales",
    "bold": "Gras",
}
STYLE_ORDER = ["script", "fraktur", "fraktur_bold", "smallcaps", "bold"]


_LIGATURES = {"œ": "oe", "Œ": "Oe", "æ": "ae", "Æ": "Ae"}


def _strip_accents(text):
    for lig, repl in _LIGATURES.items():
        text = text.replace(lig, repl)
    return "".join(
        c for c in unicodedata.normalize("NFD", text)
        if unicodedata.category(c) != "Mn"
    )


def stylize(text, style):
    """Rend `text` dans le style demandé. Style inconnu/vide → texte inchangé."""
    table = STYLES.get(style)
    if not table:
        return text
    return "".join(table.get(ch, ch) for ch in _strip_accents(text))
