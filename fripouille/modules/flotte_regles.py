"""Guerre des Flottes Royales — règles du jeu, en Python pur (aucune dépendance Discord).

Une partie (un salon) est un simple dict JSON, persisté tel quel par ``flotte.py`` ;
``Partie`` l'enveloppe. Le temps est toujours passé en paramètre (``maintenant``) et tout
l'aléa découle de la graine de la partie : mêmes graine + mêmes ordres → même partie, au
bit près (testé). L'aléa est un mulberry32 maison, indépendant de la version de Python.

Déroulé : salon → préparation → [planification → résolution] … → fin.

Carte : hexagones « pointe en haut », coordonnées décalées (colonne, rangée), rangées
impaires décalées d'un demi-hexagone vers la droite. Terrains : ``.`` mer, ``#`` île
(infranchissable, bloque les tirs), ``^`` récif (on peut y entrer, mais on s'y échoue :
fin du mouvement et dégâts), ``P`` port (mer ; un navire qui y termine la manche répare
1 point de coque). La carte est connue de tous ; seuls les navires sont cachés.

Une manche, résolue d'un bloc et dans cet ordre, à partir des ordres secrets de chacun :
1. déplacements simultanés, pas à pas (le n-ième pas de chaque navire en même temps) :
   deux navires visant la même case, ou s'échangeant leur case, ou entrant dans une case
   qui reste occupée, s'arrêtent et prennent 1 dégât de choc (1 au plus par manche) ;
2. échouages sur récif ; les navires coulés ici ne tirent pas ;
3. tirs simultanés, résolus contre l'état d'après les déplacements : la cible doit être
   vue (ou avoir été démasquée par ses propres tirs et ne pas avoir bougé), à portée, en
   ligne de tir. Chance de toucher explicite (voir ``chance``), 15 % des touches sont
   critiques (+1 dégât). Tirer démasque le tireur auprès du propriétaire de la cible ;
4. naufrages, réparations au port, éliminations, victoire ;
5. la météo passe à la prévision annoncée, une nouvelle prévision est tirée.

Vent : il souffle VERS une des 6 directions. Le coût d'un pas dépend de l'écart entre la
direction du pas et le vent (0 = vent arrière … 3 = face au vent) et de la météo.

Brouillard de guerre : chaque joueur ne voit que les navires adverses dans le rayon de
vision de ses navires. ``vue()`` construit ce que chacun a le droit de voir, et les
événements de résolution sont filtrés joueur par joueur : aucune position cachée ne
quitte le serveur.

Duel final : quand il ne reste que deux capitaines en lice, le brouillard se lève — chacun
voit toute la flotte de l'autre (pas de fin de partie à cache-cache).

Victoire : dernier capitaine à flot. Limite de manches → départage : navires à flot,
puis coque restante, puis dégâts infligés ; égalité parfaite → victoire partagée.
"""
import math

# ─────────────────────────── Constantes de jeu ───────────────────────────
MIN_JOUEURS = 2
MAX_JOUEURS = 8
ABSENCES_MAX = 3            # manches sans ordre avant l'abandon (avertissement à la 2e)
POINTS_PAR_VITESSE = 3      # points de mouvement = vitesse × 3 ; un pas coûte 2 à 6
PAS_EN_PLUS = 1             # nombre de pas max = vitesse + 1 (même vent arrière)
PART_CRITIQUE = 0.15        # part des touches qui sont critiques
MALUS_GARDE = 15
MALUS_LOURD_EN_MOUVEMENT = 10
DUREES = {"preparation": 8, "resolution": 7}
BORNES = {"manches": (8, 40), "plan": (20, 300)}
OPTIONS_DEFAUT = {"manches": 20, "plan": 60}
MAX_HISTORIQUE = 12
PHASES = ("salon", "preparation", "planification", "resolution", "fin")

CLASSES = {
    "eclaireur": {"nom": "Éclaireur", "vitesse": 4, "coque": 4, "portee": 2, "portee_min": 1,
                  "precision": 70, "chute": 8, "degats": 1, "vision": 5, "esquive": 10, "valeur": 2,
                  "lourd": False, "role": "Rapide, fragile, voit loin : les yeux de la flotte."},
    "fregate": {"nom": "Frégate royale", "vitesse": 3, "coque": 6, "portee": 3, "portee_min": 1,
                "precision": 70, "chute": 6, "degats": 2, "vision": 3, "esquive": 0, "valeur": 3,
                "lourd": False, "role": "Équilibrée : bonne bordée à courte et moyenne portée."},
    "siege": {"nom": "Navire de siège", "vitesse": 2, "coque": 8, "portee": 5, "portee_min": 2,
              "precision": 60, "chute": 3, "degats": 3, "vision": 3, "esquive": 0, "valeur": 4,
              "lourd": True, "role": "Lent et robuste, frappe fort et loin ; aveugle au contact "
                                     "(portée min. 2) et moins précis s'il a bougé."},
}
FLOTTE = ("eclaireur", "fregate", "fregate", "siege")

# couts[écart] : 0 = vent arrière, 1 = grand largue, 2 = travers/près, 3 = face au vent
TEMPS = {
    "calme": {"nom": "Mer d'huile", "couts": (3, 3, 3, 3), "vision": 0, "vision_max": None,
              "precision": 0, "precision_loin": 0, "recif": 1},
    "brise": {"nom": "Brise", "couts": (2, 3, 3, 5), "vision": 0, "vision_max": None,
              "precision": 0, "precision_loin": 0, "recif": 1},
    "vent_fort": {"nom": "Vent fort", "couts": (2, 2, 3, 6), "vision": 0, "vision_max": None,
                  "precision": -5, "precision_loin": 0, "recif": 1},
    "brouillard": {"nom": "Brouillard", "couts": (3, 3, 3, 4), "vision": 0, "vision_max": 2,
                   "precision": 0, "precision_loin": -10, "recif": 1},
    "tempete": {"nom": "Tempête", "couts": (2, 3, 4, 6), "vision": -1, "vision_max": None,
                "precision": -15, "precision_loin": 0, "recif": 2},
}
TRANSITIONS = {
    "calme": {"calme": 3, "brise": 5, "brouillard": 2},
    "brise": {"calme": 2, "brise": 4, "vent_fort": 3, "brouillard": 1},
    "vent_fort": {"brise": 3, "vent_fort": 3, "tempete": 2},
    "brouillard": {"calme": 2, "brise": 3, "brouillard": 2},
    "tempete": {"brise": 1, "vent_fort": 3, "tempete": 1},
}

