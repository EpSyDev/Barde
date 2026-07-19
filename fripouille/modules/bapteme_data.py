"""Données + moteur du générateur de noms « baptême » (données pures, sans Discord).

Combinatoire curée : quelques centaines de fragments → millions de combinaisons.
Les axes FAÇONNENT le nom :
- **Race** → la phonétique (assemblage préfixe/racine/suffixe par patrons P/R/S).
- **Origine** (sous-catégorie de la race) → le **lieu** d'origine accolé au nom.
- **Trait** → l'**épithète**.

En plus, la **structure** du nom est tirée au sort parmi plusieurs patrons
(``STRUCTURES``) : prénom seul, prénom + épithète, avec titre, avec lieu, avec
ordinal de lignée, forme à virgule… → casse la répétition « Prénom épithète lieu ».
Un patron phonétique combine ``P`` = préfixe, ``R`` = racine, ``S`` = suffixe.
"""
import random

UNIVERS = "fantasy"

# --- Titres (préfixés au prénom) et ordinaux de lignée (suffixés) ---
TITLES = [
    "Sieur", "Dame", "Maître", "Messire", "Capitaine", "Doyen", "Vénérable",
    "le Vieux", "le Jeune", "Baron", "Frère", "Sœur", "l'Ermite", "Sire", "Dom",
]
ORDINALS = [
    "Premier du Nom", "le Second", "III du Nom", "IV du Nom", "l'Aîné", "le Cadet",
    "l'Ancien", "le Dernier", "Deux-Fois-Né", "le Revenu",
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

# --- Races : phonétique + origines (sous-catégories, chacune son pool de lieux) ---
RACES = {
    "humain": {
        "label": "Humain", "emoji": "🛡️",
        "titles": ["Sire", "Chevalier", "Écuyer"],
        "prefixes": ["Ald", "Ber", "Cor", "Ed", "Gau", "Rob", "Thi", "Guil", "Ren", "Bau",
                     "Wil", "Hug", "Ans", "Bert", "God", "Roul", "Aim", "Fol"],
        "roots": ["ric", "mund", "bert", "wald", "fried", "hard", "mar", "win", "gis", "and",
                  "mer", "roy", "bald", "gar", "helm", "frid"],
        "suffixes": ["", "in", "on", "aud", "el", "ric", "and", "ier", "ot"],
        "patterns": ["PR", "PR", "PRS", "PRS"],
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
        "label": "Elfe", "emoji": "🏹",
        "titles": ["Gardien", "l'Immortel", "Sylphe"],
        "prefixes": ["Ae", "El", "Sil", "Cael", "Lith", "Fae", "Ithil", "Ny", "Aer", "Gala",
                     "Thal", "Ela", "Aran", "Cel", "Mith", "Eär", "Lor", "Fin"],
        "roots": ["thas", "riel", "andir", "wen", "loth", "mir", "dae", "sar", "vyn", "thil",
                  "lian", "neth", "gala", "dor", "wë", "los"],
        "suffixes": ["", "iel", "ion", "as", "wyn", "ith", "ael", "'iel", "wë", "dil"],
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
        "label": "Nain", "emoji": "⛏️",
        "titles": ["Maître-Forgeron", "le Barbu", "Thane"],
        "prefixes": ["Thor", "Dur", "Bal", "Grim", "Khaz", "Bru", "Thra", "Nor", "Dwal", "Gor",
                     "Bom", "Krag", "Bof", "Dain", "Thra", "Bard", "Ori", "Gloi"],
        "roots": ["gan", "din", "mund", "rak", "bek", "dush", "gar", "nar", "thok", "grim",
                  "buld", "dhr", "dur", "bur", "gnar", "throm"],
        "suffixes": ["", "son", "i", "ar", "uz", "grim", "bek", "dun", "mir"],
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
        "label": "Orc", "emoji": "🪓",
        "titles": ["Chef-de-Guerre", "le Balafré", "Broyeur"],
        "prefixes": ["Gro", "Mok", "Ur", "Gash", "Zug", "Nar", "Brak", "Dro", "Ghor", "Sna",
                     "Rok", "Vha", "Grum", "Skar", "Uz", "Drak", "Mog", "Ghaz"],
        "roots": ["gash", "dar", "mok", "thak", "nak", "rok", "zug", "dur", "gul", "rag",
                  "grum", "shak", "burz", "muk", "ghor", "krak"],
        "suffixes": ["", "nak", "zg", "ish", "ar", "gul", "thok", "dush", "mog"],
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
        "label": "Fée", "emoji": "🧚",
        "titles": ["Reine", "Sylphide", "le Petit"],
        "prefixes": ["Lil", "Fae", "Pae", "Twi", "Dew", "Bel", "Nim", "Sil", "Vio", "Thi",
                     "Ely", "Ari", "Mel", "Ros", "Cin", "Pim"],
        "roots": ["le", "wyn", "ora", "belle", "ia", "thel", "dew", "mist", "fae", "lira",
                  "sy", "nia", "pet", "lil", "bloom", "sha"],
        "suffixes": ["", "wyn", "elle", "ia", "ling", "let", "belle", "dew"],
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
        "label": "Gnome", "emoji": "🔧",
        "titles": ["Bricoleur", "Professeur", "le Petit"],
        "prefixes": ["Fizz", "Wren", "Nim", "Bix", "Cog", "Zook", "Gimble", "Nack", "Dabble",
                     "Snik", "Turl", "Bram", "Fim", "Wid", "Bop", "Tink"],
        "roots": ["le", "wick", "er", "it", "o", "in", "el", "by", "gle", "ver",
                  "ny", "ic", "am", "ot", "iz"],
        "suffixes": ["", "le", "ni", "ock", "ix", "gle", "widd", "bo"],
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
        "label": "Dragon", "emoji": "🐉",
        "titles": ["l'Ailé", "Seigneur", "l'Ancien"],
        "prefixes": ["Vor", "Rha", "Kaz", "Draa", "Sar", "Vex", "Nyx", "Tha", "Zar", "Aur",
                     "Gor", "Rex", "Xar", "Vael", "Pyr", "Bal"],
        "roots": ["xis", "thor", "gon", "rax", "mir", "zar", "eth", "gath", "rys", "vok",
                  "dral", "nax", "gorn", "rok", "aeth"],
        "suffixes": ["", "ax", "is", "oth", "ar", "yx", "or", "ux"],
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
        "label": "Démon", "emoji": "😈",
        "titles": ["Archi-", "Seigneur", "le Damné"],
        "prefixes": ["Mal", "Bel", "Az", "Nyx", "Dis", "Vas", "Mor", "Ith", "Kaz", "Rav",
                     "Sael", "Ver", "Bael", "Xul", "Gra", "Zeph"],
        "roots": ["zeth", "ael", "ith", "mor", "phas", "rok", "neth", "zar", "gloth", "vane",
                  "rix", "sius", "goth", "azel", "phel"],
        "suffixes": ["", "eth", "os", "ael", "ix", "us", "oth"],
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
        "label": "Vampire", "emoji": "🧛",
        "titles": ["Comte", "Comtesse", "le Sans-Âge"],
        "prefixes": ["Vlad", "Dra", "Carm", "Alu", "Lucr", "Cassi", "Vane", "Ortho", "Mor",
                     "Ser", "Nyx", "Bela", "Rad", "Vesp", "Cor", "Sang"],
        "roots": ["cul", "mir", "eska", "vane", "dor", "lena", "thas", "viel", "gore", "nox",
                  "rian", "sang", "mort", "ula", "cinth"],
        "suffixes": ["", "escu", "a", "ov", "ine", "us", "eth"],
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
        "label": "Loup-garou", "emoji": "🐺",
        "titles": ["Alpha", "le Grand", "Traqueur"],
        "prefixes": ["Fen", "Grey", "Ulr", "Rag", "Bjor", "Sköll", "Vark", "Lup", "Cana",
                     "Hati", "Ronce", "Croc", "Fang", "Loup", "Mord", "Snar"],
        "roots": ["rir", "mane", "fang", "garic", "mund", "var", "grim", "ulf", "mar", "nir",
                  "loup", "hurle", "gueule", "croc", "rôde"],
        "suffixes": ["", "ulf", "gar", "mane", "son", "ric", "croc"],
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

# trait → épithète accolée au nom.
TRAITS = {
    "brave": {"label": "Brave", "emoji": "⚔️", "epithets": [
        "le Vaillant", "Cœur-de-Lion", "l'Intrépide", "Brise-Bouclier", "le Hardi",
        "sans Peur", "Taille-Géant", "le Rempart", "Poing-de-Fer", "le Lion",
        "Front-d'Acier", "le Preux", "Brise-Lances", "Mâchoire-Serrée", "le Fier", "l'Audacieux"]},
    "ruse": {"label": "Rusé", "emoji": "🦊", "epithets": [
        "le Malin", "l'Ombre", "aux Mille Tours", "Langue-d'Argent", "le Filou",
        "Doigts-Agiles", "le Renard", "Pied-Feutré", "le Caméléon", "Vif-d'Esprit",
        "Double-Jeu", "le Fourbe", "Sourire-en-Coin", "l'Anguille", "le Subtil", "Trois-Coups-d'Avance"]},
    "sage": {"label": "Sage", "emoji": "📜", "epithets": [
        "le Sage", "l'Érudit", "aux Yeux Clairs", "le Contemplatif", "Barbe-Grise",
        "le Devin", "Porte-Savoir", "l'Ancien", "aux Mille Livres", "le Lucide",
        "Voix-Posée", "le Songeur", "Front-Pensif", "l'Éclairé", "Garde-Mémoire", "le Patient"]},
    "sombre": {"label": "Sombre", "emoji": "🌑", "epithets": [
        "le Ténébreux", "des Cendres", "Porte-Deuil", "le Maudit", "l'Endeuillé",
        "Nuit-Profonde", "le Corbeau", "Sang-Froid", "l'Éclipse", "le Silencieux",
        "Ombre-Longue", "le Sépulcral", "Voile-Noir", "l'Oublié", "Cœur-de-Suie", "le Funeste"]},
    "farceur": {"label": "Farceur", "emoji": "🎭", "epithets": [
        "le Fripon", "Pied-Léger", "le Bouffon", "Trouble-Fête", "la Pie",
        "Grelot", "le Chahuteur", "Nez-Rouge", "le Cabotin", "Deux-Chopes",
        "Tourne-Boule", "le Blagueur", "Pince-sans-Rire", "Culbuto", "le Farfadet", "Gros-Rire"]},
    "noble": {"label": "Noble", "emoji": "👑", "epithets": [
        "le Juste", "au Grand Cœur", "le Loyal", "Main-Ouverte", "le Digne",
        "Front-Haut", "le Courtois", "l'Honorable", "Verbe-d'Or", "le Généreux",
        "Cœur-Pur", "le Bienveillant", "Parole-Tenue", "le Magnanime", "Port-Altier", "l'Intègre"]},
    "sauvage": {"label": "Sauvage", "emoji": "🐺", "epithets": [
        "le Farouche", "Crocs-Nus", "l'Indompté", "Griffe-Rapide", "le Rôdeur",
        "Souffle-de-Loup", "l'Écorché", "Pied-de-Fauve", "le Traqueur", "Poil-Hérissé",
        "Sang-Bouillant", "Œil-de-Lynx", "le Primitif", "Mord-Vent", "l'Insaisissable", "Crin-au-Vent"]},
    "mystique": {"label": "Mystique", "emoji": "🔮", "epithets": [
        "le Voilé", "aux Runes", "Tisse-Sorts", "l'Illuminé", "Œil-d'Astral",
        "le Prophète", "aux Mains Bleues", "l'Arcaniste", "Murmure-d'Étoiles", "le Visionnaire",
        "Porte-Grimoire", "l'Éthéré", "Doigts-de-Lune", "le Sibyllin", "Voix-des-Vents", "l'Initié"]},
    "vengeur": {"label": "Vengeur", "emoji": "🗡️", "epithets": [
        "l'Implacable", "Brise-Serment", "la Lame Froide", "Sang-pour-Sang", "l'Inflexible",
        "le Marqué", "Dette-de-Sang", "l'Ombre Vengeresse", "Œil-pour-Œil", "le Rancunier",
        "Fer-Rouge", "le Poursuivant", "Cœur-de-Fiel", "la Nemesis", "l'Inexorable", "Jamais-Pardon"]},
    "ardent": {"label": "Ardent", "emoji": "🔥", "epithets": [
        "le Flamboyant", "Cœur-de-Braise", "l'Emporté", "Souffle-de-Feu", "le Bouillant",
        "l'Incandescent", "Poing-Ardent", "la Torche", "l'Insatiable", "Sang-Chaud",
        "le Fougueux", "Étincelle", "Brûle-Tout", "l'Enflammé", "Verbe-Haut", "le Volcanique"]},
    "stoique": {"label": "Stoïque", "emoji": "🗿", "epithets": [
        "l'Imperturbable", "Roc-Immobile", "le Patient", "Face-de-Pierre", "l'Endurant",
        "le Taciturne", "Épaules-Larges", "le Constant", "l'Inébranlable", "Souffle-Égal",
        "le Posé", "Marbre-Froid", "l'Immuable", "Nerfs-d'Acier", "le Flegmatique", "Assise-Ferme"]},
    "errant": {"label": "Errant", "emoji": "🧭", "epithets": [
        "le Vagabond", "Sans-Attache", "l'Éternel Voyageur", "Semelle-de-Vent", "le Nomade",
        "aux Mille Routes", "l'Exilé", "Pas-Léger", "le Solitaire", "Sans-Racines",
        "le Passant", "Poussière-de-Route", "l'Égaré", "Boussole-Folle", "le Sans-Pays", "Cœur-Ailleurs"]},
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
    """Assemble un nom : prénom (phonétique race) + composants, selon une structure tirée
    au sort (titre / épithète / lieu d'origine / ordinal de lignée)."""
    race = RACES.get(race_key)
    trait = TRAITS.get(trait_key)
    if not race or not trait:
        return None
    places = _origin(race, origin_key).get("places") or [""]
    comps = {
        "first": _firstname(race),
        "epithet": random.choice(trait["epithets"]),
        "place": random.choice(places),
        "title": random.choice(TITLES + race.get("titles", [])),
        "ordinal": random.choice(ORDINALS),
    }
    templates, weights = zip(*STRUCTURES)
    tpl = random.choices(templates, weights=weights, k=1)[0]
    return " ".join(tpl.format(**comps).split())
