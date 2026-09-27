"""Palet de comptoir entre voyageurs — arbitre du hub.

La physique est la copie exacte de ``public/proto/taverne-3d/src/palet.js`` (repo jeu) : pas fixe,
uniquement + - * / et racine carrée (résultats identiques au bit près en Python et en JS). Le hub
rejoue chaque tir et fait foi ; les clients rejouent le même tir pour l'animer, puis se calent sur
les positions envoyées ici. Toute modification des constantes ou de l'ordre des calculs doit être
faite des deux côtés.
"""
from __future__ import annotations

import asyncio
import math
import random
import time

L, W, RP, LANCE, DECEL, DT, E, MAX = 1.16, 0.36, 0.022, 0.08, 1.1, 1 / 240, 0.85, 240 * 8
LIGNES = [0.45, 0.58, 0.71, 0.84, 0.97, 1.1]
PAR_MANCHE, MANCHES, MAX_MANCHES = 4, 3, 6
POS, PENTE = 0.13, 0.15
ATTENTE, LENT = 180, 60


def _r(x: float) -> float:
    return math.floor(x * 1000 + 0.5) / 1000  # Math.round(x * 1000) / 1000


def norm_tir(t) -> dict | None:
    if not isinstance(t, dict):
        return None
    out = {}
    for key, lo, hi in (("p", -POS, POS), ("k", -PENTE, PENTE), ("f", 0.0, 1.0)):
        v = t.get(key)
        if not isinstance(v, (int, float)) or v != v:
            return None
        out[key] = _r(max(lo, min(hi, float(v))))
    return out


def simuler(palets: list, tir: dict, joueur: int) -> tuple[list, int]:
    s = 0.9 + 0.8 * tir["f"]
    n = math.sqrt(1 + tir["k"] * tir["k"])
    b = [[u, v, 0.0, 0.0, j, True] for u, v, j in palets]
    b.append([LANCE, tir["p"], s / n, (s * tir["k"]) / n, joueur, True])
    d = DECEL * DT
    r2 = 4 * RP * RP
    pas = 0
    for pas in range(MAX):
        bouge = False
        for x in b:
            if not x[5]:
                continue
            sp2 = x[2] * x[2] + x[3] * x[3]
            if sp2 > 0:
                sp = math.sqrt(sp2)
                if sp <= d:
                    x[2] = 0.0
                    x[3] = 0.0
                else:
                    k = (sp - d) / sp
                    x[2] = x[2] * k
                    x[3] = x[3] * k
                    bouge = True
                x[0] = x[0] + x[2] * DT
                x[1] = x[1] + x[3] * DT
        for i in range(len(b)):
            a = b[i]
            if not a[5]:
                continue
            for j in range(i + 1, len(b)):
                c = b[j]
                if not c[5]:
                    continue
                dx = c[0] - a[0]
                dy = c[1] - a[1]
                d2 = dx * dx + dy * dy
                if d2 >= r2 or d2 <= 0:
                    continue
                dd = math.sqrt(d2)
                nx = dx / dd
                ny = dy / dd
                rel = (a[2] - c[2]) * nx + (a[3] - c[3]) * ny
                if rel > 0:
                    im = ((1 + E) * rel) / 2
                    a[2] = a[2] - im * nx
                    a[3] = a[3] - im * ny
                    c[2] = c[2] + im * nx
                    c[3] = c[3] + im * ny
                    bouge = True
                o = (2 * RP - dd) / 2
                a[0] = a[0] - nx * o
                a[1] = a[1] - ny * o
                c[0] = c[0] + nx * o
                c[1] = c[1] + ny * o
        for x in b:
            if x[5] and (x[0] > L or x[0] < 0 or abs(x[1]) > W / 2):
                x[5] = False
                x[2] = 0.0
                x[3] = 0.0
        if not bouge:
            break
    return [[x[0], x[1], x[4]] for x in b if x[5]], pas


def case_de(u: float) -> int:
    for i in range(len(LIGNES) - 1):
        if u - RP >= LIGNES[i] and u + RP <= LIGNES[i + 1]:
            return i + 1
    return 0


def points(palets: list) -> list[int]:
    sc = [0, 0]
    for u, _v, j in palets:
        sc[j] += case_de(u)
    return sc


