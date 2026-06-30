"""Banque d'ambiance du « coin des voyageurs » : voix, monologues, saynètes, interpellations.

AUCUNE logique ici — uniquement le CONTENU. Le moteur (ambient.py, à venir) piochera
dans ces listes. Tout est pré-écrit : coût d'inférence nul en fonctionnement normal et
contrôle total de ce qui se dit (zéro risque de fuite de quête).

RÈGLE D'OR DE LA BANQUE
-----------------------
On ne nomme JAMAIS l'hydre, la cave scellée, la quête, une énigme, un Sceau ni le Nom
Premier. Ce ne sont pas des sujets de comptoir. On pose seulement l'AMBIANCE et on
« pré-sème » discrètement les LIEUX (forêt, port, mine, bibliothèque, clairière) pour
qu'ils soient déjà familiers le jour où les quêtes s'ouvriront. Une rumeur de comptoir,
pas une convocation.

Repères de « pré-semis » (champ `seeds`) :
    ""          ambiance pure (route, temps, voyages, comptoir)
    "foret"     la forêt des Murmures        → prépare l'Ermite
    "port"      le port brumeux              → prépare le Marin Maudit
    "mine"      la mine abandonnée           → prépare le Mineur Fou
    "biblio"    la bibliothèque interdite    → prépare l'Archiviste
    "clairiere" la clairière de la Pythie    → prépare la Pythie

Jetons de « voix » (champ `by`) :
    un key de PNJ nommé : "aubergiste", "marchand", "ombre", "pythie", "marin", "heraut"
    "voyageur"          : un inconnu de passage, tiré au hasard dans TRAVELERS
    "voyageur1"/"voyageur2" : deux inconnus DISTINCTS (utile dans une saynète à 2 anonymes)
"""
from dataclasses import dataclass, field

# Lieux reconnus pour le pré-semis (sert de garde-fou côté moteur).
SEEDS = ("", "foret", "port", "mine", "biblio", "clairiere")


# ─────────────────────────────────────────────────────────────────────────────
# 1) VOIX
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Sig:
    """Réplique signature propre à une voix (texte + lieu éventuellement pré-semé)."""
    text: str
    seeds: str = ""


@dataclass(frozen=True)
class Voice:
    """Une identité affichée par webhook (nom + avatar + répliques signature)."""
    name: str
    # Nom de variable .env contenant une URL d'avatar. Vide = avatar par défaut du webhook.
    avatar_env: str = ""
    # Répliques propres à CE personnage (collent à son identité visuelle). Le moteur
    # les préfère quand il fait parler ce voyageur ; à défaut il pioche un monologue
    # générique (« voyageur »).
    lines: tuple[Sig, ...] = ()


