"""Les Ombres de la Taverne — règles du jeu, en Python pur (aucune dépendance Discord).

Une partie est un simple dict JSON (persisté tel quel par ``ombres.py``) ; ``Partie``
l'enveloppe avec un générateur aléatoire et une horloge injectés, pour que les tests
puissent jouer des parties entières sans bot ni attente.

Déroulé : hall → distribution → [nuit → (alchimie) → aube → (videur) → débat → conseil
→ verdict → (videur)] … → fin.

Rôles (10) — camp Taverne : Habitué, Inquisiteur, Alchimiste, Paladin, Videur, Tavernier ;
camp des Ombres : Cultiste, Voix de l'Ombre ; solitaires : Barde, Ragequit.

Résolution de la nuit, dans cet ordre :
1. le Tavernier sert une tournée : l'action de nuit de sa cible est annulée ;
2. le Paladin protège (des Ombres seulement, pas du poison) ;
3. les Ombres frappent (la Voix peut convertir au lieu de tuer, une fois) ;
4. l'Alchimiste — dans une seconde fenêtre, la cible des Ombres sous les yeux — sauve
   et/ou empoisonne ;
5. l'Inquisiteur reçoit le camp de sa cible (avant conversion) ;
6. le Barde enchante deux âmes.

Victoire : plus aucune Ombre → Taverne ; Ombres ≥ autres vivants → Ombres ; tous les
autres vivants enchantés → Barde ; Ragequit chassé par le Conseil du 1er jour → il gagne
seul de son côté, la partie continue pour les autres.

Les morts deviennent les Âmes de l'âtre : chaque nuit elles votent pour l'Événement de
taverne (carte) qui sera tiré à l'aube et pèsera sur la journée et la nuit suivantes.

``vue()`` construit ce que chaque participant a le droit de voir : rien de secret ne
quitte le serveur.
"""
from __future__ import annotations

import random
import time
import uuid

MIN_JOUEURS, MAX_JOUEURS = 6, 16

ROLES = {
    "habitue": {"nom": "L'Habitué", "camp": "taverne", "nuit": False},
    "inquisiteur": {"nom": "L'Inquisiteur", "camp": "taverne", "nuit": True},
    "alchimiste": {"nom": "L'Alchimiste", "camp": "taverne", "nuit": True},
    "paladin": {"nom": "Le Paladin", "camp": "taverne", "nuit": True},
    "videur": {"nom": "Le Videur", "camp": "taverne", "nuit": False},
    "tavernier": {"nom": "Le Tavernier", "camp": "taverne", "nuit": True},
    "cultiste": {"nom": "Le Cultiste de l'Ombre", "camp": "ombres", "nuit": True},
    "voix": {"nom": "La Voix de l'Ombre", "camp": "ombres", "nuit": True},
    "barde": {"nom": "Le Barde", "camp": "barde", "nuit": True},
    "ragequit": {"nom": "Le Ragequit", "camp": "ragequit", "nuit": False},
}
CAMPS = {"taverne": "la Taverne", "ombres": "les Ombres", "barde": "le Barde", "ragequit": "le Ragequit"}
# Rôles spéciaux ajoutés selon le nombre de joueurs (retirables par l'hôte avant la partie).
SPECIAUX = [(6, "inquisiteur"), (6, "alchimiste"), (7, "paladin"), (8, "videur"), (9, "ragequit"),
            (11, "tavernier"), (12, "barde")]
RETIRABLES = {r for _, r in SPECIAUX} | {"voix"}

EVENEMENTS = {
    "pleine_lune": {"nom": "Pleine Lune", "texte": "La nuit prochaine, les Ombres frappent deux fois."},
    "tempete": {"nom": "Tempête magique", "texte": "La nuit prochaine, le bouclier du Paladin ne protège personne."},
    "brouillard": {"nom": "Brouillard des marais", "texte": "La nuit prochaine, l'Alchimiste ne voit pas la victime des Ombres."},
    "lanterne": {"nom": "Lanterne sourde", "texte": "La nuit prochaine, l'Inquisiteur sonde deux âmes."},
    "rumeur": {"nom": "Rumeur de comptoir", "texte": "Un convive qui n'est pas une Ombre est innocenté devant tous."},
    "biere": {"nom": "Bière frelatée", "texte": "Un convive tiré au sort perd sa voix au Conseil d'aujourd'hui."},
    "couvre_feu": {"nom": "Couvre-feu", "texte": "Le débat d'aujourd'hui est deux fois plus court."},
    "bulletins": {"nom": "Bulletins cachetés", "texte": "Le vote du Conseil reste secret jusqu'au dépouillement."},
    "calme": {"nom": "Nuit sans lune", "texte": "Rien d'étrange… pour l'instant."},
}

DUREES = {"distribution": 14, "nuit": 45, "alchimie": 20, "aube": 16, "videur": 25,
          "debat": 180, "conseil": 60, "verdict": 10}
# Bornes des durées réglables par l'hôte (secondes).
BORNES = {"nuit": (20, 120), "debat": (45, 600), "conseil": (20, 180)}
PHASES = ("hall", "distribution", "nuit", "alchimie", "aube", "videur", "debat", "conseil", "verdict", "fin")
MAX_TESTAMENT = 80
MAX_CONCILIABULE = 60
MAX_JOURNAL = 300

NOMS_PANTINS = ["Bartholomé", "Gudrun", "Ysolde", "Merwin", "Hilde", "Aldric", "Brunehaut", "Thibaut",
                "Ondine", "Gaspard", "Mahaut", "Enguerrand", "Clotilde", "Perceval", "Sidonie", "Anselme"]
TESTAMENTS_PANTINS = ["Méfiez-vous de celui qui sourit.", "J'aurais dû finir ma chope.",
                      "Regardez sous la table.", "Le Barde ment toujours.", "Je reviendrai hanter la cave."]


