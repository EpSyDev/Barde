"""Rendu image d'un jet de dés (Pillow) : une silhouette par dé, la valeur au centre.

- Chaque dé a sa forme : d4 triangle, d6 carré arrondi, d8 losange, d10/d100 cerf-volant,
  d12 pentagone, d20 hexagone à facettes (vue de face d'un icosaèdre).
- 20 naturel : dé doré + halo ; 1 naturel : dé rouge + halo ; dé écarté (kh/kl) : grisé.
- Police Cinzel (OFL, ``assets/Cinzel.ttf``), la même que le dashboard.

``rendre(des, etat)`` renvoie des octets PNG, ou ``None`` si Pillow manque (le bot
affiche alors le résultat sans image). Appelé hors de la boucle asyncio (to_thread).
"""
import io
import math
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError:  # pragma: no cover — le jet reste lisible sans image
    Image = None

POLICE = Path(__file__).parent / "assets" / "Cinzel.ttf"
S = 2                 # suréchantillonnage (anticrénelage), réduit à la fin
TAILLE = 150          # côté d'un dé à l'écran (px)
MAX_AFFICHES = 8      # au-delà : « +N » (un jet de 20d6 reste lisible)

OR = (201, 164, 74)
OR_CLAIR = (240, 212, 137)
ROUGE = (194, 83, 64)
ECARTE = (110, 104, 92)
ENCRE = (40, 25, 9)
ARETE = (60, 38, 14)
FACETTE = (95, 64, 24)


def _police(px: int):
    try:
        f = ImageFont.truetype(str(POLICE), px)
        f.set_variation_by_name(b"Black")
        return f
    except Exception:  # noqa: BLE001 — police absente : celle de Pillow
        return ImageFont.load_default(px)


def _pt(cx, cy, r, deg):
    return (cx + r * math.cos(math.radians(deg)), cy + r * math.sin(math.radians(deg)))


def _poly(cx, cy, r, n, rot=-90.0):
    return [_pt(cx, cy, r, rot + i * 360 / n) for i in range(n)]


def _silhouette(faces, cx, cy, r):
    """(contour, facettes[segments], centre du texte)."""
    if faces == 4:
        pts = _poly(cx, cy + r * 0.18, r * 1.12, 3)
        return pts, [], (cx, cy + r * 0.28)
    if faces == 6:
        return None, [], (cx, cy)          # carré arrondi, dessiné à part
    if faces == 8:
        pts = _poly(cx, cy, r * 1.12, 4)
        return pts, [], (cx, cy)
    if faces in (10, 100):
        haut, droite, bas, gauche = (cx, cy - r * 1.1), (cx + r, cy - r * 0.05), (cx, cy + r * 0.98), (cx - r, cy - r * 0.05)
        pivot = (cx, cy + r * 0.42)
        return [haut, droite, bas, gauche], [(gauche, pivot), (pivot, droite), (pivot, bas)], (cx, cy - r * 0.12)
    if faces == 12:
        ext = _poly(cx, cy, r * 1.08, 5)
        inn = _poly(cx, cy, r * 0.62, 5)
        return ext, [(a, b) for a, b in zip(inn, ext)] + list(zip(inn, inn[1:] + inn[:1])), (cx, cy + r * 0.03)
    # d20 : hexagone, triangle central, 9 arêtes vers le bord
    p = _poly(cx, cy, r * 1.1, 6)                       # p0 haut, puis sens horaire
    t = [_pt(cx, cy + r * 0.1, r * 0.66, a) for a in (-90, 30, 150)]
    seg = list(zip(t, t[1:] + t[:1]))
    seg += [(t[0], p[5]), (t[0], p[0]), (t[0], p[1]),
            (t[1], p[1]), (t[1], p[2]), (t[1], p[3]),
            (t[2], p[3]), (t[2], p[4]), (t[2], p[5])]
    return p, seg, (cx, cy + r * 0.24)


