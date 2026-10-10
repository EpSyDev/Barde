"""Générateur des cartes de combat du plateau de jeu (scènes prêtes à jouer).

Rendu procédural (numpy + Pillow) : textures de sol par bruit multi-échelle, mobilier
avec ombres portées, halos de lumière. Une case = 96 px : le quadrillage du plateau
tombe pile sur le décor, et la carte reste nette au zoom maximal.

    py dashboard/scripts/cartes.py        → dashboard/public/cartes/*.webp

Déterministe (graines fixes) : relancer redonne les mêmes cartes.
"""
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

C = 96  # px par case
SORTIE = Path(__file__).resolve().parent.parent / "public" / "cartes"


# ─────────────────────────── Bruit & textures ───────────────────────────
def bruit(w, h, echelle, octaves=4, graine=0, etire=(1.0, 1.0)):
    """Bruit de valeur multi-octaves dans [0, 1] (interpolation bicubique de grilles)."""
    rng = np.random.default_rng(graine)
    total = np.zeros((h, w), np.float32)
    amp, poids = 1.0, 0.0
    for o in range(octaves):
        s = max(2.0, echelle / (2 ** o))
        gw, gh = int(w / (s * etire[0])) + 3, int(h / (s * etire[1])) + 3
        g = rng.random((gh, gw)).astype(np.float32)
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        total += amp * (np.asarray(im, np.float32) / 255.0)
        poids += amp
        amp *= 0.5
    t = total / poids
    return (t - t.min()) / (t.max() - t.min() + 1e-6)


def teinte(base, n, amp=0.35):
    b = np.array(base, np.float32)[None, None, :]
    return np.clip(b * (1 + (n[..., None] - 0.5) * amp), 0, 255)


def melange(a, b, masque):
    m = masque[..., None]
    return a * (1 - m) + b * m


def vers_image(arr):
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def parquet(w, h, graine):
    rng = np.random.default_rng(graine)
    grain = bruit(w, h, 40, 4, graine, etire=(6.0, 0.25))
    fin = bruit(w, h, 6, 2, graine + 1)
    out = np.zeros((h, w, 3), np.float32)
    rangee = C // 3
    for y0 in range(0, h, rangee):
        x0 = -int(rng.integers(0, C * 2))
        while x0 < w:
            l = int(rng.integers(int(C * 1.4), int(C * 3.6)))
            ton = rng.uniform(0.78, 1.12)
            base = np.array([118, 78, 44]) * ton
            xa, xb, yb = max(0, x0), min(w, x0 + l), min(h, y0 + rangee)
            zone = grain[y0:yb, xa:xb] * 0.7 + fin[y0:yb, xa:xb] * 0.3
            out[y0:yb, xa:xb] = teinte(base, zone, 0.45)
            out[y0:yb, max(0, x0):max(0, x0) + 2] *= 0.45          # joint de bout
            x0 += l
        out[y0:y0 + 2, :] *= 0.5                                      # joint de rangée
    return out


def dalles(w, h, graine, base=(118, 112, 102), taille=C):
    """Dalles irrégulières : grille décalée, ton par dalle, joints sombres, léger biseau."""
    rng = np.random.default_rng(graine)
    n = bruit(w, h, 30, 5, graine)
    out = teinte(base, n, 0.35)
    img = vers_image(out)
    d = ImageDraw.Draw(img, "RGBA")
    y = 0
    while y < h:
        hh = int(taille * rng.uniform(0.75, 1.15))
        x = -int(rng.integers(0, taille))
        while x < w:
            ww = int(taille * rng.uniform(0.8, 1.5))
            ton = int(rng.integers(-22, 22))
            d.rectangle([x + 3, y + 3, x + ww - 3, y + hh - 3],
                        fill=(128 + ton, 128 + ton, 128 + ton, 34))
            d.line([x + 3, y + 3, x + ww - 3, y + 3], fill=(255, 255, 255, 30), width=2)
            d.line([x + 3, y + hh - 3, x + ww - 3, y + hh - 3], fill=(0, 0, 0, 60), width=2)
            d.rectangle([x, y, x + ww, y + hh], outline=(28, 24, 20, 200), width=3)
            x += ww
        y += hh
    a = np.asarray(img, np.float32)
    # fissures / salissures
    sale = bruit(w, h, 60, 3, graine + 7)
    return a * (0.85 + 0.25 * sale[..., None])


