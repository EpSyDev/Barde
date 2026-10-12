"""Tests des règles de la Guerre des Flottes Royales (sans Discord).

Lancer : ``py fripouille/tests/test_flotte_regles.py`` (ou ``python3`` sur la VM).
Le module est chargé directement par son chemin : pas d'import du bot ni de discord.py.
"""
import importlib.util
import json
import sys
import time
from pathlib import Path

_chemin = Path(__file__).resolve().parent.parent / "modules" / "flotte_regles.py"
_spec = importlib.util.spec_from_file_location("flotte_regles", _chemin)
R = importlib.util.module_from_spec(_spec)
sys.modules["flotte_regles"] = R
_spec.loader.exec_module(R)

T0 = 1000.0


def refuse(f, *a, **k):
    try:
        f(*a, **k)
    except R.Refus:
        return True
    raise AssertionError("aurait dû être refusé : %s%r" % (f.__name__, a))


def bac(terrain, navires, meteo=None, joueurs=("a", "b"), tiers=None):
    """Partie en planification sur une carte et une flotte posées à la main.
    navires : [(uid, classe, (c, r)), …] → ids n1, n2, … ; ``tiers`` : position d'un
    éclaireur d'un 3e capitaine « c » (dernier id) — à deux, le duel final lève le brouillard."""
    if tiers:
        joueurs, navires = tuple(joueurs) + ("c",), list(navires) + [("c", "eclaireur", tiers)]
    d = R.nouvelle("t", {"uid": joueurs[0]}, 7, sel=99)
    p = R.Partie(d)
    for u in joueurs:
        p.rejoindre({"uid": u, "nom": u.upper()})
    d["carte"] = {"l": len(terrain[0]), "h": len(terrain), "terrain": list(terrain),
                  "departs": [], "ports": []}
    d["navires"] = []
    for i, (u, classe, pos) in enumerate(navires):
        k = R.CLASSES[classe]
        d["navires"].append({"id": "n%d" % (i + 1), "uid": u, "classe": classe, "nom": "N%d" % (i + 1),
                             "pos": list(pos), "cap": 0, "coque": k["coque"], "max": k["coque"], "coule": None})
    d.update(phase="planification", manche=1, debut=T0, echeance=T0 + 60,
             meteo=meteo or {"temps": "calme", "vent": 0}, prevision={"temps": "calme", "vent": 0})
    return p


MER = ["." * 12] * 9


def ordre(chemin=(), cible=None):
    return {"chemin": [list(c) for c in chemin],
            "action": {"type": "tir", "cible": cible} if cible else {"type": "garde"}}


def partie_bots(n, graine=1, sel=2, manches=20):
    d = R.nouvelle("s", {"uid": "spectateur"}, graine, {"manches": manches}, sel=sel)
    p = R.Partie(d)
    for _ in range(n):
        p.ajouter_bot()
    p.lancer(T0)
    t = T0
    while d["phase"] != "fin":
        t += 10
        p.avancer(t)
        assert d["manche"] <= manches + 1
    return p


# ─────────────────────────── Fondations ───────────────────────────
def test_alea_deterministe():
    a, b = R.Alea(5, "x"), R.Alea(5, "x")
    sa = [a.flottant() for _ in range(200)]
    assert sa == [b.flottant() for _ in range(200)]
    assert all(0 <= x < 1 for x in sa)
    assert sa != [R.Alea(5, "y").flottant() for _ in range(200)]
    assert {R.Alea(9, i).entier(1, 6) for i in range(300)} == {1, 2, 3, 4, 5, 6}


def test_hexagones():
    for cell in [(0, 0), (3, 4), (5, 5), (2, 1)]:
        for d in range(6):
            v = R.voisin(cell, d)
            assert R.distance(cell, v) == 1
            assert R.direction(cell, v) == d
            assert R.voisin(v, (d + 3) % 6) == cell
    assert R.distance((0, 0), (5, 0)) == 5
    assert R.distance((2, 3), (7, 8)) == R.distance((7, 8), (2, 3))
    lg = R.ligne((1, 1), (8, 6))
    assert lg[0] == (1, 1) and lg[-1] == (8, 6) and len(lg) == R.distance((1, 1), (8, 6)) + 1
    assert all(R.distance(lg[i], lg[i + 1]) == 1 for i in range(len(lg) - 1))
    assert len(R.disque((5, 5), 2)) == 19
    assert R.ecart(0, 3) == 3 and R.ecart(5, 0) == 1 and R.ecart(2, 2) == 0