# Inconnus de passage. Le sel des « gens de passage » : on les croise une fois,
# ils repartent. Identités calées sur les 12 portraits de media/voyageurs/
# (voyageur_01.png … voyageur_12.png, dans l'ordre exact ci-dessous).
TRAVELERS: list[Voice] = [
    Voice("Un vieux rôdeur en cape verte", "VOY_AVATAR_1", lines=(
        Sig("Quarante ans à crapahuter sur les routes des Mondes, et la seule chose qui "
            "me file encore la chair de poule, c'est la forêt à l'ouest. Elle se souvient, "
            "cette forêt. De tout.", "foret"),
        Sig("Marche doucement, parle bas, ne coupe jamais à travers ce que tu ne connais "
            "pas. Quarante ans de route tiennent dans ces trois conseils, voyageur."),
        Sig("J'ai dormi sous plus d'étoiles qu'un roi n'a de sujets. Et pas une seule nuit "
            "ne valait le coin de feu d'une auberge honnête. *tend les mains vers l'âtre*"),
        Sig("Le froid de ce matin m'a transpercé jusqu'à l'os. Les saisons se détraquent, "
            "au Carrefour. Du temps de ma jeunesse, l'hiver savait encore attendre son tour."),
        Sig("Tu vois cette cape ? Elle a connu douze Mondes et trois guerres. Elle me "
            "survivra, et c'est très bien. On lègue ce qu'on est, pas ce qu'on possède."),
    )),
    Voice("Une alchimiste elfe", "VOY_AVATAR_2", lines=(
        Sig("*fait tourner une fiole où danse une lueur verte* Trois gouttes dans ta chope "
            "et tu verrais l'invisible… non, garde ton or. Certaines visions, on ne devrait "
            "pas pouvoir les acheter."),
        Sig("Il est une clairière, plus à l'est, où les songes deviennent nets comme du "
            "verre. J'y suis allée une fois. Je n'y retournerai pas seule.", "clairiere"),
        Sig("Je cherche une mousse qui ne pousse qu'au pied des pierres très anciennes. "
            "Rare. Capricieuse. Comme tout ce qui vaut la peine d'être cueilli."),
        Sig("*te dévisage un instant de trop* Tu as une drôle de couleur autour de toi, "
            "voyageur. Non, ce n'est rien. …Ou tout. Bois donc, oublie ce que j'ai dit."),
        Sig("On me demande souvent la recette. Je réponds toujours pareil : la recette n'est "
            "rien, c'est la main qui la tient qui fait le poison ou le remède."),
    )),
    Voice("Un nain forgeron", "VOY_AVATAR_3", lines=(
        Sig("Je reconnais une bonne roche rien qu'à l'oreille, en la cognant. Et la roche "
            "de la vieille mine, au nord, elle sonne faux. Creux. Comme s'il y avait autre "
            "chose, derrière la pierre.", "mine"),
        Sig("Une lame, ça se respecte. Apporte-moi du fer franc et je t'en forge une qui te "
            "survivra. *fait claquer son marteau sur l'enclume imaginaire*"),
        Sig("Vous autres, les gens d'en haut, vous creusez pour l'or. Nous, on creuse pour "
            "comprendre la montagne. C'est pour ça qu'on sait quand il faut s'arrêter."),
        Sig("*vide sa chope d'un trait* Encore ! Une bière de nain tient debout toute seule, "
            "mais celle-ci fera l'affaire pour un gosier de surface comme le mien."),
        Sig("Mon grand-père disait : il y a des galeries qu'on rouvre, et d'autres qu'on a "
            "murées pour de bonnes raisons. Sa génération savait faire la différence. Plus "
            "la nôtre.", "mine"),
    )),
    Voice("Une servante d'auberge", "VOY_AVATAR_4", lines=(
        Sig("J'ai servi dans dix auberges des dix Mondes, et je vais te confier un secret : "
            "ce sont toujours les plus silencieux qui filent sans payer. Toi, t'as une "
            "bonne tête. Je te sers ?"),
        Sig("Ma table préférée ? Près du feu, dos au mur, vue sur la porte. Au Carrefour, "
            "on ne sait jamais qui va pousser le battant."),
        Sig("Hier soir, un homme a payé sa tournée avec une pièce d'un royaume qui n'existe "
            "plus. Le tavernier l'a gardée. Moi, j'aurais pas. Ça porte malheur, ces choses-là."),
        Sig("Les buveurs se ressemblent partout : les gens de l'Est noient leur joie, ceux "
            "du Nord leur colère, et ici, au Carrefour, on noie surtout l'envie de rentrer."),
        Sig("*pose une chope fumante* Tiens, sur le compte de la maison. T'as marché loin, "
            "ça se voit à tes bottes. Repose tes jambes, l'étranger, la route attendra."),
    )),
    Voice("Une dame voilée", "VOY_AVATAR_5", lines=(
        Sig("*baisse la voix derrière son voile* Je ne devrais pas être ici. Disons que "
            "certains murs, dans certains palais, ont fini par devenir trop minces pour mes "
            "secrets."),
        Sig("Ne me demandez pas mon nom, voyageur. Là d'où je viens, un nom n'est qu'une "
            "laisse plus longue que les autres."),
        Sig("Je suis arrivée par un port noyé de brume, sur une barque qui ne m'a rien "
            "demandé. Le passeur n'a pas voulu de mon or. Seulement mon silence.", "port"),
        Sig("*effleure un bijou sous son col* Ceci vaut plus que cette auberge entière. Et "
            "pourtant je l'échangerais sur l'heure contre une seule nuit sans regarder la porte."),
        Sig("On laisse toujours quelque chose derrière soi quand on fuit. Un trône, un "
            "visage, un mensonge confortable. Moi ? Je préfère ne pas y penser ce soir."),
    )),
    Voice("Un vétéran balafré", "VOY_AVATAR_6", lines=(
        Sig("Cette cicatrice ? Un cadeau d'une bataille dont plus personne ne se souvient. "
            "Voilà le pire, gamin : pas les coups. L'oubli."),
        Sig("On dit qu'un vieux champ de bataille, pas loin d'ici, est encore gardé par son "
            "général tombé. *touche du bois* Bah. Les morts ne donnent plus d'ordres. "
            "J'espère."),
        Sig("J'avais douze frères d'armes. Douze. Je bois pour chacun d'eux, un soir sur "
            "douze. Ce soir, c'est pour Garrec. Il riait fort. Trop fort, peut-être."),
        Sig("Tu veux un conseil de vieux soldat ? Ne sois jamais le plus courageux de la "
            "pièce. Le plus courageux, c'est toujours lui qu'on enterre en premier."),
        Sig("*fixe le fond de sa chope* Y'a une bataille à laquelle je repense chaque nuit. "
            "Je n'en parlerai pas. Sers-moi plutôt de quoi la noyer encore une fois."),
    )),
    Voice("Un ménestrel de passage", "VOY_AVATAR_7", lines=(
        Sig("*gratte son luth* Une pièce et je chante ; deux et j'oublie ce que j'ai vu sur "
            "la route. Crois-moi, voyageur, certains soirs c'est la deuxième pièce qui vaut "
            "le plus cher."),
        Sig("J'ai une complainte sur un port où la brume avale les navires entiers. Le "
            "public en raffole. Le hic ? Cette chanson-là, je ne l'ai pas inventée.", "port"),
        Sig("Un ménestrel ne possède rien sauf ses chansons — et les histoires qu'il vole "
            "aux tablées comme la vôtre. *cligne de l'œil* Alors, racontez. J'écoute toujours."),
        Sig("*accorde une corde rétive* Quelle Terre d'Origine, l'ami ? Donne-moi ton Monde "
            "et je te trouve une mélodie. J'en ai une pour chacun. Même pour les disparus."),
        Sig("J'ai chanté dans des cours et des cachots, et je vais te dire : c'est dans les "
            "tavernes qu'on écoute vraiment. Ici, au moins, on pleure sans honte."),
    )),
    Voice("Un chasseur elfe", "VOY_AVATAR_8", lines=(
        Sig("Je piste tout ce qui marche, rampe ou vole. Mais dans la forêt des Murmures, "
            "deux fois j'ai suivi des traces fraîches… qui s'arrêtaient net au milieu de "
            "nulle part. Aucune bête ne disparaît comme ça.", "foret"),
        Sig("Garde ton arc tendu et tes flèches sèches, étranger. Le Carrefour nourrit des "
            "bêtes qu'aucun bestiaire n'ose nommer."),
        Sig("J'ai traqué trois nuits une créature dont je n'ai jamais vu que l'ombre. À "
            "l'aube, c'est elle qui m'attendait. *touche une entaille à son carquois* On a "
            "convenu de ne plus se croiser."),
        Sig("La patience, voilà ce que vous, les éphémères, ne comprenez pas. Une bonne "
            "chasse se prépare sur une saison. Une vie d'homme, c'est à peine un automne."),
        Sig("Le ciel était rouge ce matin. Mauvais présage pour qui chasse. Alors je bois, "
            "j'attends, et je laisse la forêt respirer sans moi un jour de plus.", "foret"),
    )),
    Voice("Un gamin des rues", "VOY_AVATAR_9", lines=(
        Sig("Une pièce et j'te dis tout c'qui s'raconte ici ! …Bon, deux. *sourire en coin* "
            "J'ai entendu un grand causer d'une mine qui crache de la fumée toute seule, "
            "alors qu'plus personne y descend.", "mine"),
        Sig("J'dors sous les tables et j'écoute. Tu s'rais surpris de c'que les grands "
            "lâchent quand ils croient qu'un môme pige rien."),
        Sig("*fait rouler une bague entre ses doigts* Ça ? J'l'ai… trouvée. Ouais. Par "
            "terre. Juste à côté d'une poche. T'inquiète, j'la rendrai. P't-être."),
        Sig("Un jour j'aurai une épée et une cape, et on chantera mes exploits comme ceux "
            "des chevaliers ! En attendant, file-moi un quignon de pain, j'ai l'ventre qui "
            "crie."),
        Sig("Tu cherches quelqu'un, dans la taverne ? Pour trois pièces, j'le retrouve. "
            "J'connais tous les recoins, toutes les portes, et même celles qu'on croit "
            "fermées. *clin d'œil*"),
    )),
    Voice("Une rôdeuse encapuchonnée", "VOY_AVATAR_10", lines=(
        Sig("*reste dans l'ombre de sa capuche* Je vois mieux quand on ne me voit pas. Et "
            "crois-moi, voyageur : ici, il n'y a pas que moi qui préfère rester invisible."),
        Sig("Un bon larcin, c'est comme un bon secret : ça ne profite qu'à celui qui sait "
            "se taire. *recule d'un pas et se fond presque dans le mur*"),
        Sig("Tu vois l'homme au fond, près de la porte ? Il surveille quelqu'un dans cette "
            "salle depuis une heure. *voix basse* J'espère pour toi que ce n'est pas toi."),
        Sig("L'information, voyageur, c'est la seule monnaie qui ne perd jamais sa valeur. "
            "J'en achète, j'en vends. Tu as quelque chose à me dire ? J'ai de quoi payer."),
        Sig("Méfie-toi des inconnus trop chaleureux dans une taverne au Carrefour. Les vrais "
            "dangers sourient toujours en premier. *te fixe* Comme moi, à l'instant."),
    )),
    Voice("Une chevaleresse aux cheveux d'argent", "VOY_AVATAR_11", lines=(
        Sig("J'ai rendu mon épée trois fois. Trois fois elle m'est revenue. Un serment, ça "
            "ne rouille pas, voyageur — même les jours où l'on voudrait."),
        Sig("On parle d'un champ, non loin, où un général tombé monte toujours la garde. "
            "S'il lui faut un soldat de plus… qu'il sache que cette vieille lame a déjà "
            "beaucoup donné."),
        Sig("Les jeunes chevaliers d'aujourd'hui confondent l'honneur avec le bruit qu'il "
            "fait. De mon temps, on jurait à voix basse et on mourait sans témoin."),
        Sig("*pose une main sur une vieille blessure à l'épaule* Celle-ci, je la dois à un "
            "siège qu'on raconte encore dans deux Mondes. La gloire reste. La douleur aussi."),
        Sig("Je m'entraîne encore chaque aube, avant que le soleil ne se lève. Le corps "
            "oublie vite ce que le serment veut se rappeler. Alors je lui rafraîchis la mémoire."),
    )),
    Voice("Un apprenti érudit", "VOY_AVATAR_12", lines=(
        Sig("*brandit un livre ouvert, les yeux brillants* Tu savais qu'il existerait une "
            "bibliothèque où TOUS les livres disent la vérité ?! Je donnerais dix ans de ma "
            "vie pour y poser un orteil ! …On me répète que c'est plus compliqué que ça.",
            "biblio"),
        Sig("Mon maître dit que le vrai savoir se mérite et ne s'achète jamais. Du coup je "
            "lis tout ce qui me tombe sous la main, au cas où. *rajuste ses lunettes*"),
        Sig("*tout excité* Écoute ça : il paraît que le Carrefour ne serait pas un lieu, "
            "mais un nœud — un point où tous les Mondes se touchent ! Fascinant, non ? "
            "…Personne ne veut jamais en parler avec moi."),
        Sig("J'ai perdu mon maître il y a trois jours. Enfin, perdu… il m'a dit de "
            "l'attendre ici et n'est jamais revenu. Je suppose que ça fait partie de la "
            "leçon. J'espère."),
        Sig("On murmure qu'un seul feuillet de la bibliothèque interdite suffirait à rendre "
            "fou ou sage. *frissonne d'envie* Quitte à choisir, je tenterais quand même.",
            "biblio"),
    )),
]

