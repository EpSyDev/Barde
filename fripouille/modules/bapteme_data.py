"""Données + moteur du générateur de noms « baptême » (données pures, sans Discord).

Combinatoire curée : quelques centaines de fragments → millions de combinaisons.
Les axes FAÇONNENT le nom :
- **Race** → la phonétique (préfixe/racine/suffixe par patrons P/R/S). Les **suffixes
  sont genrés** (``suffixes_m`` / ``suffixes_f``) → prénom masculin ou féminin.
- **Genre** (``m`` / ``f``) → accorde le prénom, le titre, l'épithète et l'ordinal.
- **Origine** → le **lieu** d'origine accolé au nom.
- **Trait** → l'**épithète**.
- **Structure** tirée au sort (``STRUCTURES``) → casse le gabarit fixe.

Convention de genre : un fragment vaut soit une chaîne (épicène, identique m/f),
soit un tuple ``(masculin, féminin)``. ``_pick(item, gender)`` choisit la bonne forme.
"""
import random

UNIVERS = "fantasy"

GENDERS = [("m", "Homme", "♂️"), ("f", "Femme", "♀️")]


def _pick(item, gender):
    """Chaîne épicène → telle quelle ; tuple (m, f) → forme selon le genre."""
    if isinstance(item, (tuple, list)):
        return item[0] if gender == "m" else item[1]
    return item


# --- Titres (préfixés) et ordinaux de lignée (suffixés), en (masculin, féminin) ---
TITLES = [
    ("Sieur", "Dame"), ("Maître", "Maîtresse"), ("Messire", "Madame"),
    ("Capitaine", "Capitaine"), ("Doyen", "Doyenne"), "Vénérable",
    ("le Vieux", "la Vieille"), ("le Jeune", "la Jeune"), ("Baron", "Baronne"),
    ("Frère", "Sœur"), "l'Ermite", ("Sire", "Dame"), ("Dom", "Doña"),
]
ORDINALS = [
    ("Premier du Nom", "Première du Nom"), ("le Second", "la Seconde"),
    "III du Nom", "IV du Nom", ("l'Aîné", "l'Aînée"), ("le Cadet", "la Cadette"),
    ("l'Ancien", "l'Ancienne"), ("le Dernier", "la Dernière"),
    ("Deux-Fois-Né", "Deux-Fois-Née"), ("le Revenu", "la Revenue"),
]

# Structures de nom (template, poids). Tokens : {first} {epithet} {place} {title} {ordinal}.
STRUCTURES = [
    ("{first}", 3),
    ("{first} {epithet}", 7),
    ("{first} {place}", 3),
    ("{first} {epithet} {place}", 5),
    ("{title} {first}", 2),
    ("{title} {first} {epithet}", 2),
    ("{first} {ordinal}", 2),
    ("{first}, {epithet}", 3),
    ("{title} {first} {place}", 1),
]

