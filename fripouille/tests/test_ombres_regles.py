"""Tests des règles des Ombres de la Taverne (sans Discord).

Lancer : ``py fripouille/tests/test_ombres_regles.py`` (ou ``python3`` sur la VM).
Le module est chargé directement par son chemin : pas d'import du bot ni de discord.py.
"""
import importlib.util
import json
import random
import sys
from pathlib import Path

_chemin = Path(__file__).resolve().parent.parent / "modules" / "ombres_regles.py"
_spec = importlib.util.spec_from_file_location("ombres_regles", _chemin)
R = importlib.util.module_from_spec(_spec)
sys.modules["ombres_regles"] = R
_spec.loader.exec_module(R)


class Horloge:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def partie(n, graine=1, humains=0, roles=None, retraits=()):
    """Partie lancée à n joueurs ; ``roles`` impose la distribution (dans l'ordre des sièges)."""
    h = Horloge()
    d = R.nouvelle({"uid": "h0"})
    p = R.Partie(d, random.Random(graine), h)
    for i in range(humains):
        p.rejoindre({"uid": f"h{i}", "nom": f"Humain{i}"})
    while len(d["joueurs"]) < n:
        p.ajouter_pantin()
    p.regler({"retraits": list(retraits)})
    p.lancer()
    if roles:
        for x, r in zip(d["joueurs"], roles):
            x.update(role=r, camp=R.ROLES[r]["camp"])
    return p, h


def finir_phase(p, h):
    if p.d["phase"] == "aube" and not p.d["aube"]["proclamee"]:
        p.proclamer("L'aube se lève.")
    if p.d["echeance"] is not None:
        h.t = max(h.t, p.d["echeance"])
    p.avancer()


def jouer_jusqua(p, h, phase, limite=60):
    for _ in range(limite):
        if p.d["phase"] == phase:
            return
        finir_phase(p, h)
    raise AssertionError(f"phase {phase} jamais atteinte (reste en {p.d['phase']})")


def uid_du(p, role):
    return next(x["uid"] for x in p.d["joueurs"] if x["role"] == role)


# ─────────────────────────── Composition ───────────────────────────
def test_composition():
    for n in range(R.MIN_JOUEURS, R.MAX_JOUEURS + 1):
        c = R.composition(n)
        assert len(c) == n, n
        ombres = sum(1 for r in c if R.ROLES[r]["camp"] == "ombres")
        assert ombres == (1 if n <= 7 else 2 if n <= 10 else 3 if n <= 13 else 4), (n, ombres)
        assert ("voix" in c) == (n >= 14)
        assert ("barde" in c) == (n >= 12)
    assert "paladin" not in R.composition(10, ["paladin"])
    assert len(R.composition(10, ["paladin", "videur"])) == 10


# ─────────────────────────── Parties complètes ───────────────────────────
def test_parties_pantins_terminent():
    """500 parties de pantins, toutes tailles : elles finissent, sans exception, et l'état reste JSON."""
    issues = {}
    for g in range(500):
        n = R.MIN_JOUEURS + g % (R.MAX_JOUEURS - R.MIN_JOUEURS + 1)
        p, h = partie(n, graine=g)
        for _ in range(400):
            if p.d["phase"] == "fin":
                break
            finir_phase(p, h)
        assert p.d["phase"] == "fin", (g, n, p.d["phase"])
        v = p.d["fin"]["vainqueur"]
        issues[v] = issues.get(v, 0) + 1
        json.dumps(p.d)
        # cohérence : le vainqueur annoncé correspond bien à l'état final
        assert p.vainqueur() == v or v == "personne"
    assert set(issues) <= {"taverne", "ombres", "barde", "personne"}
    assert issues.get("taverne") and issues.get("ombres"), issues


# ─────────────────────────── Nuit ───────────────────────────
ROLES_8 = ["cultiste", "cultiste", "inquisiteur", "alchimiste", "paladin", "videur", "habitue", "habitue"]