# Clés stables des 12 voyageurs (MÊME ORDRE que TRAVELERS). Permettent d'écrire des
# saynètes entre personnages PRÉCIS (jeton `by` = la clé), au lieu des anonymes
# `voyageur1`/`voyageur2`. Aucune collision avec les keys de PNJ.
TRAVELER_KEYS: tuple[str, ...] = (
    "rodeur", "alchimiste", "forgeron", "servante", "dame", "veteran",
    "menestrel", "chasseur", "gamin", "capuche", "chevaleresse", "erudit",
)
TRAVELERS_BY_KEY: dict[str, "Voice"] = dict(zip(TRAVELER_KEYS, TRAVELERS))


def traveler_by_key(key: str) -> "Voice | None":
    """Le voyageur correspondant à une clé stable (ou None)."""
    return TRAVELERS_BY_KEY.get(key)


# ─────────────────────────────────────────────────────────────────────────────
# 2) PROFIL « COMPTOIR » DES PNJ NOMMÉS  (la « force du profil pour l'IA »)
# ─────────────────────────────────────────────────────────────────────────────
# Ces textes ne servent QU'aux rares réactions live (quand un membre répond à un
# PNJ dans le coin des voyageurs). Ils ne remplacent PAS le prompt de quête des
# gardiens : ici, le PNJ est juste « de passage au comptoir » et ne parle de rien
# de sérieux. C'est volontairement léger.

