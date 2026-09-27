"""Marelle (jeu du moulin) entre voyageurs — arbitre du hub.

Règles copiées de ``public/proto/taverne-3d/src/marelle.js`` (repo jeu) : même numérotation des 24 points,
mêmes voisinages et moulins, même liste de coups légaux. Le hub n'accepte qu'un coup présent dans
``coups()`` ; toute évolution des règles doit être faite des deux côtés.
"""
from __future__ import annotations

import asyncio
import random
import time

ADJ: list[list[int]] = [[] for _ in range(24)]


def _lier(a: int, b: int):
    ADJ[a].append(b)
    ADJ[b].append(a)


for _b in (0, 8, 16):
    for _k in range(8):
        _lier(_b + _k, _b + (_k + 1) % 8)
for _k in (1, 3, 5, 7):
    _lier(_k, 8 + _k)
    _lier(8 + _k, 16 + _k)
MOULINS = [[b + k, b + k + 1, b + (k + 2) % 8] for b in (0, 8, 16) for k in (0, 2, 4, 6)] + [[k, 8 + k, 16 + k] for k in (1, 3, 5, 7)]
PIONS, SANS_PRISE = 9, 50
ATTENTE, LENT = 180, 120


def nouvelle() -> dict:
    return {"b": [-1] * 24, "main": [PIONS, PIONS], "tour": 0, "sans": 0, "g": None}


def sur(b, j) -> int:
    return sum(1 for v in b if v == j)


def phase(s, j) -> str:
    return "pose" if s["main"][j] > 0 else ("vol" if sur(s["b"], j) == 3 else "deplace")


def _dans_moulin(b, i) -> bool:
    return any(i in m and all(b[p] == b[i] for p in m) for m in MOULINS)


def _prenables(b, adv) -> list[int]:
    tous = [i for i in range(24) if b[i] == adv]
    libres = [i for i in tous if not _dans_moulin(b, i)]
    return libres or tous


def coups(s) -> list[dict]:
    j, ph, out, bases = s["tour"], phase(s, s["tour"]), [], []
    if ph == "pose":
        bases = [{"p": i} for i in range(24) if s["b"][i] < 0]
    else:
        for de in range(24):
            if s["b"][de] != j:
                continue
            cibles = range(24) if ph == "vol" else ADJ[de]
            bases += [{"de": de, "vers": v} for v in cibles if s["b"][v] < 0]
    for m in bases:
        b = list(s["b"])
        dest = m.get("p", m.get("vers"))
        if "de" in m:
            b[m["de"]] = -1
        b[dest] = j
        if _dans_moulin(b, dest):
            out += [{**m, "x": x} for x in _prenables(b, 1 - j)]
        else:
            out.append(m)
    return out


def jouer(s, c) -> dict:
    j = s["tour"]
    n = {"b": list(s["b"]), "main": list(s["main"]), "tour": 1 - j, "sans": s["sans"], "g": None}
    if "p" in c:
        n["b"][c["p"]] = j
        n["main"][j] -= 1
    else:
        n["b"][c["de"]] = -1
        n["b"][c["vers"]] = j
    if "x" in c:
        n["b"][c["x"]] = -1
        n["sans"] = 0
    elif "p" not in c:
        n["sans"] += 1
    k = n["tour"]
    if n["main"][k] + sur(n["b"], k) < 3 or not coups(n):
        n["g"] = j
    elif n["sans"] >= SANS_PRISE:
        n["g"] = -1
    return n


def norm_coup(c) -> dict | None:
    """Garde seulement les clés connues, entières et dans 0..23."""
    if not isinstance(c, dict):
        return None
    out = {}
    for k in ("p", "de", "vers", "x"):
        v = c.get(k)
        if v is None:
            continue
        if not isinstance(v, int) or isinstance(v, bool) or not 0 <= v < 24:
            return None
        out[k] = v
    return out


class Marelle:
    """Une seule table (celle de l'étranger). ctx : broadcast, players, registre_partie, annoncer."""

    def __init__(self, ctx):
        self.ctx = ctx
        self.g: dict | None = None

    def etat(self, evt: str, extra: dict | None = None) -> dict:
        g = self.g
        if not g:
            return {"t": "marelle", "s": None, "evt": evt}
        s = g["s"]
        return {"t": "marelle", "s": {"j": g["j"], "n": g["n"], "b": s["b"], "main": s["main"], "tour": s["tour"],
                                      "sans": s["sans"], "g": s["g"], "evt": evt, **(extra or {})}}

    async def action(self, me, a: str, m: dict):
        now = time.monotonic()
        g = self.g
        if a == "ouvrir" and not me.guest and not g:
            self.g = {"j": [me.id, None], "n": [me.name, None], "s": nouvelle(), "t": now}
            await self.ctx.broadcast(self.etat("attente"))
            asyncio.create_task(self.ctx.annoncer("marelle", me))
        elif a == "rejoindre" and not me.guest and g and g["j"][1] is None and g["j"][0] != me.id:
            g["j"][1], g["n"][1] = me.id, me.name
            g["s"]["tour"], g["t"] = random.randint(0, 1), now
            await self.ctx.broadcast(self.etat("debut"))
        elif a == "jouer" and g and g["j"][1] is not None and g["s"]["g"] is None and g["j"][g["s"]["tour"]] == me.id:
            c = norm_coup(m.get("coup"))
            if c is None or c not in coups(g["s"]):
                return
            j = g["s"]["tour"]
            g["s"], g["t"] = jouer(g["s"], c), now
            fini = g["s"]["g"] is not None
            if fini and g["s"]["g"] >= 0:
                pl, w = self.ctx.players, g["s"]["g"]
                self.ctx.registre_partie(pl.get(g["j"][w]), pl.get(g["j"][1 - w]), "marelle")
            await self.ctx.broadcast(self.etat("fin" if fini else "coup", {"dernier": {**c, "j": j}}))
            if fini:
                self.g = None
        elif a == "quitter" and g and me.id in g["j"]:
            await self.quitte(me.id)

    async def quitte(self, pid: int):
        g = self.g
        if not g or pid not in g["j"]:
            return
        if g["j"][1] is not None and g["s"]["g"] is None:
            w = 1 - g["j"].index(pid)
            g["s"]["g"] = w
            pl = self.ctx.players
            self.ctx.registre_partie(pl.get(g["j"][w]), pl.get(pid), "marelle")
            await self.ctx.broadcast(self.etat("abandon"))
        self.g = None
        await self.ctx.broadcast(self.etat("ferme"))

    async def veille(self):
        while True:
            await asyncio.sleep(5)
            g, now = self.g, time.monotonic()
            if not g:
                continue
            if g["j"][1] is None and now - g["t"] > ATTENTE:
                await self.quitte(g["j"][0])
            elif g["j"][1] is not None and now - g["t"] > LENT:
                await self.quitte(g["j"][g["s"]["tour"]])