PAVILLONS = ("lion", "kraken", "corbeau", "rose", "loup", "soleil", "ancre", "dragon")
TAILLES = {2: (13, 11), 3: (15, 13), 4: (15, 13), 5: (19, 15), 6: (19, 15), 7: (21, 17), 8: (21, 17)}
NOMS_NAVIRES = [
    "Fière-Marée", "Lame-d'Écume", "Corbeau-Gris", "Dame-des-Brumes", "Vent-Royal", "Sel-Noir",
    "Bourrasque", "Étoile-du-Nord", "Griffe-de-Sel", "Lanterne-Sourde", "Cœur-de-Chêne",
    "Vigie-d'Argent", "Houle-Pourpre", "Sirène-Rousse", "Hardi", "Intrépide", "Tonnerre",
    "Fléau-des-Récifs", "Belle-Ourse", "Marteau-du-Roi", "Ancre-d'Or", "Requin-Blanc",
    "Brise-Lames", "Faucon-des-Mers", "Vieille-Garce", "Porte-Tempête", "Gloire-d'Hiver",
    "Rose-des-Vents", "Serment", "Veuve-Noire", "Écume-d'Ambre", "Grand-Hunier", "Ombre-Salée",
    "Phare-Errant", "Chant-du-Kraken", "Bastion", "Licorne", "Mouette-Rieuse", "Fortune", "Albatros",
]
NOMS_BOTS = ["Amiral Brisecôte", "Capitaine Sel-de-Roche", "Dame Houlegrise", "Le Vieux Morue",
             "Baronne Tribord", "Sire Calfat", "Corsaire Lanterne", "Mère Goudron"]


class Refus(ValueError):
    """Geste refusé : le message est montré tel quel au joueur."""


# ─────────────────────────── Aléa déterministe ───────────────────────────
M32 = 0xFFFFFFFF


def _fnv(texte: str) -> int:
    h = 0x811C9DC5
    for o in texte.encode("utf-8"):
        h = ((h ^ o) * 0x01000193) & M32
    return h


class Alea:
    """mulberry32, ensemencé par (graine, sel…) : un flux indépendant par usage."""

    def __init__(self, graine: int, *sel):
        self.s = _fnv("%d|%s" % (graine, "|".join(map(str, sel))))

    def flottant(self) -> float:
        self.s = (self.s + 0x6D2B79F5) & M32
        a = self.s
        t = ((a ^ (a >> 15)) * (a | 1)) & M32
        t = ((t + (((t ^ (t >> 7)) * (t | 61)) & M32)) & M32) ^ t
        return ((t ^ (t >> 14)) & M32) / 4294967296

    def entier(self, a: int, b: int) -> int:
        return a + min(b - a, int(self.flottant() * (b - a + 1)))

    def choix(self, seq):
        return seq[self.entier(0, len(seq) - 1)]

    def pondere(self, poids: dict):
        total = sum(poids.values())
        x = self.flottant() * total
        for cle in sorted(poids):
            x -= poids[cle]
            if x < 0:
                return cle
        return sorted(poids)[-1]

    def melanger(self, liste: list) -> list:
        l = list(liste)
        for i in range(len(l) - 1, 0, -1):
            j = self.entier(0, i)
            l[i], l[j] = l[j], l[i]
        return l


# ─────────────────────────── Hexagones ───────────────────────────
DIRS = ((1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1))   # axial : E, NE, NO, O, SO, SE
NOMS_DIRS = ("est", "nord-est", "nord-ouest", "ouest", "sud-ouest", "sud-est")