AMBIENT_LORE = (
    "Tu es un personnage de « La Taverne du Gaming », une auberge médiévale épique posée "
    "au Carrefour des Mondes, territoire neutre où se croisent des voyageurs venus de "
    "Terres d'Origine différentes. Là, maintenant, tu n'es que de passage dans la salle "
    "commune — le coin des voyageurs. Tu papotes au comptoir, rien de plus.\n\n"
    "RÈGLES ABSOLUES :\n"
    "— Reste toujours dans ton rôle. Ne mentionne JAMAIS l'intelligence artificielle, "
    "Discord, les bots, les développeurs.\n"
    "— Tu n'évoques JAMAIS d'hydre, de cave scellée, de quête, d'énigme, de sceau ni de "
    "grand secret à percer : ce ne sont pas des sujets de comptoir, et tu changes de "
    "sujet en souriant si on t'y pousse.\n"
    "— Tu parles de la route, du temps qu'il fait, de tes voyages, de petites rumeurs "
    "anodines sur des contrées et des lieux lointains.\n"
    "— Français médiéval accessible, 1 à 3 phrases, sans listes ni markdown."
)

# key de PNJ → couleur de voix au comptoir (anecdotes, tics de langage, sujets favoris).
AMBIENT_FLAVOR: dict[str, str] = {
    "aubergiste": (
        "Tu es l'Aubergiste, maître des lieux. Au comptoir tu es chaleureux et bavard, "
        "tu sers, tu plaisantes, tu connais tout le monde. Tu lances volontiers la "
        "conversation et tu as toujours une anecdote sur un client d'hier. Tu glisses "
        "parfois qu'« il se passe de drôles de choses du côté de la forêt » sans en faire "
        "un drame — pure rumeur de tablée."
    ),
    "marchand": (
        "Tu es le Marchand des Mondes, de passage entre deux routes. Tu te plains des "
        "chemins, des taxes et des brigands, tu vantes des babioles de contrées lointaines. "
        "Mystérieux mais affable au comptoir, tu laisses entendre que tu as vu bien des "
        "lieux étranges — un port toujours noyé de brume, une mine que les gens fuient — "
        "sans jamais t'attarder."
    ),
    "ombre": (
        "Tu es l'Ombre. Nul ne te voit vraiment ; tu n'es qu'un murmure derrière l'épaule. "
        "Tu ne réponds jamais franchement : tu insinues, tu poses une question pour toute "
        "réponse, tu laisses planer. Tes phrases sont courtes et te donnent froid dans le "
        "dos. Tu disparais aussi vite que tu es venu."
    ),
    "pythie": (
        "Tu es la Pythie, de passage hors de ta clairière. Tu ne parles qu'en images et "
        "en demi-vers, comme si tu lisais l'avenir dans la mousse d'une chope. Inquiétante, "
        "douce et lointaine. Tu sembles toujours répondre à une question que personne n'a "
        "posée."
    ),
    "marin": (
        "Tu es le Marin Maudit, échoué là le temps d'un verre. Superstitieux, hanté, tu "
        "parles par présages et histoires de mer. Tu jures qu'au port brumeux tu as vu des "
        "choses que nul ne devrait voir, puis tu te tais, gêné d'en avoir trop dit."
    ),
    "heraut": (
        "Tu es le Héraut, qui passe parfois au comptoir entre deux annonces. Solennel "
        "même pour commander une bière, tu ponctues d'« Oyez ! » par pure habitude — tu "
        "t'en excuses et tu recommences aussitôt. Au repos tu es plus humain, presque drôle "
        "quand tu oublies ton emphase."
    ),
    "archiviste": (
        "Tu es l'Archiviste, attiré au comptoir bien malgré toi. Hautain, érudit, tu "
        "supportes mal le bruit et la foule, et tu le fais savoir ; tu rappelles que tu "
        "serais mieux dans tes rayonnages, et tu menaces sans cesse d'y remonter. Tu cites "
        "des textes que nul d'autre n'a lus."
    ),
    "mineur": (
        "Tu es le Mineur Fou, monté de la mine pour un verre, l'œil ailleurs. Décousu, "
        "exalté, tu donnes des prénoms aux objets et tu leur parles (ta chope « Berthe », ton "
        "tabouret « le Baron ») ; tu t'inquiètes de leur avis. Entre deux délires, tu lâches "
        "soudain une vérité d'une lucidité glaçante, puis tu repars dans le brouillard."
    ),
}


def ambient_system_prompt(persona_key: str) -> str:
    """Prompt système « mode comptoir » d'un PNJ nommé (réactions live uniquement)."""
    flavor = AMBIENT_FLAVOR.get(persona_key, "")
    if not flavor:
        return AMBIENT_LORE
    return f"{AMBIENT_LORE}\n\n--- TON PERSONNAGE, AU COMPTOIR ---\n{flavor}"


# ─────────────────────────────────────────────────────────────────────────────
# 3) MONOLOGUES  (une voix lâche une réplique d'ambiance)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Monologue:
    by: str           # key PNJ ou "voyageur"
    text: str
    seeds: str = ""   # voir SEEDS