def _de(faces, valeur, etat):
    W = H = TAILLE * S
    cx, cy, r = W / 2, H * 0.46, W * 0.34
    fond = {"crit": OR_CLAIR, "fumble": ROUGE, "ecarte": ECARTE}.get(etat, OR)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    contour, facettes, (tx, ty) = _silhouette(faces, cx, cy, r)

    def tracer(d, decal=(0, 0), **kw):
        if contour is None:
            x0, y0 = cx - r * 0.98 + decal[0], cy - r * 0.98 + decal[1]
            d.rounded_rectangle((x0, y0, x0 + r * 1.96, y0 + r * 1.96), radius=r * 0.28, **kw)
        else:
            d.polygon([(x + decal[0], y + decal[1]) for x, y in contour], **kw)

    halo = {"crit": (255, 214, 110, 190), "fumble": (225, 40, 30, 170)}.get(etat)
    if halo:
        h = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        tracer(ImageDraw.Draw(h), fill=halo)
        h = h.resize((W, H)).filter(ImageFilter.GaussianBlur(14 * S))
        img = Image.alpha_composite(img, h)
        img = Image.alpha_composite(img, h)
    d = ImageDraw.Draw(img)
    tracer(d, (5 * S, 7 * S), fill=(0, 0, 0, 105))                        # ombre
    tracer(d, fill=fond + (255,), outline=ARETE + (255,), width=4 * S)
    for a, b in facettes:
        d.line([a, b], fill=FACETTE + (170,), width=2 * S)
    if faces == 20:
        # face avant (triangle central) éclaircie : le chiffre s'y lit sans arête dessous
        t = [_pt(cx, cy + r * 0.1, r * 0.66, a) for a in (-90, 30, 150)]
        clair = tuple(min(255, c + 28) for c in fond)
        d.polygon(t, fill=clair + (255,), outline=FACETTE + (200,), width=2 * S)

    txt = str(valeur)
    echelle = 0.8 if len(txt) == 1 else 0.68 if len(txt) == 2 else 0.5
    if faces == 20:
        echelle *= 0.72      # tient dans la face triangulaire
    f = _police(int(r * echelle))
    bb = d.textbbox((0, 0), txt, font=f, anchor="mm")
    clair = etat == "fumble"
    d.text((tx + 2 * S, ty + 3 * S), txt, font=f, anchor="mm", fill=(0, 0, 0, 110 if not clair else 160))
    d.text((tx, ty), txt, font=f, anchor="mm",
           fill=(255, 244, 228, 255) if clair else ENCRE + (255,) if etat != "ecarte" else (60, 56, 50, 255))
    if etat == "ecarte":   # trait de rature
        d.line([(tx - (bb[2] - bb[0]) * 0.7, ty), (tx + (bb[2] - bb[0]) * 0.7, ty)], fill=(40, 30, 20, 220), width=4 * S)

    lab = _police(int(15 * S))
    d.text((cx, H - 14 * S), f"d{faces}", font=lab, anchor="mm", fill=(236, 224, 194, 235))
    out = img.resize((TAILLE, TAILLE), Image.LANCZOS)
    if etat == "ecarte":
        out.putalpha(out.getchannel("A").point(lambda a: int(a * 0.6)))
    return out


def rendre(des: list[dict], nat: int | None = None) -> bytes | None:
    """``des`` = [{faces, v, garde}] dans l'ordre du jet ; ``nat`` = 20 / 1 si critique."""
    if Image is None or not des:
        return None
    affiches = des[:MAX_AFFICHES]
    reste = len(des) - len(affiches)
    n = len(affiches) + (1 if reste else 0)
    W, H = n * TAILLE + 16, TAILLE + 12
    planche = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for i, de in enumerate(affiches):
        if not de["garde"]:
            etat = "ecarte"
        elif de["faces"] == 20 and nat == 20 and de["v"] == 20:
            etat = "crit"
        elif de["faces"] == 20 and nat == 1 and de["v"] == 1:
            etat = "fumble"
        else:
            etat = "normal"
        planche.alpha_composite(_de(de["faces"], de["v"], etat), (8 + i * TAILLE, 6))
    if reste:
        d = ImageDraw.Draw(planche)
        d.text((8 + len(affiches) * TAILLE + TAILLE / 2, H / 2), f"+{reste}", font=_police(46),
               anchor="mm", fill=(236, 224, 194, 255))
    buf = io.BytesIO()
    planche.save(buf, "PNG", optimize=True)
    return buf.getvalue()
