"""Données + moteur du générateur de noms « baptême » (données pures, sans Discord).

Philosophie (cf. mémoire) : PAS une liste de milliers de noms, mais une **combinatoire
curée**. Quelques centaines de fragments → des millions de combinaisons. Les axes
FAÇONNENT le nom :
- **Race** → la phonétique/morphologie (assemblage préfixe/racine/suffixe par patrons).
- **Trait** → l'épithète accolée (« le Vaillant », « l'Ombre »…).
- **Lieu** (univers fantasy) → complément optionnel (« des Terres Grises »).

Proto : univers unique **fantasy**. Ajouter un univers = un autre jeu de pools.
Un patron est une chaîne de segments : ``P`` = préfixe, ``R`` = racine, ``S`` = suffixe.
"""
import random

UNIVERS = "fantasy"

# race → phonétique. `patterns` combine P(réfixe)/R(acine)/S(uffixe).
RACES = {
    "elfe": {
        "label": "Elfe", "emoji": "🏹",
        "prefixes": ["Ae", "El", "Sil", "Cael", "Lith", "Fae", "Ithil", "Ny", "Aer", "Gala", "Thal", "Ela"],
        "roots": ["thas", "riel", "andir", "wen", "loth", "mir", "dae", "sar", "vyn", "thil", "lian", "neth"],
        "suffixes": ["", "iel", "ion", "as", "wyn", "ith", "ael", "'iel", "wë"],
        "patterns": ["PR", "PRS", "PRS", "RS"],
    },
    "nain": {
        "label": "Nain", "emoji": "⛏️",
        "prefixes": ["Thor", "Dur", "Bal", "Grim", "Khaz", "Bru", "Thra", "Nor", "Dwal", "Gor", "Bom", "Krag"],
        "roots": ["gan", "din", "mund", "rak", "bek", "dush", "gar", "nar", "thok", "grim", "buld", "dhr"],
        "suffixes": ["", "son", "i", "ar", "uz", "grim", "bek"],
        "patterns": ["PR", "PR", "PRS"],
    },
    "orc": {
        "label": "Orc", "emoji": "🪓",
        "prefixes": ["Gro", "Mok", "Ur", "Gash", "Zug", "Nar", "Brak", "Dro", "Ghor", "Sna", "Rok", "Vha"],
        "roots": ["gash", "dar", "mok", "thak", "nak", "rok", "zug", "dur", "gul", "rag", "grum", "shak"],
        "suffixes": ["", "nak", "zg", "ish", "ar", "gul", "thok"],
        "patterns": ["PR", "PR", "PRS", "RS"],
    },
    "humain": {
        "label": "Humain", "emoji": "🛡️",
        "prefixes": ["Ald", "Ber", "Cor", "Ed", "Gau", "Rob", "Thi", "Guil", "Ren", "Bau", "Ald", "Wil"],
        "roots": ["ric", "mund", "bert", "wald", "fried", "hard", "mar", "win", "gis", "and", "mer", "roy"],
        "suffixes": ["", "in", "on", "aud", "el", "ric", "and"],
        "patterns": ["PR", "PR", "PRS"],
    },
}

# trait → épithète accolée au nom.
TRAITS = {
    "brave": {"label": "Brave", "emoji": "⚔️", "epithets": [
        "le Vaillant", "Cœur-de-Lion", "l'Intrépide", "Brise-Bouclier", "le Hardi",
        "sans Peur", "Taille-Géant", "le Rempart", "Poing-de-Fer", "le Lion"]},
    "ruse": {"label": "Rusé", "emoji": "🦊", "epithets": [
        "le Malin", "l'Ombre", "aux Mille Tours", "Langue-d'Argent", "le Filou",
        "Doigts-Agiles", "le Renard", "Pied-Feutré", "le Caméléon", "Vif-d'Esprit"]},
    "sage": {"label": "Sage", "emoji": "📜", "epithets": [
        "le Sage", "l'Érudit", "aux Yeux Clairs", "le Contemplatif", "Barbe-Grise",
        "le Devin", "Porte-Savoir", "l'Ancien", "aux Mille Livres", "le Lucide"]},
    "sombre": {"label": "Sombre", "emoji": "🌑", "epithets": [
        "le Ténébreux", "des Cendres", "Porte-Deuil", "le Maudit", "l'Endeuillé",
        "Nuit-Profonde", "le Corbeau", "Sang-Froid", "l'Éclipse", "le Silencieux"]},
    "farceur": {"label": "Farceur", "emoji": "🎭", "epithets": [
        "le Fripon", "Pied-Léger", "le Bouffon", "Trouble-Fête", "la Pie",
        "Grelot", "le Chahuteur", "Nez-Rouge", "le Cabotin", "Deux-Chopes"]},
}

# univers fantasy : lieux d'origine (complément optionnel).
PLACES = [
    "des Terres Grises", "de la Forêt d'Argent", "du Val Perdu", "des Cimes Gelées",
    "des Marches du Nord", "de la Côte Brumeuse", "des Landes Rouges", "du Bois-aux-Fées",
    "des Ruines de Vharn", "du Lac Sombre", "des Sables d'Or", "de Nulle-Part",
]
PLACE_CHANCE = 0.4     # proba d'accoler un lieu


def race_choices():
    return [(k, v["label"], v.get("emoji")) for k, v in RACES.items()]


def trait_choices():
    return [(k, v["label"], v.get("emoji")) for k, v in TRAITS.items()]


def _cap(text):
    return text[:1].upper() + text[1:] if text else text


def _firstname(race):
    pattern = random.choice(race["patterns"])
    pools = {"P": race["prefixes"], "R": race["roots"], "S": race["suffixes"]}
    out = "".join(random.choice(pools[ch]) for ch in pattern)
    return _cap(out) or _cap(random.choice(race["roots"]))


def generate(race_key, trait_key):
    """Assemble un nom : prénom (phonétique de la race) + épithète (trait) + lieu éventuel."""
    race = RACES.get(race_key)
    trait = TRAITS.get(trait_key)
    if not race or not trait:
        return None
    parts = [_firstname(race)]
    epithet = random.choice(trait["epithets"])
    if epithet:
        parts.append(epithet)
    if random.random() < PLACE_CHANCE:
        parts.append(random.choice(PLACES))
    return " ".join(parts)