# --- Races : phonétique (suffixes genrés) + origines + titres genrés ---
RACES = {
    "humain": {
        "label": "Humain", "emoji": "🛡️", "role_id": "1528460919217192980",
        "titles": [("Sire", "Dame"), ("Chevalier", "Chevalière"), ("Écuyer", "Écuyère")],
        "prefixes": ["Ald", "Ber", "Cor", "Ed", "Gau", "Rob", "Thi", "Guil", "Ren", "Bau",
                     "Wil", "Hug", "Ans", "Bert", "God", "Roul", "Aim", "Fol"],
        "roots": ["ric", "mund", "bert", "wald", "fried", "hard", "mar", "win", "gis", "and",
                  "mer", "roy", "bald", "gar", "helm", "frid"],
        "suffixes_m": ["", "in", "on", "aud", "ric", "and", "ier", "ot", "bert"],
        "suffixes_f": ["a", "e", "ie", "elle", "ette", "ine", "aude", "onne"],
        "patterns": ["PR", "PRS", "PRS", "RS"],
        "origins": [
            {"key": "royaumes", "label": "des Royaumes", "emoji": "👑",
             "places": ["du Royaume d'Or", "des Terres de la Couronne", "de la Cité Haute",
                        "des Marches Royales", "du Trône de Chêne", "des Terres Bénies"]},
            {"key": "cites", "label": "des Cités Libres", "emoji": "🏛️",
             "places": ["de la Cité Franche", "des Ports du Sud", "des Rues Marchandes",
                        "de la Vieille Ville", "du Grand Marché", "des Canaux"]},
            {"key": "sauvage", "label": "des Terres Sauvages", "emoji": "🏕️",
             "places": ["des Confins", "des Terres Sans-Loi", "de la Frontière",
                        "des Bois Perdus", "des Chemins Oubliés", "du Bout du Monde"]},
            {"key": "nord", "label": "du Nord", "emoji": "❄️",
             "places": ["des Terres du Nord", "des Fjords Gris", "de la Côte Gelée",
                        "des Neiges Éternelles", "du Mur de Glace", "des Longs Hivers"]},
        ],
    },
    "elfe": {
        "label": "Elfe", "emoji": "🏹", "role_id": "1528461977083707532",
        "titles": [("Gardien", "Gardienne"), ("l'Immortel", "l'Immortelle"), ("Sylphe", "Sylphide")],
        "prefixes": ["Ae", "El", "Sil", "Cael", "Lith", "Fae", "Ithil", "Ny", "Aer", "Gala",
                     "Thal", "Ela", "Aran", "Cel", "Mith", "Eär", "Lor", "Fin"],
        "roots": ["thas", "riel", "andir", "wen", "loth", "mir", "dae", "sar", "vyn", "thil",
                  "lian", "neth", "gala", "dor", "wë", "los"],
        "suffixes_m": ["", "ion", "as", "dir", "or", "ael", "dil", "on"],
        "suffixes_f": ["iel", "wyn", "ith", "'iel", "wë", "elle", "ia", "riel", "a"],
        "patterns": ["PR", "PRS", "PRS", "RS"],
        "origins": [
            {"key": "bois", "label": "des Bois", "emoji": "🌲",
             "places": ["des Bois d'Argent", "de la Forêt Chantante", "des Grands Chênes",
                        "du Bosquet Pâle", "des Feuilles d'Or", "de la Sylve Éternelle"]},
            {"key": "plaines", "label": "des Plaines", "emoji": "🌾",
             "places": ["des Plaines Vertes", "des Prairies du Vent", "des Herbes Hautes",
                        "des Champs d'Étoiles", "des Grands Espaces", "de l'Horizon Doré"]},
            {"key": "crepuscule", "label": "du Crépuscule", "emoji": "🌙",
             "places": ["des Terres Grises", "du Val d'Ombre", "des Brumes Mauves",
                        "du Dernier Rayon", "des Lueurs Pâles", "du Seuil des Songes"]},
            {"key": "cimes", "label": "des Cimes", "emoji": "🏔️",
             "places": ["des Cimes Argentées", "des Aiguilles de Givre", "du Nid des Aigles",
                        "des Hauts Sommets", "des Tours de Cristal", "du Toit du Monde"]},
        ],
    },
    "nain": {
        "label": "Nain", "emoji": "⛏️", "role_id": "1528462229127561459",
        "titles": [("Maître-Forgeron", "Maîtresse-Forgeronne"), ("le Barbu", "la Barbue"), "Thane"],
        "prefixes": ["Thor", "Dur", "Bal", "Grim", "Khaz", "Bru", "Thra", "Nor", "Dwal", "Gor",
                     "Bom", "Krag", "Bof", "Dain", "Bard", "Ori", "Gloi", "Balin"],
        "roots": ["gan", "din", "mund", "rak", "bek", "dush", "gar", "nar", "thok", "grim",
                  "buld", "dhr", "dur", "bur", "gnar", "throm"],
        "suffixes_m": ["", "son", "i", "ar", "uz", "grim", "bek", "dun", "mir"],
        "suffixes_f": ["a", "i", "hild", "dis", "runn", "unn", "ra", "wyn"],
        "patterns": ["PR", "PR", "PRS", "PRS"],
        "origins": [
            {"key": "montagnes", "label": "des Montagnes", "emoji": "🏔️",
             "places": ["des Monts de Fer", "du Pic Tonnerre", "des Cols Gelés",
                        "de la Montagne Creuse", "des Sommets Noirs", "du Toit de Pierre"]},
            {"key": "mines", "label": "des Profondeurs", "emoji": "🕳️",
             "places": ["des Mines Profondes", "des Salles d'Or", "du Gouffre Rouge",
                        "des Galeries Sans-Fin", "des Veines d'Argent", "du Cœur du Monde"]},
            {"key": "forges", "label": "des Forges", "emoji": "🔨",
             "places": ["des Grandes Forges", "de l'Enclume Éternelle", "des Fournaises",
                        "du Marteau Sacré", "des Braises Vives", "de la Grande Fonte"]},
            {"key": "collines", "label": "des Collines", "emoji": "⛰️",
             "places": ["des Collines Brunes", "des Coteaux de Pierre", "des Terres Basses",
                        "des Tertres Anciens", "des Vallons Gris"]},
        ],
    },
    "orc": {
        "label": "Orc", "emoji": "🪓", "role_id": "1528464103319015474",
        "titles": [("Chef-de-Guerre", "Cheffe-de-Guerre"), ("le Balafré", "la Balafrée"), ("Broyeur", "Broyeuse")],
        "prefixes": ["Gro", "Mok", "Ur", "Gash", "Zug", "Nar", "Brak", "Dro", "Ghor", "Sna",
                     "Rok", "Vha", "Grum", "Skar", "Uz", "Drak", "Mog", "Ghaz"],
        "roots": ["gash", "dar", "mok", "thak", "nak", "rok", "zug", "dur", "gul", "rag",
                  "grum", "shak", "burz", "muk", "ghor", "krak"],
        "suffixes_m": ["", "nak", "zg", "ish", "ar", "gul", "thok", "dush", "mog"],
        "suffixes_f": ["a", "ga", "sha", "nka", "gra", "ola", "ka", "ra"],
        "patterns": ["PR", "PR", "PRS", "RS"],
        "origins": [
            {"key": "steppes", "label": "des Steppes", "emoji": "🐺",
             "places": ["des Steppes Rouges", "des Plaines Brûlées", "du Vent Sauvage",
                        "des Grandes Herbes", "des Terres Nues", "du Grand Galop"]},
            {"key": "marais", "label": "des Marais", "emoji": "🐸",
             "places": ["des Marais Noirs", "de la Fange Verte", "des Eaux Croupies",
                        "du Bourbier", "des Roseaux Pourris", "de la Vase"]},
            {"key": "cendres", "label": "des Cendres", "emoji": "🌋",
             "places": ["des Terres de Cendre", "du Mont Fumant", "des Champs Calcinés",
                        "de la Faille Ardente", "des Scories", "du Val de Suie"]},
            {"key": "horde", "label": "de la Horde", "emoji": "🏴",
             "places": ["du Camp Brisé", "des Bannières Déchirées", "de la Grande Horde",
                        "des Crânes Empilés", "du Cri de Guerre"]},
        ],
    },
    "fee": {
        "label": "Fée", "emoji": "🧚", "role_id": "1528464185795805234",
        "titles": [("Roi", "Reine"), ("Sylphe", "Sylphide"), ("le Petit", "la Petite")],
        "prefixes": ["Lil", "Fae", "Pae", "Twi", "Dew", "Bel", "Nim", "Sil", "Vio", "Thi",
                     "Ely", "Ari", "Mel", "Ros", "Cin", "Pim"],
        "roots": ["le", "wyn", "ora", "belle", "ia", "thel", "dew", "mist", "fae", "lira",
                  "sy", "nia", "pet", "lil", "bloom", "sha"],
        "suffixes_m": ["", "wick", "in", "il", "on"],
        "suffixes_f": ["elle", "ia", "wyn", "belle", "dew", "let", "ora", "a"],
        "patterns": ["PR", "PRS", "RS", "PRS"],
        "origins": [
            {"key": "fleurs", "label": "des Fleurs", "emoji": "🌸",
             "places": ["des Pétales", "du Jardin Secret", "des Boutons d'Or",
                        "de la Roseraie", "des Corolles", "du Champ de Bruyère"]},
            {"key": "rosee", "label": "de la Rosée", "emoji": "💧",
             "places": ["des Gouttes du Matin", "des Sources Claires", "de l'Étang de Lune",
                        "des Perles d'Eau", "du Ruisseau Frais"]},
            {"key": "lucioles", "label": "des Lucioles", "emoji": "✨",
             "places": ["des Lueurs Dansantes", "du Bois Scintillant", "des Nuits d'Été",
                        "des Feux Follets", "de la Clairière Brillante"]},
        ],
    },
    "gnome": {
        "label": "Gnome", "emoji": "🔧", "role_id": "1528464292674797578",
        "titles": [("Bricoleur", "Bricoleuse"), ("Professeur", "Professeure"), ("le Petit", "la Petite")],
        "prefixes": ["Fizz", "Wren", "Nim", "Bix", "Cog", "Zook", "Gimble", "Nack", "Dabble",
                     "Snik", "Turl", "Bram", "Fim", "Wid", "Bop", "Tink"],
        "roots": ["le", "wick", "er", "it", "o", "in", "el", "by", "gle", "ver",
                  "ny", "ic", "am", "ot", "iz"],
        "suffixes_m": ["", "ock", "ix", "gle", "widd", "bo", "us"],
        "suffixes_f": ["a", "ella", "ina", "elle", "ie", "etta", "wenn"],
        "patterns": ["PR", "PRS", "RS"],
        "origins": [
            {"key": "ateliers", "label": "des Ateliers", "emoji": "⚙️",
             "places": ["des Grands Ateliers", "de la Tour à Rouages", "des Établis",
                        "de la Fabrique", "des Engrenages", "du Grand Mécanisme"]},
            {"key": "terriers", "label": "des Terriers", "emoji": "🕳️",
             "places": ["des Terriers Doux", "du Dédale", "des Galeries Rondes",
                        "du Nid Douillet", "des Trous Chauds"]},
            {"key": "cavernes", "label": "des Cavernes", "emoji": "💎",
             "places": ["des Cavernes Scintillantes", "des Cristaux", "des Grottes Bleues",
                        "des Geodes", "du Puits de Gemmes"]},
        ],
    },
    "dragon": {
        "label": "Dragon", "emoji": "🐉", "role_id": "1528464357745492100",
        "titles": [("l'Ailé", "l'Ailée"), ("Seigneur", "Dame"), ("l'Ancien", "l'Ancienne")],
        "prefixes": ["Vor", "Rha", "Kaz", "Draa", "Sar", "Vex", "Nyx", "Tha", "Zar", "Aur",
                     "Gor", "Rex", "Xar", "Vael", "Pyr", "Bal"],
        "roots": ["xis", "thor", "gon", "rax", "mir", "zar", "eth", "gath", "rys", "vok",
                  "dral", "nax", "gorn", "rok", "aeth"],
        "suffixes_m": ["", "ax", "oth", "ar", "yx", "or", "ux"],
        "suffixes_f": ["a", "ia", "yssa", "eth", "ira", "issa", "ax"],
        "patterns": ["PR", "PRS", "PR", "PRS"],
        "origins": [
            {"key": "feu", "label": "du Feu", "emoji": "🔥",
             "places": ["du Cœur de Braise", "des Pics de Lave", "du Souffle Ardent",
                        "de l'Antre Rouge", "des Cavernes de Feu", "du Volcan Noir"]},
            {"key": "givre", "label": "du Givre", "emoji": "🧊",
             "places": ["des Glaces Éternelles", "du Souffle Gelé", "de l'Antre Bleue",
                        "des Toundras", "du Pic Glacé", "des Cavernes de Cristal"]},
            {"key": "orage", "label": "de l'Orage", "emoji": "⚡",
             "places": ["des Cieux Grondants", "du Pic Foudroyé", "des Nuées Noires",
                        "de la Tempête", "des Vents Hurlants"]},
        ],
    },
    "demon": {
        "label": "Démon", "emoji": "😈", "role_id": "1528464419192049714",
        "titles": [("Prince", "Princesse"), ("Seigneur", "Dame"), ("le Damné", "la Damnée")],
        "prefixes": ["Mal", "Bel", "Az", "Nyx", "Dis", "Vas", "Mor", "Ith", "Kaz", "Rav",
                     "Sael", "Ver", "Bael", "Xul", "Gra", "Zeph"],
        "roots": ["zeth", "ael", "ith", "mor", "phas", "rok", "neth", "zar", "gloth", "vane",
                  "rix", "sius", "goth", "azel", "phel"],
        "suffixes_m": ["", "eth", "os", "ael", "ix", "us", "oth"],
        "suffixes_f": ["a", "eth", "ia", "elle", "issa", "ael", "ara"],
        "patterns": ["PR", "PRS", "PR", "PRS"],
        "origins": [
            {"key": "abysses", "label": "des Abysses", "emoji": "🕳️",
             "places": ["des Abysses Sans-Fond", "des Neuf Cercles", "du Gouffre Rouge",
                        "des Ténèbres", "du Puits d'Ombre", "des Enfers Profonds"]},
            {"key": "pactes", "label": "des Pactes", "emoji": "📜",
             "places": ["du Serment Brisé", "des Contrats de Sang", "de la Dette Éternelle",
                        "des Âmes Vendues", "du Marché Maudit"]},
            {"key": "exil", "label": "de l'Exil", "emoji": "🚪",
             "places": ["des Terres Reniées", "du Long Chemin", "des Portes Closes",
                        "de Nulle-Part", "des Marges du Monde"]},
        ],
    },
    "vampire": {
        "label": "Vampire", "emoji": "🧛", "role_id": "1528464495901671584",
        "titles": [("Comte", "Comtesse"), ("le Sans-Âge", "la Sans-Âge"), ("Baron", "Baronne")],
        "prefixes": ["Vlad", "Dra", "Carm", "Alu", "Lucr", "Cassi", "Vane", "Ortho", "Mor",
                     "Ser", "Nyx", "Bela", "Rad", "Vesp", "Cor", "Sang"],
        "roots": ["cul", "mir", "eska", "vane", "dor", "lena", "thas", "viel", "gore", "nox",
                  "rian", "sang", "mort", "ula", "cinth"],
        "suffixes_m": ["", "escu", "ov", "us", "eth", "or"],
        "suffixes_f": ["a", "escu", "ova", "ine", "issa", "ella", "ia"],
        "patterns": ["PR", "PRS", "PR", "PRS"],
        "origins": [
            {"key": "chateau", "label": "du Château", "emoji": "🏰",
             "places": ["du Château Noir", "des Tours Sombres", "du Donjon Maudit",
                        "des Cryptes Anciennes", "du Manoir Perdu", "des Remparts Gris"]},
            {"key": "nuit", "label": "de la Nuit", "emoji": "🌙",
             "places": ["des Ténèbres", "de la Pleine Lune", "des Ombres",
                        "de Minuit", "du Voile Nocturne", "des Heures Noires"]},
            {"key": "sang", "label": "du Sang", "emoji": "🩸",
             "places": ["de la Lignée Pourpre", "du Calice", "des Roses Rouges",
                        "du Pacte de Sang", "de la Coupe Éternelle"]},
        ],
    },
    "loup_garou": {
        "label": "Loup-garou", "emoji": "🐺", "role_id": "1528464585856909381",
        "titles": ["Alpha", ("le Grand", "la Grande"), ("Traqueur", "Traqueuse")],
        "prefixes": ["Fen", "Grey", "Ulr", "Rag", "Bjor", "Sköll", "Vark", "Lup", "Cana",
                     "Hati", "Ronce", "Croc", "Fang", "Loup", "Mord", "Snar"],
        "roots": ["rir", "mane", "fang", "garic", "mund", "var", "grim", "ulf", "mar", "nir",
                  "loup", "hurle", "gueule", "croc", "rôde"],
        "suffixes_m": ["", "ulf", "gar", "son", "ric", "croc"],
        "suffixes_f": ["a", "wenn", "ra", "ira", "mane", "wina"],
        "patterns": ["PR", "PRS", "PR", "PRS"],
        "origins": [
            {"key": "forets", "label": "des Forêts", "emoji": "🌲",
             "places": ["des Bois Profonds", "de la Sylve Noire", "des Taillis",
                        "des Grands Pins", "des Fourrés", "du Cœur Sombre"]},
            {"key": "lune", "label": "de la Pleine Lune", "emoji": "🌕",
             "places": ["de la Nuit d'Argent", "du Croissant", "des Hurlements",
                        "de la Lune Rousse", "du Halo Blafard"]},
            {"key": "meutes", "label": "des Meutes", "emoji": "🐾",
             "places": ["de la Grande Meute", "des Traqueurs", "du Clan Sauvage",
                        "des Chasseurs", "de la Ronde Nocturne"]},
        ],
    },
}