MONOLOGUES: list[Monologue] = [
    # --- Ambiance pure -------------------------------------------------------
    Monologue("voyageur", "*secoue la pluie de sa cape* Trois jours de route et pas une "
              "auberge digne de ce nom avant celle-ci. Une chope, l'ami, et qu'elle soit pleine."),
    Monologue("voyageur", "On gèle dehors. Le Carrefour n'a jamais été aussi calme… ça "
              "ne me dit rien qui vaille, un calme pareil."),
    Monologue("aubergiste", "Approchez, approchez ! Le feu est bon et la bière est fraîche. "
              "Ici, d'où que vous veniez, vous êtes chez vous le temps d'un verre."),
    Monologue("voyageur", "J'ai croisé une caravane à l'aube. Personne dedans. Juste les "
              "chevaux qui avançaient tout seuls. *frisson* Buvons à autre chose."),
    Monologue("marchand", "Soie de l'Est, sel des marais, fioles qui changent de couleur "
              "selon l'humeur… j'ai de tout, voyageur. Sauf de la patience, alors décide-toi."),
    Monologue("heraut", "Oyez ! …Pardon. Vieille habitude. Sers-moi donc, je n'annonce rien "
              "ce soir — même un crieur a droit à son repos."),
    Monologue("voyageur", "Vous venez tous d'un monde différent et vous buvez à la même "
              "table. Drôle d'endroit, ce Carrefour. J'aime ça."),
    Monologue("pythie", "La chope est pleine, puis vide, puis pleine à nouveau. Tout revient, "
              "voyageur. Tout revient. *fixe le fond de son verre*"),
    Monologue("voyageur", "Quelqu'un a perdu un gant rouge près de la porte. Si c'est à toi… "
              "garde l'œil, on raconte que ce qu'on perd ici, on le retrouve ailleurs."),
    Monologue("ombre", "*depuis un coin sombre* Beaucoup de monde, ce soir. C'est quand il y "
              "a foule qu'on remarque le moins… qui manque."),

    # --- Pré-semis : la forêt ------------------------------------------------
    Monologue("voyageur", "Évitez la forêt à l'ouest si vous tenez à vos oreilles. Ça "
              "murmure là-dedans. Des mots, presque. Comme si les arbres se souvenaient.",
              seeds="foret"),
    Monologue("aubergiste", "Une vieille femme vivrait au cœur de la forêt des Murmures, "
              "paraît-il. Moi je n'y ai jamais mis les pieds — j'aime trop mes habitudes "
              "et mon comptoir.", seeds="foret"),
    Monologue("marchand", "J'ai voulu couper par la forêt pour gagner un jour. J'en ai perdu "
              "trois. Les sentiers s'y déplacent, je vous jure que les sentiers bougent.",
              seeds="foret"),

    # --- Pré-semis : le port -------------------------------------------------
    Monologue("marin", "Au port brumeux, on n'voit pas sa propre main au bout du bras. Et "
              "parfois, dans la brume… on voit la main d'un autre. *crache par terre*",
              seeds="port"),
    Monologue("voyageur", "Un batelier m'a déposé près d'un port noyé de brouillard. Il n'a "
              "pas voulu accoster. Il a juste dit : « pas ce port-là, pas ce soir » et il "
              "est reparti.", seeds="port"),
    Monologue("marchand", "Les meilleures affaires se font au port brumeux. Les pires "
              "rencontres aussi. Va savoir laquelle des deux t'y attend.", seeds="port"),

    # --- Pré-semis : la mine -------------------------------------------------
    Monologue("voyageur", "On dit qu'une mine, au nord, gronde encore alors qu'on n'y "
              "creuse plus depuis cent ans. Moi je dis : si la roche parle, faut pas "
              "l'écouter répondre.", seeds="mine"),
    Monologue("ombre", "*murmure* La mine abandonnée n'est pas si abandonnée. Quelqu'un "
              "y rit, tout au fond. Tout seul. Toute la nuit.", seeds="mine"),
    Monologue("aubergiste", "Un type est descendu de la mine la semaine passée, blanc comme "
              "un linge. Il répétait qu'il avait « entendu les voix s'accorder ». J'lui ai "
              "offert sa tournée et je n'ai pas posé de question.", seeds="mine"),

    # --- Pré-semis : la bibliothèque ----------------------------------------
    Monologue("voyageur", "On parle d'une bibliothèque qu'aucune porte n'ouvre. Les livres y "
              "seraient si vrais qu'on n'a pas le droit de les lire. Pff. Histoires pour "
              "endormir les apprentis.", seeds="biblio"),
    Monologue("marchand", "J'achèterais cher un seul feuillet de la bibliothèque interdite. "
              "Mais on n'y entre pas avec de l'or — seulement, dit-on, avec de l'esprit.",
              seeds="biblio"),

    # --- Pré-semis : la clairière de la Pythie -------------------------------
    Monologue("pythie", "Il est une clairière où les questions reviennent en écho avant "
              "qu'on les pose. J'y retourne toujours. On y retourne toujours.",
              seeds="clairiere"),
    Monologue("voyageur", "Une femme dans une clairière m'a dit mon avenir sans que je "
              "demande rien. Le pire ? Elle avait raison sur hier. J'ose pas vérifier "
              "pour demain.", seeds="clairiere"),

    # --- Gags des PNJ nommés (humour typique du lore) ------------------------
    Monologue("heraut", "Oyez, oyez ! Une… *se reprend* …une bière. Juste une bière. Sans "
              "« oyez ». *un silence* …Oyez quand même."),
    Monologue("heraut", "Ce soir je ne crie rien. Rien du tout. Discrétion totale. *prend "
              "une inspiration, se ravise* …non, rien. Vous avez vu ? J'ai réussi. *fier*"),
    Monologue("marchand", "*déballe un caillou* Ceci, voyageur, est un fragment de la lune "
              "d'un Monde aujourd'hui éteint. Trois pièces. …Deux. …Bon, garde ta monnaie, "
              "mais tu me revaudras ça."),
    Monologue("marchand", "Un bouton. Oui. Mais un bouton PORTE-BONHEUR, garanti deux lunes. "
              "Le dernier client qui a refusé ? *baisse la voix* …il a eu de la pluie toute "
              "la semaine. Réfléchis bien."),
    Monologue("aubergiste", "On me demande souvent depuis quand je tiens cette taverne. "
              "*essuie une chope, l'air ailleurs* Oh… disons que j'ai connu d'autres métiers, "
              "dans une autre vie. Mais ça, c'est une histoire pour une autre tournée."),
    Monologue("pythie", "Toi. *te fixe* Tu vas renverser ta chope. …Non, pas tout de suite. "
              "*attend* …Maintenant. *flac* Je sais. Je sais toujours."),
    Monologue("mineur", "*chuchote à sa chope* T'entends, Berthe ? Y'a du monde ce soir. "
              "*à toi* Berthe trouve que t'as une tête honnête. Le Baron, lui, se méfie. "
              "Le Baron se méfie de tout le monde. C'est un tabouret bien."),
    Monologue("archiviste", "Du bruit, des rires, de la bière renversée jusque sur les "
              "tables… Comment voulez-vous PENSER, ici ?! *se lève* Non. Je remonte. Je n'ai "
              "rien à faire parmi les vivants.", seeds="biblio"),
    Monologue("marin", "Laissez-moi vous conter le jour où j'ai vu… *s'arrête, perdu* …où "
              "j'ai vu… *fronce les sourcils* …Pardon. Où en étais-je ? Ah. Une chope. Ça, au "
              "moins, je m'en souviens.", seeds="port"),
    Monologue("ombre", "*d'un coin où il n'y a personne* Tu accroches ta cape ici, voyageur ? "
              "Sur moi ? …Charmant. Vraiment. Je note."),
]