def test_cartes_reproductibles_et_connexes():
    for n in range(2, 9):
        for graine in range(12):
            c = R.generer_carte(graine, n)
            assert c == R.generer_carte(graine, n)
            assert len(c["departs"]) == n and len(c["ports"]) >= 1
            dep = tuple(c["departs"][0])
            vu, pile = {dep}, [dep]
            while pile:
                x = pile.pop()
                for d in range(6):
                    v = R.voisin(x, d)
                    if v not in vu and R.navigable(c, v):
                        vu.add(v)
                        pile.append(v)
            navig = {(x, y) for y in range(c["h"]) for x in range(c["l"]) if R.navigable(c, (x, y))}
            assert vu == navig, "mer coupée (graine %d, %d joueurs)" % (graine, n)
            for p in c["departs"]:   # le départ et ses voisins sont de la mer libre
                assert R.terrain(c, p) == "."
                assert sum(R.terrain(c, R.voisin(tuple(p), d)) == "." for d in range(6)) >= 3
    assert R.generer_carte(1, 4) != R.generer_carte(2, 4)


# ─────────────────────────── Salon ───────────────────────────
def test_salon():
    d = R.nouvelle("s", {"uid": "a"}, 3)
    p = R.Partie(d)
    p.rejoindre({"uid": "a", "nom": "Anne"})
    refuse(p.lancer, T0)                       # seul
    p.rejoindre({"uid": "b", "nom": "Bob"})
    assert p.j("b")["pavillon"] != p.j("a")["pavillon"]
    refuse(p.pavillon, "b", p.j("a")["pavillon"])
    refuse(p.lancer, T0)                       # Bob pas prêt
    p.pret("b", True)
    p.regler({"manches": 999, "plan": 1})
    assert d["options"] == {"manches": 40, "plan": 20}
    p.lancer(T0)
    assert d["phase"] == "preparation" and len(d["navires"]) == 8
    assert {n["uid"] for n in d["navires"]} == {"a", "b"}
    assert len({tuple(n["pos"]) for n in d["navires"]}) == 8
    assert all(R.terrain(d["carte"], n["pos"]) == "." for n in d["navires"])
    refuse(p.rejoindre, {"uid": "c", "nom": "C"})
    p.avancer(T0 + 9)
    assert d["phase"] == "planification" and d["echeance"] == T0 + 9 + 20


def test_hote_qui_part():
    d = R.nouvelle("s", {"uid": "a"}, 3)
    p = R.Partie(d)
    p.rejoindre({"uid": "a", "nom": "A"})
    p.ajouter_bot()
    p.rejoindre({"uid": "b", "nom": "B"})
    p.quitter("a", T0)
    assert d["hote"] == "b" and not p.j("a")


# ─────────────────────────── Ordres ───────────────────────────
def test_chemins():
    terrain = ["......", "..#...", "..^...", "......"]
    p = bac(terrain, [("a", "fregate", (1, 1)), ("b", "fregate", (5, 3))])
    c, m = p.d["carte"], p.d["meteo"]
    refuse(R.verifier_chemin, c, m, "fregate", (1, 1), [(2, 1)])          # île
    refuse(R.verifier_chemin, c, m, "fregate", (1, 1), [(3, 1)])          # pas voisin
    refuse(R.verifier_chemin, c, m, "fregate", (1, 1), [(0, 1), (1, 1), (0, 1), (1, 1)])  # 4 pas × 3 > 9
    assert R.verifier_chemin(c, m, "fregate", (1, 1), [(1, 2), (2, 2)]) == 6   # récif en dernier : ok
    refuse(R.verifier_chemin, c, m, "fregate", (1, 1), [(1, 2), (2, 2), (3, 2)])  # on ne repart pas d'un récif
    assert R.verifier_chemin(c, m, "fregate", (2, 2), [(3, 2)]) == 3      # on repart d'un récif
    assert (3, 2) in R.atteignables(c, m, "fregate", (2, 2))
    vent = {"temps": "brise", "vent": 0}                                  # vent vers l'est
    assert R.verifier_chemin(c, vent, "eclaireur", (0, 0), [(1, 0), (2, 0), (3, 0), (4, 0), (5, 0)]) == 10
    refuse(R.verifier_chemin, c, vent, "eclaireur", (5, 0), [(4, 0), (3, 0), (2, 0)])  # face au vent : 15 > 12
    acc = R.atteignables(c, m, "fregate", (1, 1))
    for cell, chemin in acc.items():
        R.verifier_chemin(c, m, "fregate", (1, 1), chemin)
        assert (chemin[-1] if chemin else (1, 1)) == cell
    assert (2, 1) not in acc and (3, 2) not in acc          # île ; au-delà du récif


