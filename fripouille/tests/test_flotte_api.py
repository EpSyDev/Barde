"""Test d'intégration des Flottes Royales : la vraie API aiohttp de La Fripouille, deux
capitaines (deux clients HTTP distincts) et un bot, de la création du salon à la revanche.

Lancer depuis la racine du repo, avec les dépendances du bot (aiohttp, discord.py) :
``python3 -m fripouille.tests.test_flotte_api`` (sur la VM : avec le venv du bot).
Aucun Discord réel : le serveur Discord est simulé, l'état est écrit dans un dossier
temporaire. L'horloge des manches est avancée à la main (``flotte.tic``).
"""
import asyncio
import json
import os
import sys
import tempfile
import time
from pathlib import Path

os.environ["FRIPOUILLE_API_TOKEN"] = "jeton-de-test"
os.environ["GUILD_ID"] = "1"

from aiohttp import ClientSession, test_utils  # noqa: E402

from fripouille import webapi  # noqa: E402
from fripouille.modules import flotte, flotte_regles as R  # noqa: E402

A, B, INTRUS = "100000000000000001", "100000000000000002", "100000000000000009"
JETON = {"X-Api-Token": "jeton-de-test"}


class Avatar:
    def replace(self, **_):
        return self

    url = "https://cdn.discordapp.com/avatars/1/a.webp?size=128"


class Membre:
    def __init__(self, nom):
        self.display_name, self.display_avatar = nom, Avatar()


class Guilde:
    membres = {int(A): Membre("Anne"), int(B): Membre("Bastien")}

    def get_member(self, uid):
        return self.membres.get(uid)


class FauxBot:
    store = None

    def get_guild(self, _gid):
        return Guilde()


async def lire_evenement(flux):
    """Prochain message « data: » d'un flux SSE (les battements sont ignorés)."""
    while True:
        ligne = (await asyncio.wait_for(flux.content.readline(), 5)).decode().strip()
        if ligne.startswith("data: "):
            return json.loads(ligne[6:])


async def dernier_etat(flux, condition, essais=30):
    for _ in range(essais):
        v = await lire_evenement(flux)
        if condition(v):
            return v
    raise AssertionError("état attendu jamais reçu")