# ─────────────────────────────────────────────────────────────────────────────
# 4) SAYNÈTES  (deux voix échangent, les membres assistent)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Line:
    by: str
    text: str


@dataclass(frozen=True)
class Scene:
    title: str               # repère interne (jamais affiché)
    turns: list[Line]        # 2 à 4 répliques alternées
    seeds: str = ""


SCENES: list[Scene] = [
    Scene("comptoir-aubergiste-marchand", seeds="", turns=[
        Line("marchand", "Aubergiste ! Ta meilleure bière, et ne me ressers pas la piquette "
             "de la dernière fois."),
        Line("aubergiste", "La dernière fois tu as payé en boutons de cuivre, marchand. À "
             "piquette, monnaie de singe. *rires*"),
        Line("marchand", "Touché. Tiens — de l'argent vrai. Et garde la monnaie, j'ai vu pire "
             "accueil dans des palais."),
    ]),

    Scene("rumeur-foret", seeds="foret", turns=[
        Line("voyageur1", "Tu l'entends, toi aussi ? On dirait que ça vient de la forêt à "
             "l'ouest. Comme des chuchotements."),
        Line("voyageur2", "C'est le vent dans les branches, rien d'autre. Bois et tais-toi."),
        Line("voyageur1", "Le vent ne connaît pas mon nom. Tout à l'heure… j'ai cru qu'on "
             "m'appelait."),
    ]),

    Scene("port-marin-marchand", seeds="port", turns=[
        Line("marin", "Tu repars par le port, marchand ? À ta place j'attendrais que la brume "
             "se lève. Si elle se lève."),
        Line("marchand", "Le commerce n'attend pas la brume, vieux loup. Qu'as-tu vu là-bas "
             "qui te fasse cette tête ?"),
        Line("marin", "*baisse la voix* Des lumières sur l'eau, sans bateau dessous. J'en ai "
             "pas dormi depuis. N'y va pas de nuit."),
    ]),

    Scene("mine-ombre", seeds="mine", turns=[
        Line("voyageur", "On raconte que la vieille mine gronde encore. Foutaises, non ?"),
        Line("ombre", "*tout bas, sans qu'on sache d'où* …Va vérifier. Descends. Écoute. "
             "Et surtout — ne réponds pas quand ça t'appellera."),
        Line("voyageur", "Qui… qui a dit ça ? *se retourne, personne*"),
    ]),

    Scene("clairiere-pythie", seeds="clairiere", turns=[
        Line("voyageur", "Madame ? Vous fixez le feu depuis une heure sans boire. Tout va bien ?"),
        Line("pythie", "Trois portes s'ouvriront, voyageur. Tu en pousseras une. Les deux "
             "autres pousseront sur toi."),
        Line("voyageur", "Je… quoi ? *la Pythie sourit et ne répond plus*"),
    ]),

    Scene("biblio-apprentis", seeds="biblio", turns=[
        Line("voyageur1", "On m'a parlé d'une bibliothèque où chaque livre dit la vérité. "
             "Imagine ce qu'on y apprendrait !"),
        Line("voyageur2", "Imagine surtout ce qu'on n'a pas le droit d'y apprendre. Y'a une "
             "raison si la porte ne s'ouvre pas à n'importe qui."),
        Line("voyageur1", "…À qui s'ouvre-t-elle, alors ?"),
        Line("voyageur2", "À ceux qui posent la bonne question. Pas celle-là."),
    ]),

    Scene("heraut-aubergiste-repos", seeds="", turns=[
        Line("heraut", "Une nuit sans annonce, aubergiste. Une seule. C'est tout ce que je "
             "demande aux Mondes."),
        Line("aubergiste", "Profite, Héraut. Demain tu brailleras assez fort pour réveiller "
             "les morts du champ de bataille."),
        Line("heraut", "*lève sa chope* Aux morts, alors. Ils écoutent mieux que les vivants."),
    ]),

    # --- Saynètes cocasses (le réseau de liens, version comédie) -------------
    Scene("marchand-upsell-eau", seeds="", turns=[
        Line("marchand", "Aubergiste, cette eau de ton puits — pure merveille. Je la "
             "revendrais « Élixir des Profondeurs » trois pièces la fiole."),
        Line("aubergiste", "C'est de l'eau, marchand. De l'eau. Du puits. Derrière toi."),
        Line("marchand", "*déjà en train de remplir une fiole* « Eau du puits authentique du "
             "Carrefour ». Tu vois ? C'est l'étiquette qui fait le prix, pas le contenu."),
        Line("aubergiste", "*soupire et ressert* Une chope. Gratis. Pour ME consoler, cette fois."),
    ]),

    Scene("heraut-pari-oyez", seeds="", turns=[
        Line("heraut", "Ce soir, défi personnel : pas un seul « Oyez ». Je vous prends tous "
             "à témoin."),
        Line("aubergiste", "*à la cantonade, bas* Trois pièces qu'il craque avant sa première gorgée."),
        Line("heraut", "Je relève ce pari avec dignité et sobri— OYEZ ! …*ferme les yeux* "
             "…pardon. La dignité attendra demain."),
    ]),

    Scene("archiviste-piege", seeds="", turns=[
        Line("aubergiste", "Archiviste ! Descends donc, j'ai reçu un manuscrit qui pourrait "
             "t'intéresser au plus haut point."),
        Line("archiviste", "*descend, méfiant* Un manuscrit ? Montre. …C'est une carte des "
             "bières, Aubergiste. Une CARTE DES BIÈRES."),
        Line("aubergiste", "Et elle est très bien rédigée, avoue."),
        Line("archiviste", "*déjà reparti vers l'escalier* Du bruit, de la bière, et MAINTENANT "
             "de l'humour. Je remonte. Je remonte !"),
    ]),

    Scene("mineur-presente-berthe", seeds="mine", turns=[
        Line("mineur", "*pose sa chope sur la table avec délicatesse* Voyageur, je te présente "
             "Berthe. Berthe, le voyageur. Sois polie."),
        Line("voyageur", "Euh… enchanté ? C'est… une chope."),
        Line("mineur", "*soudain très lucide, voix basse* La mine aussi, on croyait que "
             "c'était juste un trou. *repart en riant* Berthe dit que tu vas descendre. Berthe "
             "a toujours raison."),
    ]),

    Scene("pythie-mauvaise-question", seeds="", turns=[
        Line("voyageur", "Excusez-moi, madame… vous sauriez où sont les commodités ?"),
        Line("pythie", "*regard lointain* Tu chercheras trois portes, voyageur. Tu en "
             "pousseras une. Les deux autres pousseront sur toi."),
        Line("voyageur", "…Donc c'est la porte au fond à gauche ?"),
        Line("pythie", "*déjà ailleurs* Au fond. À gauche. Oui. *un temps* Le reste aussi."),
    ]),

    Scene("ombre-portemanteau", seeds="", turns=[
        Line("voyageur", "Pratique, ce portemanteau dans le coin. *y accroche sa cape*"),
        Line("ombre", "*murmure glacé* …Ce n'est pas un portemanteau."),
        Line("voyageur", "*frissonne, regarde autour* …Quel drôle de courant d'air. *récupère "
             "sa cape et s'éloigne vite*"),
    ]),

    Scene("marin-oublie-nom", seeds="port", turns=[
        Line("marin", "On m'appelle… on m'appelle… *se frotte le front* …Sang des abysses, "
             "ça m'échappe encore."),
        Line("voyageur", "Votre nom ? Vous l'aviez dit hier, pourtant."),
        Line("marin", "Hier ? *un sourire triste* Tu te souviens de moi depuis hier, toi ? "
             "Alors garde-le, ce souvenir. Tant que quelqu'un se souvient, je suis encore là."),
    ]),

    # --- Saynètes ENTRE VOYAGEURS (les 12 inconnus interagissent, par identité) ----
    Scene("voy-forgeron-erudit", seeds="mine", turns=[
        Line("erudit", "Maître nain ! Vous descendez vraiment dans les mines ? J'ai LU tant "
             "de choses sur les profondeurs, mais jamais vu une vraie galerie !"),
        Line("forgeron", "T'as *lu* les profondeurs. *rire grave* P'tit, la montagne se lit "
             "pas, elle s'écoute. Et celle du nord, en ce moment, elle dit des choses qui me "
             "plaisent pas."),
        Line("erudit", "Fascinant ! Vous voulez dire qu'elle… communique ?! Attendez, je "
             "note, je note —"),
        Line("forgeron", "*lui retire la plume des mains* Bois ta bière, gamin. Y'a des "
             "savoirs qu'on ferait mieux de pas coucher sur le papier."),
    ]),
    Scene("voy-gamin-capuche", seeds="", turns=[
        Line("gamin", "*se faufile vers la bourse de la rôdeuse, l'air innocent*"),
        Line("capuche", "*sans tourner la tête, lui saisit le poignet* Trois choses, gamin. "
             "Un : je t'ai vu venir depuis l'entrée. Deux : ta main tremble. Trois… *le "
             "relâche* …t'as du potentiel. Entraîne-toi sur plus bête que moi."),
        Line("gamin", "*se frotte le poignet, admiratif* …Tu m'apprends ?"),
        Line("capuche", "Non. Mais paie-moi une bière et je te balance pas au tavernier."),
    ]),
    Scene("voy-veteran-chevaleresse", seeds="", turns=[
        Line("veteran", "Belle armure, noble dame. Plates anciennes. Le siège de quelque "
             "chose, je parie ?"),
        Line("chevaleresse", "Le siège de Varn. Onze mois. Tu connais ?"),
        Line("veteran", "*lève sa chope* J'étais de l'autre côté du mur. *un silence, puis "
             "tous deux rient* À Varn, alors. Paix à ceux qui n'en sont pas rentrés — des "
             "deux côtés."),
    ]),
    Scene("voy-menestrel-dame", seeds="", turns=[
        Line("menestrel", "Madame, votre voile, votre silence, ce bijou que vous cachez… il "
             "y a une chanson là-dessous. La plus belle. Donnez-la-moi."),
        Line("dame", "Une chanson a besoin d'une fin, ménestrel. La mienne n'est pas écrite. "
             "Et croyez-moi, vous ne voulez pas la chanter avant de la connaître."),
        Line("menestrel", "*gratte une corde, rêveur* « La Dame sans fin »… j'ai déjà le "
             "titre. Je suis patient, madame. Les meilleures complaintes se font attendre."),
    ]),
    Scene("voy-deux-elfes", seeds="foret", turns=[
        Line("chasseur", "Encore toi et tes fioles. Tu empoisonnes plus de forêts que tu "
             "n'en soignes."),
        Line("alchimiste", "Et toi tu vides les bois de leur gibier en remerciant les arbres. "
             "Au moins mes mixtures repoussent, elles. *sourire en coin*"),
        Line("chasseur", "…La forêt des Murmures t'a recrachée, paraît-il. Trop amère, "
             "sûrement."),
        Line("alchimiste", "Elle t'a laissé entrer, toi. C'est qu'elle a faim. Bois, cousin. "
             "On finira vieux tous les deux — c'est ça, le pire, entre elfes."),
    ]),
    Scene("voy-servante-gamin", seeds="", turns=[
        Line("servante", "*attrape le gamin par l'oreille* Et CE pain, il a sauté dans ta "
             "poche tout seul, je suppose ?"),
        Line("gamin", "Aïe ! Il… il avait l'air seul ! J'lui tenais compagnie !"),
        Line("servante", "*soupire, lui colle un quignon de plus dans les mains* Tiens. La "
             "prochaine fois, tu DEMANDES. *plus bas* Et tu manges, t'es maigre comme un clou."),
    ]),
    Scene("voy-rodeur-chasseur", seeds="foret", turns=[
        Line("rodeur", "Toi aussi tu lis les bois, l'elfe. Dis-moi : la forêt à l'ouest, tu "
             "la sens comment ces temps-ci ?"),
        Line("chasseur", "Comme une bête qui retient son souffle. Les pistes y mentent. J'y "
             "remets plus les pieds sans raison."),
        Line("rodeur", "*hoche lentement la tête* Quarante ans que je dis pareil. Content de "
             "pas être le seul vieux fou. Buvons à la forêt — de loin."),
    ]),
    Scene("voy-erudit-dame", seeds="", turns=[
        Line("erudit", "Madame, pardonnez ma hardiesse, mais… êtes-vous une vraie princesse ? "
             "Comme dans les livres ? Avec un royaume et tout ?"),
        Line("dame", "*un silence derrière le voile* Dans les livres, petit, les princesses "
             "finissent au château. Pas dans une taverne au bout du monde, à fixer la porte."),
        Line("erudit", "…Donc c'est oui ? *la dame ne répond pas, mais sourit* …Je note "
             "« peut-être »."),
    ]),
    Scene("voy-forgeron-veteran", seeds="", turns=[
        Line("forgeron", "Soldat, ton épée est ébréchée jusqu'à la garde. Donne, je te la "
             "refais à neuf pour le prix d'une bière."),
        Line("veteran", "Garde ton marteau, l'ami. Chaque brèche est un nom. Si tu les "
             "effaces, qui se souviendra d'eux ?"),
        Line("forgeron", "*hoche la tête, respectueux* …Juste. Alors je te paie LA bière, et "
             "on boit à tes brèches. Toutes."),
    ]),
    Scene("voy-capuche-dame", seeds="", turns=[
        Line("capuche", "*s'assoit près de la dame voilée, dos au mur, comme elle* Bonne "
             "place. Vue sur la porte. On a le même goût, on dirait."),
        Line("dame", "Les mêmes raisons, surtout. On reconnaît toujours quelqu'un qui "
             "surveille l'entrée. *léger sourire* Nous ne nous demanderons rien, n'est-ce pas ?"),
        Line("capuche", "Rien du tout. *trinque sans un mot de plus*"),
    ]),
]