def test_ordres_valides_et_idempotents():
    p = bac(MER, [("a", "fregate", (2, 2)), ("a", "eclaireur", (2, 3)), ("b", "fregate", (4, 2)),
                  ("b", "siege", (11, 8))], tiers=(11, 0))
    refuse(p.ordonner, "a", 2, {})                                    # manche périmée
    refuse(p.ordonner, "a", 1, {"n3": ordre()})                       # navire adverse
    refuse(p.ordonner, "a", 1, {"n1": ordre(cible="n2")})             # tir ami
    refuse(p.ordonner, "a", 1, {"n1": ordre(cible="n4")})             # cible hors de vue
    refuse(p.ordonner, "a", 1, {"n1": ordre(cible="n99")})            # cible inexistante (même message)
    refuse(p.ordonner, "a", 1, {"n1": {"chemin": [[True, 2]]}})       # types piégés
    refuse(p.ordonner, "a", 1, {"n1": {"chemin": "3,2"}})
    refuse(p.ordonner, "a", 1, {"n1": {"action": {"type": "victoire"}}})
    refuse(p.ordonner, "x", 1, {})                                    # pas dans la partie
    o = {"n1": ordre([(3, 2)], cible="n3")}
    p.ordonner("a", 1, o)
    avant = json.dumps(p.d, sort_keys=True)
    p.ordonner("a", 1, o)                                             # rejoué : rien ne change
    assert json.dumps(p.d, sort_keys=True) == avant
    p.ordonner("a", 1, None, verrou=True)
    assert p.j("a")["verrou"] and p.humains_attendus() == [p.j("b"), p.j("c")]
    p.d["phase"] = "resolution"
    refuse(p.ordonner, "a", 1, o)


# ─────────────────────────── Déplacements simultanés ───────────────────────────
def coques(p):
    return {n["id"]: n["coque"] for n in p.d["navires"]}


def test_case_disputee():
    p = bac(MER, [("a", "fregate", (2, 2)), ("b", "fregate", (4, 2))])
    p.ordonner("a", 1, {"n1": ordre([(3, 2)])})
    p.ordonner("b", 1, {"n2": ordre([(3, 2)])})
    p.resoudre(T0)
    assert p.n("n1")["pos"] == [2, 2] and p.n("n2")["pos"] == [4, 2]
    assert coques(p) == {"n1": 5, "n2": 5}


def test_echange_de_cases():
    p = bac(MER, [("a", "fregate", (2, 2)), ("b", "fregate", (3, 2))])
    p.ordonner("a", 1, {"n1": ordre([(3, 2)])})
    p.ordonner("b", 1, {"n2": ordre([(2, 2)])})
    p.resoudre(T0)
    assert p.n("n1")["pos"] == [2, 2] and p.n("n2")["pos"] == [3, 2]
    assert coques(p) == {"n1": 5, "n2": 5}


def test_file_et_rotation():
    # n1 suit n2 qui s'en va : tout le monde passe, sans choc.
    p = bac(MER, [("a", "fregate", (2, 2)), ("b", "fregate", (3, 2))])
    p.ordonner("a", 1, {"n1": ordre([(3, 2), (4, 2)])})
    p.ordonner("b", 1, {"n2": ordre([(4, 2), (5, 2)])})
    p.resoudre(T0)
    assert p.n("n1")["pos"] == [4, 2] and p.n("n2")["pos"] == [5, 2] and coques(p) == {"n1": 6, "n2": 6}
    # Ronde de trois navires sur trois cases voisines : chacun prend la place du suivant.
    a, b, c = (4, 4), (5, 4), (4, 3)
    assert R.distance(a, b) == R.distance(b, c) == R.distance(c, a) == 1
    p = bac(MER, [("a", "fregate", a), ("a", "fregate", b), ("b", "fregate", c)])
    p.ordonner("a", 1, {"n1": ordre([b]), "n2": ordre([c])})
    p.ordonner("b", 1, {"n3": ordre([a])})
    p.resoudre(T0)
    assert [p.n(s)["pos"] for s in ("n1", "n2", "n3")] == [list(b), list(c), list(a)]