class Palet:
    """Une seule table à palet. ctx : broadcast, players, registre_partie, annoncer."""

    def __init__(self, ctx):
        self.ctx = ctx
        self.g: dict | None = None

    def etat(self, evt: str, extra: dict | None = None) -> dict:
        g = self.g
        if not g:
            return {"t": "palet", "s": None, "evt": evt}
        return {"t": "palet", "s": {"j": g["j"], "n": g["n"], "sc": g["sc"], "manche": g["manche"], "tir": g["tir"],
                                    "tour": g["tour"], "palets": g["palets"], "g": g.get("g"), "evt": evt, **(extra or {})}}

    async def action(self, me, a: str, m: dict):
        now = time.monotonic()
        g = self.g
        if a == "ouvrir" and not me.guest and not g:
            self.g = {"j": [me.id, None], "n": [me.name, None], "sc": [0, 0], "manche": 1, "tir": 0, "tour": 0,
                      "premier": 0, "palets": [], "t": now, "occupe": 0.0}
            await self.ctx.broadcast(self.etat("attente"))
            asyncio.create_task(self.ctx.annoncer("palet", me))
        elif a == "rejoindre" and not me.guest and g and g["j"][1] is None and g["j"][0] != me.id:
            g["j"][1], g["n"][1] = me.id, me.name
            g["tour"] = g["premier"] = random.randint(0, 1)
            g["t"] = now
            await self.ctx.broadcast(self.etat("debut"))
        elif a == "tirer" and g and g["j"][1] is not None and g.get("g") is None and g["j"][g["tour"]] == me.id and now >= g["occupe"]:
            tir = norm_tir(m.get("tir"))
            if not tir:
                return
            avant = g["palets"]
            apres, pas = simuler(avant, tir, g["tour"])
            g["palets"], g["tir"] = apres, g["tir"] + 1
            duree = pas * DT + 0.6
            g["occupe"], g["t"] = now + duree + 5, now
            await self.ctx.broadcast(self.etat("tir", {"tirJ": g["tour"], "tirP": tir, "avant": avant, "dureeMs": int(duree * 1000)}))
            asyncio.create_task(self._suite(g, duree))
        elif a == "quitter" and g and me.id in g["j"]:
            await self.quitte(me.id)

    async def _suite(self, g: dict, delai: float):
        await asyncio.sleep(delai)
        if self.g is not g:
            return
        g["t"] = time.monotonic()
        if g["tir"] < 2 * PAR_MANCHE:
            g["tour"], g["occupe"] = 1 - g["tour"], 0.0
            return await self.ctx.broadcast(self.etat("tour"))
        pts = points(g["palets"])
        g["sc"] = [g["sc"][0] + pts[0], g["sc"][1] + pts[1]]
        fin = g["manche"] >= MANCHES and (g["sc"][0] != g["sc"][1] or g["manche"] >= MAX_MANCHES)
        if fin:
            g["g"] = -1 if g["sc"][0] == g["sc"][1] else (0 if g["sc"][0] > g["sc"][1] else 1)
            if g["g"] >= 0:
                pl = self.ctx.players
                self.ctx.registre_partie(pl.get(g["j"][g["g"]]), pl.get(g["j"][1 - g["g"]]), "palet")
            await self.ctx.broadcast(self.etat("fin", {"pts": pts}))
            self.g = None
            return
        await self.ctx.broadcast(self.etat("manche_fin", {"pts": pts}))
        await asyncio.sleep(3.2)
        if self.g is not g:
            return
        g["manche"], g["tir"], g["palets"] = g["manche"] + 1, 0, []
        g["premier"] = 1 - g["premier"]
        g["tour"], g["occupe"], g["t"] = g["premier"], 0.0, time.monotonic()
        await self.ctx.broadcast(self.etat("manche"))

    async def quitte(self, pid: int):
        g = self.g
        if not g or pid not in g["j"]:
            return
        if g["j"][1] is not None and g.get("g") is None:
            g["g"] = 1 - g["j"].index(pid)
            pl = self.ctx.players
            self.ctx.registre_partie(pl.get(g["j"][g["g"]]), pl.get(pid), "palet")
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
            elif g["j"][1] is not None and now - g["t"] > LENT and now >= g["occupe"]:
                await self.quitte(g["j"][g["tour"]])