def humaniser(p):
    for x in p.d["joueurs"]:
        x["pantin"] = False


def test_ombres_devorent_et_paladin_protege():
    p, h = partie(8, roles=ROLES_8)
    humaniser(p)
    finir_phase(p, h)                          # distribution → nuit
    assert p.d["phase"] == "nuit"
    c1, c2 = (x["uid"] for x in p.d["joueurs"][:2])
    victime = uid_du(p, "habitue")
    p.agir(c1, {"vote": victime})
    p.agir(c2, {"vote": victime})
    p.agir(uid_du(p, "paladin"), {"cible": victime})
    p.agir(uid_du(p, "inquisiteur"), {"cible": c1})
    assert p.nuit_complete()
    finir_phase(p, h)                          # → alchimie
    assert p.d["phase"] == "alchimie"
    finir_phase(p, h)                          # → aube
    assert p.d["phase"] == "aube" and p.d["aube"]["morts"] == []
    infos = p.d["infos"][uid_du(p, "inquisiteur")]
    assert "OMBRES" in infos[-1]["texte"]
    # La même âme ne peut pas être protégée deux nuits de suite
    jouer_jusqua(p, h, "nuit")
    try:
        p.agir(uid_du(p, "paladin"), {"cible": victime})
        raise AssertionError("protection répétée acceptée")
    except R.Refus:
        pass


def test_alchimiste_sauve_et_empoisonne():
    p, h = partie(8, roles=ROLES_8)
    humaniser(p)
    finir_phase(p, h)
    c1, c2 = (x["uid"] for x in p.d["joueurs"][:2])
    hab = [x["uid"] for x in p.d["joueurs"] if x["role"] == "habitue"]
    p.agir(c1, {"vote": hab[0]})
    p.agir(c2, {"vote": hab[0]})
    finir_phase(p, h)
    al = uid_du(p, "alchimiste")
    try:
        p.agir(al, {"vie": hab[1]})
        raise AssertionError("fiole de vie sur une non-victime acceptée")
    except R.Refus:
        pass
    p.agir(al, {"vie": hab[0], "mort": c1})
    finir_phase(p, h)
    assert [m["uid"] for m in p.d["aube"]["morts"]] == [c1]
    assert not p.d["memo"]["fiole_vie"] and not p.d["memo"]["fiole_mort"]
    p.proclamer("…")
    assert not p.j(c1)["vivant"] and p.j(c1)["revele"]


def test_tavernier_bloque_l_ombre():
    roles = ["cultiste", "cultiste", "inquisiteur", "alchimiste", "paladin", "videur", "ragequit",
             "habitue", "habitue", "habitue", "tavernier"]
    p, h = partie(11, roles=roles)
    humaniser(p)
    finir_phase(p, h)
    c1, c2 = (x["uid"] for x in p.d["joueurs"][:2])
    hab = [x["uid"] for x in p.d["joueurs"] if x["role"] == "habitue"]
    p.agir(c1, {"vote": hab[0]})
    p.agir(c2, {"vote": hab[1]})
    p.agir(uid_du(p, "tavernier"), {"cible": c1})
    finir_phase(p, h)
    assert p.d["nuit_etat"]["cibles"] == [hab[1]]       # le vote de c1 ne compte pas
    finir_phase(p, h)
    assert [m["uid"] for m in p.d["aube"]["morts"]] == [hab[1]]
    tav = p.d["infos"][uid_du(p, "tavernier")][-1]["texte"]
    assert "éveillé" in tav
    assert any(i["nature"] == "tournee" for i in p.d["infos"][c1])