def nom_role(role: str) -> str:
    """Nom du rôle en milieu de phrase : « c'était l'Alchimiste », « c'était le Paladin »."""
    n = ROLES[role]["nom"]
    return n[0].lower() + n[1:] if n[:2] in ("L'", "Le", "La") else n


class Refus(ValueError):
    """Geste refusé (message lisible renvoyé tel quel au joueur)."""


def composition(n: int, retraits=()) -> list[str]:
    """Distribution des rôles pour ``n`` joueurs (6 à 16)."""
    nb_ombres = 1 if n <= 7 else 2 if n <= 10 else 3 if n <= 13 else 4
    roles = ["cultiste"] * nb_ombres
    if n >= 14 and "voix" not in retraits:
        roles[0] = "voix"
    for seuil, r in SPECIAUX:
        if n >= seuil and r not in retraits:
            roles.append(r)
    return roles + ["habitue"] * (n - len(roles))


def nouvelle(hote: dict, mode: str = "auto", mj: str = "") -> dict:
    """Partie vierge, au hall (inscriptions)."""
    return {
        "id": uuid.uuid4().hex[:10], "phase": "hall", "jour": 0, "nuit": 0,
        "mode": "mj" if mode == "mj" and mj else "auto", "mj": mj if mode == "mj" else "",
        "hote": hote.get("uid", ""),
        "options": {"evenements": True, "retraits": [], "nuit": DUREES["nuit"],
                    "debat": DUREES["debat"], "conseil": DUREES["conseil"]},
        "joueurs": [], "echeance": None, "pause": None,
        "nuit_etat": {}, "votes": {}, "pret_vote": [], "muet": "", "evenement": None,
        "ames": {"cartes": [], "votes": {}},
        "memo": {"paladin_dernier": "", "tavernier_dernier": "", "fiole_vie": True, "fiole_mort": True,
                 "voix_utilisee": False, "ragequit_gagnant": ""},
        "aube": None, "videur": {"attente": [], "retour": ""}, "verdict": None,
        "infos": {}, "conciliabule": [], "journal": [], "fin": None,
        "cree": time.time(),
    }


