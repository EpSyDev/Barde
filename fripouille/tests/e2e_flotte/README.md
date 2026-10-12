# Banc de bout en bout — Guerre des Flottes Royales

Fait tourner **la vraie API de La Fripouille** (`webapi` + `modules/flotte.py`, Discord simulé
par `api_banc.py`) et **le vrai dashboard** (`next build` + `next start`), puis pilote Chromium
avec Playwright. Rien ne touche au vrai Discord ni à la VM ; l'état vit dans un dossier temporaire.

## Lancer

```bash
cd dashboard && npm ci && cd ..                       # une fois
PYTHON=/chemin/vers/python-du-bot fripouille/tests/e2e_flotte/lancer.sh
```

- `PYTHON` : un Python avec les dépendances du bot (`pip install -r requirements.txt`).
- Playwright : `npm i -g playwright` (ou `PW=/chemin/vers/playwright`) et son Chromium
  (`npx playwright install chromium`, ou `CHROMIUM=/chemin/vers/chrome`).
- Ports utilisés : 8091 (API du banc) et 3077 (dashboard).
- `--sans-build` réutilise le dernier build ; on peut nommer les scénarios à jouer.
- Captures et journaux : `fripouille/tests/e2e_flotte/captures/` (ignoré par git).

## Scénarios

| Fichier | Ce qui est vérifié |
|---|---|
| `non_regression.mjs` | pages existantes du panneau (admin) sans erreur JS ; un convive reste cantonné à `/ombres` + `/flotte` ; non-membre → 403 ; sans session → 401 |
| `deux_navigateurs.mjs` | deux comptes (ordinateur + téléphone 390 px) : salon par code, prêt, lancement, ordre au clavier validé par le serveur, verrous, résolution reçue des deux côtés, rechargement en pleine partie, abandon confirmé |
| `fin_de_partie.mjs` | entraînement contre deux bots jusqu'à l'écran de fin, bascule carte/classement, revanche |
| `meteo.mjs` | vitrine visuelle : `BANC_METEO=tempete lancer.sh --sans-build meteo` (captures en pleine résolution) |
| `performance.mjs` | images par seconde, 8 flottes, haute puis basse qualité |

Comptes simulés : identifiants `10000000000000000N` (N = 0…8, membres du serveur ; 7 = admin
via `ALLOWED_DISCORD_IDS`) ; `…09` n'est pas membre. Les cookies de session sont forgés avec le
secret du banc (jamais un secret réel).