async def scenario():
    dossier = Path(tempfile.mkdtemp())
    flotte.FICHIER = dossier / "flotte.json"
    flotte._etat = {"salons": {}}
    app = webapi.build_app(FauxBot())
    flotte._taches["horloge"].cancel()          # l'horloge est menée par le test
    serveur = test_utils.TestServer(app)
    await serveur.start_server()
    base = str(serveur.make_url(""))
    async with ClientSession() as http_a, ClientSession() as http_b:
        async def ticket(http, uid, role="convive"):
            r = await http.post(base + "/api/flotte/ticket", headers=JETON,
                                json={"uid": uid, "role": role, "nom": "x"})
            return r.status, await r.json()

        async def op(http, t, **corps):
            r = await http.post(base + "/api/flotte/op?ticket=" + t, json=corps)
            return r.status, await r.json()

        # Identités : membre du serveur obligatoire, ticket obligatoire pour agir.
        st, _ = await ticket(http_a, INTRUS)
        assert st == 403
        st, _ = await op(http_a, "faux", op="creer")
        assert st == 401
        r = await http_a.post(base + "/api/flotte/op", headers=JETON, json={"op": "creer"})
        assert r.status == 403                    # le token seul ne fait pas un capitaine
        _, ta = await ticket(http_a, A)
        _, tb = await ticket(http_b, B)
        ta, tb = ta["op_url"].split("ticket=")[1], tb["op_url"].split("ticket=")[1]

        # Salon : création idempotente, quai, code, hôte.
        st, c1 = await op(http_a, ta, op="creer", options={"plan": 30})
        assert st == 200 and len(c1["code"]) == 5
        _, c2 = await op(http_a, ta, op="creer")
        assert c2["salon"] == c1["salon"]          # double clic : même salon
        sid = c1["salon"]
        quai = await http_b.get(base + "/api/flotte/flux?ticket=" + tb)
        v = await lire_evenement(quai)
        assert v["type"] == "quai" and [s["code"] for s in v["salons"]] == [c1["code"]]
        quai.close()
        st, e = await op(http_b, tb, op="rejoindre", code="ZZZZZ")
        assert st == 400 and "code" in e["error"]
        st, _ = await op(http_b, tb, op="rejoindre", code=c1["code"].lower())
        assert st == 200
        st, _ = await op(http_b, tb, op="lancer", salon=sid)
        assert st == 400                          # pas l'hôte
        st, _ = await op(http_b, tb, op="bot", salon=sid)
        assert st == 400
        await op(http_a, ta, op="bot", salon=sid)  # 3 flottes : le brouillard tient
        st, e = await op(http_a, ta, op="lancer", salon=sid)
        assert st == 400 and "prêts" in e["error"]
        await op(http_b, tb, op="pret", salon=sid, valeur=True)

        flux_a = await http_a.get(base + "/api/flotte/flux?ticket=%s&salon=%s" % (ta, sid))
        flux_b = await http_b.get(base + "/api/flotte/flux?ticket=%s&salon=%s" % (tb, sid))
        v = await lire_evenement(flux_a)
        assert v["type"] == "salon" and v["peut"]["lancer"] and v["phase"] == "salon"
        st, _ = await op(http_a, ta, op="lancer", salon=sid)
        assert st == 200
        t0 = time.time()
        flotte.tic(t0 + 9)
        va = await dernier_etat(flux_a, lambda x: x.get("phase") == "planification")
        vb = await dernier_etat(flux_b, lambda x: x.get("phase") == "planification")
        assert sorted(va["connectes"]) == [A, B]

        # Brouillard : chacun ne reçoit que ses navires et ceux qu'il voit.
        d = flotte.salons()[sid]
        p = R.Partie(d)
        for v, uid in ((va, A), (vb, B)):
            brut = json.dumps(v)
            permis = {n["id"] for n in p.flotte(uid)} | {n["id"] for n in p.visibles(uid)}
            assert {n["id"] for n in v["navires"]} == permis
            for n in d["navires"]:
                if n["id"] not in permis:
                    assert '"%s"' % n["id"] not in brut
            assert '"sel"' not in brut and v["graine"] is None

        # Ordres : falsifications refusées, rejeu sans effet, verrou.
        mien = p.flotte(A)[0]
        autre = p.flotte(B)[0]
        cachee = next((n for n in d["navires"] if n["uid"] != A and n not in p.visibles(A)), None)
        st, _ = await op(http_a, ta, op="ordres", salon=sid, manche=1, ordres={autre["id"]: {}})
        assert st == 400                          # navire d'autrui
        st, _ = await op(http_a, ta, op="ordres", salon=sid, manche=2, ordres={})
        assert st == 400                          # mauvaise manche
        st, _ = await op(http_a, ta, op="ordres", salon=sid, manche=1,
                         ordres={mien["id"]: {"chemin": [[0, 0], [12, 10]]}})
        assert st == 400                          # téléportation
        if cachee:
            st, _ = await op(http_a, ta, op="ordres", salon=sid, manche=1,
                             ordres={mien["id"]: {"action": {"type": "tir", "cible": cachee["id"]}}})
            assert st == 400                      # cible cachée : refusée sans rien révéler
        acces = R.atteignables(d["carte"], d["meteo"], mien["classe"], mien["pos"])
        occupees = {tuple(n["pos"]) for n in d["navires"]}
        chemin = next(c for cell, c in sorted(acces.items()) if c and not occupees & set(c))
        ordre = {mien["id"]: {"chemin": [list(x) for x in chemin], "action": {"type": "garde"}}}
        for _ in range(2):                        # double envoi : même résultat
            st, _ = await op(http_a, ta, op="ordres", salon=sid, manche=1, ordres=ordre, verrou=True)
            assert st == 200
        await op(http_b, tb, op="ordres", salon=sid, manche=1, verrou=True)
        flotte.tic(time.time())                   # tous verrouillés : échéance ramenée à 1 s
        assert d["echeance"] <= time.time() + 1.01
        flotte.tic(time.time() + 2)
        assert d["phase"] == "resolution" and d["manche"] == 2
        va = await dernier_etat(flux_a, lambda x: x.get("manche") == 2)
        assert va["historique"][-1]["manche"] == 1
        evts = va["historique"][-1]["evts"]
        heurte = any(e["t"] == "choc" and mien["id"] in e["ids"] for e in evts)   # le bot a pu couper la route
        assert heurte or any(e["t"] == "mouv" and e["id"] == mien["id"] for e in evts)
        assert heurte or p.n(mien["id"])["pos"] == list(chemin[-1])

        # Reconnexion : un nouveau flux redonne aussitôt l'état autorisé.
        flux_b.close()
        _, tb2 = await ticket(http_b, B)
        tb2 = tb2["op_url"].split("ticket=")[1]
        flux_b = await http_b.get(base + "/api/flotte/flux?ticket=%s&salon=%s" % (tb2, sid))
        vb = await lire_evenement(flux_b)
        assert vb["manche"] == 2 and vb["moi"] == B

        # Persistance : l'état relu du disque est identique.
        flotte._ecrire()
        relu = json.loads(flotte.FICHIER.read_text(encoding="utf-8"))
        assert relu["salons"][sid]["manche"] == 2

        # Limiteur : une rafale de gestes est freinée, sans rien casser.
        flotte._debit.clear()
        rafale = [await op(http_a, ta, op="ordres", salon=sid, manche=2, ordres={}) for _ in range(15)]
        assert any("doucement" in e.get("error", "") for _, e in rafale)
        flotte._debit.clear()

        # Départ de B (abandon), puis de A : plus d'humain en lice → clôture, revanche.
        await op(http_b, tb2, op="quitter", salon=sid)
        assert p.j(B)["abandon"] and d["phase"] != "fin"
        await op(http_a, ta, op="quitter", salon=sid)
        flotte.tic(time.time())
        assert d["phase"] == "fin" and d["fin"]["raison"] in ("anticipee", "derniere_flotte")
        vf = await dernier_etat(flux_a, lambda x: x.get("phase") == "fin")
        assert vf["graine"] == d["graine"] and vf["peut"]["revanche"]
        st, _ = await op(http_b, tb2, op="revanche", salon=sid)
        assert st == 400                          # B a quitté : il n'est plus du salon…
        st, e = await op(http_a, ta, op="revanche", salon=sid, meme_carte=True)
        assert st == 200, e
        neuve = flotte.salons()[sid]
        assert neuve["phase"] == "salon" and neuve["graine"] == d["graine"] and neuve["sel"] != d["sel"]
        assert [j["uid"] for j in neuve["joueurs"] if not j["bot"]] == [A]   # B n'est plus là
        flux_a.close()
        flux_b.close()
    await serveur.close()
    print("ok   scénario complet : salon, brouillard, ordres, résolution, reconnexion, revanche")


async def relais_et_menage():
    """Hôte absent du quai → la barre passe après 60 s ; salon déserté → refermé."""
    flotte._etat = {"salons": {}}
    flotte._abonnes.clear()
    qa = {"uid": A, "nom": "Anne", "avatar": "", "role": "convive"}
    qb = {"uid": B, "nom": "Bastien", "avatar": "", "role": "convive"}
    now = time.time()
    sid = flotte._appliquer("creer", {}, qa, A, now)["salon"]
    code = flotte.salons()[sid]["code"]
    flotte._appliquer("rejoindre", {"code": code}, qb, B, now)
    flotte._abonnes[asyncio.Queue()] = {"qui": qb, "salon": sid}   # seul Bastien est à quai
    flotte.tic(now)
    assert flotte.salons()[sid]["hote"] == A
    flotte.tic(now + 61)
    assert flotte.salons()[sid]["hote"] == B
    flotte._abonnes.clear()
    flotte.tic(time.time() + flotte.OUBLI["salon"] + 5)
    assert sid not in flotte.salons()
    print("ok   relais de l'hôte absent, ménage des salons désertés")


if __name__ == "__main__":
    try:
        asyncio.run(scenario())
        asyncio.run(relais_et_menage())
    except Exception:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        sys.exit(1)