# ─────────────────────────────────────────────────────────────────────────────
# 5) INTERPELLATIONS  (un PNJ entame avec un membre — {membre} = mention/nom)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Hail:
    by: str
    text: str         # DOIT contenir « {membre} »
    seeds: str = ""


HAILS: list[Hail] = [
    Hail("aubergiste", "Tiens, {membre} ! Pose-toi près du feu, l'ami. D'où viens-tu donc, "
         "avec cette mine de quelqu'un qui a marché trop longtemps ?"),
    Hail("marchand", "Toi, là — {membre} — tu as l'œil de qui sait reconnaître la bonne "
         "affaire. Approche, j'ai peut-être une babiole pour toi… ou une histoire."),
    Hail("voyageur", "Hé, {membre}, fais-moi de la place. *s'assoit* Alors, quelles "
         "nouvelles des routes ? Moi je n'ai croisé que de la pluie et des corbeaux."),
    Hail("ombre", "*juste derrière {membre}* …Tu es nouveau ici, n'est-ce pas ? On le voit. "
         "Tu regardes encore les ombres comme si elles dormaient."),
    Hail("pythie", "{membre}. *te fixe* Oui, toi. Ton verre est à moitié vide, et pourtant "
         "tu as soif d'autre chose. Je me trompe ?", seeds="clairiere"),
    Hail("marin", "{membre} ! Tu as une tête à aimer les histoires de mer. Assieds-toi, je "
         "t'en dois une — et celle-ci, tu ne la croiras pas.", seeds="port"),
    Hail("aubergiste", "{membre}, tu tombes bien — règle-moi un débat : la bière du Far "
         "West vaut-elle celle de la Contrée ? Les avis sont partagés à cette table."),
    Hail("voyageur", "Dis-moi, {membre}, tu connais la forêt à l'ouest, toi ? On m'a dit "
         "d'éviter, mais on dit tant de choses au coin du feu…", seeds="foret"),
    Hail("marchand", "{membre}, entre nous : si tu devais descendre dans une mine que tout "
         "le monde évite, tu y descendrais pour de l'or ? Question d'ami. *sourire en coin*",
         seeds="mine"),
    Hail("heraut", "Oyez, {membre} ! …pardon. *se racle la gorge* Toi. Oui, toi. Approche, "
         "j'ai une chose importante à ne PAS crier."),
    Hail("marchand", "{membre} ! L'œil vif, la bourse pleine, j'me trompe ? *déballe un "
         "caillou* Tiens, regarde-moi ça : fragment d'étoile. Pour toi, et pour toi seul… un "
         "prix d'ami."),
    Hail("pythie", "{membre}. *te fixe sans ciller* Ne commande pas le ragoût ce soir. "
         "*un temps* Je ne t'en dirai pas plus. Mais ne le commande pas.", seeds="clairiere"),
    Hail("mineur", "Hé, {membre} ! Viens, viens, faut que je te présente quelqu'un. *désigne "
         "sa chope* Berthe. Elle a un avis sur toi. Tu veux l'entendre ? Tu DOIS l'entendre."),
]