def test_voix_convertit_une_fois():
    roles = ["voix", "cultiste", "cultiste", "cultiste", "inquisiteur", "alchimiste", "paladin", "videur",
             "ragequit", "tavernier", "barde", "habitue", "habitue", "habitue"]
    p, h = partie(14, roles=roles)
    humaniser(p)
    finir_phase(p, h)
    voix = uid_du(p, "voix")
    cible = uid_du(p, "inquisiteur")
    for o in p.ombres():
        p.agir(o["uid"], {"vote": cible, "convertir": True} if o["uid"] == voix else {"vote": cible})
    finir_phase(p, h)
    finir_phase(p, h)
    assert p.d["aube"]["morts"] == []
    assert p.j(cible)["camp"] == "ombres" and p.j(cible)["role"] == "cultiste"
    assert p.d["memo"]["voix_utilisee"]
    # La convertie voit ses nouveaux frères, et eux la voient
    v = R.vue(p.d, {"uid": cible})
    assert all(j["role"] for j in v["joueurs"] if p.j(j["uid"])["camp"] == "ombres")


def test_barde_gagne():
    roles = ["cultiste", "barde", "habitue", "habitue", "habitue", "habitue"]  # imposés
    p, h = partie(6, roles=roles)
    humaniser(p)
    for x in p.d["joueurs"]:
        if x["role"] != "barde":
            x["enchante"] = True
    assert p.vainqueur() == "barde"


def test_ragequit_gagne_le_premier_jour():
    p, h = partie(9, roles=["cultiste", "cultiste", "inquisiteur", "alchimiste", "paladin", "videur",
                            "ragequit", "habitue", "habitue"])
    humaniser(p)
    jouer_jusqua(p, h, "conseil")
    rq = uid_du(p, "ragequit")
    for x in p.votants():
        if x["uid"] != rq:
            p.voter(x["uid"], rq)
    finir_phase(p, h)
    assert p.d["verdict"]["chasse"] == rq
    assert p.d["memo"]["ragequit_gagnant"] == rq
    assert p.d["phase"] == "verdict"


def test_ragequit_devient_habitue():
    p, h = partie(9, roles=["cultiste", "cultiste", "inquisiteur", "alchimiste", "paladin", "videur",
                            "ragequit", "habitue", "habitue"])
    humaniser(p)
    rq = uid_du(p, "ragequit")
    jouer_jusqua(p, h, "conseil")
    finir_phase(p, h)
    if p.j(rq)["vivant"]:
        assert p.j(rq)["role"] == "habitue" and p.j(rq)["camp"] == "taverne"


def test_videur_emporte_quelquun():
    p, h = partie(8, roles=ROLES_8)
    humaniser(p)
    finir_phase(p, h)
    c1, c2 = (x["uid"] for x in p.d["joueurs"][:2])
    vid = uid_du(p, "videur")
    p.agir(c1, {"vote": vid})
    p.agir(c2, {"vote": vid})
    jouer_jusqua(p, h, "videur")
    p.tir_videur(vid, c1)
    finir_phase(p, h)
    assert not p.j(c1)["vivant"]
    assert p.d["phase"] == "debat"


def test_egalite_au_conseil():
    p, h = partie(8, roles=ROLES_8)
    humaniser(p)
    jouer_jusqua(p, h, "conseil")
    viv = [x["uid"] for x in p.votants()]
    a, b = viv[0], viv[1]
    for i, u in enumerate(viv):
        cible = a if i % 2 else b
        if cible == u:
            cible = ""
        p.voter(u, cible)
    c = p.decompte()
    finir_phase(p, h)
    haut = max(c.values()) if c else 0
    if list(c.values()).count(haut) > 1:
        assert p.d["verdict"]["chasse"] == ""


def test_evenements_et_ames():
    p, h = partie(8, roles=ROLES_8)
    humaniser(p)
    jouer_jusqua(p, h, "nuit")
    cartes = p.d["ames"]["cartes"]
    assert len(cartes) == 3 and len(set(cartes)) == 3
    finir_phase(p, h)
    finir_phase(p, h)
    assert p.d["aube"]["carte"] in cartes


