"""Banc d'essai : la VRAIE API de La Fripouille (webapi + module flotte), Discord simulé.

Membres simulés : tout identifiant 10000000000000000N (N = 0…8) ; …09 n'est PAS membre
(sert à vérifier le refus). Aucun bot Discord, aucun réseau : état dans un dossier temporaire.
Variables : BANC_API_PORT (8091), BANC_METEO (calme|brise|vent_fort|brouillard|tempete :
météo imposée, pour contrôler les effets visuels).
"""
import asyncio
import os
import sys
import tempfile
from pathlib import Path

PORT = int(os.environ.get("BANC_API_PORT", "8091"))
os.environ.update(FRIPOUILLE_API_TOKEN="jeton-banc", GUILD_ID="1", FRIPOUILLE_PUBLIC_BASE=f"http://127.0.0.1:{PORT}")
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from aiohttp import web  # noqa: E402

from fripouille import webapi  # noqa: E402
from fripouille.modules import flotte, flotte_regles as R  # noqa: E402

NOMS = ["Hugo du Ressac", "Anne de Brisevague", "Bastien Tribord", "Corentin Vague", "Dalia Hune",
        "Émile Vergue", "Fanny Bouline", "Gaspard Sabord", "Hélène Misaine"]


class Avatar:
    url = "https://cdn.discordapp.com/embed/avatars/0.png"

    def replace(self, **_):
        return self


class Membre:
    def __init__(self, nom):
        self.display_name, self.display_avatar = nom, Avatar()


class Guilde:
    def get_member(self, uid):
        n = uid - 100000000000000000
        return Membre(NOMS[n]) if 0 <= n <= 8 else None


class FauxBot:
    store = None

    def get_guild(self, _):
        return Guilde()


METEO = os.environ.get("BANC_METEO")
if METEO:
    R.tirer_meteo = lambda m, a: {"temps": METEO, "vent": m["vent"]}
    _lancer = R.Partie.lancer

    def lancer(self, maintenant):
        _lancer(self, maintenant)
        self.d["meteo"]["temps"] = METEO
        self.d["prevision"] = {"temps": METEO, "vent": self.d["meteo"]["vent"]}
    R.Partie.lancer = lancer


async def main():
    dossier = Path(tempfile.mkdtemp(prefix="flotte-banc-"))
    flotte.FICHIER, flotte.HISTORIQUE = dossier / "flotte.json", dossier / "flotte_historique.json"
    flotte._etat = {"salons": {}}
    runner = web.AppRunner(webapi.build_app(FauxBot()))
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", PORT).start()
    print(f"API du banc prête sur {PORT} (état : {dossier})", flush=True)
    await asyncio.Event().wait()

asyncio.run(main())
