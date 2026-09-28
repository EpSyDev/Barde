"""Veillée du conteur — Taverne 3D.

Une fois par semaine (``HUB_VEILLEE``, par défaut « 4 21:00 » = vendredi 21 h, heure de Paris), Gaspard
raconte au coin du feu le chapitre suivant de ``hub/veillee.json``. Le hub donne le tempo : les clients
reçoivent le chapitre et le temps écoulé (un voyageur qui arrive en cours de route tombe sur la bonne
phrase). Un quart d'heure avant, annonce sur Discord ; à la fin, les présents (restés près du feu au
moins la moitié du récit) sont crédités (gain ``taverne_veillee`` du bot) et le résumé part sur Discord.

``HUB_VEILLEE_TEST=<secondes>`` : lance une veillée N secondes après le démarrage (développement).

Réglages pilotés depuis le dashboard (page Jeux, module Fripouille ``taverne3d``) : actif, jour, heure,
chapitre imposé, « lancer maintenant ». Le hub les relit toutes les 20 s et y dépose son état ; sans
réponse du bot, il garde ses derniers réglages (au départ : ``HUB_VEILLEE``).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timedelta
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    PARIS = ZoneInfo("Europe/Paris")
except Exception:  # base des fuseaux absente (Windows sans tzdata) : heure locale de la machine
    PARIS = None

log = logging.getLogger("hub")
CHAPITRES_F = Path(__file__).parent / "veillee.json"
RAYON, PRESENCE = 6.0, 0.5   # distance au foyer (0, 0) et part du récit à passer au coin du feu
AVANCE = 15 * 60             # annonce Discord avant le début
DEBUT_BLANC = 4.0            # le temps de s'installer avant la première phrase


def duree_ligne(ligne: str) -> float:
    """Même formule que public/proto/taverne-3d/src/veillee.js (repo jeu)."""
    return 3.0 + len(ligne) * 0.058


def _maintenant() -> datetime:
    return datetime.now(PARIS) if PARIS else datetime.now()


def prochaine(horaire: str, depuis: datetime | None = None) -> datetime:
    """« J HH:MM » (J : 0 lundi … 6 dimanche) → prochaine occurrence strictement future."""
    j, hm = horaire.split()
    h, m = (int(x) for x in hm.split(":"))
    now = depuis or _maintenant()
    d = now.replace(hour=h, minute=m, second=0, microsecond=0) + timedelta(days=(int(j) - now.weekday()) % 7)
    return d if d > now else d + timedelta(days=7)


class Veillee:
    """ctx : broadcast, players, frip, registre, registre_sauver, send."""

    def __init__(self, ctx):
        self.ctx = ctx
        self.horaire = os.getenv("HUB_VEILLEE") or "4 21:00"
        try:
            self.chapitres = json.loads(CHAPITRES_F.read_text(encoding="utf8"))["chapitres"]
        except (OSError, ValueError, KeyError):
            self.chapitres = []
            log.warning("veillee.json illisible : pas de veillée")
        self.en_cours: dict | None = None
        self.prochaine_t = 0.0  # time.monotonic() du prochain début
        j, hm = self.horaire.split()
        self.cfg = {"veillee_actif": True, "veillee_jour": int(j), "veillee_heure": hm, "veillee_chapitre": None, "veillee_demande": 0}
        self.prochaine_d: datetime | None = None

    # ---- état envoyé aux clients
    def _reg(self) -> dict:
        return self.ctx.registre.setdefault("veillee", {"n": 0, "derniere": None})

    def etat(self, evt: str = "etat") -> dict:
        v = self.en_cours
        out = {"t": "veillee", "evt": evt, "prochaine": max(0, int(self.prochaine_t - time.monotonic())),
               "derniere": self._reg().get("derniere")}
        if v:
            out["s"] = {"titre": v["ch"]["titre"], "lignes": v["ch"]["lignes"], "ecoule": round(time.monotonic() - v["t0"], 2)}
        return out

    def chapitre(self, i: int) -> dict | None:
        return self.chapitres[i % len(self.chapitres)] if self.chapitres else None

    # ---- réglages (dashboard) et état rapporté
    def _index(self) -> int:
        c = self.cfg.get("veillee_chapitre")
        return c if isinstance(c, int) and self.chapitres and 0 <= c < len(self.chapitres) else self._reg()["n"] % max(1, len(self.chapitres))

    def _resume(self) -> dict:
        v = self.en_cours
        return {"chapitres": [c["titre"] for c in self.chapitres], "suivant": self._index(),
                "prochaine": self.prochaine_d.isoformat(timespec="minutes") if self.prochaine_d else None,
                "en_cours": {"titre": v["ch"]["titre"], "ecoule": int(time.monotonic() - v["t0"]), "duree": int(v["duree"])} if v else None,
                "derniere": (self._reg().get("derniere") or {}).get("titre")}

    async def _relire(self):
        r = await self.ctx.frip("veillee_reglages", {"etat": self._resume()}, "taverne3d")
        if r and r.get("ok"):
            self.cfg.update({k: r[k] for k in self.cfg if k in r})

    # ---- déroulé : un passage toutes les 20 s (réglages, annonce un quart d'heure avant, début)
    async def boucle(self):
        test = os.getenv("HUB_VEILLEE_TEST")
        debut_test = time.monotonic() + float(test) if test else None
        annoncee = None
        while True:
            await self._relire()
            reg = self._reg()
            if not self.chapitres:
                await asyncio.sleep(3600)
                continue
            # « lancer maintenant » depuis le dashboard (joué une seule fois, même après un redémarrage)
            demande = int(self.cfg.get("veillee_demande") or 0)
            if demande > int(reg.get("demande_vue") or 0):
                reg["demande_vue"] = demande
                self.ctx.registre_sauver()
                await self.raconter(self._index())
                continue
            if debut_test and time.monotonic() >= debut_test:
                debut_test = None
                await self.raconter(self._index())
                continue
            if not self.cfg.get("veillee_actif"):
                self.prochaine_d, self.prochaine_t = None, 0.0
                await asyncio.sleep(20)
                continue
            self.prochaine_d = prochaine(f"{self.cfg['veillee_jour']} {self.cfg['veillee_heure']}")
            attente = (self.prochaine_d - _maintenant()).total_seconds()
            self.prochaine_t = time.monotonic() + attente
            ch = self.chapitre(self._index())
            if attente <= AVANCE and annoncee != self.prochaine_d:
                annoncee = self.prochaine_d
                await self.ctx.frip("annonce", {"type": "veillee_bientot", "nom": "Gaspard", "titre": ch["titre"]}, "taverne3d")
                await self.ctx.broadcast({"t": "veillee", "evt": "bientot", "titre": ch["titre"], "dans": int(attente)})
            if attente <= 20:
                await asyncio.sleep(max(0.0, attente))
                await self.raconter(self._index())
                continue
            await asyncio.sleep(20)

    async def raconter(self, i: int):
        ch = self.chapitre(i)
        impose = self.cfg.get("veillee_chapitre") is not None
        duree = DEBUT_BLANC + sum(duree_ligne(l) for l in ch["lignes"])
        v = self.en_cours = {"ch": ch, "t0": time.monotonic(), "presence": {}, "noms": {}, "duree": duree}
        log.info("veillée : « %s » (%.0f s)", ch["titre"], duree)
        if impose:
            self.cfg["veillee_chapitre"] = None
            await self.ctx.frip("veillee_consommee", {}, "taverne3d")
        await self._relire()
        await self.ctx.broadcast(self.etat("debut"))
        pas = 5.0
        fin = v["t0"] + duree
        while time.monotonic() < fin:
            await asyncio.sleep(pas)
            for p in list(self.ctx.players.values()):
                if p.guest or not p.discord or p.w != "in":
                    continue
                if (p.p[0] ** 2 + p.p[2] ** 2) ** 0.5 <= RAYON:
                    v["presence"][p.discord] = v["presence"].get(p.discord, 0.0) + pas
                    v["noms"][p.discord] = p.name
        presents = [d for d, s in v["presence"].items() if s >= duree * PRESENCE]
        self.en_cours = None
        reg = self._reg()
        reg["n"] = (i + 1) % max(1, len(self.chapitres))
        reg["derniere"] = {"titre": ch["titre"], "lignes": ch["lignes"], "resume": ch.get("resume", ""), "date": int(time.time())}
        self.ctx.registre_sauver()
        res = await self.ctx.frip("veillee", {"user_ids": presents}, "economie") if presents else None
        montant = int((res or {}).get("montant") or 0)
        credites = set((res or {}).get("credites") or [])
        noms = [v["noms"][d] for d in presents]
        await self.ctx.frip("annonce", {"type": "veillee_resume", "nom": "Gaspard", "titre": ch["titre"], "resume": ch.get("resume", ""),
                                        "presents": ", ".join(noms)}, "taverne3d")
        fin_msg = self.etat("fin")
        fin_msg.update({"presents": noms, "montant": montant,
                        "ids": [p.id for p in self.ctx.players.values() if p.discord in credites]})
        await self.ctx.broadcast(fin_msg)
        log.info("veillée finie : %d présent(s), %d crédité(s) de %d", len(presents), len(credites), montant)