class Partie:
    def __init__(self, d: dict, rng: random.Random | None = None, horloge=time.time):
        self.d = d
        self.rng = rng or random.Random()
        self.maintenant = horloge

    # ─────────────── Accès ───────────────
    def j(self, uid) -> dict | None:
        return next((x for x in self.d["joueurs"] if x["uid"] == uid), None)

    def vivants(self) -> list[dict]:
        return [x for x in self.d["joueurs"] if x["vivant"]]

    def du_role(self, *roles) -> list[dict]:
        return [x for x in self.vivants() if x["role"] in roles]

    def ombres(self) -> list[dict]:
        return [x for x in self.vivants() if x["camp"] == "ombres"]

    def _vivant(self, uid, quoi="cette cible") -> dict:
        x = self.j(uid)
        if x is None or not x["vivant"]:
            raise Refus(f"{quoi} n'est pas (ou plus) à table")
        return x

    def evenement(self) -> str | None:
        return self.d.get("evenement")

    def journal(self, texte: str, type_: str = "recit", pour="public", **extra):
        self.d["journal"].append({"id": uuid.uuid4().hex[:8], "t": self.maintenant(), "type": type_,
                                  "texte": texte, "pour": pour, "jour": self.d["jour"], **extra})
        self.d["journal"] = self.d["journal"][-MAX_JOURNAL:]

    def info(self, uid: str, texte: str, nature: str = "info"):
        self.d["infos"].setdefault(uid, []).append(
            {"t": self.maintenant(), "nuit": self.d["nuit"], "jour": self.d["jour"], "texte": texte, "nature": nature})
        self.journal(f"{self.nom(uid)} — {texte}", "secret", pour="mj")

    def nom(self, uid) -> str:
        x = self.j(uid)
        return x["nom"] if x else "?"

    def _echeance(self, secondes: float | None):
        self.d["echeance"] = None if secondes is None else self.maintenant() + secondes
        self.d["pause"] = None
        self.d["debut"] = self.maintenant()

    # ─────────────── Hall ───────────────
    def rejoindre(self, qui: dict, pantin: bool = False):
        d = self.d
        if d["phase"] != "hall":
            raise Refus("la partie a déjà commencé")
        if qui["uid"] == d["mj"]:
            raise Refus("le MJ ne joue pas : il mène la partie")
        if self.j(qui["uid"]):
            return
        if len(d["joueurs"]) >= MAX_JOUEURS:
            raise Refus(f"la table est pleine ({MAX_JOUEURS} places)")
        d["joueurs"].append({
            "uid": qui["uid"], "nom": str(qui.get("nom") or "?")[:32], "avatar": qui.get("avatar", ""),
            "pantin": pantin, "role": "", "camp": "", "vivant": True, "revele": False, "enchante": False,
            "testament": "", "mort": None,
        })
        if not d["hote"]:
            d["hote"] = qui["uid"]

    def ajouter_pantin(self):
        pris = {x["nom"] for x in self.d["joueurs"]}
        nom = next((n for n in NOMS_PANTINS if n not in pris), "Pantin %d" % len(self.d["joueurs"]))
        self.rejoindre({"uid": "pantin-" + uuid.uuid4().hex[:6], "nom": nom, "avatar": ""}, pantin=True)
        self.j(self.d["joueurs"][-1]["uid"])["testament"] = self.rng.choice(TESTAMENTS_PANTINS)

    def quitter(self, uid: str):
        d = self.d
        if d["phase"] != "hall":
            raise Refus("on ne quitte pas la table en pleine partie (le MJ peut t'exclure)")
        d["joueurs"] = [x for x in d["joueurs"] if x["uid"] != uid]
        if d["hote"] == uid:
            humains = [x for x in d["joueurs"] if not x["pantin"]]
            d["hote"] = humains[0]["uid"] if humains else ""

    def regler(self, opts: dict):
        if self.d["phase"] != "hall":
            raise Refus("les réglages se figent au lancement")
        o = self.d["options"]
        if "evenements" in opts:
            o["evenements"] = bool(opts["evenements"])
        if isinstance(opts.get("retraits"), list):
            o["retraits"] = sorted({str(r) for r in opts["retraits"]} & RETIRABLES)
        for k, (mini, maxi) in BORNES.items():
            if k in opts:
                try:
                    o[k] = max(mini, min(maxi, int(opts[k])))
                except (TypeError, ValueError):
                    pass

    def lancer(self):
        d = self.d
        n = len(d["joueurs"])
        if d["phase"] != "hall":
            raise Refus("la partie est déjà lancée")
        if n < MIN_JOUEURS:
            raise Refus(f"il faut au moins {MIN_JOUEURS} convives (vous êtes {n})")
        roles = composition(n, d["options"]["retraits"])
        self.rng.shuffle(roles)
        self.rng.shuffle(d["joueurs"])              # places autour de la table tirées au sort
        for x, r in zip(d["joueurs"], roles):
            x.update(role=r, camp=ROLES[r]["camp"], vivant=True, revele=False, enchante=False, mort=None)
        d["phase"] = "distribution"
        self._echeance(DUREES["distribution"])
        compo = ", ".join(sorted({nom_role(r) for r in roles}, key=lambda n: n[2:] if n.startswith("l'") else n.split(" ", 1)[-1]))
        self.journal(f"{n} convives prennent place autour de la table. Dans la salle : {compo}.", "recit")
        for x in d["joueurs"]:
            if x["camp"] == "ombres":
                autres = [self.nom(o["uid"]) for o in d["joueurs"] if o["camp"] == "ombres" and o is not x]
                self.info(x["uid"], "Tes frères de l'Ombre : " + (", ".join(autres) or "personne — tu es seul"), "ombres")

    # ─────────────── Machine à états ───────────────
    def avancer(self):
        """Fin de la phase courante (échéance atteinte, ou tout le monde a joué)."""
        p = self.d["phase"]
        if p == "distribution":
            self._entrer_nuit()
        elif p == "nuit":
            self._fin_nuit()
        elif p == "alchimie":
            self._resoudre_nuit()
        elif p == "aube":
            if not self.d["aube"].get("proclamee"):
                return                                # le MJ (ou le narrateur) n'a pas encore parlé
            self._apres_morts("aube")
        elif p == "videur":
            self._fin_videur()
        elif p == "debat":
            self._entrer_conseil()
        elif p == "conseil":
            self._depouiller()
        elif p == "verdict":
            self._apres_morts("verdict")

    def _apres_morts(self, depuis: str):
        if self.d["videur"]["attente"]:
            self.d["videur"]["retour"] = "debat" if depuis == "aube" else "nuit"
            self._entrer_videur()
            return
        if self._verifier_victoire():
            return
        if depuis == "aube":
            self._entrer_debat()
        else:
            self._entrer_nuit()

    # ── Nuit ──
    def _entrer_nuit(self):
        d = self.d
        d["phase"] = "nuit"
        d["nuit"] += 1
        d["nuit_etat"] = {"actions": {}, "votes_ombres": {}, "faits": []}
        d["votes"], d["pret_vote"], d["muet"] = {}, [], ""
        if d["options"]["evenements"]:
            pool = [k for k in EVENEMENTS if k != d.get("evenement")]
            d["ames"] = {"cartes": self.rng.sample(pool, 3), "votes": {}}
        else:
            d["ames"] = {"cartes": [], "votes": {}}
        self._echeance(d["options"]["nuit"])
        self.journal(f"La nuit {d['nuit']} tombe sur la taverne. Les chandelles s'éteignent une à une…", "recit")
        self._pantins_nuit()

    def acteurs_nuit(self) -> list[dict]:
        """Vivants qui ont une action à faire cette nuit (fenêtre principale)."""
        return [x for x in self.vivants() if x["role"] in ("inquisiteur", "paladin", "tavernier", "barde", "cultiste", "voix")]

    def nuit_complete(self) -> bool:
        ne = self.d["nuit_etat"]
        for x in self.acteurs_nuit():
            if x["camp"] == "ombres":
                if x["uid"] not in ne["votes_ombres"]:
                    return False
            if x["role"] != "cultiste" and x["uid"] not in ne["actions"]:
                return False
        return True

    def agir(self, uid: str, a: dict):
        """Action de nuit (fenêtre principale) ou de l'Alchimiste (seconde fenêtre)."""
        d = self.d
        x = self._vivant(uid, "tu")
        ne = d["nuit_etat"]
        if d["phase"] == "alchimie":
            return self._agir_alchimie(x, a)
        if d["phase"] != "nuit":
            raise Refus("ce n'est pas la nuit")
        r = x["role"]
        passer = bool(a.get("passer"))
        if x["camp"] == "ombres" and "vote" in a:
            cible = a.get("vote") or ""
            if cible:
                c = self._vivant(cible)
                if c["camp"] == "ombres":
                    raise Refus("on ne dévore pas les siens")
            ne["votes_ombres"][uid] = cible
            if r == "cultiste":
                return
        if r == "cultiste":
            if passer:
                ne["votes_ombres"].setdefault(uid, "")
                return
            raise Refus("désigne une victime")
        if r not in ("inquisiteur", "paladin", "tavernier", "barde", "voix"):
            raise Refus("ton rôle dort la nuit")
        if passer:
            ne["actions"][uid] = {"passe": True}
            return
        if r == "voix":
            ne["actions"][uid] = {"convertir": bool(a.get("convertir")) and not d["memo"]["voix_utilisee"]}
            return
        cibles = a.get("cibles") if isinstance(a.get("cibles"), list) else [a.get("cible")] if a.get("cible") else []
        cibles = [c for i, c in enumerate(cibles) if c and c not in cibles[:i]]
        maxi = 2 if r == "barde" or (r == "inquisiteur" and self.evenement() == "lanterne") else 1
        if not cibles or len(cibles) > maxi:
            raise Refus(f"choisis {'une ou deux âmes' if maxi == 2 else 'une âme'}")
        for c in cibles:
            cx = self._vivant(c)
            if c == uid and r != "paladin":
                raise Refus("pas toi-même")
            if r == "paladin" and c == d["memo"]["paladin_dernier"]:
                raise Refus("ton bouclier ne protège pas deux nuits de suite la même âme")
            if r == "tavernier" and c == d["memo"]["tavernier_dernier"]:
                raise Refus("tu as déjà servi cette âme la nuit dernière")
            if r == "barde" and cx["enchante"]:
                raise Refus(f"{cx['nom']} est déjà sous le charme")
        ne["actions"][uid] = {"cibles": cibles}

    def _cibles_ombres(self, bloque: str) -> list[str]:
        """Victime(s) désignée(s) par les Ombres (votes des Ombres non servies)."""
        ne = self.d["nuit_etat"]
        compte: dict[str, int] = {}
        for o in self.ombres():
            c = ne["votes_ombres"].get(o["uid"])
            if o["uid"] != bloque and c and self.j(c) and self.j(c)["vivant"]:
                compte[c] = compte.get(c, 0) + 1
        ordre = sorted(compte, key=lambda c: (-compte[c], self.rng.random()))
        return ordre[:2 if self.evenement() == "pleine_lune" else 1]

    def _bloque(self) -> str:
        t = next((x for x in self.du_role("tavernier")), None)
        act = self.d["nuit_etat"]["actions"].get(t["uid"]) if t else None
        return (act or {}).get("cibles", [""])[0] if act and not act.get("passe") else ""

    def _fin_nuit(self):
        d = self.d
        ne = d["nuit_etat"]
        bloque = self._bloque()
        ne["bloque"] = bloque
        ne["cibles"] = self._cibles_ombres(bloque)
        alchi = next(iter(self.du_role("alchimiste")), None)
        if alchi:
            # Toujours une seconde fenêtre tant que l'Alchimiste vit : sa durée ne doit rien
            # trahir (tournée du Tavernier, fioles déjà vides).
            d["phase"] = "alchimie"
            ne["alchimie"] = {}
            if not (d["memo"]["fiole_vie"] or d["memo"]["fiole_mort"]):
                ne["alchimie"] = {"fait": True}
                self._echeance(4 + self.rng.random() * 6)
            elif alchi["uid"] == bloque:
                ne["alchimie"] = {"fait": True}
                self.info(alchi["uid"], "Le Tavernier t'a servi une tournée : tes fioles restent bouchées cette nuit.", "tournee")
                self._echeance(4 + self.rng.random() * 6)       # ne trahit pas la tournée par un saut immédiat
            else:
                self._echeance(DUREES["alchimie"])
                self._pantins_alchimie(alchi)
        else:
            self._resoudre_nuit()

    def _agir_alchimie(self, x: dict, a: dict):
        d = self.d
        if x["role"] != "alchimiste":
            raise Refus("seule l'Alchimiste veille encore")
        al = d["nuit_etat"].setdefault("alchimie", {})
        if al.get("fait"):
            raise Refus("tes fioles sont rangées pour cette nuit")
        vie, mort = a.get("vie") or "", a.get("mort") or ""
        if vie:
            if not d["memo"]["fiole_vie"]:
                raise Refus("ta fiole de vie est vide")
            if vie not in d["nuit_etat"]["cibles"] or self.evenement() == "brouillard":
                raise Refus("la fiole de vie ne sauve que la victime des Ombres")
        if mort:
            if not d["memo"]["fiole_mort"]:
                raise Refus("ta fiole de mort est vide")
            if mort == x["uid"]:
                raise Refus("pas toi-même")
            self._vivant(mort)
        d["nuit_etat"]["alchimie"] = {"vie": vie, "mort": mort, "fait": True}

    def _resoudre_nuit(self):
        d = self.d
        ne = d["nuit_etat"]
        act = ne["actions"]
        bloque = ne.get("bloque", "")
        cibles = ne.get("cibles", [])
        mj = []                                         # détail réservé au MJ
        morts: list[tuple[str, str]] = []

        def agit(role):
            x = next(iter(self.du_role(role)), None)
            if x is None or x["uid"] == bloque:
                return None, None
            a = act.get(x["uid"])
            return x, (a if a and not a.get("passe") else None)

        # 1. Tournée du Tavernier
        tav, a_tav = agit("tavernier")
        if tav and a_tav:
            c = self.j(bloque)
            eveille = ROLES[c["role"]]["nuit"]
            d["memo"]["tavernier_dernier"] = bloque
            self.info(tav["uid"], f"{c['nom']} {'était bien éveillé cette nuit…' if eveille else 'dormait comme un loir.'}", "tavernier")
            if c["role"] != "alchimiste":
                self.info(bloque, "Le Tavernier t'a servi une tournée : tu as dormi d'une traite, sans agir.", "tournee")
            mj.append(f"Tavernier → {c['nom']} servi")
        elif tav:
            d["memo"]["tavernier_dernier"] = ""
        # 2. Paladin
        pal, a_pal = agit("paladin")
        protege = ""
        if pal and a_pal:
            protege = a_pal["cibles"][0]
            d["memo"]["paladin_dernier"] = protege
            if self.evenement() == "tempete":
                mj.append(f"Paladin → {self.nom(protege)} (bouclier brisé par la tempête)")
                protege = ""
            else:
                mj.append(f"Paladin → protège {self.nom(protege)}")
        elif pal:
            d["memo"]["paladin_dernier"] = ""
        # 5. (avant conversion) Inquisiteur
        inq, a_inq = agit("inquisiteur")
        if inq and a_inq:
            for c in a_inq["cibles"]:
                cx = self.j(c)
                camp = {"taverne": "au camp de la Taverne", "ombres": "aux OMBRES"}.get(cx["camp"], "à lui seul : c'est un solitaire")
                self.info(inq["uid"], f"Tu sondes l'âme de {cx['nom']} : elle appartient {camp}.", "inquisiteur")
        # 3. Ombres (+ Voix)
        voix, a_voix = agit("voix")
        convertir = bool(a_voix and a_voix.get("convertir")) and not d["memo"]["voix_utilisee"]
        al = ne.get("alchimie") or {}
        sauve = al.get("vie", "") if al.get("fait") else ""
        for i, c in enumerate(cibles):
            cx = self.j(c)
            if c == protege:
                mj.append(f"Ombres → {cx['nom']}, sauvé par le Paladin")
                if convertir and i == 0:
                    self.info(voix["uid"], f"Ta voix s'est brisée sur le bouclier qui gardait {cx['nom']}.", "voix")
                continue
            if c == sauve:
                d["memo"]["fiole_vie"] = False
                mj.append(f"Ombres → {cx['nom']}, sauvé par la fiole de vie")
                continue
            if convertir and i == 0:
                d["memo"]["voix_utilisee"] = True
                ancien = cx["role"]
                cx.update(role="cultiste", camp="ombres", enchante=cx["enchante"])
                freres = ", ".join(o["nom"] for o in self.ombres() if o is not cx)
                self.info(cx["uid"], "Une voix murmure dans ton sommeil… Tu rejoins les OMBRES : tu es désormais Cultiste. "
                          "Tes frères : " + freres + ".", "conversion")
                self.info(voix["uid"], f"{cx['nom']} ({ROLES[ancien]['nom']}) a rejoint les Ombres.", "voix")
                mj.append(f"Voix → convertit {cx['nom']} ({ROLES[ancien]['nom']})")
                continue
            morts.append((c, "ombres"))
            mj.append(f"Ombres → dévorent {cx['nom']}")
        if al.get("fait") and al.get("mort"):
            d["memo"]["fiole_mort"] = False
            if not any(m[0] == al["mort"] for m in morts):
                morts.append((al["mort"], "fiole"))
            mj.append(f"Alchimiste → empoisonne {self.nom(al['mort'])}")
        # 6. Barde
        barde, a_barde = agit("barde")
        if barde and a_barde:
            for c in a_barde["cibles"]:
                self.j(c)["enchante"] = True
            mj.append("Barde → enchante " + ", ".join(self.nom(c) for c in a_barde["cibles"]))
            ench = [x["nom"] for x in self.vivants() if x["enchante"]]
            for x in self.vivants():
                if x["enchante"]:
                    self.info(x["uid"], "Une mélodie t'envoûte. Sous le charme : " + ", ".join(ench) + ".", "barde")
        for t in mj:
            self.journal(t, "secret", pour="mj")
        # Âmes de l'âtre : carte de la journée
        carte = None
        if d["ames"]["cartes"]:
            votes = d["ames"]["votes"]
            compte = {k: 0 for k in d["ames"]["cartes"]}
            for v in votes.values():
                if v in compte:
                    compte[v] += 1
            carte = sorted(compte, key=lambda k: (-compte[k], self.rng.random()))[0]
        d["phase"] = "aube"
        d["jour"] += 1
        d["evenement"] = carte
        d["aube"] = {"morts": [{"uid": u, "cause": c} for u, c in morts], "carte": carte,
                     "par_ames": bool(carte and d["ames"]["votes"]), "proclamee": False,
                     "brouillon": "", "texte": ""}
        self._echeance(None)

    def faits_aube(self) -> dict:
        """Faits publics de l'aube (pour le narrateur, sans aucun secret)."""
        a = self.d["aube"]
        return {"jour": self.d["jour"],
                "morts": [{"nom": self.nom(m["uid"]), "role": nom_role(self.j(m["uid"])["role"]), "cause": m["cause"]}
                          for m in a["morts"]],
                "evenement": EVENEMENTS[a["carte"]]["nom"] if a["carte"] else None,
                "vivants": len(self.vivants()) - len(a["morts"])}

    def proclamer(self, texte: str):
        """Publie l'aube : récit, morts révélés, carte de la journée."""
        d = self.d
        a = d["aube"]
        if d["phase"] != "aube" or a["proclamee"]:
            return
        a["proclamee"], a["texte"] = True, texte
        self.journal(texte, "recit", aube=True)
        for m in a["morts"]:
            self._tuer(m["uid"], m["cause"])
        if not a["morts"]:
            self.journal("Personne n'est mort cette nuit.", "recit")
        if a["carte"]:
            ev = EVENEMENTS[a["carte"]]
            par = "Les Âmes de l'âtre ont choisi" if a["par_ames"] else "Le destin tire"
            self.journal(f"{par} : « {ev['nom']} » — {ev['texte']}", "evenement", carte=a["carte"])
            self._appliquer_carte(a["carte"])
        self._echeance(DUREES["aube"])

    def _appliquer_carte(self, carte: str):
        d = self.d
        if carte == "rumeur":
            pool = [x for x in self.vivants() if x["camp"] != "ombres"]
            if pool:
                x = self.rng.choice(pool)
                self.journal(f"La rumeur court : {x['nom']} n'a rien d'une Ombre.", "evenement")
        elif carte == "biere":
            pool = self.vivants()
            if pool:
                x = self.rng.choice(pool)
                d["muet"] = x["uid"]
                self.journal(f"{x['nom']} a bu la bière frelatée : pas de voix au Conseil aujourd'hui.", "evenement")

    def _tuer(self, uid: str, cause: str):
        x = self.j(uid)
        if x is None or not x["vivant"]:
            return
        x.update(vivant=False, revele=True, mort={"jour": self.d["jour"], "cause": cause})
        self.journal(f"{x['nom']} était {nom_role(x['role'])}.", "mort", uid=uid, role=x["role"])
        if x["testament"]:
            self.journal(f"Dernières volontés de {x['nom']} : « {x['testament']} »", "testament", uid=uid)
        if x["role"] == "videur" and cause != "exclu":
            self.d["videur"]["attente"].append(uid)

    # ── Videur ──
    def _entrer_videur(self):
        self.d["phase"] = "videur"
        v = self.j(self.d["videur"]["attente"][0])
        self.journal(f"{v['nom']}, le Videur, se relève une dernière fois et cherche qui jeter dehors avec lui…", "recit")
        self._echeance(DUREES["videur"])
        if v["pantin"]:
            pool = [x for x in self.vivants()]
            if pool:
                self.d["videur"]["cible"] = self.rng.choice(pool)["uid"]
                self._echeance(3)

    def tir_videur(self, uid: str, cible: str):
        d = self.d
        if d["phase"] != "videur" or not d["videur"]["attente"] or d["videur"]["attente"][0] != uid:
            raise Refus("ce n'est pas à toi de jeter quelqu'un dehors")
        self._vivant(cible)
        d["videur"]["cible"] = cible
        self._echeance(2)

    def _fin_videur(self):
        d = self.d
        v = d["videur"]["attente"].pop(0)
        cible = d["videur"].pop("cible", "")
        if cible and self.j(cible)["vivant"]:
            self.journal(f"{self.nom(v)} empoigne {self.nom(cible)} et l'emporte dans sa chute !", "recit")
            self._tuer(cible, "videur")
        else:
            self.journal(f"{self.nom(v)} s'effondre sans emporter personne.", "recit")
        if d["videur"]["attente"]:
            self._entrer_videur()
            return
        if self._verifier_victoire():
            return
        if d["videur"]["retour"] == "debat":
            self._entrer_debat()
        else:
            self._entrer_nuit()

    # ── Jour ──
    def _entrer_debat(self):
        d = self.d
        d["phase"] = "debat"
        duree = d["options"]["debat"] // (2 if self.evenement() == "couvre_feu" else 1)
        self._echeance(duree)
        d["pret_vote"] = []

    def pret_vote(self, uid: str):
        d = self.d
        self._vivant(uid, "tu")
        if d["phase"] != "debat":
            raise Refus("le débat n'est pas en cours")
        if uid not in d["pret_vote"]:
            d["pret_vote"].append(uid)
        if len(d["pret_vote"]) * 2 > len(self.vivants()):
            self._echeance(min(3, max(0, (d["echeance"] or 0) - self.maintenant())))

    def _entrer_conseil(self):
        d = self.d
        d["phase"] = "conseil"
        d["votes"] = {}
        self._echeance(d["options"]["conseil"])
        self.journal(f"La cloche sonne : le Conseil du jour {d['jour']} est ouvert.", "recit")
        for x in self.vivants():
            if x["pantin"] and x["uid"] != d["muet"]:
                pool = [y for y in self.vivants() if y["uid"] != x["uid"]]
                d["votes"][x["uid"]] = self.rng.choice(pool)["uid"] if pool and self.rng.random() > 0.1 else ""

    def votants(self) -> list[dict]:
        return [x for x in self.vivants() if x["uid"] != self.d["muet"]]

    def voter(self, uid: str, cible: str):
        d = self.d
        self._vivant(uid, "tu")
        if d["phase"] != "conseil":
            raise Refus("le Conseil n'est pas ouvert")
        if uid == d["muet"]:
            raise Refus("la bière frelatée t'a coupé la voix aujourd'hui")
        if cible:
            if cible == uid:
                raise Refus("on ne s'accuse pas soi-même")
            self._vivant(cible)
        d["votes"][uid] = cible or ""
        if all(x["uid"] in d["votes"] for x in self.votants()):
            self._echeance(min(3, max(0, (d["echeance"] or 0) - self.maintenant())))

    def decompte(self) -> dict[str, int]:
        c: dict[str, int] = {}
        for v in self.d["votes"].values():
            if v:
                c[v] = c.get(v, 0) + 1
        return c

    def _depouiller(self):
        d = self.d
        c = self.decompte()
        detail = ", ".join(f"{self.nom(u)} → {self.nom(v) if v else 'blanc'}" for u, v in d["votes"].items()) or "aucun vote"
        self.journal(f"Conseil du jour {d['jour']} : {detail}", "vote")
        haut = max(c.values()) if c else 0
        tete = [u for u, n in c.items() if n == haut]
        d["phase"] = "verdict"
        chasse = tete[0] if haut and len(tete) == 1 else ""
        d["verdict"] = {"chasse": chasse, "voix": haut, "egalite": len(tete) > 1}
        if chasse:
            x = self.j(chasse)
            self.journal(f"Par {haut} voix, le Conseil jette {x['nom']} hors de la taverne.", "recit")
            if x["role"] == "ragequit" and d["jour"] == 1:
                d["memo"]["ragequit_gagnant"] = chasse
                self.journal(f"{x['nom']} claque la porte en hurlant « J'AVAIS RAISON ! » — le Ragequit a gagné… à sa façon.", "recit")
            self._tuer(chasse, "conseil")
        elif len(tete) > 1:
            self.journal("Égalité : le Conseil se dispute, personne n'est chassé.", "recit")
        else:
            self.journal("Le Conseil n'a désigné personne.", "recit")
        if d["jour"] == 1:
            for x in self.du_role("ragequit"):
                x.update(role="habitue", camp="taverne")
                self.info(x["uid"], "Personne ne t'a chassé… Tu boudes, puis tu commandes une chope : te voilà simple Habitué.", "ragequit")
        self._echeance(DUREES["verdict"])

    # ── Victoire ──
    def vainqueur(self) -> str | None:
        viv = self.vivants()
        if not viv:
            return "personne"
        barde = next((x for x in viv if x["role"] == "barde"), None)
        if barde and all(x["enchante"] for x in viv if x is not barde):
            return "barde"
        ombres = [x for x in viv if x["camp"] == "ombres"]
        if not ombres:
            return "taverne"
        if len(ombres) >= len(viv) - len(ombres):
            return "ombres"
        return None

    def _verifier_victoire(self) -> bool:
        v = self.vainqueur()
        if v is None:
            return False
        self.terminer(v)
        return True

    def terminer(self, v: str, raison: str = ""):
        d = self.d
        gagnants = [x["uid"] for x in d["joueurs"] if x["camp"] == v]
        if d["memo"]["ragequit_gagnant"]:
            gagnants.append(d["memo"]["ragequit_gagnant"])
        titres = {"taverne": "La Taverne a chassé toutes les Ombres !",
                  "ombres": "Les Ombres ont englouti la taverne…",
                  "barde": "Le Barde a envoûté toute la salle : il règne seul sur la taverne.",
                  "personne": "Il ne reste plus personne pour éteindre les chandelles.",
                  "annulee": "La partie a été interrompue."}
        d["phase"] = "fin"
        d["fin"] = {"vainqueur": v, "titre": titres.get(v, ""), "gagnants": gagnants, "raison": raison}
        d["echeance"] = d["pause"] = None
        for x in d["joueurs"]:
            x["revele"] = True
        self.journal(titres.get(v, "") + (f" ({raison})" if raison else ""), "fin")

    # ─────────────── Gestes divers ───────────────
    def testament(self, uid: str, texte: str):
        x = self.j(uid)
        if x is None or not x["vivant"]:
            raise Refus("les morts n'écrivent plus")
        x["testament"] = " ".join(str(texte or "").split())[:MAX_TESTAMENT]

    def conciliabule(self, uid: str, texte: str):
        x = self.j(uid)
        if x is None or x["camp"] != "ombres":
            raise Refus("ce murmure ne t'est pas destiné")
        if not x["vivant"]:
            raise Refus("les morts ne murmurent plus")
        texte = " ".join(str(texte or "").split())[:200]
        if texte:
            self.d["conciliabule"] = (self.d["conciliabule"] + [
                {"uid": uid, "nom": x["nom"], "texte": texte, "t": self.maintenant()}])[-MAX_CONCILIABULE:]

    def vote_ames(self, uid: str, carte: str):
        d = self.d
        x = self.j(uid)
        if x is None or x["vivant"]:
            raise Refus("seules les Âmes de l'âtre choisissent la carte")
        if d["phase"] not in ("nuit", "alchimie") or carte not in d["ames"]["cartes"]:
            raise Refus("aucune carte à choisir pour l'instant")
        d["ames"]["votes"][uid] = carte

    def exclure(self, uid: str):
        x = self.j(uid)
        if x is None or not x["vivant"]:
            raise Refus("joueur introuvable")
        if self.d["phase"] in ("hall", "fin"):
            raise Refus("rien à exclure ici")
        self.journal(f"{x['nom']} quitte la table (exclu par le MJ).", "recit")
        self._tuer(uid, "exclu")
        if self.d["phase"] not in ("aube", "videur"):
            self._verifier_victoire()

    # ─────────────── Pantins (parties d'essai) ───────────────
    def _pantins_nuit(self):
        d = self.d
        ne = d["nuit_etat"]
        for x in self.vivants():
            if not x["pantin"]:
                continue
            autres = [y for y in self.vivants() if y["uid"] != x["uid"]]
            if x["camp"] == "ombres":
                proies = [y for y in self.vivants() if y["camp"] != "ombres"]
                ne["votes_ombres"][x["uid"]] = self.rng.choice(proies)["uid"] if proies else ""
            r = x["role"]
            if r == "voix":
                ne["actions"][x["uid"]] = {"convertir": not d["memo"]["voix_utilisee"] and self.rng.random() < 0.4}
            elif r == "barde":
                pool = [y["uid"] for y in autres if not y["enchante"]]
                ne["actions"][x["uid"]] = {"cibles": self.rng.sample(pool, min(2, len(pool)))} if pool else {"passe": True}
            elif r in ("inquisiteur", "tavernier", "paladin"):
                interdit = {"paladin": d["memo"]["paladin_dernier"], "tavernier": d["memo"]["tavernier_dernier"]}.get(r, "")
                pool = [y["uid"] for y in (self.vivants() if r == "paladin" else autres) if y["uid"] != interdit]
                ne["actions"][x["uid"]] = {"cibles": [self.rng.choice(pool)]} if pool else {"passe": True}
        for x in d["joueurs"]:
            if x["pantin"] and not x["vivant"] and d["ames"]["cartes"]:
                d["ames"]["votes"][x["uid"]] = self.rng.choice(d["ames"]["cartes"])

    def _pantins_alchimie(self, alchi: dict):
        if not alchi["pantin"]:
            return
        d = self.d
        cibles = d["nuit_etat"].get("cibles", [])
        vu = cibles and self.evenement() != "brouillard"
        vie = cibles[0] if vu and d["memo"]["fiole_vie"] and self.rng.random() < 0.5 else ""
        pool = [y["uid"] for y in self.vivants() if y["uid"] != alchi["uid"]]
        mort = self.rng.choice(pool) if pool and d["memo"]["fiole_mort"] and self.rng.random() < 0.2 else ""
        d["nuit_etat"]["alchimie"] = {"vie": vie, "mort": mort, "fait": True}
        self._echeance(3 + self.rng.random() * 5)

    def humains_attendus(self) -> bool:
        """Vrai si un humain doit encore agir dans la phase (sinon la phase peut se clore tôt)."""
        d = self.d
        if d["phase"] == "nuit":
            return not self.nuit_complete()
        if d["phase"] == "alchimie":
            return not (d["nuit_etat"].get("alchimie") or {}).get("fait")
        return True