def test_eperonnage_et_recif():
    p = bac(["......", "..^...", "......"], [("a", "fregate", (0, 0)), ("b", "siege", (1, 0)),
                                            ("a", "eclaireur", (1, 1))])
    p.ordonner("a", 1, {"n1": ordre([(1, 0), (2, 0)]), "n3": ordre([(2, 1), (3, 1)][:1])})
    p.resoudre(T0)
    assert p.n("n1")["pos"] == [0, 0]                       # bloqué par le navire de siège immobile
    assert coques(p)["n1"] == 5 and coques(p)["n2"] == 7    # choc pour les deux
    assert p.n("n3")["pos"] == [2, 1] and coques(p)["n3"] == 3   # échoué sur le récif


def test_choc_au_plus_une_fois():
    p = bac(MER, [("a", "eclaireur", (3, 3)), ("b", "fregate", (5, 3)), ("b", "fregate", (4, 2))])
    p.ordonner("a", 1, {"n1": ordre([(4, 3)])})
    p.ordonner("b", 1, {"n2": ordre([(4, 3)]), "n3": ordre([(4, 3)])})
    p.resoudre(T0)
    assert coques(p) == {"n1": 3, "n2": 5, "n3": 5}


# ─────────────────────────── Combat ───────────────────────────
def test_chance_explicite():
    calme = {"temps": "calme", "vent": 0}
    assert R.chance(calme, "fregate", "fregate", 1) == 70
    assert R.chance(calme, "fregate", "fregate", 3) == 58
    assert R.chance(calme, "fregate", "eclaireur", 1) == 60
    assert R.chance(calme, "fregate", "fregate", 1, cible_en_garde=True) == 55
    assert R.chance(calme, "siege", "fregate", 5) == 48
    assert R.chance(calme, "siege", "fregate", 5, tireur_a_bouge=True) == 38
    assert R.chance({"temps": "tempete", "vent": 0}, "fregate", "fregate", 1) == 55
    assert R.chance({"temps": "brouillard", "vent": 0}, "fregate", "fregate", 3) == 48
    assert R.chance(calme, "eclaireur", "eclaireur", 9) == 5


def test_portee_et_ligne_de_tir():
    terrain = ["........", "........", "...##...", "........", "........"]
    c = {"l": 8, "h": 5, "terrain": terrain}
    assert R.tir_possible(c, "siege", (1, 2), (2, 2))[0] is False        # trop près
    assert R.tir_possible(c, "fregate", (0, 0), (5, 0))[0] is False      # hors de portée
    assert R.tir_possible(c, "siege", (1, 2), (6, 2)) == (False, "ligne de tir masquée par une île")
    assert R.tir_possible(c, "siege", (1, 0), (6, 0)) == (True, "")


def test_tirs_resolus_par_le_serveur():
    p = bac(MER, [("a", "siege", (1, 4)), ("b", "fregate", (4, 4)), ("b", "eclaireur", (10, 0))],
            meteo={"temps": "calme", "vent": 0})
    p.ordonner("a", 1, {"n1": ordre(cible="n2")})
    p.ordonner("b", 1, {"n2": ordre()})
    p.resoudre(T0)
    tirs = [e for h in p.d["historique"]["a"] for e in h["evts"] if e["t"] == "tir"]
    assert len(tirs) == 1 and tirs[0]["chance"] == R.chance(p.d["meteo"], "siege", "fregate", 3, True)
    assert coques(p)["n2"] == 6 - tirs[0]["degats"]
    assert p.j("a")["stats"]["tirs"] == 1


def test_tir_annule_si_cible_echappe():
    p = bac(MER, [("a", "fregate", (2, 4)), ("b", "fregate", (5, 4))], tiers=(11, 0))
    p.ordonner("a", 1, {"n1": ordre(cible="n2")})
    p.ordonner("b", 1, {"n2": ordre([(6, 4), (7, 4)])})          # sort de la portée et de la vue
    p.resoudre(T0)
    evts = [e for h in p.d["historique"]["a"] for e in h["evts"]]
    assert any(e["t"] == "tir_annule" for e in evts) and coques(p)["n2"] == 6
    assert not any(e["t"] == "mouv" and e["id"] == "n2" and [7, 4] in e["chemin"] for e in evts)