# trait → épithètes (str épicène, ou tuple (masculin, féminin)).
TRAITS = {
    "brave": {"label": "Brave", "emoji": "⚔️", "epithets": [
        ("le Vaillant", "la Vaillante"), "Cœur-de-Lion", "l'Intrépide", "Brise-Bouclier",
        ("le Hardi", "la Hardie"), "sans Peur", "Taille-Géant", "le Rempart", "Poing-de-Fer",
        ("le Lion", "la Lionne"), "Front-d'Acier", ("le Brave", "la Brave"), "Brise-Lances",
        "Mâchoire-Serrée", ("le Fier", "la Fière"), ("l'Audacieux", "l'Audacieuse")]},
    "ruse": {"label": "Rusé", "emoji": "🦊", "epithets": [
        ("le Malin", "la Maligne"), "l'Ombre", "aux Mille Tours", "Langue-d'Argent",
        ("le Filou", "la Filoute"), "Doigts-Agiles", ("le Renard", "la Renarde"), "Pied-Feutré",
        "le Caméléon", "Vif-d'Esprit", "Double-Jeu", ("le Fourbe", "la Fourbe"),
        "Sourire-en-Coin", "l'Anguille", ("le Subtil", "la Subtile"), "Trois-Coups-d'Avance"]},
    "sage": {"label": "Sage", "emoji": "📜", "epithets": [
        ("le Sage", "la Sage"), ("l'Érudit", "l'Érudite"), "aux Yeux Clairs",
        ("le Contemplatif", "la Contemplative"), "Barbe-Grise", ("le Devin", "la Devineresse"),
        "Porte-Savoir", ("l'Ancien", "l'Ancienne"), "aux Mille Livres", ("le Lucide", "la Lucide"),
        "Voix-Posée", ("le Songeur", "la Songeuse"), ("l'Éclairé", "l'Éclairée"),
        "Garde-Mémoire", ("le Patient", "la Patiente")]},
    "sombre": {"label": "Sombre", "emoji": "🌑", "epithets": [
        ("le Ténébreux", "la Ténébreuse"), "des Cendres", "Porte-Deuil", ("le Maudit", "la Maudite"),
        ("l'Endeuillé", "l'Endeuillée"), "Nuit-Profonde", ("le Corbeau", "la Corneille"), "Sang-Froid",
        "l'Éclipse", ("le Silencieux", "la Silencieuse"), "Ombre-Longue",
        ("le Sépulcral", "la Sépulcrale"), "Voile-Noir", ("l'Oublié", "l'Oubliée"),
        "Cœur-de-Suie", ("le Funeste", "la Funeste")]},
    "farceur": {"label": "Farceur", "emoji": "🎭", "epithets": [
        ("le Fripon", "la Friponne"), "Pied-Léger", ("le Bouffon", "la Bouffonne"), "Trouble-Fête",
        "la Pie", "Grelot", ("le Chahuteur", "la Chahuteuse"), "Nez-Rouge",
        ("le Cabotin", "la Cabotine"), "Deux-Chopes", "Tourne-Boule", ("le Blagueur", "la Blagueuse"),
        "Pince-sans-Rire", "Culbuto", ("le Farfadet", "la Farfadette"), "Gros-Rire"]},
    "noble": {"label": "Noble", "emoji": "👑", "epithets": [
        ("le Juste", "la Juste"), "au Grand Cœur", ("le Loyal", "la Loyale"), "Main-Ouverte",
        ("le Digne", "la Digne"), "Front-Haut", ("le Courtois", "la Courtoise"), "l'Honorable",
        "Verbe-d'Or", ("le Généreux", "la Généreuse"), "Cœur-Pur", ("le Bienveillant", "la Bienveillante"),
        "Parole-Tenue", ("le Magnanime", "la Magnanime"), "Port-Altier", "l'Intègre"]},
    "sauvage": {"label": "Sauvage", "emoji": "🐺", "epithets": [
        ("le Farouche", "la Farouche"), "Crocs-Nus", ("l'Indompté", "l'Indomptée"), "Griffe-Rapide",
        ("le Rôdeur", "la Rôdeuse"), "Souffle-de-Loup", ("l'Écorché", "l'Écorchée"), "Pied-de-Fauve",
        ("le Traqueur", "la Traqueuse"), "Poil-Hérissé", "Sang-Bouillant", "Œil-de-Lynx",
        ("le Primitif", "la Primitive"), "Mord-Vent", "l'Insaisissable", "Crin-au-Vent"]},
    "mystique": {"label": "Mystique", "emoji": "🔮", "epithets": [
        ("le Voilé", "la Voilée"), "aux Runes", "Tisse-Sorts", ("l'Illuminé", "l'Illuminée"),
        "Œil-d'Astral", ("le Prophète", "la Prophétesse"), "aux Mains Bleues", "l'Arcaniste",
        "Murmure-d'Étoiles", ("le Visionnaire", "la Visionnaire"), "Porte-Grimoire",
        ("l'Éthéré", "l'Éthérée"), "Doigts-de-Lune", ("le Sibyllin", "la Sibylline"),
        "Voix-des-Vents", ("l'Initié", "l'Initiée")]},
    "vengeur": {"label": "Vengeur", "emoji": "🗡️", "epithets": [
        "l'Implacable", "Brise-Serment", "la Lame Froide", "Sang-pour-Sang", "l'Inflexible",
        ("le Marqué", "la Marquée"), "Dette-de-Sang", "l'Ombre Vengeresse", "Œil-pour-Œil",
        ("le Rancunier", "la Rancunière"), "Fer-Rouge", ("le Poursuivant", "la Poursuivante"),
        "Cœur-de-Fiel", "la Nemesis", "l'Inexorable", "Jamais-Pardon"]},
    "ardent": {"label": "Ardent", "emoji": "🔥", "epithets": [
        ("le Flamboyant", "la Flamboyante"), "Cœur-de-Braise", ("l'Emporté", "l'Emportée"),
        "Souffle-de-Feu", ("le Bouillant", "la Bouillante"), ("l'Incandescent", "l'Incandescente"),
        "Poing-Ardent", "la Torche", "l'Insatiable", "Sang-Chaud", ("le Fougueux", "la Fougueuse"),
        "Étincelle", "Brûle-Tout", ("l'Enflammé", "l'Enflammée"), "Verbe-Haut",
        ("le Volcanique", "la Volcanique")]},
    "stoique": {"label": "Stoïque", "emoji": "🗿", "epithets": [
        "l'Imperturbable", "Roc-Immobile", ("le Patient", "la Patiente"), "Face-de-Pierre",
        ("l'Endurant", "l'Endurante"), ("le Taciturne", "la Taciturne"), "Épaules-Larges",
        ("le Constant", "la Constante"), "l'Inébranlable", "Souffle-Égal", ("le Posé", "la Posée"),
        "Marbre-Froid", "l'Immuable", "Nerfs-d'Acier", ("le Flegmatique", "la Flegmatique")]},
    "errant": {"label": "Errant", "emoji": "🧭", "epithets": [
        ("le Vagabond", "la Vagabonde"), "Sans-Attache", ("l'Éternel Voyageur", "l'Éternelle Voyageuse"),
        "Semelle-de-Vent", ("le Nomade", "la Nomade"), "aux Mille Routes", ("l'Exilé", "l'Exilée"),
        "Pas-Léger", ("le Solitaire", "la Solitaire"), "Sans-Racines", ("le Passant", "la Passante"),
        "Poussière-de-Route", ("l'Égaré", "l'Égarée"), "Boussole-Folle", "Sans-Pays", "Cœur-Ailleurs"]},
}