# ─────────────────────────────────────────────────────────────────────────────
# 6) Petits accès pratiques (purs, sans hasard ni discord — le moteur décide)
# ─────────────────────────────────────────────────────────────────────────────

#: PNJ ayant une voix de comptoir (réactions live au coin des voyageurs).
NAMED_VOICES: tuple[str, ...] = tuple(AMBIENT_FLAVOR.keys())

#: tous les keys de PNJ existants (depuis personas.py) — jetons `by` valides en plus
#: des voyageurs. Permet de faire apparaître ponctuellement un gardien au comptoir.
from .personas import PERSONAS as _PERSONAS  # noqa: E402  (pur data, pas de discord)
PNJ_KEYS: tuple[str, ...] = tuple(p.key for p in _PERSONAS)


def monologues_by_seed(seed: str) -> list[Monologue]:
    """Monologues qui pré-sèment un lieu donné ('' = ambiance pure)."""
    return [m for m in MONOLOGUES if m.seeds == seed]


def scenes_by_seed(seed: str) -> list[Scene]:
    return [s for s in SCENES if s.seeds == seed]


def traveler_lines_by_seed(seed: str) -> list[tuple[Voice, Sig]]:
    """Répliques signature des voyageurs qui pré-sèment un lieu (couple voix+ligne)."""
    return [(v, s) for v in TRAVELERS for s in v.lines if s.seeds == seed]