def test_carte_couvre_feu_et_biere():
    p, h = partie(8, roles=ROLES_8)
    humaniser(p)
    jouer_jusqua(p, h, "nuit")
    p.d["ames"]["cartes"] = ["biere", "calme", "rumeur"]
    p.d["ames"]["votes"] = {"x": "biere"}
    finir_phase(p, h)
    finir_phase(p, h)
    p.proclamer("…")
    muet = p.d["muet"]
    assert muet and p.j(muet)["vivant"]
    jouer_jusqua(p, h, "conseil")
    try:
        p.voter(muet, "")
        raise AssertionError("le muet a voté")
    except R.Refus:
        pass


# ─────────────────────────── Secrets ───────────────────────────
def test_vue_ne_fuit_rien():
    p, h = partie(10, graine=4, humains=3)
    for _ in range(3):
        finir_phase(p, h)
    d = p.d
    spect = R.vue(d, {"uid": "", "role": "spectateur"})
    assert spect["perso"] is None and spect["secrets"] is None
    for j in spect["joueurs"]:
        x = p.j(j["uid"])
        if not x["revele"]:
            assert j["role"] is None and j["camp"] is None and j["enchante"] is None
    assert all(e["pour"] == "public" for e in spect["journal"])
    texte = json.dumps(spect, ensure_ascii=False)
    for x in d["joueurs"]:
        if not x["revele"] and x["role"] not in ("habitue",):
            # les noms de rôles non révélés n'apparaissent pas en clair dans la vue publique
            assert f'"role": "{x["role"]}"' not in texte or any(
                y["revele"] and y["role"] == x["role"] for y in d["joueurs"])
    moi = d["joueurs"][0]
    v = R.vue(d, {"uid": moi["uid"]})
    assert v["perso"]["role"] == moi["role"]
    for j in v["joueurs"]:
        x = p.j(j["uid"])
        if j["role"] and x["uid"] != moi["uid"] and not x["revele"]:
            assert moi["camp"] == "ombres" and x["camp"] == "ombres"


def test_mj_voit_tout():
    h = Horloge()
    d = R.nouvelle({"uid": "mj1"}, mode="mj", mj="mj1")
    p = R.Partie(d, random.Random(3), h)
    for _ in range(7):
        p.ajouter_pantin()
    try:
        p.rejoindre({"uid": "mj1", "nom": "MJ"})
        raise AssertionError("le MJ a pu s'asseoir")
    except R.Refus:
        pass
    p.lancer()
    v = R.vue(d, {"uid": "mj1"})
    assert v["est_mj"] and all(j["role"] for j in v["joueurs"])


def test_aube_mj_attend_la_proclamation():
    h = Horloge()
    d = R.nouvelle({"uid": "mj1"}, mode="mj", mj="mj1")
    p = R.Partie(d, random.Random(5), h)
    for _ in range(8):
        p.ajouter_pantin()
    p.lancer()
    for _ in range(3):
        if d["phase"] == "aube":
            break
        h.t = d["echeance"]
        p.avancer()
    assert d["phase"] == "aube" and d["echeance"] is None
    p.avancer()                                   # sans proclamation, rien ne bouge
    assert d["phase"] == "aube"
    pub = R.vue(d, {"uid": ""})
    assert pub["aube"]["morts"] == [] and pub["evenement"] is None
    p.proclamer("Le MJ raconte.")
    assert d["echeance"] is not None


if __name__ == "__main__":
    tests = [(k, f) for k, f in sorted(globals().items()) if k.startswith("test_") and callable(f)]
    echecs = 0
    for nom, f in tests:
        try:
            f()
            print("ok   ", nom)
        except Exception as exc:  # noqa: BLE001
            echecs += 1
            print("ÉCHEC", nom, "→", type(exc).__name__, exc)
    print(f"\n{len(tests) - echecs}/{len(tests)} tests passent")
    sys.exit(1 if echecs else 0)