def axial(cell) -> tuple:
    c, r = cell
    return (c - (r - (r & 1)) // 2, r)


def decale(q: int, r: int) -> tuple:
    return (q + (r - (r & 1)) // 2, r)


def distance(a, b) -> int:
    qa, ra = axial(a)
    qb, rb = axial(b)
    dq, dr = qa - qb, ra - rb
    return max(abs(dq), abs(dr), abs(dq + dr))


def voisin(cell, d: int) -> tuple:
    q, r = axial(cell)
    return decale(q + DIRS[d][0], r + DIRS[d][1])


def direction(a, b):
    for d in range(6):
        if voisin(a, d) == tuple(b):
            return d
    return None


def ecart(d: int, vent: int) -> int:
    return min((d - vent) % 6, (vent - d) % 6)


def disque(cell, rayon: int) -> list:
    q0, r0 = axial(cell)
    out = []
    for dq in range(-rayon, rayon + 1):
        for dr in range(max(-rayon, -dq - rayon), min(rayon, -dq + rayon) + 1):
            out.append(decale(q0 + dq, r0 + dr))
    return out


def _arrondi(x: float, y: float, z: float) -> tuple:
    rx, ry, rz = math.floor(x + 0.5), math.floor(y + 0.5), math.floor(z + 0.5)
    dx, dy, dz = abs(rx - x), abs(ry - y), abs(rz - z)
    if dx > dy and dx > dz:
        rx = -ry - rz
    elif dy > dz:
        ry = -rx - rz
    else:
        rz = -rx - ry
    return decale(rx, rz)


def ligne(a, b) -> list:
    """Cases traversées de a à b (incluses), interpolation cubique légèrement décalée pour
    trancher les cas limites toujours du même côté."""
    n = distance(a, b)
    qa, ra = axial(a)
    qb, rb = axial(b)
    ax, az = qa + 1e-6, ra - 2e-6
    bx, bz = qb + 1e-6, rb - 2e-6
    out = []
    for i in range(n + 1):
        t = i / n if n else 0.0
        x, z = ax + (bx - ax) * t, az + (bz - az) * t
        out.append(_arrondi(x, -x - z, z))
    return out


# ─────────────────────────── Carte ───────────────────────────
def terrain(carte: dict, cell):
    c, r = cell
    if 0 <= c < carte["l"] and 0 <= r < carte["h"]:
        return carte["terrain"][r][c]
    return None


def navigable(carte: dict, cell) -> bool:
    return terrain(carte, cell) in (".", "^", "P")


def ligne_de_tir(carte: dict, a, b) -> bool:
    return all(terrain(carte, c) != "#" for c in ligne(a, b)[1:-1])


def generer_carte(graine: int, n: int) -> dict:
    """Carte reproductible pour n capitaines : départs répartis sur une ellipse, îles en
    amas, récifs autour, ports vers le centre ; toute la mer est d'un seul tenant."""
    l, h = TAILLES[max(MIN_JOUEURS, min(MAX_JOUEURS, n))]
    cx, cy = (l - 1) / 2, (h - 1) / 2
    for essai in range(40):
        a = Alea(graine, "carte", essai)
        dense = essai < 30
        g = [["."] * l for _ in range(h)]
        rot = a.flottant() * 2 * math.pi
        departs = []
        for i in range(n):
            ang = rot + 2 * math.pi * i / n
            departs.append((int(math.floor(cx + (cx - 1.5) * math.cos(ang) + 0.5)),
                            int(math.floor(cy + (cy - 1.5) * math.sin(ang) + 0.5))))
        if any(distance(p, q) < 4 for i, p in enumerate(departs) for q in departs[i + 1:]):
            continue

        def libre(cell, marge=3):
            return all(distance(cell, d) > marge for d in departs)

        if dense:
            cible, poses, essais = int(l * h * 0.11), 0, 0
            while poses < cible and essais < 500:
                essais += 1
                cell = (a.entier(1, l - 2), a.entier(1, h - 2))
                for _ in range(a.entier(1, 5)):
                    c, r = cell
                    if 0 <= c < l and 0 <= r < h and libre(cell) and g[r][c] == ".":
                        g[r][c] = "#"
                        poses += 1
                    cell = voisin(cell, a.entier(0, 5))
            for r in range(h):
                for c in range(l):
                    if g[r][c] != "." or not libre((c, r)):
                        continue
                    pres_ile = any(terrain({"l": l, "h": h, "terrain": g}, v) == "#"
                                   for v in (voisin((c, r), d) for d in range(6)))
                    if a.flottant() < (0.16 if pres_ile else 0.02):
                        g[r][c] = "^"
        # Ports : mer près d'une île, loin des départs et entre eux, au plus près du centre.
        carte = {"l": l, "h": h, "terrain": g}
        cand = []
        for r in range(h):
            for c in range(l):
                if g[r][c] == "." and libre((c, r), 3):
                    pres = any(terrain(carte, voisin((c, r), d)) == "#" for d in range(6))
                    if pres or not dense:
                        cand.append((distance((c, r), (int(cx), int(cy))) + a.flottant() * 3, (c, r)))
        ports = []
        for _, cell in sorted(cand):
            if len(ports) >= max(1, n // 2):
                break
            if all(distance(cell, p) >= 4 for p in ports):
                ports.append(cell)
                g[cell[1]][cell[0]] = "P"
        # Connexité : on remplit les lagunes isolées ; on recommence si un départ est coupé.
        vu, pile = {departs[0]}, [departs[0]]
        while pile:
            x = pile.pop()
            for d in range(6):
                v = voisin(x, d)
                if v not in vu and navigable(carte, v):
                    vu.add(v)
                    pile.append(v)
        if any(p not in vu for p in departs + ports):
            continue
        for r in range(h):
            for c in range(l):
                if g[r][c] != "#" and (c, r) not in vu:
                    g[r][c] = "#"
        return {"l": l, "h": h, "terrain": ["".join(row) for row in g],
                "departs": [list(p) for p in departs], "ports": [list(p) for p in ports]}
    raise RuntimeError("carte impossible")  # inatteignable : la mer ouverte passe toujours


# ─────────────────────────── Mouvement ───────────────────────────
def points_mouvement(classe: str) -> int:
    return CLASSES[classe]["vitesse"] * POINTS_PAR_VITESSE


def pas_max(classe: str) -> int:
    return CLASSES[classe]["vitesse"] + PAS_EN_PLUS


def cout_pas(meteo: dict, d: int) -> int:
    return TEMPS[meteo["temps"]]["couts"][ecart(d, meteo["vent"])]


def verifier_chemin(carte: dict, meteo: dict, classe: str, depart, chemin) -> int:
    """Lève Refus si le chemin est illégal ; renvoie son coût."""
    if len(chemin) > pas_max(classe):
        raise Refus("trop de pas pour ce navire")
    cout, ici = 0, tuple(depart)
    for i, cell in enumerate(chemin):
        if i > 0 and terrain(carte, ici) == "^":    # on repart d'un récif la manche suivante
            raise Refus("un navire échoué sur un récif ne va pas plus loin cette manche")
        d = direction(ici, cell)
        if d is None:
            raise Refus("chaque pas doit mener à une case voisine")
        if not navigable(carte, cell):
            raise Refus("on ne navigue pas sur la terre ferme")
        cout += cout_pas(meteo, d)
        ici = cell
    if cout > points_mouvement(classe):
        raise Refus("pas assez de vent dans les voiles pour aller si loin")
    return cout


def atteignables(carte: dict, meteo: dict, classe: str, depart) -> dict:
    """{case: chemin le moins coûteux} — même règles que verifier_chemin."""
    pts, smax = points_mouvement(classe), pas_max(classe)
    depart = tuple(depart)
    meilleur = {(depart, 0): (0, [])}
    front = [(depart, 0)]
    for pas in range(smax):
        suivant = []
        for etat in front:
            cell, _ = etat
            cout, chemin = meilleur[etat]
            if terrain(carte, cell) == "^" and chemin:
                continue
            for d in range(6):
                v = voisin(cell, d)
                if not navigable(carte, v):
                    continue
                c2 = cout + cout_pas(meteo, d)
                if c2 > pts:
                    continue
                cle = (v, pas + 1)
                if cle not in meilleur or meilleur[cle][0] > c2:
                    if cle not in meilleur:
                        suivant.append(cle)
                    meilleur[cle] = (c2, chemin + [v])
        front = suivant
    out: dict = {}
    for (cell, _), (cout, chemin) in sorted(meilleur.items(), key=lambda kv: (kv[1][0], len(kv[1][1]))):
        if cell not in out:
            out[cell] = chemin
    return out


# ─────────────────────────── Tir ───────────────────────────
def chance(meteo: dict, classe_tireur: str, classe_cible: str, dist: int,
           cible_en_garde: bool = False, tireur_a_bouge: bool = False) -> int:
    """Chance de toucher, en %, bornée à [5, 95] :
    précision du tireur − chute × (distance − 1) − esquive de la cible + météo
    − 15 si la cible est en garde − 10 si un navire lourd a bougé."""
    k, t = CLASSES[classe_tireur], TEMPS[meteo["temps"]]
    p = k["precision"] - k["chute"] * (dist - 1) - CLASSES[classe_cible]["esquive"] + t["precision"]
    if dist > 2:
        p += t["precision_loin"]
    if cible_en_garde:
        p -= MALUS_GARDE
    if tireur_a_bouge and k["lourd"]:
        p -= MALUS_LOURD_EN_MOUVEMENT
    return max(5, min(95, p))


def tir_possible(carte: dict, classe: str, de, vers):
    """(possible, raison) — portée et ligne de tir."""
    k, dist = CLASSES[classe], distance(de, vers)
    if dist < k["portee_min"]:
        return False, "trop près pour cette pièce"
    if dist > k["portee"]:
        return False, "hors de portée"
    if not ligne_de_tir(carte, de, vers):
        return False, "ligne de tir masquée par une île"
    return True, ""


def rayon_vision(classe: str, meteo: dict) -> int:
    t = TEMPS[meteo["temps"]]
    r = CLASSES[classe]["vision"] + t["vision"]
    if t["vision_max"] is not None:
        r = min(r, t["vision_max"])
    return max(1, r)


def tirer_meteo(meteo: dict, alea: Alea) -> dict:
    temps = alea.pondere(TRANSITIONS[meteo["temps"]])
    x = alea.flottant()
    vent = meteo["vent"] if x < 0.5 else (meteo["vent"] + (1 if x < 0.75 else -1)) % 6
    return {"temps": temps, "vent": vent}


# ─────────────────────────── Partie ───────────────────────────
def nouvelle(id_partie: str, hote: dict, graine: int, options: dict | None = None,
             sel: int | None = None) -> dict:
    """``graine`` fixe la carte (révélée en fin de partie) ; ``sel`` est l'aléa secret des
    tirs, de la météo et des bots — il ne quitte jamais le serveur, sinon un client pourrait
    prédire ses jets (``flotte.py`` le tire au hasard ; les tests le fixent)."""
    graine = int(graine) & M32
    d = {
        "id": id_partie, "graine": graine, "sel": (graine ^ 0x9E3779B9) if sel is None else int(sel) & M32,
        "phase": "salon", "hote": hote["uid"],
        "options": dict(OPTIONS_DEFAUT), "joueurs": [], "carte": None, "navires": [],
        "manche": 0, "meteo": None, "prevision": None, "ordres": {}, "memoire": {},
        "revelations": {}, "historique": {}, "echeance": None, "debut": None, "fin": None,
    }
    if options:
        Partie(d).regler(options)
    return d


def revanche(d: dict, id_partie: str, graine: int, meme_carte: bool, sel: int) -> dict:
    """Même salon, même configuration ; même carte (même graine) ou carte neuve. Le sel,
    lui, est toujours neuf : connaître la carte ne dit rien des jets à venir."""
    hote = next((j for j in d["joueurs"] if j["uid"] == d["hote"]), None) or {"uid": d["hote"]}
    neuve = nouvelle(id_partie, hote, d["graine"] if meme_carte else graine, d["options"], sel)
    p = Partie(neuve)
    for j in d["joueurs"]:
        if j["abandon"] and not j["bot"]:
            continue
        p.rejoindre({"uid": j["uid"], "nom": j["nom"], "avatar": j["avatar"]}, bot=j["bot"])
        p.j(j["uid"])["pavillon"] = j["pavillon"]
    return neuve


def _stats_vides() -> dict:
    return {"tirs": 0, "touches": 0, "degats": 0, "coules": 0, "perdus": 0}


class Partie:
    def __init__(self, d: dict):
        self.d = d

    # ── accès ──
    def j(self, uid: str) -> dict | None:
        return next((x for x in self.d["joueurs"] if x["uid"] == uid), None)

    def n(self, sid: str) -> dict | None:
        return next((x for x in self.d["navires"] if x["id"] == sid), None)

    def flotte(self, uid: str) -> list:
        return [x for x in self.d["navires"] if x["uid"] == uid and x["coule"] is None]

    def actifs(self) -> list:
        return [x for x in self.d["joueurs"] if x["elimine"] is None and not x["abandon"]]

    def humains_attendus(self) -> list:
        """Capitaines humains encore en lice qui n'ont pas verrouillé leurs ordres."""
        return [x for x in self.actifs() if not x["bot"] and not x["verrou"]]

    # ── salon ──
    def _salon(self):
        if self.d["phase"] != "salon":
            raise Refus("la partie a déjà levé l'ancre")

    def rejoindre(self, qui: dict, bot: bool = False):
        self._salon()
        if self.j(qui["uid"]):
            return
        if len(self.d["joueurs"]) >= MAX_JOUEURS:
            raise Refus("la flotte est au complet (%d capitaines)" % MAX_JOUEURS)
        pris = {x["pavillon"] for x in self.d["joueurs"]}
        self.d["joueurs"].append({
            "uid": qui["uid"], "nom": (qui.get("nom") or "?")[:32], "avatar": qui.get("avatar") or "",
            "bot": bot, "pavillon": next(p for p in PAVILLONS if p not in pris), "pret": bot,
            "verrou": False, "elimine": None, "abandon": False, "absences": 0, "stats": _stats_vides(),
        })

    def ajouter_bot(self):
        self._salon()
        noms = {x["nom"] for x in self.d["joueurs"]}
        nom = next((b for b in NOMS_BOTS if b not in noms), "Capitaine sans nom")
        i = 1
        while self.j("bot:%d" % i):
            i += 1
        self.rejoindre({"uid": "bot:%d" % i, "nom": nom}, bot=True)

    def retirer(self, uid: str):
        """Salon : un capitaine quitte le quai (l'hôte passe au premier humain restant)."""
        self._salon()
        self.d["joueurs"] = [x for x in self.d["joueurs"] if x["uid"] != uid]
        if uid == self.d["hote"]:
            h = next((x for x in self.d["joueurs"] if not x["bot"]), None)
            self.d["hote"] = h["uid"] if h else ""

    def pavillon(self, uid: str, pav: str):
        self._salon()
        j = self.j(uid)
        if j is None:
            raise Refus("tu n'es pas inscrit dans ce salon")
        if pav not in PAVILLONS:
            raise Refus("pavillon inconnu")
        if any(x["pavillon"] == pav and x["uid"] != uid for x in self.d["joueurs"]):
            raise Refus("ce pavillon flotte déjà sur une autre flotte")
        j["pavillon"] = pav

    def pret(self, uid: str, valeur: bool):
        self._salon()
        j = self.j(uid)
        if j is None:
            raise Refus("tu n'es pas inscrit dans ce salon")
        j["pret"] = bool(valeur)

    def regler(self, options: dict):
        self._salon()
        for cle, (lo, hi) in BORNES.items():
            if cle in options:
                try:
                    v = int(options[cle])
                except (TypeError, ValueError):
                    raise Refus("réglage invalide : %s" % cle) from None
                self.d["options"][cle] = max(lo, min(hi, v))

    def lancer(self, maintenant: float):
        self._salon()
        d = self.d
        if len(d["joueurs"]) < MIN_JOUEURS:
            raise Refus("il faut au moins %d capitaines (ajoute un bot pour t'entraîner)" % MIN_JOUEURS)
        if any(not x["pret"] for x in d["joueurs"] if x["uid"] != d["hote"]):
            raise Refus("tous les capitaines ne sont pas prêts")
        a = Alea(d["graine"], "depart")
        d["carte"] = generer_carte(d["graine"], len(d["joueurs"]))
        d["meteo"] = {"temps": "brise", "vent": a.entier(0, 5)}
        d["prevision"] = tirer_meteo(d["meteo"], Alea(d["sel"], "meteo", 1))
        self._deployer(a)
        for x in d["joueurs"]:
            x.update(verrou=False, elimine=None, abandon=False, absences=0, stats=_stats_vides())
        d.update(phase="preparation", manche=1, debut=maintenant, ordres={}, fin=None,
                 echeance=maintenant + DUREES["preparation"], revelations={}, historique={}, memoire={})
        self._memoriser()

    def _deployer(self, a: Alea):
        d, carte = self.d, self.d["carte"]
        centre = (carte["l"] // 2, carte["h"] // 2)
        noms = a.melanger(NOMS_NAVIRES)
        places = a.melanger(list(range(len(d["joueurs"]))))
        d["navires"] = []
        for i, x in enumerate(d["joueurs"]):
            dep = tuple(carte["departs"][places[i]])
            autour = sorted((v for v in (voisin(dep, k) for k in range(6)) if terrain(carte, v) == "."),
                            key=lambda v: (distance(v, centre), v))
            cases = [dep] + autour
            for k, classe in enumerate(FLOTTE):
                pos = cases[k]
                cap = min(range(6), key=lambda dd: (distance(voisin(pos, dd), centre), dd))
                d["navires"].append({
                    "id": "n%d" % (len(d["navires"]) + 1), "uid": x["uid"], "classe": classe,
                    "nom": noms[len(d["navires"]) % len(noms)], "pos": list(pos), "cap": cap,
                    "coque": CLASSES[classe]["coque"], "max": CLASSES[classe]["coque"], "coule": None,
                })

    # ── horloge ──
    def avancer(self, maintenant: float):
        """Échéance atteinte : passe à la phase suivante."""
        d = self.d
        if d["phase"] == "preparation":
            d.update(phase="planification", echeance=maintenant + d["options"]["plan"])
        elif d["phase"] == "planification":
            self.resoudre(maintenant)
        elif d["phase"] == "resolution":
            d.update(phase="planification", echeance=maintenant + d["options"]["plan"])

    # ── ordres ──
    def ordonner(self, uid: str, manche, ordres: dict | None = None, verrou: bool | None = None):
        """Remplace les ordres du capitaine pour la manche (idempotent : renvoyer le même
        message ne change rien). ``manche`` doit être la manche en cours : un ordre en
        retard ou rejoué ne déborde jamais sur la suivante."""
        d = self.d
        if d["phase"] != "planification":
            raise Refus("les ordres ne se donnent qu'en phase de planification")
        if manche != d["manche"]:
            raise Refus("ordre périmé (manche %s, nous sommes à la manche %d)" % (manche, d["manche"]))
        j = self.j(uid)
        if j is None or j["bot"]:
            raise Refus("tu ne commandes aucune flotte ici")
        if j["elimine"] is not None or j["abandon"]:
            raise Refus("ta flotte ne navigue plus")
        if ordres is not None:
            if not isinstance(ordres, dict) or len(ordres) > len(FLOTTE):
                raise Refus("ordres illisibles")
            propres, visibles = {}, {x["id"] for x in self.visibles(uid)}
            for sid, o in ordres.items():
                n = self.n(str(sid))
                if n is None or n["uid"] != uid or n["coule"] is not None:
                    raise Refus("ce navire n'est pas sous tes ordres")
                if not isinstance(o, dict):
                    raise Refus("ordre illisible")
                chemin = o.get("chemin") or []
                if not isinstance(chemin, list) or len(chemin) > 8:
                    raise Refus("chemin illisible")
                cases = []
                for c in chemin:
                    if (not isinstance(c, (list, tuple)) or len(c) != 2
                            or not all(isinstance(v, int) and not isinstance(v, bool) for v in c)):
                        raise Refus("chemin illisible")
                    cases.append((c[0], c[1]))
                verifier_chemin(d["carte"], d["meteo"], n["classe"], n["pos"], cases)
                action = o.get("action") or {"type": "garde"}
                if not isinstance(action, dict) or action.get("type") not in ("garde", "tir"):
                    raise Refus("action inconnue")
                if action["type"] == "tir":
                    cible = str(action.get("cible") or "")
                    if cible not in visibles:
                        raise Refus("cible inconnue ou hors de vue")
                    act = {"type": "tir", "cible": cible}
                else:
                    act = {"type": "garde"}
                propres[n["id"]] = {"chemin": [list(c) for c in cases], "action": act}
            d["ordres"][uid] = propres
        elif uid not in d["ordres"]:
            d["ordres"][uid] = {}
        if verrou is not None:
            j["verrou"] = bool(verrou)

    # ── vision ──
    def duel(self) -> bool:
        return self.d["phase"] != "salon" and len(self.actifs()) == 2

    def champ(self, uid: str) -> set:
        j = self.j(uid)
        if j is None or j["elimine"] is not None or j["abandon"]:
            return set()
        carte = self.d["carte"]
        if self.duel():
            return {(c, r) for r in range(carte["h"]) for c in range(carte["l"])}
        out = set()
        for n in self.flotte(uid):
            out.update(disque(tuple(n["pos"]), rayon_vision(n["classe"], self.d["meteo"])))
        return out

    def visibles(self, uid: str) -> list:
        """Navires adverses que ce capitaine voit en ce moment (vision + démasqués)."""
        champ = self.champ(uid)
        if not champ:
            return []
        demasques = set(self.d["revelations"].get(uid, []))
        return [n for n in self.d["navires"]
                if n["uid"] != uid and n["coule"] is None
                and (tuple(n["pos"]) in champ or n["id"] in demasques)]

    def _memoriser(self):
        m = self.d["manche"]
        for x in self.d["joueurs"]:
            mem = self.d["memoire"].setdefault(x["uid"], {})
            for n in self.visibles(x["uid"]):
                mem[n["id"]] = {"pos": list(n["pos"]), "manche": m}
            for sid in list(mem):
                n = self.n(sid)
                if n is None or n["coule"] is not None:
                    del mem[sid]

    # ── résolution ──
    def resoudre(self, maintenant: float):
        d = self.d
        m, carte = d["manche"], d["carte"]
        alea = Alea(d["sel"], "manche", m)
        evts: list = []
        publics: list = []

        # 1. Ordres effectifs : bots, absents (ordre défensif), abandons.
        for x in self.actifs():
            if x["bot"]:
                d["ordres"][x["uid"]] = ordres_bot(self, x["uid"])
            elif x["uid"] in d["ordres"]:
                x["absences"] = 0
            else:
                x["absences"] += 1
                if x["absences"] >= ABSENCES_MAX:
                    publics += self._abandonner(x, "absent %d manches" % ABSENCES_MAX)
        plan = {}
        for n in d["navires"]:
            if n["coule"] is None:
                o = d["ordres"].get(n["uid"], {}).get(n["id"]) or {}
                plan[n["id"]] = {"chemin": [tuple(c) for c in o.get("chemin", [])],
                                 "action": o.get("action") or {"type": "garde"}}
        uids = [x["uid"] for x in d["joueurs"]]
        v_avant = {u: self.champ(u) for u in uids}
        demasques_avant = {u: set(d["revelations"].get(u, [])) for u in uids}

        # 2. Déplacements simultanés.
        pos = {sid: tuple(self.n(sid)["pos"]) for sid in plan}
        trajets = {sid: [pos[sid]] for sid in plan}
        arretes, chocs, echoues = set(), [], []
        for i in range(max((len(p["chemin"]) for p in plan.values()), default=0)):
            cand = {sid: p["chemin"][i] for sid, p in plan.items()
                    if sid not in arretes and i < len(p["chemin"])}
            occupant = {c: sid for sid, c in pos.items()}
            bloques: set = set()
            par_case: dict = {}
            for sid, c in sorted(cand.items()):
                par_case.setdefault(c, []).append(sid)
            for c, sids in sorted(par_case.items()):
                if len(sids) > 1:
                    bloques.update(sids)
                    chocs.append((sids, c))
            for sid, c in sorted(cand.items()):
                o = occupant.get(c)
                if o in cand and o != sid and cand[o] == pos[sid] and sid < o:
                    bloques.update((sid, o))
                    chocs.append(([sid, o], c))
            change = True
            while change:
                change = False
                for sid, c in sorted(cand.items()):
                    o = occupant.get(c)
                    if sid not in bloques and o is not None and o != sid and (o not in cand or o in bloques):
                        bloques.add(sid)
                        chocs.append(([sid, o], c))
                        change = True
            for sid, c in sorted(cand.items()):
                if sid in bloques:
                    arretes.add(sid)
                    continue
                pos[sid] = c
                trajets[sid].append(c)
                if terrain(carte, c) == "^":
                    arretes.add(sid)
                    echoues.append(sid)
        a_bouge = set()
        for sid, t in trajets.items():
            n = self.n(sid)
            if len(t) > 1:
                a_bouge.add(sid)
                n["cap"] = direction(t[-2], t[-1])
                evts.append({"t": "mouv", "id": sid, "chemin": [list(c) for c in t], "cap": n["cap"]})
            n["pos"] = list(pos[sid])
        # Chocs et échouages (1 dégât de choc au plus par navire et par manche).
        heurtes: set = set()
        for sids, c in chocs:
            touches = {}
            for sid in sids:
                if sid not in heurtes:
                    heurtes.add(sid)
                    touches[sid] = 1
                    self.n(sid)["coque"] -= 1
            evts.append({"t": "choc", "ids": list(sids), "pos": list(c), "degats": touches})
        for sid in echoues:
            dg = TEMPS[d["meteo"]["temps"]]["recif"]
            self.n(sid)["coque"] -= dg
            evts.append({"t": "recif", "id": sid, "pos": list(pos[sid]), "degats": dg})
        for sid in sorted(plan):
            n = self.n(sid)
            if n["coque"] <= 0 and n["coule"] is None:
                evts.append(self._couler(n, m, "choc" if sid in heurtes else "recif"))
        v_mid = {u: self.champ(u) for u in uids}

        # 3. Tirs simultanés.
        degats: dict = {}
        par_qui: dict = {}
        revel: dict = {}
        for sid in sorted(plan):
            action, n = plan[sid]["action"], self.n(sid)
            if action["type"] != "tir" or n["coule"] is not None:
                continue
            cible = self.n(action["cible"])
            proprio = n["uid"]
            raison = ""
            if cible is None or cible["coule"] is not None:
                raison = "la cible a déjà sombré"
            elif not (tuple(cible["pos"]) in v_mid[proprio]
                      or (cible["id"] in demasques_avant[proprio] and cible["id"] not in a_bouge)):
                raison = "la cible s'est perdue de vue"
            else:
                ok, raison = tir_possible(carte, n["classe"], n["pos"], cible["pos"])
            if raison:
                evts.append({"t": "tir_annule", "id": sid, "cible": action["cible"], "raison": raison})
                continue
            garde = plan.get(cible["id"], {}).get("action", {}).get("type") == "garde"
            p = chance(d["meteo"], n["classe"], cible["classe"], distance(n["pos"], cible["pos"]),
                       garde, sid in a_bouge)
            r = alea.flottant() * 100
            touche = r < p
            critique = touche and r < p * PART_CRITIQUE
            dg = (CLASSES[n["classe"]]["degats"] + (1 if critique else 0)) if touche else 0
            st = self.j(proprio)["stats"]
            st["tirs"] += 1
            if touche:
                st["touches"] += 1
                st["degats"] += dg
                degats[cible["id"]] = degats.get(cible["id"], 0) + dg
                par_qui.setdefault(cible["id"], {}).setdefault(proprio, 0)
                par_qui[cible["id"]][proprio] += dg
            revel.setdefault(cible["uid"], set()).add(sid)
            evts.append({"t": "tir", "de": sid, "vers": cible["id"], "pos_de": list(n["pos"]),
                         "pos_vers": list(cible["pos"]), "chance": p, "touche": touche,
                         "critique": critique, "degats": dg})
        for cid in sorted(degats):
            c = self.n(cid)
            c["coque"] -= degats[cid]
            if c["coque"] <= 0 and c["coule"] is None:
                qui = par_qui[cid]
                vainqueur = sorted(qui, key=lambda u: (-qui[u], u))[0]
                if vainqueur != c["uid"]:
                    self.j(vainqueur)["stats"]["coules"] += 1
                evts.append(self._couler(c, m, "tir", vainqueur))

        # 4. Réparations, éliminations.
        for n in d["navires"]:
            if n["coule"] is None and terrain(carte, n["pos"]) == "P" and n["coque"] < n["max"]:
                n["coque"] += 1
                evts.append({"t": "reparation", "id": n["id"], "pos": list(n["pos"])})
        for x in d["joueurs"]:
            if x["elimine"] is None and not x["abandon"] and not self.flotte(x["uid"]):
                x["elimine"] = m
                publics.append({"t": "elimine", "uid": x["uid"]})

        # 5. Filtrage par joueur, puis manche suivante.
        for x in d["joueurs"]:
            u = x["uid"]
            vus = [e for e in (self._filtrer(e, u, v_avant[u], v_mid[u]) for e in evts) if e]
            mem = d["memoire"].setdefault(u, {})
            for e in vus:          # sorti de vue en route : on retient la dernière case aperçue
                if e["t"] == "mouv" and not e.get("fin_vue", True):
                    mem[e["id"]] = {"pos": e["chemin"][-1], "manche": m}
            hist = d["historique"].setdefault(u, [])
            hist.append({"manche": m, "evts": vus + publics})
            del hist[:-MAX_HISTORIQUE]
        d["revelations"] = {u: sorted(s) for u, s in revel.items()}
        d["ordres"] = {}
        for x in d["joueurs"]:
            x["verrou"] = False
        if not self._verifier_fin(maintenant, m):
            d["meteo"] = d["prevision"]
            d["prevision"] = tirer_meteo(d["meteo"], Alea(d["sel"], "meteo", m + 1))
            d["manche"] = m + 1
            d.update(phase="resolution", echeance=maintenant + DUREES["resolution"])
        self._memoriser()

    def _couler(self, n: dict, m: int, cause: str, par: str = "") -> dict:
        n["coule"] = m
        n["coque"] = 0
        self.j(n["uid"])["stats"]["perdus"] += 1
        e = {"t": "coule", "id": n["id"], "uid": n["uid"], "classe": n["classe"], "nom": n["nom"],
             "pos": list(n["pos"]), "cause": cause}
        if par:
            e["par"] = par
        return e

    def _abandonner(self, x: dict, raison: str) -> list:
        x["abandon"] = True
        out = [{"t": "abandon", "uid": x["uid"], "raison": raison}]
        for n in self.flotte(x["uid"]):
            e = self._couler(n, self.d["manche"], "abandon")
            e.pop("pos")
            out.append(e)
        return out

    def quitter(self, uid: str, maintenant: float):
        """Un capitaine quitte : au salon il s'en va, en mer il amène son pavillon."""
        d = self.d
        if d["phase"] == "salon":
            return self.retirer(uid)
        x = self.j(uid)
        if x is None or x["abandon"] or x["elimine"] is not None or d["phase"] == "fin":
            return
        evts = self._abandonner(x, "a quitté la partie")
        for y in d["joueurs"]:
            d["historique"].setdefault(y["uid"], []).append({"manche": d["manche"], "evts": evts})
        d["ordres"].pop(uid, None)
        self._verifier_fin(maintenant, d["manche"])
        self._memoriser()

    def _filtrer(self, e: dict, u: str, v_avant: set, v_mid: set) -> dict | None:
        """Ce que le capitaine u a le droit de savoir de l'événement e."""
        def a_moi(sid):
            n = self.n(sid)
            return n is not None and n["uid"] == u
        vu = v_avant | v_mid
        t = e["t"]
        if t == "mouv":
            if a_moi(e["id"]):
                return e
            chemin = [c for c in e["chemin"] if tuple(c) in vu]
            if not chemin:
                return None
            fin_vue = tuple(e["chemin"][-1]) in v_mid
            return {"t": "mouv", "id": e["id"], "chemin": chemin, "cap": e["cap"] if fin_vue else None,
                    "debut_vu": tuple(e["chemin"][0]) in v_avant, "fin_vue": fin_vue}
        if t == "choc":
            if any(a_moi(s) for s in e["ids"]) or tuple(e["pos"]) in vu:
                return e
            return None
        if t in ("recif", "reparation"):
            return e if a_moi(e["id"]) or tuple(e["pos"]) in v_mid else None
        if t == "tir_annule":
            return e if a_moi(e["id"]) else None
        if t == "tir":
            tireur, cible = a_moi(e["de"]), a_moi(e["vers"])
            voit_de, voit_vers = tuple(e["pos_de"]) in v_mid, tuple(e["pos_vers"]) in v_mid
            if tireur or cible or (voit_de and voit_vers):
                return e          # la cible voit l'éclair du tireur : il est démasqué
            if voit_vers:
                return {**e, "de": None, "pos_de": None}
            if voit_de:
                return {"t": "tir", "de": e["de"], "pos_de": e["pos_de"], "vers": None, "pos_vers": None,
                        "chance": None, "touche": None, "critique": None, "degats": None}
            return None
        if t == "coule":
            if a_moi(e["id"]) or tuple(e["pos"]) in v_mid:
                return e
            return {k: v for k, v in e.items() if k != "pos"}
        return e

    # ── fin ──
    def _verifier_fin(self, maintenant: float, m: int) -> bool:
        d = self.d
        actifs = self.actifs()
        limite = m >= d["options"]["manches"]
        if len(actifs) > 1 and not limite:
            return False
        if len(actifs) == 1:
            gagnants, raison = [actifs[0]["uid"]], "derniere_flotte"
        elif actifs:
            cle = self._cle_depart
            top = max(cle(x) for x in actifs)
            gagnants, raison = [x["uid"] for x in actifs if cle(x) == top], "limite"
        else:   # anéantissement mutuel : départage aux dégâts parmi les derniers coulés
            derniers = [x for x in d["joueurs"] if x["elimine"] == m]
            if derniers:
                top = max(x["stats"]["degats"] for x in derniers)
                gagnants = [x["uid"] for x in derniers if x["stats"]["degats"] == top]
            else:
                gagnants = []
            raison = "aneantissement"
        d.update(phase="fin", echeance=None,
                 fin={"gagnants": gagnants, "raison": raison, "manches": m,
                      "duree": round(maintenant - (d["debut"] or maintenant)),
                      "classement": self._classement()})
        return True

    def _cle_depart(self, x: dict) -> tuple:
        fl = self.flotte(x["uid"])
        return (len(fl), sum(n["coque"] for n in fl), x["stats"]["degats"])

    def _classement(self) -> list:
        def cle(x):
            if x["abandon"]:
                return (0, 0, 0, 0)
            if x["elimine"] is not None:
                return (1, x["elimine"], x["stats"]["degats"], 0)
            return (2,) + self._cle_depart(x)
        tri = sorted(self.d["joueurs"], key=lambda x: (cle(x), x["uid"]), reverse=True)
        out, rang, prec = [], 0, None
        for i, x in enumerate(tri):
            if cle(x) != prec:
                rang, prec = i + 1, cle(x)
            fl = self.flotte(x["uid"])
            st = x["stats"]
            out.append({"uid": x["uid"], "rang": rang, "navires": len(fl), "coque": sum(n["coque"] for n in fl),
                        "precision": round(100 * st["touches"] / st["tirs"]) if st["tirs"] else None,
                        "elimine": x["elimine"], "abandon": x["abandon"], **st})
        return out


# ─────────────────────────── Bots d'entraînement ───────────────────────────
def ordres_bot(p: Partie, uid: str) -> dict:
    """Capitaine automatique : ne connaît que ce que sa propre vue lui montre (vision et
    dernières positions connues), comme un humain. Simple, mais il manœuvre et tire."""
    d, carte = p.d, p.d["carte"]
    a = Alea(d["sel"], "bot", uid, d["manche"])
    vus = p.visibles(uid)
    souvenirs = [tuple(s["pos"]) for sid, s in sorted(d["memoire"].get(uid, {}).items())
                 if sid not in {x["id"] for x in vus}]
    occupees = {tuple(e["pos"]) for e in vus}
    reservees: set = set()
    centre = (carte["l"] // 2, carte["h"] // 2)
    ordres = {}
    for n in sorted(p.flotte(uid), key=lambda x: x["id"]):
        k = CLASSES[n["classe"]]
        acces = atteignables(carte, d["meteo"], n["classe"], n["pos"])
        if vus:
            ideal = k["portee"] - (1 if k["lourd"] else 0)

            def score(cell):
                # meilleur tir espéré depuis cette case, moins le danger et l'écart à la portée idéale
                bouge = cell != tuple(n["pos"])
                tir = max((chance(d["meteo"], n["classe"], e["classe"], distance(cell, e["pos"]), False, bouge)
                           for e in vus if tir_possible(carte, n["classe"], cell, e["pos"])[0]), default=0)
                dmin = min(distance(cell, e["pos"]) for e in vus)
                menace = sum(1 for e in vus if distance(cell, e["pos"]) <= CLASSES[e["classe"]]["portee"])
                return tir * k["degats"] / 20 - abs(dmin - ideal) - menace * (1.2 if k["coque"] < 5 else 0.5)
        else:   # cap stable sur plusieurs manches : dernier souvenir, sinon les départs adverses
            deps = carte["departs"]
            but = souvenirs[0] if souvenirs else (
                tuple(deps[(int(n["id"][1:]) + d["manche"] // 5) % len(deps)]) if d["manche"] > 2 else centre)

            def score(cell):
                return -distance(cell, but)
        meilleur, meilleur_s = tuple(n["pos"]), None
        for cell in sorted(acces):
            if cell in occupees or cell in reservees:
                continue
            s = score(cell) + a.flottant() * 0.4
            t = terrain(carte, cell)
            if t == "^":
                s -= 5
            elif t == "P" and n["coque"] < n["max"]:
                s += 2
            if meilleur_s is None or s > meilleur_s:
                meilleur, meilleur_s = cell, s
        reservees.add(meilleur)
        action = {"type": "garde"}
        choix = []
        for e in vus:
            ok, _ = tir_possible(carte, n["classe"], meilleur, e["pos"])
            if ok:
                c = chance(d["meteo"], n["classe"], e["classe"], distance(meilleur, e["pos"]),
                           False, meilleur != tuple(n["pos"]))
                choix.append((c * k["degats"] + (20 if e["coque"] <= k["degats"] else 0), e["id"]))
        if choix:
            action = {"type": "tir", "cible": max(choix)[1]}
        ordres[n["id"]] = {"chemin": [list(c) for c in acces.get(meilleur, [])], "action": action}
    return ordres


# ─────────────────────────── Vue filtrée ───────────────────────────
def _public_navire(n: dict) -> dict:
    return {k: n[k] for k in ("id", "uid", "classe", "nom", "pos", "cap", "coque", "max")}


def vue(d: dict, uid: str, maintenant: float) -> dict:
    """Ce que ce participant a le droit de voir — rien de caché ne quitte le serveur."""
    p = Partie(d)
    moi = p.j(uid)
    joueurs = []
    for x in d["joueurs"]:
        fl = p.flotte(x["uid"])
        joueurs.append({
            "uid": x["uid"], "nom": x["nom"], "avatar": x["avatar"], "bot": x["bot"],
            "pavillon": x["pavillon"], "pret": x["pret"], "verrou": x["verrou"],
            "elimine": x["elimine"], "abandon": x["abandon"], "navires": len(fl),
        })
    v = {
        "id": d["id"], "phase": d["phase"], "manche": d["manche"], "hote": d["hote"],
        "options": d["options"], "echeance": d["echeance"], "maintenant": maintenant,
        "joueurs": joueurs, "moi": uid if moi else None,
        "graine": d["graine"] if d["phase"] == "fin" else None,
        "carte": d["carte"], "meteo": d["meteo"], "prevision": d["prevision"],
        "navires": [], "fantomes": [], "ordres": {}, "cibles": {}, "historique": [],
        "absences": moi["absences"] if moi else 0, "absences_max": ABSENCES_MAX,
        "stats": moi["stats"] if moi else None, "fin": d["fin"],
    }
    if d["phase"] == "salon":
        return v
    if d["phase"] == "fin":
        v["navires"] = [{**_public_navire(n), "coule": n["coule"]} for n in d["navires"]]
    elif moi:
        vus = p.visibles(uid)
        mien = p.flotte(uid)
        v["navires"] = [_public_navire(n) for n in mien + vus]
        ids_vus = {n["id"] for n in vus}
        for sid, s in sorted(d["memoire"].get(uid, {}).items()):
            n = p.n(sid)
            if sid not in ids_vus and n is not None and n["coule"] is None:
                v["fantomes"].append({"id": sid, "uid": n["uid"], "classe": n["classe"], "nom": n["nom"],
                                      "pos": s["pos"], "manche": s["manche"]})
        v["ordres"] = d["ordres"].get(uid, {})
        v["demasques"] = sorted(set(d["revelations"].get(uid, [])) & ids_vus)
        for n in mien:
            lst = []
            for e in vus:
                ok, raison = tir_possible(d["carte"], n["classe"], n["pos"], e["pos"])
                dist = distance(n["pos"], e["pos"])
                lst.append({"id": e["id"], "distance": dist, "possible": ok, "raison": raison,
                            "chance": chance(d["meteo"], n["classe"], e["classe"], dist)})
            v["cibles"][n["id"]] = lst
    if moi:
        v["historique"] = d["historique"].get(uid, [])
    return v