# --- Fois (voies masquées ; leur vraie nature se révèle en quête) ---
# Pour l'instant : simple choix stocké. Les accès/chemins par foi viendront ensuite.
FAITHS = [
    {"key": "sceau", "label": "l'Ordre du Sceau", "emoji": "🔒",
     "role_id": "1528416586120167774",
     "desc": "Protéger ce qui doit le rester.",
     "creed": "Quelque chose dort sous la taverne. L'Ordre veille à ce qu'il ne s'éveille "
              "jamais : discipline, serments, et foi inébranlable envers le Premier."},
    {"key": "renard", "label": "la Voie du Renard", "emoji": "🦊",
     "role_id": "1528416918434742473",
     "desc": "La ruse ouvre plus de portes que la force.",
     "creed": "Pourquoi forcer une porte qu'on peut convaincre de s'ouvrir ? Les Renards "
              "amassent secrets, faveurs et raccourcis — et paient toujours leurs dettes… un jour."},
    {"key": "marteau", "label": "la Voie du Marteau", "emoji": "🔨",
     "role_id": "1528417282957512855",
     "desc": "La force brise tous les sceaux.",
     "creed": "Tout sceau finit par céder sous assez de coups. Les fidèles du Marteau ne "
              "négocient pas avec un mur : ils cognent jusqu'à ce qu'il cède."},
    {"key": "voile", "label": "la Voie du Voile", "emoji": "🌫️",
     "role_id": "1528418114780397588",
     "desc": "Les ombres murmurent des vérités.",
     "creed": "Tends l'oreille : les murs murmurent, et le Voile traduit. Ceux qui l'écoutent "
              "apprennent des vérités que les autres préfèrent ne pas connaître."},
    {"key": "libre", "label": "Libre-penseur", "emoji": "🎲",
     "role_id": "1528418315280584764",
     "desc": "Aucun maître, aucun dogme.",
     "creed": "Dieux, sceaux, prophéties : du folklore pour veillées d'auberge. Le Libre-penseur "
              "ne doit rien à personne et compte bien le rester."},
]