def herbe(w, h, graine):
    n1 = bruit(w, h, 120, 5, graine)
    n2 = bruit(w, h, 14, 3, graine + 1)
    base = melange(teinte((74, 104, 46), n2, 0.5), teinte((98, 122, 52), n2, 0.4), n1)
    rng = np.random.default_rng(graine + 2)
    img = vers_image(base * (0.85 + 0.3 * n1[..., None]))
    d = ImageDraw.Draw(img, "RGBA")
    for _ in range(w * h // 900):                                     # brins clairs
        x, y = rng.integers(0, w), rng.integers(0, h)
        d.line([x, y, x + rng.integers(-3, 4), y - rng.integers(4, 10)], fill=(150, 180, 90, 110), width=1)
    for _ in range(w * h // 26000):                                   # fleurs
        x, y = rng.integers(0, w), rng.integers(0, h)
        col = [(235, 225, 120), (230, 230, 240), (200, 120, 190)][rng.integers(0, 3)]
        d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=col + (220,))
    return np.asarray(img, np.float32)


def terre(w, h, graine):
    n = bruit(w, h, 50, 5, graine)
    f = bruit(w, h, 5, 2, graine + 3)
    out = teinte((122, 92, 60), n * 0.7 + f * 0.3, 0.45)
    rng = np.random.default_rng(graine + 4)
    img = vers_image(out)
    d = ImageDraw.Draw(img, "RGBA")
    for _ in range(w * h // 5000):                                    # cailloux
        x, y, r = rng.integers(0, w), rng.integers(0, h), rng.integers(2, 6)
        g = int(rng.integers(110, 170))
        d.ellipse([x - r, y - r, x + r, y + r], fill=(g, g - 8, g - 20, 200))
    return np.asarray(img, np.float32)


def eau(w, h, graine):
    n = bruit(w, h, 40, 4, graine, etire=(1.5, 0.6))
    return teinte((52, 92, 112), n, 0.5)


# ─────────────────────────── Décor ───────────────────────────
class Scene:
    """Fond + calques : ombres (portées, floutées), objets, lumières (additives)."""

    def __init__(self, cols, rows):
        self.w, self.h = cols * C, rows * C
        self.fond = None
        self.ombre = Image.new("L", (self.w, self.h), 0)
        self.obj = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        self.lum = Image.new("RGB", (self.w, self.h), (0, 0, 0))
        self.do = ImageDraw.Draw(self.obj)
        self.ds = ImageDraw.Draw(self.ombre)

    @staticmethod
    def p(v):
        return v * C

    def _ombre(self, forme, coords, **kw):
        dec = [c + (8 if i % 2 == 0 else 11) for i, c in enumerate(coords)] if isinstance(coords[0], (int, float)) else \
              [(x + 8, y + 11) for x, y in coords]
        getattr(self.ds, forme)(dec, fill=150, **kw)

    def rect(self, x, y, l, h, couleur, bord=None, ombre=True, rayon=0, epaisseur=3):
        c = [self.p(x), self.p(y), self.p(x + l), self.p(y + h)]
        if ombre:
            self._ombre("rounded_rectangle", c, radius=rayon)
        self.do.rounded_rectangle(c, radius=rayon, fill=couleur, outline=bord, width=epaisseur)

    def rond(self, x, y, r, couleur, bord=None, ombre=True, epaisseur=3):
        c = [self.p(x - r), self.p(y - r), self.p(x + r), self.p(y + r)]
        if ombre:
            self._ombre("ellipse", c)
        self.do.ellipse(c, fill=couleur, outline=bord, width=epaisseur)

    def poly(self, pts, couleur, bord=None, ombre=True):
        pp = [(self.p(x), self.p(y)) for x, y in pts]
        if ombre:
            self._ombre("polygon", pp)
        self.do.polygon(pp, fill=couleur, outline=bord)

    def ligne(self, pts, couleur, ep=3):
        self.do.line([(self.p(x), self.p(y)) for x, y in pts], fill=couleur, width=ep)

    def lumiere(self, x, y, r, couleur, force=1.0):
        """Halo radial additif (torche, foyer, brasero)."""
        R = int(self.p(r))
        g = Image.new("L", (2 * R, 2 * R), 0)
        dg = ImageDraw.Draw(g)
        for i in range(R, 0, -2):
            v = int(255 * force * (1 - i / R) ** 1.8)
            dg.ellipse([R - i, R - i, R + i, R + i], fill=v)
        col = Image.new("RGB", (2 * R, 2 * R), couleur)
        tache = ImageChops.multiply(col, Image.merge("RGB", (g, g, g)))
        zone = (int(self.p(x)) - R, int(self.p(y)) - R)
        self.lum.paste(ImageChops.add(self.lum.crop((*zone, zone[0] + 2 * R, zone[1] + 2 * R)), tache), zone)

    # Meubles & éléments récurrents
    def table_ronde(self, x, y, r=0.75, chaises=4):
        for i in range(chaises):
            a = i * 2 * math.pi / chaises + math.pi / 4
            cx, cy = x + math.cos(a) * (r + 0.32), y + math.sin(a) * (r + 0.32)
            self.rect(cx - 0.2, cy - 0.2, 0.4, 0.4, (92, 60, 32), (40, 24, 10), rayon=6)
        self.rond(x, y, r, (138, 92, 50), (52, 32, 14), epaisseur=5)
        self.rond(x, y, r * 0.78, None, (112, 74, 40), ombre=False, epaisseur=2)
        self.rond(x + r * 0.25, y - r * 0.2, 0.09, (230, 200, 120), ombre=False)      # bougie
        self.rond(x - r * 0.3, y + r * 0.15, 0.12, (170, 170, 180), (90, 90, 100), ombre=False)  # chope
        self.lumiere(x + r * 0.25, y - r * 0.2, 1.6, (255, 170, 80), 0.55)

    def tonneau(self, x, y, r=0.38):
        self.rond(x, y, r, (110, 70, 36), (40, 24, 10), epaisseur=4)
        for k in (0.75, 0.45):
            self.rond(x, y, r * k, None, (60, 40, 22), ombre=False, epaisseur=3)

    def caisse(self, x, y, s=0.8):
        self.rect(x, y, s, s, (140, 102, 60), (58, 38, 18), epaisseur=4)
        self.ligne([(x, y), (x + s, y + s)], (88, 60, 30), 4)
        self.ligne([(x + s, y), (x, y + s)], (88, 60, 30), 4)

    def arbre(self, x, y, r, graine):
        rng = np.random.default_rng(graine)
        # houppier : contour lobé sombre, touffes de feuillage, petits reflets en haut à gauche
        for k in range(12):
            a = k * 2 * math.pi / 12
            self.rond(x + math.cos(a) * r * 0.72, y + math.sin(a) * r * 0.72, r * 0.38, (30, 52, 24), ombre=(k % 2 == 0))
        self.rond(x, y, r * 0.8, (36, 62, 28), ombre=False)
        for _ in range(14):
            a, d = rng.uniform(0, 2 * math.pi), rng.uniform(0.05, 0.65) * r
            rr = r * rng.uniform(0.18, 0.34)
            g = int(rng.integers(66, 100))
            self.rond(x + math.cos(a) * d, y + math.sin(a) * d, rr, (g - 28, g, g - 42), ombre=False)
        for _ in range(6):
            a, d = rng.uniform(math.pi * 1.0, math.pi * 1.6), rng.uniform(0.2, 0.6) * r
            self.rond(x + math.cos(a) * d, y + math.sin(a) * d, r * rng.uniform(0.07, 0.13), (118, 148, 74), ombre=False)

    def rocher(self, x, y, r, graine):
        rng = np.random.default_rng(graine)
        pts = [(x + math.cos(a) * r * rng.uniform(0.7, 1.1), y + math.sin(a) * r * rng.uniform(0.7, 1.1))
               for a in np.linspace(0, 2 * math.pi, 9)[:-1]]
        g = int(rng.integers(108, 140))
        self.poly(pts, (g, g - 4, g - 10), (60, 58, 52))
        self.rond(x - r * 0.25, y - r * 0.25, r * 0.3, (g + 30, g + 26, g + 20), ombre=False)

    def murs(self, cases, graine):
        """Murs de pierre (épais, ombre portée) d'après un masque de cases."""
        rng = np.random.default_rng(graine)
        for (cx, cy) in cases:
            ton = int(rng.integers(-10, 10))
            self.rect(cx, cy, 1, 1, (64 + ton, 58 + ton, 52 + ton), (30, 26, 22), epaisseur=2)
            self.ligne([(cx + 0.05, cy + 0.08), (cx + 0.95, cy + 0.08)], (110, 102, 92), 3)

    def rendre(self, chemin, nuit=0.0):
        base = self.fond.copy().convert("RGB")
        ombre = self.ombre.filter(ImageFilter.GaussianBlur(9))
        noir = Image.new("RGB", base.size, (0, 0, 0))
        base = Image.composite(noir, base, ombre.point(lambda v: int(v * 0.55)))
        base.paste(self.obj, (0, 0), self.obj)
        # vignettage doux
        vg = Image.new("L", base.size, 0)
        ImageDraw.Draw(vg).ellipse([-self.w * 0.15, -self.h * 0.15, self.w * 1.15, self.h * 1.15], fill=255)
        vg = vg.filter(ImageFilter.GaussianBlur(self.w // 10))
        base = Image.composite(base, ImageChops.multiply(base, Image.new("RGB", base.size, (150, 140, 130))), vg)
        base = ImageChops.add(base, self.lum.filter(ImageFilter.GaussianBlur(6)))
        chemin.parent.mkdir(parents=True, exist_ok=True)
        base.save(chemin, "WEBP", quality=82, method=6)
        print(f"{chemin.name}: {base.size[0]}x{base.size[1]}, {chemin.stat().st_size // 1024} Ko")


def fond(arr):
    return vers_image(arr)


# ─────────────────────────── Scènes ───────────────────────────
def taverne():
    s = Scene(24, 16)
    w, h = s.w, s.h
    s.fond = fond(parquet(w, h, 11))
    bord = [(x, y) for x in range(24) for y in range(16) if x in (0, 23) or y in (0, 15)]
    bord = [c for c in bord if not (c[1] == 15 and c[0] in (11, 12))]          # porte
    s.murs(bord, 12)
    s.rect(11, 15.1, 2, 0.9, (90, 70, 50), (40, 30, 20), ombre=False)           # seuil
    # Comptoir en L + tabourets + étagères
    s.rect(2, 2.2, 8, 0.9, (96, 58, 28), (40, 22, 8), epaisseur=5)
    s.rect(9.1, 2.2, 0.9, 3.3, (96, 58, 28), (40, 22, 8), epaisseur=5)
    s.rect(2, 2.25, 8, 0.25, (150, 104, 58), ombre=False)
    for i in range(6):
        s.rond(2.8 + i * 1.15, 3.75, 0.24, (70, 44, 22), (30, 18, 8))
    for i in range(7):
        s.tonneau(1.6 + i * 1.05, 1.5, 0.36)
    # Foyer
    s.rect(21.2, 6, 1.8, 4, (88, 80, 72), (36, 30, 26), epaisseur=4)
    s.rect(21.5, 6.6, 1.2, 2.8, (40, 22, 12), (20, 10, 5), ombre=False)
    for k in range(3):                                                         # bûches
        s.ligne([(21.65, 7.3 + k * 0.6), (22.55, 7.1 + k * 0.6)], (70, 40, 20), 14)
    for (r_, col) in ((0.62, (190, 50, 20)), (0.46, (240, 110, 30)), (0.3, (255, 190, 70)), (0.14, (255, 240, 180))):
        s.do.ellipse([s.p(22.1 - r_ * 0.7), s.p(8 - r_ * 1.6), s.p(22.1 + r_ * 0.7), s.p(8 + r_ * 1.6)], fill=col)
    s.lumiere(21.9, 8, 6.5, (255, 140, 50), 0.95)
    # Tapis devant le foyer
    s.rect(15.5, 5.5, 5, 5, (120, 34, 30), (70, 18, 14), ombre=False, epaisseur=6)
    s.rect(16, 6, 4, 4, None, (200, 160, 70), ombre=False, epaisseur=3)
    # Tables
    for (x, y, r) in ((5, 7.5, 0.8), (8.5, 10.5, 0.8), (4.5, 12, 0.7), (13, 7, 0.8),
                      (13.5, 11.5, 0.9), (18, 8, 0.9), (18.5, 12.8, 0.7)):
        s.table_ronde(x, y, r)
    # Longue table
    s.rect(14, 2, 4.5, 1.1, (128, 86, 46), (52, 32, 14), epaisseur=5)
    for i in range(5):
        s.rect(14.2 + i * 0.9, 1.35, 0.5, 0.45, (92, 60, 32), (40, 24, 10), rayon=5)
        s.rect(14.2 + i * 0.9, 3.3, 0.5, 0.45, (92, 60, 32), (40, 24, 10), rayon=5)
    # Escalier vers l'étage
    s.rect(19.5, 1, 3.5, 3.6, (80, 54, 30), (30, 18, 8), epaisseur=4)
    for k in range(7):
        s.ligne([(19.5, 1.4 + k * 0.48), (23, 1.4 + k * 0.48)], (44, 28, 12), 4)
    # Réserve : caisses et tonneaux
    s.caisse(1.3, 13.4)
    s.caisse(2.2, 13.9, 0.7)
    s.tonneau(1.8, 12.4)
    # Lampes murales
    for (x, y) in ((1.3, 6), (1.3, 10), (8, 14.6), (16, 14.6)):
        s.rond(x, y, 0.14, (255, 210, 120), ombre=False)
        s.lumiere(x, y, 3.2, (255, 160, 70), 0.6)
    s.rendre(SORTIE / "taverne.webp")


def crypte():
    s = Scene(24, 16)
    w, h = s.w, s.h
    sol = dalles(w, h, 21, base=(104, 100, 94))
    roche = teinte((40, 36, 34), bruit(w, h, 60, 5, 22), 0.6)
    pieces = [(3, 3, 11, 9), (17, 2, 5, 5), (14, 4, 3, 2), (17, 9, 5, 5), (19, 7, 2, 2), (1, 7, 2, 2)]
    m = np.zeros((h, w), np.float32)
    for (x, y, l, hh) in pieces:
        m[y * C:(y + hh) * C, x * C:(x + l) * C] = 1
    m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3)), np.float32) / 255
    s.fond = fond(melange(roche, sol, m))
    ouvert = {(cx, cy) for (x, y, l, hh) in pieces for cx in range(x, x + l) for cy in range(y, y + hh)}
    bordure = {(cx + dx, cy + dy) for (cx, cy) in ouvert for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
    s.murs(sorted(c for c in bordure - ouvert if 0 <= c[0] < 24 and 0 <= c[1] < 16), 23)
    # Escalier d'entrée
    for k in range(4):
        s.ligne([(1 + k * 0.5, 7), (1 + k * 0.5, 9)], (40, 36, 32), 5)
    # Grande salle : piliers, autel, braseros
    for px in (5, 8, 11):
        for py in (5, 10):
            s.rond(px, py, 0.42, (120, 116, 108), (50, 46, 42), epaisseur=5)
            s.rond(px - 0.1, py - 0.12, 0.18, (150, 146, 138), ombre=False)
    s.rect(7.2, 7, 2.6, 1.1, (88, 84, 78), (40, 36, 32), epaisseur=5)          # autel
    s.rond(8.5, 7.55, 0.2, (150, 30, 30), ombre=False)
    for (bx, by) in ((4, 7.5), (13, 7.5)):
        s.rond(bx, by, 0.32, (60, 50, 40), (30, 24, 18))
        s.rond(bx, by, 0.18, (255, 150, 40), ombre=False)
        s.lumiere(bx, by, 4.5, (255, 120, 40), 0.85)
    # Chambre funéraire : sarcophages
    for (sx, sy) in ((17.6, 2.6), (19.8, 2.6), (17.6, 4.9), (19.8, 4.9)):
        s.rect(sx, sy, 1.6, 1.4, (126, 120, 110), (54, 50, 44), rayon=10, epaisseur=4)
        s.rect(sx + 0.2, sy + 0.2, 1.2, 1.0, None, (90, 86, 78), ombre=False, rayon=8, epaisseur=3)
        s.ligne([(sx + 0.8, sy + 0.35), (sx + 0.8, sy + 1.05)], (80, 76, 70), 4)
    s.lumiere(19.5, 4.5, 3.2, (120, 170, 255), 0.45)                           # lueur spectrale
    # Salle du bas : éboulis, flaque, ossements
    for i, (rx, ry, rr) in enumerate(((18, 10.5, 0.45), (19, 10.2, 0.3), (18.6, 11.3, 0.35), (21, 13, 0.4))):
        s.rocher(rx, ry, rr, 30 + i)
    s.poly([(19.2, 12.2), (20.6, 12.0), (21.1, 12.9), (20.2, 13.6), (19.1, 13.2)], (40, 64, 76), ombre=False)
    for (ox, oy) in ((17.6, 13.3), (8.6, 11.3), (12.2, 4.2)):
        s.ligne([(ox, oy), (ox + 0.5, oy + 0.15)], (220, 210, 190), 5)
        s.rond(ox + 0.6, oy + 0.18, 0.12, (220, 210, 190), ombre=False)
    s.rendre(SORTIE / "crypte.webp")


def clairiere():
    s = Scene(26, 18)
    w, h = s.w, s.h
    base = herbe(w, h, 41)
    # Sentier sinueux
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    centre = h * 0.62 + np.sin(xx / w * math.pi * 2.2) * C * 1.6
    chemin = np.clip(1 - np.abs(yy - centre) / (C * 0.95), 0, 1) ** 0.7
    chemin *= bruit(w, h, 40, 3, 42) * 0.6 + 0.6
    base = melange(base, terre(w, h, 43), np.clip(chemin, 0, 1))
    # Ruisseau
    cx_r = w * 0.2 + np.sin(yy / h * math.pi * 1.6) * C * 1.2
    riv = np.clip(1 - np.abs(xx - cx_r) / (C * 0.7), 0, 1)
    rive = np.clip(1 - np.abs(xx - cx_r) / (C * 1.0), 0, 1)
    base = melange(base, terre(w, h, 44) * 0.8, rive * 0.8)
    base = melange(base, eau(w, h, 45), (riv > 0.25).astype(np.float32) * np.clip(riv * 2, 0, 1))
    s.fond = fond(base)
    # Pierres de gué
    for i, (gx, gy) in enumerate(((5.0, 10.6), (5.6, 11.2), (6.1, 11.9))):
        s.rocher(gx, gy, 0.28, 50 + i)
    # Cercle de pierres levées
    for k in range(7):
        a = k * 2 * math.pi / 7
        s.rocher(16 + math.cos(a) * 2.6, 6 + math.sin(a) * 2.2, 0.42, 60 + k)
    s.rond(16, 6, 0.55, (120, 116, 108), (60, 56, 50), epaisseur=4)             # pierre d'autel
    s.lumiere(16, 6, 3, (150, 220, 255), 0.35)
    # Champignons en cercle féerique
    for k in range(10):
        a = k * 2 * math.pi / 10
        s.rond(20.5 + math.cos(a) * 1.1, 13.5 + math.sin(a) * 1.1, 0.11, (200, 60, 50), ombre=False)
    # Arbres (lisière)
    rng = np.random.default_rng(46)
    places = [(1.5, 1.5), (3.5, 1), (8, 1.2), (11, 0.8), (22, 1.2), (24.5, 2.5), (24.7, 6), (24.5, 9.5),
              (24.2, 15.5), (21, 16.8), (12, 17), (8.5, 16.8), (2, 16), (1, 4.5), (10, 3.2), (23, 4),
              (14.5, 15.5), (3, 14)]
    for i, (ax, ay) in enumerate(places):
        s.arbre(ax + rng.uniform(-0.3, 0.3), ay + rng.uniform(-0.3, 0.3), rng.uniform(1.0, 1.6), 70 + i)
    for i, (rx, ry) in enumerate(((9, 7), (12.5, 13), (22, 10))):
        s.rocher(rx, ry, 0.5, 90 + i)
    s.rendre(SORTIE / "clairiere.webp")


def camp():
    s = Scene(24, 16)
    w, h = s.w, s.h
    base = herbe(w, h, 61)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    route = np.clip(1 - np.abs(yy - (h * 0.42 + np.sin(xx / w * math.pi) * C * 0.6)) / (C * 1.6), 0, 1) ** 0.5
    route *= bruit(w, h, 30, 3, 62) * 0.5 + 0.7
    base = melange(base, terre(w, h, 63), np.clip(route, 0, 1))
    s.fond = fond(base)
    # Ornières
    for dy in (-0.55, 0.55):
        pts = [(x / 4, 6.7 + dy + math.sin(x / 4 / 24 * math.pi) * 0.6) for x in range(0, 97)]
        s.ligne(pts, (90, 64, 40), 6)
    # Feu de camp
    for k in range(8):
        a = k * 2 * math.pi / 8
        s.rocher(12 + math.cos(a) * 0.62, 11.5 + math.sin(a) * 0.62, 0.17, 100 + k)
    s.rond(12, 11.5, 0.42, (60, 30, 16), ombre=False)
    for k in range(6):
        s.rond(12 + math.cos(k) * 0.18, 11.5 + math.sin(k) * 0.18, 0.13, (255, 160 - k * 15, 40), ombre=False)
    s.lumiere(12, 11.5, 6, (255, 140, 50), 0.9)
    for (lx, ly, a) in ((13.6, 11.2, 0.3), (10.5, 12.3, -0.4), (12.4, 13.2, 1.4)):          # bûches-bancs
        s.ligne([(lx - math.cos(a) * 0.7, ly - math.sin(a) * 0.7), (lx + math.cos(a) * 0.7, ly + math.sin(a) * 0.7)], (100, 66, 36), 22)
    # Tentes
    for (tx, ty, col) in ((8, 12, (150, 132, 96)), (15.5, 12.5, (120, 60, 50)), (11.3, 14.2, (100, 110, 80))):
        s.poly([(tx - 1, ty - 0.8), (tx + 1, ty - 0.8), (tx + 1.2, ty + 0.8), (tx - 1.2, ty + 0.8)], col, (50, 40, 30))
        s.ligne([(tx, ty - 0.8), (tx, ty + 0.8)], (60, 48, 34), 5)
    # Chariot bâché près de la route
    s.rect(15, 3.6, 3.6, 1.6, (180, 168, 140), (80, 70, 50), rayon=24, epaisseur=4)
    for k in range(4):
        s.ligne([(15.4 + k * 0.9, 3.6), (15.4 + k * 0.9, 5.2)], (140, 128, 104), 3)
    for (wx, wy) in ((15.4, 3.4), (18.2, 3.4), (15.4, 5.4), (18.2, 5.4)):
        s.rect(wx - 0.3, wy - 0.1, 0.6, 0.2, (60, 40, 20), ombre=False)
    s.ligne([(14.9, 4.4), (13.4, 4.4)], (90, 60, 30), 6)
    # Marchandises
    s.caisse(19.5, 9.5)
    s.caisse(20.4, 10, 0.7)
    s.tonneau(19.8, 11.3)
    s.tonneau(20.6, 11.6, 0.32)
    # Clôture et arbres
    for k in range(9):
        s.rond(2 + k * 0.9, 9.4, 0.12, (90, 60, 30))
    s.ligne([(2, 9.4), (9.2, 9.4)], (110, 76, 40), 5)
    rng = np.random.default_rng(64)
    for i, (ax, ay) in enumerate(((1.5, 1.5), (4, 1.2), (21.5, 1.4), (23, 13.5), (1.4, 14.5), (5, 15.2), (22.5, 15.4))):
        s.arbre(ax, ay, rng.uniform(1.0, 1.5), 110 + i)
    for i, (rx, ry) in enumerate(((7, 2.5), (22, 8.5), (3, 11.5))):
        s.rocher(rx, ry, 0.45, 120 + i)
    s.rendre(SORTIE / "camp.webp")


if __name__ == "__main__":
    taverne()
    crypte()
    clairiere()
    camp()