def test_naufrage_et_victoire():
    p = bac(MER, [("a", "siege", (1, 4)), ("b", "eclaireur", (4, 4))])
    p.n("n2")["coque"] = 1
    p.d["sel"] = next(s for s in range(500) if R.Alea(s, "manche", 1).flottant() * 100 < 30)
    p.ordonner("a", 1, {"n1": ordre(cible="n2")})
    p.ordonner("b", 1, {"n2": ordre([(3, 4)])})                 # s'approche à 2 : toujours à portée
    p.resoudre(T0 + 42)
    assert p.n("n2")["coule"] == 1
    assert p.d["phase"] == "fin" and p.d["fin"]["gagnants"] == ["a"]
    assert p.d["fin"]["raison"] == "derniere_flotte" and p.d["fin"]["duree"] == 42
    cl = p.d["fin"]["classement"]
    assert [x["uid"] for x in cl] == ["a", "b"] and cl[0]["coules"] == 1 and cl[1]["perdus"] == 1


def test_limite_de_manches_et_departage():
    p = bac(MER, [("a", "fregate", (1, 1)), ("b", "fregate", (10, 7))])
    p.d["options"]["manches"] = 1
    p.n("n2")["coque"] = 4
    p.resoudre(T0)
    assert p.d["fin"]["raison"] == "limite" and p.d["fin"]["gagnants"] == ["a"]
    p = bac(MER, [("a", "fregate", (1, 1)), ("b", "fregate", (10, 7))])
    p.d["options"]["manches"] = 1
    p.resoudre(T0)
    assert sorted(p.d["fin"]["gagnants"]) == ["a", "b"]       # égalité parfaite : partagée


def test_reparation_au_port():
    p = bac(["....P."], [("a", "fregate", (3, 0)), ("b", "fregate", (0, 0))])
    p.n("n1")["coque"] = 3
    p.ordonner("a", 1, {"n1": ordre([(4, 0)])})
    p.resoudre(T0)
    assert coques(p)["n1"] == 4


# ─────────────────────────── Brouillard de guerre ───────────────────────────
def test_vue_ne_fuit_rien():
    # n3 (b) est hors de vue de a pendant toute la manche ; n2 (b) est visible.
    p = bac(["." * 20] * 9, [("a", "fregate", (1, 4)), ("b", "fregate", (3, 4)), ("b", "siege", (18, 8))], tiers=(19, 0))
    p.ordonner("b", 1, {"n3": ordre([(17, 8), (16, 8)]), "n2": ordre()})
    p.resoudre(T0)
    v = p and R.vue(p.d, "a", T0)
    brut = json.dumps(v)
    assert {n["id"] for n in v["navires"]} == {"n1", "n2"}
    assert '"n3"' not in brut and "[16, 8]" not in brut and "[18, 8]" not in brut
    assert '"sel"' not in brut and v["graine"] is None
    assert v["cibles"]["n1"][0]["id"] == "n2"
    assert R.vue(p.d, "intrus", T0)["navires"] == []


def test_flash_demasque_le_tireur():
    p = bac(["." * 20] * 9, [("a", "fregate", (5, 4)), ("b", "siege", (10, 4)), ("b", "eclaireur", (7, 4))], tiers=(19, 0))
    assert "n2" not in {n["id"] for n in p.visibles("a")}       # siège à 5 cases, vision 3
    p.d["sel"] = next(s for s in range(500) if R.Alea(s, "manche", 1).flottant() * 100 > 60)
    p.ordonner("b", 1, {"n2": ordre(cible="n1")})
    p.resoudre(T0)
    tirs = [e for h in p.d["historique"]["a"] for e in h["evts"] if e["t"] == "tir"]
    assert tirs and tirs[0]["pos_de"] == [10, 4]
    assert "n2" in {n["id"] for n in p.visibles("a")} and R.vue(p.d, "a", T0 + 1)["demasques"] == ["n2"]
    p.avancer(T0 + 8)
    p.ordonner("a", 2, {"n1": ordre(cible="n2")})                # riposte possible…
    p.ordonner("b", 2, {"n2": ordre([(11, 4)])})                 # …mais le siège se déplace
    p.resoudre(T0 + 20)
    assert any(e["t"] == "tir_annule" for h in p.d["historique"]["a"] for e in h["evts"])


def test_memoire_derniere_position():
    p = bac(["." * 20] * 9, [("a", "eclaireur", (5, 4)), ("b", "fregate", (9, 4))], tiers=(19, 0))
    p._memoriser()
    p.ordonner("b", 1, {"n2": ordre([(10, 4), (11, 4), (12, 4)])})
    p.resoudre(T0)
    v = R.vue(p.d, "a", T0)
    assert [f["id"] for f in v["fantomes"]] == ["n2"]
    assert v["fantomes"][0]["pos"] == [10, 4]               # dernière case aperçue (vision 5)
    assert "[11, 4]" not in json.dumps(v) and "[12, 4]" not in json.dumps(v)


