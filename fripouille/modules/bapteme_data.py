"""Données + moteur du générateur de noms « baptême » (données pures, sans Discord).

Combinatoire curée : quelques centaines de fragments → millions de combinaisons.
Les axes FAÇONNENT le nom :
- **Race** → la phonétique (assemblage préfixe/racine/suffixe par patrons P/R/S).
- **Origine** (sous-catégorie de la race) → le **lieu** d'origine accolé au nom
  (« des Bois d'Argent »), pour une immersion cohérente.
- **Trait** → l'**épithète** (« le Vaillant », « l'Ombre »…).

Un patron combine des segments : ``P`` = préfixe, ``R`` = racine, ``S`` = suffixe.
Structure du nom : ``Prénom [épithète] [de <lieu d'origine>]``.
"""
import random

UNIVERS = "fantasy"

# Chaque race : phonétique (prefixes/roots/suffixes/patterns) + origines (sous-cat.).
# Chaque origine porte son propre pool de lieux → cohérence race/origine/nom.
RACES = {
    "elfe": {
        "label": "Elfe", "emoji": "🏹",
        "prefixes": ["Ae", "El", "Sil", "Cael", "Lith", "Fae", "Ithil", "Ny", "Aer", "Gala", "Thal", "Ela"],
        "roots": ["thas", "riel", "andir", "wen", "loth", "mir", "dae", "sar", "vyn", "thil", "lian", "neth"],
        "suffixes": ["", "iel", "ion", "as", "wyn", "ith", "ael", "'iel", "wë"],
        "patterns": ["PR", "PRS", "PRS", "RS"],
        "origins": [
            {"key": "bois", "label": "des Bois", "emoji": "🌲",
             "places": ["des Bois d'Argent", "de la Forêt Chantante", "des Grands Chênes", "du Bosquet Pâle", "des Feuilles d'Or"]},
            {"key": "plaines", "label": "des Plaines", "emoji": "🌾",
             "places": ["des Plaines Vertes", "des Prairies du Vent", "des Herbes Hautes", "des Champs d'Étoiles"]},
            {"key": "crepuscule", "label": "du Crépuscule", "emoji": "🌙",
             "places": ["des Terres Grises", "du Val d'Ombre", "des Brumes Mauves", "du Dernier Rayon"]},
            {"key": "cimes", "label": "des Cimes", "emoji": "🏔️",
             "places": ["des Cimes Argentées", "des Aiguilles de Givre", "du Nid des Aigles", "des Hauts Sommets"]},
        ],
    },
    "nain": {
        "label": "Nain", "emoji": "⛏️",
        "prefixes": ["Thor", "Dur", "Bal", "Grim", "Khaz", "Bru", "Thra", "Nor", "Dwal", "Gor", "Bom", "Krag"],
        "roots": ["gan", "din", "mund", "rak", "bek", "dush", "gar", "nar", "thok", "grim", "buld", "dhr"],
        "suffixes": ["", "son", "i", "ar", "uz", "grim", "bek"],
        "patterns": ["PR", "PR", "PRS"],
        "origins": [
            {"key": "montagnes", "label": "des Montagnes", "emoji": "🏔️",
             "places": ["des Monts de Fer", "du Pic Tonnerre", "des Cols Gelés", "de la Montagne Creuse"]},
            {"key": "mines", "label": "des Profondeurs", "emoji": "🕳️",
             "places": ["des Mines Profondes", "des Salles d'Or", "du Gouffre Rouge", "des Galeries Sans-Fin"]},
            {"key": "forges", "label": "des Forges", "emoji": "🔨",
             "places": ["des Grandes Forges", "de l'Enclume Éternelle", "des Fournaises", "du Marteau Sacré"]},
            {"key": "collines", "label": "des Collines", "emoji": "⛰️",
             "places": ["des Collines Brunes", "des Coteaux de Pierre", "des Terres Basses"]},
        ],
    },
    "orc": {
        "label": "Orc", "emoji": "🪓",
        "prefixes": ["Gro", "Mok", "Ur", "Gash", "Zug", "Nar", "Brak", "Dro", "Ghor", "Sna", "Rok", "Vha"],
        "roots": ["gash", "dar", "mok", "thak", "nak", "rok", "zug", "dur", "gul", "rag", "grum", "shak"],
        "suffixes": ["", "nak", "zg", "ish", "ar", "gul", "thok"],
        "patterns": ["PR", "PR", "PRS", "RS"],
        "origins": [
            {"key": "steppes", "label": "des Steppes", "emoji": "🐺",
             "places": ["des Steppes Rouges", "des Plaines Brûlées", "du Vent Sauvage", "des Grandes Herbes"]},
            {"key": "marais", "label": "des Marais", "emoji": "🐸",
             "places": ["des Marais Noirs", "de la Fange Verte", "des Eaux Croupies", "du Bourbier"]},
            {"key": "cendres", "label": "des Cendres", "emoji": "🌋",
             "places": ["des Terres de Cendre", "du Mont Fumant", "des Champs Calcinés", "de la Faille Ardente"]},
            {"key": "horde", "label": "de la Horde", "emoji": "🏴",
             "places": ["du Camp Brisé", "des Bannières Déchirées", "de la Grande Horde"]},
        ],
    },
    "humain": {
        "label": "Humain", "emoji": "🛡️",
        "prefixes": ["Ald", "Ber", "Cor", "Ed", "Gau", "Rob", "Thi", "Guil", "Ren", "Bau", "Ald", "Wil"],
        "roots": ["ric", "mund", "bert", "wald", "fried", "hard", "mar", "win", "gis", "and", "mer", "roy"],
        "suffixes": ["", "in", "on", "aud", "el", "ric", "and"],
        "patterns": ["PR", "PR", "PRS"],
        "origins": [
            {"key": "royaumes", "label": "des Royaumes", "emoji": "👑",
             "places": ["du Royaume d'Or", "des Terres de la Couronne", "de la Cité Haute", "des Marches Royales"]},
            {"key": "cites", "label": "des Cités Libres", "emoji": "🏛️",
             "places": ["de la Cité Franche", "des Ports du Sud", "des Rues Marchandes", "de la Vieille Ville"]},
            {"key": "sauvage", "label": "des Terres Sauvages", "emoji": "🏕️",
             "places": ["des Confins", "des Terres Sans-Loi", "de la Frontière", "des Bois Perdus"]},
            {"key": "nord", "label": "du Nord", "emoji": "❄️",
             "places": ["des Terres du Nord", "des Fjords Gris", "de la Côte Gelée", "des Neiges Éternelles"]},
        ],
    },
    "loup_garou": {
        "label": "Loup-garou", "emoji": "🐺",
        "prefixes": ["Fen", "Grey", "Ulr", "Rag", "Bjor", "Sköll", "Vark", "Lup", "Cana", "Hati", "Ronce", "Croc"],
        "roots": ["rir", "mane", "fang", "garic", "mund", "var", "grim", "ulf", "mar", "nir", "loup", "hurle"],
        "suffixes": ["", "ulf", "gar", "mane", "son", "ric"],
        "patterns": ["PR", "PRS", "PR"],
        "origins": [
            {"key": "forets", "label": "des Forêts", "emoji": "🌲",
             "places": ["des Bois Profonds", "de la Sylve Noire", "des Taillis", "des Grands Pins"]},
            {"key": "lune", "label": "de la Pleine Lune", "emoji": "🌕",
             "places": ["de la Nuit d'Argent", "du Croissant", "des Hurlements", "de la Lune Rousse"]},
            {"key": "meutes", "label": "des Meutes", "emoji": "🐾",
             "places": ["de la Grande Meute", "des Traqueurs", "du Clan Sauvage", "des Chasseurs"]},
        ],
    },
    "gnome": {
        "label": "Gnome", "emoji": "🔧",
        "prefixes": ["Fizz", "Wren", "Nim", "Bix", "Cog", "Zook", "Gimble", "Nack", "Dabble", "Snik", "Turl", "Bram"],
        "roots": ["le", "wick", "er", "it", "o", "in", "el", "by", "gle", "ver", "ny", "ic"],
        "suffixes": ["", "le", "ni", "ock", "ix", "gle", "widd"],
        "patterns": ["PR", "PRS", "PRS", "RS"],
        "origins": [
            {"key": "ateliers", "label": "des Ateliers", "emoji": "⚙️",
             "places": ["des Grands Ateliers", "de la Tour à Rouages", "des Établis", "de la Fabrique"]},
            {"key": "terriers", "label": "des Terriers", "emoji": "🕳️",
             "places": ["des Terriers Doux", "du Dédale", "des Galeries Rondes", "du Nid Douillet"]},
            {"key": "cavernes", "label": "des Cavernes", "emoji": "💎",
             "places": ["des Cavernes Scintillantes", "des Cristaux", "des Grottes Bleues"]},
        ],
    },
    "dragon": {
        "label": "Dragon", "emoji": "🐉",
        "prefixes": ["Vor", "Rha", "Kaz", "Draa", "Sar", "Vex", "Nyx", "Tha", "Zar", "Aur", "Gor", "Rex"],
        "roots": ["xis", "thor", "gon", "rax", "mir", "zar", "eth", "gath", "rys", "vok", "dral", "nax"],
        "suffixes": ["", "ax", "is", "oth", "ar", "yx", "or"],
        "patterns": ["PR", "PRS", "PR"],
        "origins": [
            {"key": "feu", "label": "du Feu", "emoji": "🔥",
             "places": ["du Cœur de Braise", "des Pics de Lave", "du Souffle Ardent", "de l'Antre Rouge"]},
            {"key": "givre", "label": "du Givre", "emoji": "🧊",
             "places": ["des Glaces Éternelles", "du Souffle Gelé", "de l'Antre Bleue", "des Toundras"]},
            {"key": "orage", "label": "de l'Orage", "emoji": "⚡",
             "places": ["des Cieux Grondants", "du Pic Foudroyé", "des Nuées Noires", "de la Tempête"]},
        ],
    },
    "demon": {
        "label": "Démon", "emoji": "😈",
        "prefixes": ["Mal", "Bel", "Az", "Nyx", "Dis", "Vas", "Mor", "Ith", "Kaz", "Rav", "Sael", "Ver"],
        "roots": ["zeth", "ael", "ith", "mor", "phas", "rok", "neth", "zar", "gloth", "vane", "rix", "sius"],
        "suffixes": ["", "eth", "os", "ael", "ix", "us"],
        "patterns": ["PR", "PRS", "PR"],
        "origins": [
            {"key": "abysses", "label": "des Abysses", "emoji": "🕳️",
             "places": ["des Abysses Sans-Fond", "des Neuf Cercles", "du Gouffre Rouge", "des Ténèbres"]},
            {"key": "pactes", "label": "des Pactes", "emoji": "📜",
             "places": ["du Serment Brisé", "des Contrats de Sang", "de la Dette Éternelle"]},
            {"key": "exil", "label": "de l'Exil", "emoji": "🚪",
             "places": ["des Terres Reniées", "du Long Chemin", "des Portes Closes", "de Nulle-Part"]},
        ],
    },
    "fee": {
        "label": "Fée", "emoji": "🧚",
        "prefixes": ["Lil", "Fae", "Pae", "Twi", "Dew", "Bel", "Nim", "Sil", "Vio", "Thi", "Ely", "Ari"],
        "roots": ["le", "wyn", "ora", "belle", "ia", "thel", "dew", "mist", "fae", "lira", "sy", "nia"],
        "suffixes": ["", "wyn", "elle", "ia", "ling", "let"],
        "patterns": ["PR", "PRS", "RS"],
        "origins": [
            {"key": "fleurs", "label": "des Fleurs", "emoji": "🌸",
             "places": ["des Pétales", "du Jardin Secret", "des Boutons d'Or", "de la Roseraie"]},
            {"key": "rosee", "label": "de la Rosée", "emoji": "💧",
             "places": ["des Gouttes du Matin", "des Sources Claires", "de l'Étang de Lune"]},
            {"key": "lucioles", "label": "des Lucioles", "emoji": "✨",
             "places": ["des Lueurs Dansantes", "du Bois Scintillant", "des Nuits d'Été"]},
        ],
    },
    "vampire": {
        "label": "Vampire", "emoji": "🧛",
        "prefixes": ["Vlad", "Dra", "Carm", "Alu", "Lucr", "Cassi", "Vane", "Ortho", "Mor", "Ser", "Nyx", "Bela"],
        "roots": ["cul", "mir", "eska", "vane", "dor", "lena", "thas", "viel", "gore", "nox", "rian", "sang"],
        "suffixes": ["", "escu", "a", "ov", "ine", "us"],
        "patterns": ["PR", "PRS", "PR"],
        "origins": [
            {"key": "chateau", "label": "du Château", "emoji": "🏰",
             "places": ["du Château Noir", "des Tours Sombres", "du Donjon Maudit", "des Cryptes Anciennes"]},
            {"key": "nuit", "label": "de la Nuit", "emoji": "🌙",
             "places": ["des Ténèbres", "de la Pleine Lune", "des Ombres", "de Minuit"]},
            {"key": "sang", "label": "du Sang", "emoji": "🩸",
             "places": ["de la Lignée Pourpre", "du Calice", "des Roses Rouges", "du Pacte de Sang"]},
        ],
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
    "noble": {"label": "Noble", "emoji": "👑", "epithets": [
        "le Juste", "au Grand Cœur", "le Loyal", "Main-Ouverte", "le Digne",
        "Front-Haut", "le Courtois", "l'Honorable", "Verbe-d'Or"]},
    "sauvage": {"label": "Sauvage", "emoji": "🐺", "epithets": [
        "le Farouche", "Crocs-Nus", "l'Indompté", "Griffe-Rapide", "le Rôdeur",
        "Souffle-de-Loup", "l'Écorché", "Pied-de-Fauve", "le Traqueur"]},
    "mystique": {"label": "Mystique", "emoji": "🔮", "epithets": [
        "le Voilé", "aux Runes", "Tisse-Sorts", "l'Illuminé", "Œil-d'Astral",
        "le Prophète", "aux Mains Bleues", "l'Arcaniste", "Murmure-d'Étoiles"]},
    "vengeur": {"label": "Vengeur", "emoji": "🗡️", "epithets": [
        "l'Implacable", "Brise-Serment", "la Lame Froide", "le Traqueur", "Sang-pour-Sang",
        "l'Inflexible", "le Marqué", "Dette-de-Sang", "l'Ombre Vengeresse"]},
    "ardent": {"label": "Ardent", "emoji": "🔥", "epithets": [
        "le Flamboyant", "Cœur-de-Braise", "l'Emporté", "Souffle-de-Feu", "le Bouillant",
        "l'Incandescent", "Poing-Ardent", "la Torche", "l'Insatiable"]},
    "stoique": {"label": "Stoïque", "emoji": "🗿", "epithets": [
        "l'Imperturbable", "Roc-Immobile", "le Patient", "Face-de-Pierre", "l'Endurant",
        "le Taciturne", "Épaules-Larges", "le Constant", "l'Inébranlable"]},
    "errant": {"label": "Errant", "emoji": "🧭", "epithets": [
        "le Vagabond", "Sans-Attache", "l'Éternel Voyageur", "Semelle-de-Vent", "le Nomade",
        "aux Mille Routes", "l'Exilé", "Pas-Léger", "le Solitaire"]},
}


def race_choices():
    return [(k, v["label"], v.get("emoji")) for k, v in RACES.items()]


def origin_choices(race_key):
    race = RACES.get(race_key)
    if not race:
        return []
    return [(o["key"], o["label"], o.get("emoji")) for o in race.get("origins", [])]


def trait_choices():
    return [(k, v["label"], v.get("emoji")) for k, v in TRAITS.items()]


def race_label(race_key):
    r = RACES.get(race_key)
    return r["label"] if r else race_key


def origin_label(race_key, origin_key):
    race = RACES.get(race_key)
    if race:
        for o in race.get("origins", []):
            if o["key"] == origin_key:
                return o["label"]
    return origin_key


def trait_label(trait_key):
    t = TRAITS.get(trait_key)
    return t["label"] if t else trait_key


def _cap(text):
    return text[:1].upper() + text[1:] if text else text


def _firstname(race):
    pattern = random.choice(race["patterns"])
    pools = {"P": race["prefixes"], "R": race["roots"], "S": race["suffixes"]}
    out = "".join(random.choice(pools[ch]) for ch in pattern)
    return _cap(out) or _cap(random.choice(race["roots"]))


def _origin(race, origin_key):
    for o in race.get("origins", []):
        if o["key"] == origin_key:
            return o
    return race.get("origins", [{}])[0] if race.get("origins") else {}


def generate(race_key, origin_key, trait_key):
    """Assemble un nom : prénom (phonétique race) + épithète (trait) + lieu (origine)."""
    race = RACES.get(race_key)
    trait = TRAITS.get(trait_key)
    if not race or not trait:
        return None
    parts = [_firstname(race)]
    epithet = random.choice(trait["epithets"])
    if epithet:
        parts.append(epithet)
    places = _origin(race, origin_key).get("places") or []
    if places and random.random() < 0.6:
        parts.append(random.choice(places))
    return " ".join(parts)