def faith_choices():
    return [(f["key"], f["label"], f.get("emoji"), f.get("desc")) for f in FAITHS]


def faith_label(faith_key):
    for f in FAITHS:
        if f["key"] == faith_key:
            return f["label"]
    return faith_key


def faith_role_id(faith_key):
    for f in FAITHS:
        if f["key"] == faith_key:
            return f.get("role_id")
    return None


def all_faith_role_ids():
    return {int(f["role_id"]) for f in FAITHS if f.get("role_id")}


def race_choices():
    return [(k, v["label"], v.get("emoji")) for k, v in RACES.items()]


def gender_choices():
    return list(GENDERS)


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


def race_role_id(race_key):
    r = RACES.get(race_key)
    return r.get("role_id") if r else None


def all_race_role_ids():
    return {int(r["role_id"]) for r in RACES.values() if r.get("role_id")}


def gender_label(gender):
    return {"m": "Homme", "f": "Femme"}.get(gender, gender)


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


def _firstname(race, gender):
    pattern = random.choice(race["patterns"])
    suffixes = race.get(f"suffixes_{gender}") or race.get("suffixes_m") or [""]
    pools = {"P": race["prefixes"], "R": race["roots"], "S": suffixes}
    out = "".join(random.choice(pools[ch]) for ch in pattern)
    return _cap(out) or _cap(random.choice(race["roots"]))


def _origin(race, origin_key):
    for o in race.get("origins", []):
        if o["key"] == origin_key:
            return o
    return race.get("origins", [{}])[0] if race.get("origins") else {}


def generate(race_key, origin_key, trait_key, gender="m"):
    """Assemble un nom genré : prénom + composants accordés, selon une structure tirée
    au sort. ``gender`` = ``m`` ou ``f``."""
    race = RACES.get(race_key)
    trait = TRAITS.get(trait_key)
    if not race or not trait:
        return None
    places = _origin(race, origin_key).get("places") or [""]
    comps = {
        "first": _firstname(race, gender),
        "epithet": _pick(random.choice(trait["epithets"]), gender),
        "place": random.choice(places),
        "title": _pick(random.choice(TITLES + race.get("titles", [])), gender),
        "ordinal": _pick(random.choice(ORDINALS), gender),
    }
    templates, weights = zip(*STRUCTURES)
    tpl = random.choices(templates, weights=weights, k=1)[0]
    return " ".join(tpl.format(**comps).split())