# ─────────────────────────── Vue filtrée ───────────────────────────
def vue(d: dict, qui: dict, maintenant: float | None = None) -> dict:
    """État visible par ``qui`` ({uid, role}) : MJ de la partie = tout ; joueur = le public
    + ses secrets ; spectateur / autre = le public seul. Partie finie = tout est révélé."""
    p = Partie(d)
    uid = qui.get("uid") or ""
    phase = d["phase"]
    est_mj = bool(d["mj"]) and uid == d["mj"]
    tout = est_mj or phase == "fin"
    moi = p.j(uid)
    ombre = bool(moi and moi["camp"] == "ombres")
    mes_ench = bool(moi and (moi["enchante"] or moi["role"] == "barde"))
    aube_cachee = phase == "aube" and not (d["aube"] or {}).get("proclamee")

    joueurs = []
    for x in d["joueurs"]:
        lui = moi is not None and x["uid"] == moi["uid"]
        voit_role = tout or x["revele"] or lui or (ombre and x["camp"] == "ombres")
        j = {"uid": x["uid"], "nom": x["nom"], "avatar": x["avatar"], "pantin": x["pantin"],
             "vivant": x["vivant"], "mort": x["mort"],
             "role": x["role"] if voit_role else None,
             "camp": x["camp"] if voit_role else None,
             "enchante": x["enchante"] if (tout or (mes_ench and x["enchante"])) else None,
             "testament": x["testament"] if (tout or lui or not x["vivant"]) else None}
        joueurs.append(j)

    ne = d.get("nuit_etat") or {}
    secrets_mj = None
    if est_mj and phase not in ("hall", "fin"):
        secrets_mj = {"actions": ne.get("actions", {}), "votes_ombres": ne.get("votes_ombres", {}),
                      "cibles": ne.get("cibles", []), "bloque": ne.get("bloque", ""),
                      "alchimie": ne.get("alchimie"), "memo": d["memo"],
                      "aube_morts": (d["aube"] or {}).get("morts", []) if d["aube"] else [],
                      "aube_brouillon": (d["aube"] or {}).get("brouillon", "") if d["aube"] else ""}

    # Ce que MOI je dois savoir pour jouer
    perso = None
    if moi and phase not in ("hall",):
        perso = {"role": moi["role"], "camp": moi["camp"], "vivant": moi["vivant"],
                 "infos": d["infos"].get(uid, [])[-30:], "enchante": moi["enchante"]}
        if phase in ("nuit", "alchimie"):
            perso["action"] = ne.get("actions", {}).get(uid)
            if ombre:
                perso["votes_ombres"] = ne.get("votes_ombres", {})
        if moi["role"] == "alchimiste" and phase == "alchimie":
            al = ne.get("alchimie") or {}
            brouille = d.get("evenement") == "brouillard"
            perso["alchimie"] = {"cibles": [] if brouille else ne.get("cibles", []), "brouillard": brouille,
                                 "fait": bool(al.get("fait")), "vie": al.get("vie", ""), "mort": al.get("mort", "")}
        if moi["role"] in ("alchimiste", "paladin", "tavernier", "voix"):
            m = d["memo"]
            perso["memo"] = {"alchimiste": {"fiole_vie": m["fiole_vie"], "fiole_mort": m["fiole_mort"]},
                             "paladin": {"dernier": m["paladin_dernier"]},
                             "tavernier": {"dernier": m["tavernier_dernier"]},
                             "voix": {"utilisee": m["voix_utilisee"]}}[moi["role"]]
        if ombre:
            perso["conciliabule"] = d["conciliabule"]
        if phase == "conseil":
            perso["mon_vote"] = d["votes"].get(uid)

    # Conseil : fils visibles de tous, sauf « bulletins cachetés » (jusqu'au verdict)
    votes = None
    if phase in ("conseil", "verdict"):
        secret = d.get("evenement") == "bulletins" and phase == "conseil" and not est_mj
        votes = {"secret": secret, "exprimes": len(d["votes"]),
                 "liste": {} if secret else d["votes"], "decompte": {} if secret else p.decompte()}

    pour_moi = lambda e: e["pour"] == "public" or (est_mj and e["pour"] == "mj") or (  # noqa: E731
        isinstance(e["pour"], list) and uid in e["pour"]) or (phase == "fin" and e["pour"] == "mj")
    journal = [e for e in d["journal"] if pour_moi(e)][-150:]

    nuit_publique = None
    if phase in ("nuit", "alchimie"):
        acteurs = p.acteurs_nuit()
        nuit_publique = {"eveilles": len(acteurs)}

    ames = None
    if d["ames"]["cartes"] and phase in ("nuit", "alchimie"):
        compte = {k: 0 for k in d["ames"]["cartes"]}
        for v in d["ames"]["votes"].values():
            if v in compte:
                compte[v] += 1
        ames = {"cartes": d["ames"]["cartes"], "compte": compte,
                "mon_vote": d["ames"]["votes"].get(uid) if moi and not moi["vivant"] else None}

    aube = None
    if d.get("aube") and phase in ("aube", "videur", "debat", "conseil", "verdict"):
        a = d["aube"]
        aube = {"proclamee": a["proclamee"], "texte": a["texte"] if a["proclamee"] else "",
                "morts": [m["uid"] for m in a["morts"]] if a["proclamee"] or est_mj else [],
                "carte": a["carte"] if a["proclamee"] or est_mj else None}

    return {
        "id": d["id"], "phase": phase, "jour": d["jour"], "nuit": d["nuit"], "mode": d["mode"],
        "mj": d["mj"], "hote": d["hote"], "options": d["options"],
        "echeance": d["echeance"], "pause": d["pause"], "debut": d.get("debut"),
        "maintenant": maintenant or time.time(),
        "joueurs": joueurs, "moi": uid if moi else None, "est_mj": est_mj,
        "evenement": None if aube_cachee and not est_mj else d.get("evenement"),
        "muet": d["muet"], "votes": votes, "pret_vote": len(d["pret_vote"]),
        "verdict": d["verdict"] if phase == "verdict" else None,
        "videur": d["videur"]["attente"][0] if phase == "videur" and d["videur"]["attente"] else None,
        "aube": aube, "ames": ames, "nuit_publique": nuit_publique, "perso": perso,
        "secrets": secrets_mj, "journal": journal, "fin": d["fin"],
        "composition": composition(len(d["joueurs"]), d["options"]["retraits"]) if phase == "hall" and len(d["joueurs"]) >= MIN_JOUEURS else None,
    }