# ─────────────────────────── Absences ───────────────────────────
def test_absent_puis_abandon():
    p = bac(MER, [("a", "fregate", (1, 1)), ("b", "fregate", (10, 7))])
    t = T0
    for m in (1, 2):
        p.ordonner("a", m, {})
        p.resoudre(t)
        p.avancer(t + 8)
        t += 20
    assert p.j("b")["absences"] == 2 and not p.j("b")["abandon"]
    assert R.vue(p.d, "b", t)["absences"] == 2
    p.ordonner("a", 3, {})
    p.resoudre(t)
    assert p.j("b")["abandon"] and p.n("n2")["coule"] == 3
    assert p.d["phase"] == "fin" and p.d["fin"]["gagnants"] == ["a"]


def test_duel_final_leve_le_brouillard():
    p = bac(["." * 20] * 9, [("a", "fregate", (1, 4)), ("b", "siege", (18, 8))], tiers=(19, 0))
    assert p.visibles("a") == []
    p.quitter("c", T0)
    assert p.duel() and [n["id"] for n in p.visibles("a")] == ["n2"]


def test_quitter_en_mer():
    p = bac(MER, [("a", "fregate", (1, 1)), ("b", "fregate", (10, 7))], joueurs=("a", "b", "c"))
    p.d["navires"].append({**p.n("n2"), "id": "n3", "uid": "c", "pos": [5, 5]})
    p.quitter("c", T0)
    assert p.j("c")["abandon"] and p.n("n3")["coule"] == 1 and p.d["phase"] == "planification"
    p.quitter("b", T0)
    assert p.d["phase"] == "fin" and p.d["fin"]["gagnants"] == ["a"]


# ─────────────────────────── Parties complètes ───────────────────────────
def test_parties_simulees():
    debut, raisons = time.time(), {}
    for n in range(2, 9):
        for g in range(25):
            p = partie_bots(n, graine=g, sel=g * 7 + n, manches=30)
            f = p.d["fin"]
            raisons[f["raison"]] = raisons.get(f["raison"], 0) + 1
            assert f["gagnants"] or f["raison"] == "aneantissement"
            assert all(x["uid"] in {j["uid"] for j in p.d["joueurs"]} for x in f["classement"])
            for n_ in p.d["navires"]:
                assert (n_["coule"] is None) == (n_["coque"] > 0)
            assert R.vue(p.d, p.d["joueurs"][0]["uid"], T0)["graine"] == p.d["graine"]
    assert raisons.get("derniere_flotte", 0) > 0, raisons
    print("    175 parties de bots en %.1f s — %s" % (time.time() - debut, raisons))


def test_determinisme():
    a = json.dumps(partie_bots(4, graine=11, sel=5).d, sort_keys=True)
    assert a == json.dumps(partie_bots(4, graine=11, sel=5).d, sort_keys=True)
    assert a != json.dumps(partie_bots(4, graine=11, sel=6).d, sort_keys=True)


def test_revanche():
    p = partie_bots(3, graine=4, sel=8)
    d2 = R.revanche(p.d, "s2", graine=77, meme_carte=True, sel=1234)
    assert d2["phase"] == "salon" and d2["graine"] == 4 and d2["sel"] == 1234
    assert [j["pavillon"] for j in d2["joueurs"]] == [j["pavillon"] for j in p.d["joueurs"]]
    d3 = R.revanche(p.d, "s3", graine=77, meme_carte=False, sel=1)
    assert d3["graine"] == 77
    q = R.Partie(d2)
    q.lancer(T0)
    assert q.d["carte"] == R.generer_carte(4, 3)


if __name__ == "__main__":
    tests = [(k, f) for k, f in sorted(globals().items()) if k.startswith("test_") and callable(f)]
    echecs = 0
    for nom, f in tests:
        try:
            f()
            print("ok  ", nom)
        except Exception as exc:  # noqa: BLE001
            echecs += 1
            print("ÉCHEC", nom, "→", repr(exc))
            import traceback
            traceback.print_exc()
    print("\n%d/%d tests passés" % (len(tests) - echecs, len(tests)))
    sys.exit(1 if echecs else 0)
