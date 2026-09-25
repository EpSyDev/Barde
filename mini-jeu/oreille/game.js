// L'Oreille de Myrhaven — moteur. Tick d'une seconde, suspendu quand l'onglet est caché (économie CPU).
'use strict';

const CLE_SAUVEGARDE = 'oreille-myrhaven-v1';
const H = 3600 * 1000;
const PLACES = [
  { x: 12, y: 71 }, { x: 40, y: 85 }, { x: 80, y: 75 },
  { x: 26, y: 71 }, { x: 56, y: 87 }, { x: 93, y: 79 },
];
const PEAU = { marchand: '#d9a878', nain: '#c98f67', elfe_bois: '#e6c29a', chasseur: '#c8966a', elfe_cimes: '#efd9bd', marin: '#b98560', passeur: '#a89478',
  vampire: '#dcd6d0', orc: '#7d8a5a', fee: '#f2d2c4', gnome: '#e0b08a', loup: '#8a7461', demon: '#a4524a' };

// ——— Utilitaires ———
const $ = (s, r = document) => r.querySelector(s);
const alea = (a, b) => a + Math.random() * (b - a);
const entier = (a, b) => Math.floor(alea(a, b + 1));
const choix = (t) => t[Math.floor(Math.random() * t.length)];
const maj = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nb = (n) => Math.floor(n).toLocaleString('fr-FR');
function duree(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  if (h === 0) return m + ' min ' + String(s % 60).padStart(2, '0');
  return h + ' h ' + String(m % 60).padStart(2, '0');
}
function jourCle(d = new Date()) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function hier() { const d = new Date(); d.setDate(d.getDate() - 1); return jourCle(d); }
function graine(str) { let h = 1779033703; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }
function dansFenetre(h, f) { return f[0] <= f[1] ? h >= f[0] && h < f[1] : h >= f[0] || h < f[1]; }

// ——— État ———
function etatNeuf() {
  const now = Date.now();
  return {
    v: 1, ecus: 40, xp: 0, niv: 1,
    stock: { blonde: 6 }, ingr: { orge: 6, houblon: 3 },
    tonneaux: [{ b: 'blonde', fin: now + 60 * 1000 }, null],
    travaux: { tables: 0, tonneaux: 0 },
    musique: {}, rumeurs: {}, reveles: {}, carnet: {},
    stats: { servis: 0, devines: 0, perdus: 0, gains: 0, tires: 0, rumeurs: 0, vieil: 0, parisGagnes: 0 },
    jour: null, serie: { n: 0, dernier: null }, fripouille: { jour: null, parties: 0 },
    marche: { creneau: -1, stock: {}, vu: true },
    tuto: { debut: false, indice: false, cave: false, rumeur: false },
    enSerie: 0, vieil: null, son: false, vu: now, cree: now,
  };
}
let S = charger();
let clients = [];
let choisi = null;
let onglet = 'salle';
let prochainClient = Date.now() + 2500;
let minuteur = null;
let idClient = 1;
let derniereReplique = 0;
let caveChoix = null;

function charger() {
  try {
    const brut = localStorage.getItem(CLE_SAUVEGARDE);
    if (brut) return Object.assign(etatNeuf(), JSON.parse(brut));
  } catch (e) { /* stockage indisponible : partie éphémère */ }
  return null;
}
function sauver() {
  S.vu = Date.now();
  try { localStorage.setItem(CLE_SAUVEGARDE, JSON.stringify(S)); } catch (e) { /* rien */ }
}

// ——— Dérivés ———
const nbTables = () => TRAVAUX.tables.base + (S.travaux.tables || 0);
const nbTonneaux = () => TRAVAUX.tonneaux.base + (S.travaux.tonneaux || 0);
const a = (k) => (S.travaux[k] || 0) > 0;
const musique = (k) => (S.musique[k] || 0) > Date.now();
const rendement = () => 8 + (a('chene') ? 4 : 0);
const capAbsence = () => (a('chambres') ? 14 : 8) * H;
const seuil = (n) => Math.round(60 * Math.pow(n - 1, 2.4));
const titre = () => TITRES[Math.min(S.niv, TITRES.length) - 1];
const boissonDispo = (id) => S.niv >= BOISSONS[id].niv;
const nbRumeurs = () => Object.keys(S.rumeurs).length;
const rumeursDe = (c) => [0, 1, 2].filter((i) => S.rumeurs[c + ':' + i]).length;
const nbReveles = () => Object.keys(S.reveles).length;
const bonusSerie = () => (S.serie.dernier === jourCle() || S.serie.dernier === hier()) ? SERIE_BONUS[Math.min(S.serie.n, 7)] : 0;

function atteignables() {
  const set = new Set(DEPART);
  for (const c of Object.keys(S.reveles)) for (const v of CONTREES[c].voisins) set.add(v);
  return [...set].filter((c) => S.niv >= CONTREES[c].niv);
}
function sourcesSanctuaire(s) { return Object.keys(CONTREES).filter((c) => CONTREES[c].voisins.includes(s)); }

// ——— Voyageurs ———
function peuplesPresents() {
  const h = new Date().getHours();
  const ok = new Set(atteignables());
  const liste = [];
  for (const [id, p] of Object.entries(PEUPLES)) {
    if (!ok.has(p.contree) || CONTREES[p.contree].sanctuaire) continue;
    if (p.heures && !dansFenetre(h, p.heures)) continue;
    const poids = p.pic && dansFenetre(h, p.pic) ? 3 : 1;
    liste.push([id, poids]);
  }
  return liste;
}
function tirerPeuple() {
  const l = peuplesPresents();
  if (!l.length) return 'marchand';
  let t = l.reduce((s, x) => s + x[1], 0) * Math.random();
  for (const [id, w] of l) { t -= w; if (t <= 0) return id; }
  return l[0][0];
}
function placesDispo() {
  const prises = new Set(clients.map((c) => c.place));
  return [...Array(nbTables()).keys()].filter((i) => !prises.has(i));
}
function nouveauClient() {
  const libres = placesDispo();
  if (!libres.length) return;
  const place = choix(libres);
  const now = Date.now();
  const patience = 75 * (a('atre') ? 1.25 : 1) * (musique('menestrel') ? 1.4 : 1) * alea(0.85, 1.15);
  // Le vieil homme : une fois par jour au plus, quand une bonne part de la carte est levée.
  const nuit = dansFenetre(new Date().getHours(), [0, 6]);
  if (nbReveles() >= 8 && S.vieil !== jourCle() && Math.random() < (nuit ? 0.04 : 0.007)) {
    clients.push({ id: idClient++, p: 'vieil', capuche: false, nom: 'Un vieil homme', veut: 'eau', indice: false, texte: 'De l\'eau chaude. Juste chaude.', place, fin: now + patience * 1.6 * 1000, max: patience * 1.6, ne: now });
    rendreCalque();
    return;
  }
  const pid = tirerPeuple();
  const p = PEUPLES[pid];
  const capuche = !S.reveles[p.contree];
  let gouts = p.gouts.filter(boissonDispo);
  if (!gouts.length) gouts = ['blonde'];
  const veut = choix(gouts);
  const indice = S.niv >= 2 && S.stats.servis >= 3 && Math.random() < (capuche ? 0.45 : 0.3);
  const modele = choix(capuche ? CAPUCHE.dit : p.dit);
  const texte = indice ? choix(INDICES[veut]) : modele.replace('{D}', maj(BOISSONS[veut].art)).replace('{d}', BOISSONS[veut].art);
  const nom = capuche ? 'Voyageur encapuchonné' : choix(p.syl[0]) + choix(p.syl[1]);
  clients.push({ id: idClient++, p: pid, capuche, nom, veut, indice, texte, place, fin: now + patience * 1000, max: patience, ne: now });
  if (indice && !S.tuto.indice) { S.tuto.indice = true; dire(TAVERNIER.tuto[1], true); }
  if (!S.tuto.debut) dire(TAVERNIER.tuto[0], true);
  rendreCalque();
  son('porte');
}
function intervalleClients() {
  return 13000 * alea(0.7, 1.3) / ((a('enseigne') ? 1.2 : 1) * (musique('troubadour') ? 1.4 : 1));
}

function servir(cid, boisson) {
  const c = clients.find((x) => x.id === cid);
  if (!c) return;
  const now = Date.now();
  if (c.p === 'vieil') return servirVieil(c);
  if (!(S.stock[boisson] > 0)) return;
  S.stock[boisson]--;
  const B = BOISSONS[boisson];
  const juste = boisson === c.veut;
  const base = B.prix * (a('comptoir') ? 1.1 : 1);
  let gain, xp;
  const car = S.carnet[c.p] || (S.carnet[c.p] = { servis: 0, connus: [] });
  car.servis++;
  const J = S.jour;
  J.p.servis++;
  if (!J.peuples.includes(c.p)) { J.peuples.push(c.p); J.p.peuplesJour = J.peuples.length; }
  if (juste) {
    let pourboire = base * alea(0.15, 0.4);
    if (c.indice) pourboire += base;
    if (musique('barde')) pourboire *= 1.3;
    pourboire *= 1 + bonusSerie();
    gain = Math.round(base + pourboire);
    xp = Math.round(B.prix * (c.indice ? 1.5 : 1));
    if (!car.connus.includes(boisson)) car.connus.push(boisson);
    if (c.indice) { S.stats.devines++; J.p.devines++; dire(choix(TAVERNIER.devine)); }
    S.enSerie++;
  } else {
    gain = Math.round(base * 0.5);
    xp = Math.round(B.prix / 2);
    S.enSerie++;
    if (Math.random() < 0.5) dire(choix(TAVERNIER.faux));
  }
  J.p.serie = Math.max(J.p.serie, S.enSerie);
  S.ecus += gain; S.stats.gains += gain; J.p.gains += gain;
  S.stats.servis++;
  gagnerXp(xp);
  const reaction = c.capuche ? (juste ? CAPUCHE.bon : CAPUCHE.faux) : (juste ? PEUPLES[c.p].bon : PEUPLES[c.p].faux);
  flotter(c, '+' + gain + ' écus');
  son('piece');
  toast(esc(c.nom) + ' : « ' + esc(reaction) + ' »');
  if (juste) tenterRumeur(c);
  partir(c);
  if (!S.tuto.debut) { S.tuto.debut = true; setTimeout(() => dire(TAVERNIER.tuto[2], true), 3500); }
  verifierTaches();
  sauver();
  majHud();
}

function servirVieil(c) {
  const gain = 250 + 50 * S.niv;
  S.ecus += gain; S.stats.gains += gain; S.stats.vieil++; S.vieil = jourCle();
  flotter(c, '+' + gain + ' écus');
  son('rumeur');
  const manque = [0, 1, 2].find((i) => !S.rumeurs['drag-or:' + i]);
  partir(c);
  modale('<h2>Une pièce trop lourde</h2><div class="parchemin">Il a bu son eau chaude à petites gorgées, les yeux fermés, comme on écoute une chanson. Puis il a posé sur le comptoir une pièce d\'or. Elle est trop lourde pour sa taille. Quand tu relèves la tête, la chaise est vide et la porte n\'a pas grincé.</div><p class="sous">+' + gain + ' écus</p><button class="btn" data-fermer>Garder la pièce</button>');
  dire(TAVERNIER.vieil, true);
  if (manque !== undefined) setTimeout(() => donnerRumeur('drag-or', manque, 'Un vieil homme'), 600);
  sauver(); majHud();
}

function partir(c, fache) {
  clients = clients.filter((x) => x !== c);
  if (choisi === c.id) choisi = null;
  const el = document.querySelector('[data-cid="' + c.id + '"]');
  if (el) { el.classList.add('part'); setTimeout(() => el.remove(), 600); }
  if (fache) {
    S.stats.perdus++; S.enSerie = 0;
    dire(choix(TAVERNIER.parti));
  }
  setTimeout(rendreCalque, 620);
  if (onglet === 'salle') rendrePanneau();
}

// ——— Rumeurs et brume ———
function tenterRumeur(c) {
  let chance = 0.11;
  if (c.indice) chance *= 2;
  if (musique('conteur')) chance *= 2;
  if (Math.random() > Math.min(chance, 0.65)) return;
  const cible = choisirRumeur(c);
  if (cible) donnerRumeur(cible[0], cible[1], c.nom);
}
function choisirRumeur(c) {
  const peuple = PEUPLES[c.p];
  const prochaine = (ct) => {
    const i = [0, 1, 2].find((k) => !S.rumeurs[ct + ':' + k]);
    if (i === undefined) return null;
    if (i === 2 && !c.indice) return null; // la 3ᵉ rumeur se mérite : il faut avoir lu la commande
    return [ct, i];
  };
  if (!S.reveles[peuple.contree]) return prochaine(peuple.contree);
  const ok = new Set(atteignables());
  const voisins = CONTREES[peuple.contree].voisins.filter((v) => !S.reveles[v] && ok.has(v));
  const candidats = voisins.map(prochaine).filter(Boolean);
  return candidats.length ? choix(candidats) : null;
}
function donnerRumeur(ct, i, source) {
  const cle = ct + ':' + i;
  if (S.rumeurs[cle]) return;
  S.rumeurs[cle] = { de: source, le: Date.now() };
  S.stats.rumeurs++;
  S.jour.p.rumeurs++;
  son('rumeur');
  const C = CONTREES[ct];
  modale('<h2>Une rumeur</h2><p class="sous">' + esc(source) + ' se penche vers toi et baisse la voix…</p><div class="parchemin">« ' + esc(RUMEURS[ct][i]) + ' »</div><p class="sous">' + esc(C.nom) + ' — ' + rumeursDe(ct) + ' rumeur' + (rumeursDe(ct) > 1 ? 's' : '') + ' sur 3</p><button class="btn" data-fermer>Retenir</button>');
  if (!S.tuto.rumeur) { S.tuto.rumeur = true; dire(TAVERNIER.tuto[3], true); } else dire(choix(TAVERNIER.rumeur));
  if (rumeursDe(ct) >= 3 && !S.reveles[ct]) {
    S.reveles[ct] = Date.now();
    setTimeout(() => leverBrume(ct), 400);
  }
  verifierTaches();
  sauver(); majHud();
}
function leverBrume(ct) {
  const C = CONTREES[ct];
  const peuples = Object.values(PEUPLES).filter((p) => p.contree === ct).map((p) => p.pluriel);
  const nouveaux = C.voisins.filter((v) => !S.reveles[v] && S.niv >= CONTREES[v].niv).map((v) => CONTREES[v].nom);
  const lointains = C.voisins.some((v) => !S.reveles[v] && S.niv < CONTREES[v].niv);
  gagnerXp(40 + 20 * nbReveles());
  toast('La brume se lève sur <b>' + esc(C.nom) + '</b>');
  dire(TAVERNIER.brume.replace('{c}', C.nom), true);
  const lignes = [];
  if (peuples.length) lignes.push('Les ' + esc(peuples.join(' et les ')) + ' entreront désormais à visage découvert.');
  if (C.sanctuaire) lignes.push('Personne n\'en vient. Mais on en parle, maintenant, et ça se sent dans la salle.');
  if (nouveaux.length) lignes.push('On commence à parler de ' + esc(nouveaux.join(', ')) + '.');
  if (lointains) lignes.push('Plus loin encore, des noms qu\'on ne prononce pas devant un simple ' + esc(titre().toLowerCase()) + '. Ça viendra avec la renommée.');
  if (nbReveles() === 16) lignes.push('Toute la carte est levée. Le tavernier la regarde longtemps, puis il dit : « Bon. Maintenant, le reste. » Tu ne sais pas de quel reste il parle.');
  modale('<h2>' + esc(C.nom) + '</h2><p class="sous">' + esc(C.sous) + '</p><div class="parchemin">La brume recule sur la carte, derrière le comptoir. ' + lignes.join(' ') + '</div><button class="btn" data-fermer data-aller="carte">Voir la carte</button>');
  sauver();
}

// ——— Renommée ———
function gagnerXp(n) {
  S.xp += n;
  let monte = false;
  while (S.xp >= seuil(S.niv + 1)) { S.niv++; monte = true; }
  if (monte) {
    const neuves = ORDRE_BOISSONS.filter((b) => BOISSONS[b].niv === S.niv).map((b) => BOISSONS[b].nom);
    const lieux = Object.values(CONTREES).filter((c) => c.niv === S.niv).map((c) => c.nom);
    let txt = 'Tu deviens <b>' + esc(titre()) + '</b>.';
    if (neuves.length) txt += ' Nouvelle recette : ' + esc(neuves.join(', ')) + '.';
    if (lieux.length) txt += ' On croisera peut-être des gens de ' + esc(lieux.join(', ')) + '.';
    toast(txt);
    dire(choix(TAVERNIER.niveau), true);
    son('rumeur');
    majMarche(true);
  }
}

// ——— Cave ———
function brasser(i, b) {
  const B = BOISSONS[b];
  for (const [k, q] of Object.entries(B.recette)) if ((S.ingr[k] || 0) < q) return;
  for (const [k, q] of Object.entries(B.recette)) S.ingr[k] -= q;
  S.tonneaux[i] = { b, fin: Date.now() + B.duree * 1000 };
  caveChoix = null;
  son('verse');
  sauver(); rendre();
}
function tirer(i) {
  const t = S.tonneaux[i];
  if (!t || t.fin > Date.now()) return;
  const n = rendement();
  S.stock[t.b] = (S.stock[t.b] || 0) + n;
  S.tonneaux[i] = null;
  S.stats.tires++; S.jour.p.tires++;
  toast('+' + n + ' chopes de ' + esc(BOISSONS[t.b].nom));
  son('verse');
  verifierTaches();
  sauver(); rendre();
}

// ——— Marché ———
function majMarche(force) {
  const creneau = Math.floor(Date.now() / (3 * H));
  if (creneau === S.marche.creneau && !force) return;
  const nouveau = creneau !== S.marche.creneau;
  const r = graine('marche' + creneau);
  const stock = {};
  for (const [k, I] of Object.entries(INGREDIENTS)) {
    if (I.base || S.niv < I.niv) continue;
    const garde = force && !nouveau && S.marche.stock[k] !== undefined;
    stock[k] = garde ? S.marche.stock[k] : I.lot[0] + Math.floor(r() * (I.lot[1] - I.lot[0] + 1));
  }
  S.marche.creneau = creneau;
  S.marche.stock = stock;
  if (nouveau && Object.keys(stock).length) S.marche.vu = false;
}
function acheter(k, q) {
  const I = INGREDIENTS[k];
  if (!I.base) q = Math.min(q, S.marche.stock[k] || 0);
  q = Math.min(q, Math.floor(S.ecus / I.prix));
  if (q <= 0) return;
  S.ecus -= q * I.prix;
  S.ingr[k] = (S.ingr[k] || 0) + q;
  if (!I.base) S.marche.stock[k] -= q;
  S.jour.p.achats += q;
  son('piece');
  verifierTaches();
  sauver(); rendre(); majHud();
}

// ——— Ardoise du jour ———
function majJour() {
  const j = jourCle();
  if (S.jour && S.jour.cle === j) return;
  const r = graine('ardoise' + j);
  const pool = TACHES.filter((t) => S.niv >= 2 || t.id !== 'deviner');
  const palier = S.niv < 4 ? 0 : S.niv < 7 ? 1 : 2;
  const taches = [];
  while (taches.length < 3) {
    const t = pool.splice(Math.floor(r() * pool.length), 1)[0];
    taches.push({ id: t.id, cle: t.cle, n: t.n[palier], txt: t.txt.replace('{n}', t.n[palier]), fait: false });
  }
  S.jour = { cle: j, taches, coffret: false, peuples: [], p: { servis: 0, devines: 0, tires: 0, gains: 0, rumeurs: 0, achats: 0, serie: 0, peuplesJour: 0 } };
  S.enSerie = 0;
}
function verifierTaches() {
  let neuf = false;
  for (const t of S.jour.taches) {
    if (!t.fait && (S.jour.p[t.cle] || 0) >= t.n) {
      t.fait = true; neuf = true;
      const prime = 30 + 25 * S.niv;
      S.ecus += prime;
      toast('Ardoise : « ' + esc(t.txt) + ' » — +' + prime + ' écus');
    }
  }
  if (neuf) { majBadges(); if (onglet === 'ardoise') rendrePanneau(); }
}
function ouvrirCoffret() {
  const J = S.jour;
  if (J.coffret || !J.taches.every((t) => t.fait)) return;
  J.coffret = true;
  S.serie.n = S.serie.dernier === hier() ? S.serie.n + 1 : (S.serie.dernier === jourCle() ? S.serie.n : 1);
  S.serie.dernier = jourCle();
  const dons = [];
  const rares = Object.keys(INGREDIENTS).filter((k) => !INGREDIENTS[k].base && S.niv >= INGREDIENTS[k].niv && k !== 'brume');
  for (let i = 0; i < 2; i++) {
    const k = rares.length ? choix(rares) : 'orge';
    const q = rares.length ? entier(3, 6) : 10;
    S.ingr[k] = (S.ingr[k] || 0) + q; dons.push(q + ' × ' + INGREDIENTS[k].nom);
  }
  if (S.serie.n % 7 === 0 || S.niv >= 8 && Math.random() < 0.3) { S.ingr.brume = (S.ingr.brume || 0) + 1; dons.push('1 × Fiole de brume'); }
  const ecus = 50 + 30 * S.niv; S.ecus += ecus; dons.push(ecus + ' écus');
  son('rumeur');
  modale('<h2>Le coffret du jour</h2><div class="parchemin">Le tavernier pousse un coffret sur le comptoir sans rien dire. C\'est sa façon de dire merci. Dedans : <b>' + esc(dons.join(', ')) + '</b>.</div><p class="sous">Série de jours : ' + S.serie.n + ' — pourboires +' + Math.round(bonusSerie() * 100) + ' % tant qu\'elle tient.</p><button class="btn" data-fermer>Merci, patron</button>');
  sauver(); rendre(); majHud();
}

// ——— La Fripouille ———
let partie = null;
function parier(mise) {
  majFripouille();
  if (S.fripouille.parties >= 3 || S.ecus < mise || partie) return;
  S.ecus -= mise; S.fripouille.parties++;
  const toi = [entier(1, 6), entier(1, 6)];
  const elle = [entier(1, 6), entier(1, 6)];
  const triche = Math.random() < 0.16;
  if (triche) elle[1] = 7;
  partie = { mise, toi, elle, triche, attrapee: false, fin: false };
  rendrePanneau();
  son('des');
  if (triche) {
    setTimeout(() => { if (partie && !partie.fin) conclurePari(); }, 1900);
  } else setTimeout(conclurePari, 700);
  sauver(); majHud();
}
function attraper() { if (partie && partie.triche && !partie.fin) { partie.attrapee = true; conclurePari(); } }
function conclurePari() {
  if (!partie || partie.fin) return;
  partie.fin = true;
  const t = partie.toi[0] + partie.toi[1], e = partie.elle[0] + partie.elle[1];
  let ligne;
  if (partie.attrapee) { S.ecus += partie.mise * 3; ligne = choix(FRIPOUILLE.attrape); partie.res = '+' + partie.mise * 2; S.stats.parisGagnes++; }
  else if (partie.triche) { ligne = FRIPOUILLE.triche; partie.res = '−' + partie.mise; }
  else if (t > e) { S.ecus += partie.mise * 2; ligne = choix(FRIPOUILLE.gagne); partie.res = '+' + partie.mise; S.stats.parisGagnes++; }
  else if (t === e) { ligne = FRIPOUILLE.egal; partie.res = '−' + partie.mise; }
  else { ligne = choix(FRIPOUILLE.perd); partie.res = '−' + partie.mise; }
  direFripouille(ligne);
  son(partie.res.startsWith('+') ? 'piece' : 'porte');
  const p = partie;
  setTimeout(() => { if (partie === p) { partie = null; if (onglet === 'ardoise') rendrePanneau(); } }, 3200);
  sauver(); majHud(); rendrePanneau();
}
function majFripouille() { if (S.fripouille.jour !== jourCle()) { S.fripouille = { jour: jourCle(), parties: 0 }; } }

// ——— Musiciens & travaux ———
function engager(k) {
  const M = MUSICIENS[k];
  if (!a('scene') || S.niv < M.niv || S.ecus < M.prix || musique(k)) return;
  S.ecus -= M.prix;
  S.musique[k] = Date.now() + DUREE_MUSIQUE * 1000;
  toast(esc(M.nom) + ' monte sur la scène.');
  son('rumeur');
  sauver(); rendre(); majHud();
}
function prixTravaux(k) {
  const T = TRAVAUX[k], n = S.travaux[k] || 0;
  if (n >= T.paliers.length) return null;
  return { prix: T.paliers[n], niv: T.niv[n] };
}
function construire(k) {
  const p = prixTravaux(k);
  if (!p || S.niv < p.niv || S.ecus < p.prix) return;
  S.ecus -= p.prix;
  S.travaux[k] = (S.travaux[k] || 0) + 1;
  if (k === 'tonneaux') S.tonneaux.push(null);
  toast('Travaux terminés : ' + esc(TRAVAUX[k].nom.toLowerCase()) + '.');
  son('piece');
  sauver(); rendre(); majHud();
}

// ——— Absence ———
function rattraper(depuis) {
  const ecart = Math.min(Date.now() - depuis, capAbsence());
  if (ecart < 60 * 1000) return null;
  const visites = Math.floor(ecart / 75000);
  let vendus = 0, gain = 0, xp = 0;
  const detail = {};
  for (let i = 0; i < visites; i++) {
    const dispo = ORDRE_BOISSONS.filter((b) => S.stock[b] > 0);
    if (!dispo.length) break;
    const b = choix(dispo);
    S.stock[b]--; vendus++;
    detail[b] = (detail[b] || 0) + 1;
    gain += BOISSONS[b].prix * 0.7; xp += BOISSONS[b].prix * 0.5;
  }
  gain = Math.round(gain);
  S.ecus += gain; S.stats.gains += gain;
  if (xp) gagnerXp(Math.round(xp));
  return { ecart, vendus, gain, detail, plafond: Date.now() - depuis > capAbsence(), manque: visites - vendus };
}
function rapportAbsence(r) {
  if (!r) return;
  const lignes = Object.entries(r.detail).map(([b, n]) => n + ' × ' + BOISSONS[b].nom).join(', ');
  const prets = S.tonneaux.filter((t) => t && t.fin <= Date.now()).length;
  let txt = '<p>Absent ' + duree(r.ecart) + (r.plafond ? ' (le tavernier ne tient pas plus longtemps que ça)' : '') + '.</p>';
  txt += r.vendus ? '<p>Il a servi <b>' + r.vendus + ' chopes</b> (' + esc(lignes) + ') pour <b>' + nb(r.gain) + ' écus</b>.</p>' : '<p>Il n\'avait rien à servir. La salle s\'est vidée.</p>';
  if (r.manque > 0) txt += '<p class="sous">Environ ' + r.manque + ' voyageurs sont repartis faute de chopes. Remplis la cave et le comptoir avant de partir.</p>';
  if (prets) txt += '<p class="sous">' + prets + ' tonneau(x) prêt(s) à tirer à la cave.</p>';
  txt += '<p class="sous">Aucune rumeur : lui sert, il n\'écoute pas. Ça, c\'est ton travail.</p>';
  modale('<h2>Pendant ton absence</h2><div class="ligne"><img src="assets/tavernier.webp" alt="" style="width:56px;border-radius:50%"><p><i>« ' + esc(choix(TAVERNIER.absence)) + ' »</i></p></div>' + txt + '<button class="btn" data-fermer>Reprendre le service</button>');
}

// ——— Boucle ———
function tick() {
  const now = Date.now();
  majJour(); majMarche(false);
  for (const c of clients.slice()) if (c.fin <= now) partir(c, true);
  if (now >= prochainClient) { nouveauClient(); prochainClient = now + intervalleClients(); }
  // barres de patience
  for (const c of clients) {
    const el = document.querySelector('[data-cid="' + c.id + '"] .patience i');
    if (!el) continue;
    const r = Math.max(0, (c.fin - now) / (c.max * 1000));
    el.style.width = (r * 100).toFixed(1) + '%';
    el.className = r < 0.25 ? 'court' : r < 0.5 ? 'moyen' : '';
  }
  for (const el of document.querySelectorAll('[data-fin]')) {
    const fin = +el.dataset.fin;
    el.textContent = fin <= now ? (el.dataset.pret || 'Prêt') : duree(fin - now);
    if (fin <= now && el.dataset.pret !== undefined && !el.dataset.fait) { el.dataset.fait = '1'; rendre(); }
  }
  const prets = S.tonneaux.filter((t) => t && t.fin <= now).length;
  if (prets && !tick.annonce) { tick.annonce = true; dire(TAVERNIER.pret); }
  if (!prets) tick.annonce = false;
  if (now - derniereReplique > 45000) {
    const h = new Date().getHours();
    dire(dansFenetre(h, [21, 5]) && Math.random() < 0.4 ? choix(TAVERNIER.nuit) : dansFenetre(h, [5, 10]) && Math.random() < 0.4 ? choix(TAVERNIER.matin) : choix(TAVERNIER.calme));
  }
  majHud(); majBadges();
  if (now - (tick.save || 0) > 10000) { tick.save = now; sauver(); }
}
function demarrer() {
  if (minuteur) return;
  minuteur = setInterval(tick, 1000);
}
function suspendre() { clearInterval(minuteur); minuteur = null; sauver(); }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { suspendre(); return; }
  const ecart = Date.now() - S.vu;
  if (ecart > 60 * 1000) { clients = []; choisi = null; rapportAbsence(rattraper(S.vu)); rendre(); }
  else for (const c of clients) c.fin += ecart;
  prochainClient = Math.min(prochainClient, Date.now() + 3000);
  demarrer();
});
window.addEventListener('pagehide', sauver);

// ——— Rendu : HUD, répliques, toasts ———
function majHud() {
  $('#h-ecus').textContent = nb(S.ecus);
  $('#h-titre').textContent = titre();
  $('#h-niv').textContent = 'niv. ' + S.niv;
  const bas = seuil(S.niv), haut = seuil(S.niv + 1);
  $('#h-xp').style.width = Math.min(100, (S.xp - bas) / (haut - bas) * 100) + '%';
  $('#h-rum').textContent = nbRumeurs();
  const d = new Date();
  $('#h-heure').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  $('#h-lune').className = dansFenetre(d.getHours(), [20, 6]) ? 'nuit' : '';
  $('#b-son').textContent = 'Son : ' + (S.son ? 'oui' : 'non');
  $('#b-son').setAttribute('aria-pressed', S.son);
}
function badge(id, n, urgent) {
  const el = $('#badge-' + id);
  el.hidden = !n; el.textContent = n; el.classList.toggle('urgent', !!urgent);
}
function majBadges() {
  const now = Date.now();
  const impatients = clients.filter((c) => (c.fin - now) / (c.max * 1000) < 0.3).length;
  badge('salle', onglet === 'salle' ? 0 : clients.length, impatients > 0);
  badge('cave', S.tonneaux.filter((t) => t && t.fin <= now).length);
  badge('marche', S.marche.vu ? 0 : '!');
  const J = S.jour;
  badge('ardoise', J && J.taches.every((t) => t.fait) && !J.coffret ? '!' : 0);
}
function dire(txt, fort) {
  if (!fort && Date.now() - derniereReplique < 8000) return;
  derniereReplique = Date.now();
  const b = $('#bandeau');
  b.classList.remove('fripouille');
  b.querySelector('img').src = 'assets/tavernier.webp';
  b.querySelector('b').textContent = 'Le tavernier';
  $('#replique').textContent = txt;
}
function direFripouille(txt) {
  derniereReplique = Date.now();
  const b = $('#bandeau');
  b.classList.add('fripouille');
  b.querySelector('img').src = 'assets/fripouille.webp';
  b.querySelector('b').textContent = 'La Fripouille';
  $('#replique').textContent = txt;
}
function toast(html) {
  const t = document.createElement('div');
  t.className = 'toast'; t.innerHTML = html;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 4000);
  while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
}
function flotter(c, txt, cls) {
  const el = document.querySelector('[data-cid="' + c.id + '"]');
  if (!el) return;
  const r = el.getBoundingClientRect();
  const f = document.createElement('div');
  f.className = 'gain ' + (cls || ''); f.textContent = txt;
  f.style.left = (r.left + r.width / 2 - 30) + 'px'; f.style.top = (r.top - 10) + 'px';
  $('#flottants').appendChild(f);
  setTimeout(() => f.remove(), 1200);
}
const fileModales = [];
function modale(html, large) {
  const m = $('#modale');
  if (!m.hidden) { fileModales.push([html, large]); return; }
  m.innerHTML = '<div role="dialog" aria-modal="true"' + (large ? ' class="large"' : '') + '>' + html + '</div>';
  m.hidden = false;
  const b = m.querySelector('button'); if (b) b.focus();
}

// ——— Sons (WebAudio minuscule, désactivé par défaut) ———
let ctx = null;
function son(type) {
  if (!S.son) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    const note = (f, d, v, w, at) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = w || 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(v, t + (at || 0)); g.gain.exponentialRampToValueAtTime(0.0001, t + (at || 0) + d); o.connect(g).connect(ctx.destination); o.start(t + (at || 0)); o.stop(t + (at || 0) + d); };
    if (type === 'piece') { note(1760, 0.12, 0.08); note(2349, 0.18, 0.06, 'triangle', 0.06); }
    else if (type === 'rumeur') { note(523, 0.5, 0.06, 'sine'); note(784, 0.7, 0.05, 'sine', 0.15); }
    else if (type === 'porte') { note(110, 0.25, 0.08, 'sawtooth'); }
    else if (type === 'des') { for (let i = 0; i < 5; i++) note(300 + Math.random() * 400, 0.05, 0.05, 'square', i * 0.07); }
    else if (type === 'verse') {
      const n = ctx.sampleRate * 0.5, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) * 0.3;
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; s.buffer = buf; s.connect(f).connect(ctx.destination); s.start();
    }
  } catch (e) { /* audio indisponible */ }
}

// ——— Silhouettes (SVG) ———
function silhouette(pid, capuche) {
  if (pid === 'vieil') {
    return '<svg viewBox="0 0 100 120" aria-hidden="true"><path d="M8 120 C10 84 28 72 50 72 C72 72 90 84 92 120Z" fill="#6d6a66"/><path d="M26 64 C22 30 36 16 50 16 C64 16 78 30 74 64 C68 80 32 80 26 64Z" fill="#8e8a84"/><ellipse cx="50" cy="56" rx="15" ry="18" fill="#d9c3a8"/><path d="M36 62 C40 86 60 86 64 62 C58 70 42 70 36 62Z" fill="#ece8e0"/><circle cx="44" cy="53" r="1.8" fill="#e7b64a"/><circle cx="56" cy="53" r="1.8" fill="#e7b64a"/></svg>';
  }
  const p = PEUPLES[pid];
  const cape = p.cape, peau = PEAU[pid] || '#d9a878', tr = capuche ? 'capuche_x' : p.trait;
  let arriere = '', devant = '', tete = '<ellipse cx="50" cy="52" rx="17" ry="20" fill="' + peau + '"/><circle cx="44" cy="50" r="2" fill="#241810"/><circle cx="56" cy="50" r="2" fill="#241810"/>';
  let corpsY = 72;
  switch (tr) {
    case 'chapeau': devant = '<ellipse cx="50" cy="35" rx="30" ry="6" fill="#3b2a1c"/><path d="M36 35 C36 20 64 20 64 35Z" fill="#3b2a1c"/><rect x="36" y="30" width="28" height="4" fill="#a3374a"/>'; break;
    case 'barbe': tete = '<ellipse cx="50" cy="56" rx="19" ry="17" fill="' + peau + '"/><circle cx="43" cy="52" r="2" fill="#241810"/><circle cx="57" cy="52" r="2" fill="#241810"/>'; devant = '<path d="M30 56 C30 96 70 96 70 56 C64 66 36 66 30 56Z" fill="#8a4f24"/><path d="M40 62 C44 66 56 66 60 62" stroke="#5a3214" stroke-width="3" fill="none"/><path d="M32 44 C34 30 66 30 68 44 C60 38 40 38 32 44Z" fill="#6b6b6b"/>'; corpsY = 76; break;
    case 'oreilles': arriere = '<path d="M34 50 L14 34 L36 58Z" fill="' + peau + '"/><path d="M66 50 L86 34 L64 58Z" fill="' + peau + '"/>'; devant = '<path d="M32 46 C32 22 68 22 68 46 C66 34 34 34 32 46Z" fill="' + (pid === 'elfe_cimes' ? '#e9e4d8' : '#6b4a2a') + '"/>'; break;
    case 'capuche': devant = '<path d="M28 66 C22 30 38 20 50 20 C62 20 78 30 72 66 C66 48 34 48 28 66Z" fill="' + cape + '"/>'; break;
    case 'bonnet': devant = '<path d="M32 42 C32 24 68 24 68 42Z" fill="#8e2b3a"/><rect x="31" y="39" width="38" height="6" rx="2" fill="#6e1f2c"/>'; break;
    case 'col': arriere = '<path d="M20 90 L26 44 L40 70Z M80 90 L74 44 L60 70Z" fill="#1c0810"/>'; devant = '<path d="M34 44 C34 26 66 26 66 44 C60 36 50 42 50 42 C50 42 40 36 34 44Z" fill="#1d1d24"/><circle cx="44" cy="50" r="2" fill="#a3374a"/><circle cx="56" cy="50" r="2" fill="#a3374a"/>'; break;
    case 'crocs': devant = '<path d="M42 64 L44 56 L46 64Z M54 64 L56 56 L58 64Z" fill="#f1ead8"/><path d="M34 40 C38 30 62 30 66 40" stroke="#2b2b20" stroke-width="5" fill="none"/>'; tete = '<ellipse cx="50" cy="54" rx="20" ry="19" fill="' + peau + '"/><circle cx="43" cy="50" r="2.2" fill="#e0a948"/><circle cx="57" cy="50" r="2.2" fill="#e0a948"/>'; break;
    case 'ailes': arriere = '<path d="M46 76 C20 40 4 58 10 80 C16 96 36 90 46 80Z M54 76 C80 40 96 58 90 80 C84 96 64 90 54 80Z" fill="rgba(215,230,245,.55)" stroke="rgba(255,255,255,.7)"/>'; devant = '<path d="M32 46 C30 26 70 26 68 46 C62 36 38 36 32 46Z" fill="#e8c85a"/>'; corpsY = 80; break;
    case 'bonnet_pointu': devant = '<path d="M30 42 L52 2 L70 42Z" fill="#a3374a"/><rect x="28" y="38" width="44" height="6" rx="3" fill="#7a2330"/>'; tete = '<ellipse cx="50" cy="56" rx="15" ry="16" fill="' + peau + '"/><circle cx="45" cy="54" r="1.8" fill="#241810"/><circle cx="55" cy="54" r="1.8" fill="#241810"/><ellipse cx="50" cy="60" rx="3" ry="2.5" fill="#c98a6a"/>'; corpsY = 78; break;
    case 'oreilles_loup': arriere = '<path d="M32 42 L30 14 L46 34Z M68 42 L70 14 L54 34Z" fill="' + peau + '"/>'; devant = '<path d="M32 50 C30 30 70 30 68 50 C62 40 38 40 32 50Z" fill="#5a4a3c"/><circle cx="44" cy="50" r="2.2" fill="#e8c34a"/><circle cx="56" cy="50" r="2.2" fill="#e8c34a"/>'; break;
    case 'cornes': arriere = '<path d="M38 36 C28 26 26 14 32 6 C34 18 40 26 44 32Z M62 36 C72 26 74 14 68 6 C66 18 60 26 56 32Z" fill="#2a2024"/>'; devant = '<circle cx="44" cy="50" r="2.2" fill="#f3cf7d"/><circle cx="56" cy="50" r="2.2" fill="#f3cf7d"/><path d="M44 62 Q50 66 56 62" stroke="#3a1414" stroke-width="2" fill="none"/>'; break;
    case 'capuche_x':
      tete = '<path d="M26 70 C20 28 36 14 50 14 C64 14 80 28 74 70 C66 80 34 80 26 70Z" fill="' + cape + '"/><path d="M26 70 C20 28 36 14 50 14 C64 14 80 28 74 70 C66 80 34 80 26 70Z" fill="rgba(0,0,0,.25)"/><ellipse cx="50" cy="54" rx="14" ry="17" fill="#120c08"/><circle cx="45" cy="52" r="1.6" fill="#f3cf7d"/><circle cx="55" cy="52" r="1.6" fill="#f3cf7d"/>';
      break;
  }
  const ombre = '<defs><linearGradient id="ombre" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient></defs>';
  const corps = ombre + '<path d="M8 120 C10 ' + (corpsY + 12) + ' 28 ' + corpsY + ' 50 ' + corpsY + ' C72 ' + corpsY + ' 90 ' + (corpsY + 12) + ' 92 120Z" fill="' + cape + '"/><path d="M50 ' + corpsY + ' L44 120 M50 ' + corpsY + ' L56 120" stroke="rgba(0,0,0,.25)" stroke-width="2"/><path d="M8 120 C10 ' + (corpsY + 12) + ' 28 ' + corpsY + ' 50 ' + corpsY + ' C72 ' + corpsY + ' 90 ' + (corpsY + 12) + ' 92 120Z" fill="url(#ombre)"/>';
  return '<svg viewBox="0 0 100 120" aria-hidden="true">' + arriere + corps + tete + devant + '</svg>';
}
function svgTonneau(t) {
  const liq = t ? BOISSONS[t.b].couleur : '#3a2a1c';
  return '<svg viewBox="0 0 90 120" aria-hidden="true"><defs><linearGradient id="bois" x1="0" x2="1"><stop offset="0" stop-color="#3a2212"/><stop offset=".35" stop-color="#8a5a30"/><stop offset=".55" stop-color="#7a4c26"/><stop offset="1" stop-color="#2e1a0d"/></linearGradient></defs><path d="M14 10 C4 40 4 80 14 110 L76 110 C86 80 86 40 76 10Z" fill="url(#bois)"/><path d="M26 10 C20 40 20 80 26 110 M45 10 L45 110 M64 10 C70 40 70 80 64 110" stroke="#4a2d17" stroke-width="2" fill="none"/><path d="M9 30 L81 30 M7 60 L83 60 M9 90 L81 90" stroke="#2b2622" stroke-width="5"/><ellipse cx="45" cy="10" rx="31" ry="7" fill="#8a5a30" stroke="#2b2622" stroke-width="3"/><circle cx="45" cy="75" r="9" fill="' + liq + '" stroke="#2b2622" stroke-width="3"/></svg>';
}

// ——— Rendu des scènes ———
function rendre() { rendreCalque(); rendrePanneau(); majBadges(); }
function rendreCalque() {
  const scene = $('#scene'), calque = $('#calque'), fond = $('#fond');
  const salleVisible = ['salle', 'ardoise', 'travaux'].includes(onglet);
  const src = salleVisible ? 'assets/salle.webp' : 'assets/' + onglet + '.webp';
  if (!fond.src.endsWith(src)) fond.src = src;
  scene.classList.toggle('sombre', onglet === 'marche');
  let h = '';
  if (salleVisible) {
    const prises = new Set(clients.map((c) => c.place));
    for (let i = 0; i < nbTables(); i++) if (!prises.has(i)) h += '<span class="place-libre" style="left:' + PLACES[i].x + '%;top:' + PLACES[i].y + '%"></span>';
    const joue = Object.keys(MUSICIENS).find(musique);
    if (joue) h += '<div class="musicien-scene">' + silhouette('chasseur', false).replace('#8a6a3a', '#5b2c6f') + '</div>';
    h += '<button type="button" class="fripouille-scene" data-action="fripouille" title="La Fripouille propose un pari"><img src="assets/fripouille.webp" alt="La Fripouille"></button>';
    for (const c of clients) {
      const P = PLACES[c.place];
      const r = Math.max(0, (c.fin - Date.now()) / (c.max * 1000));
      const bulle = c.p === 'vieil' ? '<span class="bulle">De l\'eau chaude…</span>'
        : c.indice ? '<span class="bulle indice">« … » ?</span>'
        : '<span class="bulle"><span class="pastille" style="background:' + BOISSONS[c.veut].couleur + '"></span>' + esc(BOISSONS[c.veut].nom.split(' ')[0]) + '</span>';
      h += '<button type="button" class="client' + (choisi === c.id ? ' choisi' : '') + (Date.now() - c.ne < 700 ? ' nouveau' : '') + '" data-cid="' + c.id + '" style="left:' + P.x + '%;top:' + P.y + '%" aria-label="' + esc(c.nom) + '">' + bulle + silhouette(c.p, c.capuche) + '<span class="patience"><i style="width:' + (r * 100).toFixed(1) + '%"></i></span></button>';
    }
  } else if (onglet === 'cave') {
    h += '<div class="tonneaux">';
    S.tonneaux.forEach((t, i) => {
      const pret = t && t.fin <= Date.now();
      const etat = !t ? 'Vide' : pret ? 'Tirer' : '';
      h += '<button type="button" class="tonneau' + (pret ? ' pret' : '') + (!t ? ' vide-t' : '') + '" data-tonneau="' + i + '" aria-label="Tonneau ' + (i + 1) + '">' + svgTonneau(t) + '<span class="etat"' + (t && !pret ? ' data-fin="' + t.fin + '" data-pret="Tirer"' : '') + '>' + (etat || duree(t.fin - Date.now())) + '</span></button>';
    });
    h += '</div><span class="etiquette-scene">La cave — ' + nbTonneaux() + ' tonneaux</span>';
  } else if (onglet === 'marche') {
    const prochain = (S.marche.creneau + 1) * 3 * H;
    h += '<span class="etiquette-scene">Prochain arrivage dans <span data-fin="' + prochain + '" data-pret="un instant">' + duree(prochain - Date.now()) + '</span></span>';
  } else if (onglet === 'carte') {
    const ok = new Set(atteignables());
    for (const [id, C] of Object.entries(CONTREES)) {
      const x = (C.x / 1536 * 100).toFixed(2), y = (C.y / 1024 * 100).toFixed(2);
      h += '<span class="brume-c' + (S.reveles[id] ? ' leve' : ok.has(id) ? ' proche' : '') + '" style="left:' + x + '%;top:' + y + '%"></span>';
      if (!S.reveles[id] && ok.has(id)) {
        const n = rumeursDe(id);
        h += '<span class="jalon" style="left:' + x + '%;top:' + y + '%" title="' + n + ' rumeur(s) sur 3"><span>' + [0, 1, 2].map((k) => '<i class="' + (k < n ? 'ok' : '') + '"></i>').join('') + '</span></span>';
      }
    }
    h += '<span class="etiquette-scene">La carte des rumeurs — ' + nbReveles() + ' / 16 contrées</span>';
  }
  calque.innerHTML = h;
}

function chopes(b) { return '<span class="chope" style="background:' + BOISSONS[b].couleur + '"></span>'; }
function rendrePanneau() {
  const P = $('#panneau');
  if (onglet === 'salle') P.innerHTML = panneauSalle();
  else if (onglet === 'cave') P.innerHTML = panneauCave();
  else if (onglet === 'marche') P.innerHTML = panneauMarche();
  else if (onglet === 'carte') P.innerHTML = panneauCarte();
  else if (onglet === 'ardoise') P.innerHTML = panneauArdoise();
  else if (onglet === 'travaux') P.innerHTML = panneauTravaux();
}

function panneauSalle() {
  const c = clients.find((x) => x.id === choisi);
  let h = '';
  if (c) {
    const car = S.carnet[c.p];
    const peuple = c.p === 'vieil' ? 'On ne sait pas d\'où il vient.' : c.capuche ? 'Vient d\'une contrée encore sous la brume.' : PEUPLES[c.p].nom;
    h += '<div class="plateau"><div class="qui">' + silhouette(c.p, c.capuche) + '<div><h3>' + esc(c.nom) + '</h3><p class="sous">' + esc(peuple) + '</p><blockquote>« ' + esc(c.texte) + ' »</blockquote></div></div>';
    if (c.p === 'vieil') {
      h += '<div class="verres"><button type="button" class="verre" data-servir="eau">Servir de l\'eau chaude</button></div>';
    } else {
      if (c.indice) h += '<p class="sous">Il parle en devinette. Trouve le bon verre : pourboire doublé et plus de chances qu\'il se confie.' + (car && car.connus.length && !c.capuche ? ' Ton carnet : ce peuple aime ' + esc(car.connus.map((b) => BOISSONS[b].nom.toLowerCase()).join(', ')) + '.' : '') + '</p>';
      h += '<div class="verres">' + ORDRE_BOISSONS.filter(boissonDispo).map((b) => '<button type="button" class="verre" data-servir="' + b + '"' + (S.stock[b] > 0 ? '' : ' disabled') + '>' + chopes(b) + esc(BOISSONS[b].nom) + ' <span class="n">×' + (S.stock[b] || 0) + '</span></button>').join('') + '</div>';
    }
    h += '<div class="ligne"><button type="button" class="btn sobre petit" data-action="deselect">Plus tard</button></div></div>';
  } else {
    h += '<div class="ligne entre"><h2>La salle commune</h2><span class="sous">' + clients.length + ' voyageur(s) sur ' + nbTables() + ' places</span></div>';
    const prochain = S.niv + 1;
    const gains = ORDRE_BOISSONS.filter((b) => BOISSONS[b].niv === prochain).map((b) => BOISSONS[b].nom).concat(Object.values(CONTREES).filter((c) => c.niv === prochain).map((c) => c.nom));
    h += '<p class="sous">Renommée ' + prochain + ' dans ' + nb(seuil(prochain) - S.xp) + ' points' + (gains.length ? ' : ' + esc(gains.join(', ')) : '') + '.</p>';
    h += '<p>' + (clients.length ? 'Clique un voyageur pour prendre sa commande. Une bulle mauve, c\'est une devinette.' : 'Personne pour l\'instant. Ça ne va pas durer : tout passe par cette porte.') + '</p>';
  }
  h += '<div class="carte-b"><h3>Au comptoir</h3><div class="stock">' + (ORDRE_BOISSONS.filter((b) => S.stock[b] > 0).map((b) => '<span>' + chopes(b) + esc(BOISSONS[b].nom) + ' <b>' + S.stock[b] + '</b></span>').join('') || '<span class="vide">Plus une chope. Direction la cave.</span>') + '</div></div>';
  const presents = peuplesPresents().map(([id]) => S.reveles[PEUPLES[id].contree] ? PEUPLES[id].pluriel : null).filter(Boolean);
  const masques = peuplesPresents().some(([id]) => !S.reveles[PEUPLES[id].contree]);
  h += '<p class="sous">À cette heure, passent ici : ' + esc([...new Set(presents)].join(', ') || '') + (masques ? (presents.length ? ', et ' : '') + 'des voyageurs encapuchonnés' : '') + '.' + (S.reveles['mor-kor'] && !dansFenetre(new Date().getHours(), [20, 6]) ? ' Les seigneurs de Mor\'Kor ne viennent qu\'après la tombée de la nuit.' : '') + '</p>';
  const joue = Object.keys(MUSICIENS).filter(musique);
  if (joue.length) h += '<p class="sous">Sur scène : ' + joue.map((k) => esc(MUSICIENS[k].nom) + ' (<span data-fin="' + S.musique[k] + '" data-pret="fini">' + duree(S.musique[k] - Date.now()) + '</span>)').join(', ') + '.</p>';
  return h;
}

function panneauCave() {
  let h = '<h2>La cave</h2>';
  if (caveChoix !== null) {
    h += '<div class="plateau"><h3>Que brasser dans le tonneau ' + (caveChoix + 1) + ' ?</h3><div class="grille">';
    for (const b of ORDRE_BOISSONS) {
      const B = BOISSONS[b], dispo = boissonDispo(b);
      const ok = dispo && Object.entries(B.recette).every(([k, q]) => (S.ingr[k] || 0) >= q);
      const rec = Object.entries(B.recette).map(([k, q]) => q + ' ' + INGREDIENTS[k].nom.toLowerCase() + ' (' + (S.ingr[k] || 0) + ')').join(', ');
      h += '<div class="carte-b' + (dispo ? '' : ' verrou') + '"><div class="ligne">' + chopes(b) + '<b>' + esc(B.nom) + '</b></div><p class="sous">' + (dispo ? esc(rec) + '<br>' + duree(B.duree * 1000) + ' — ' + rendement() + ' chopes à ' + B.prix + ' écus' : 'Renommée niveau ' + B.niv) + '</p>' + (dispo ? '<button type="button" class="btn petit" data-brasser="' + b + '"' + (ok ? '' : ' disabled') + '>' + (ok ? 'Brasser' : 'Il manque des ingrédients') + '</button>' : '') + '</div>';
    }
    h += '</div><div class="ligne"><button type="button" class="btn sobre petit" data-action="annuler-cave">Annuler</button></div></div>';
  } else {
    h += '<p>Clique un tonneau vide pour brasser, un tonneau prêt pour le tirer. Plus c\'est long, plus ça rapporte : un brassin de nuit se tire le matin.</p>';
  }
  h += '<div class="carte-b"><h3>Réserve d\'ingrédients</h3><div class="stock">' + (Object.keys(INGREDIENTS).filter((k) => S.ingr[k] > 0).map((k) => '<span>' + esc(INGREDIENTS[k].nom) + ' <b>' + S.ingr[k] + '</b></span>').join('') || '<span class="vide">Vide. Le marché est à deux pas.</span>') + '</div></div>';
  h += '<div class="carte-b"><h3>Chopes au comptoir</h3><div class="stock">' + (ORDRE_BOISSONS.filter((b) => S.stock[b] > 0).map((b) => '<span>' + chopes(b) + esc(BOISSONS[b].nom) + ' <b>' + S.stock[b] + '</b></span>').join('') || '<span class="vide">Aucune.</span>') + '</div></div>';
  return h;
}

function panneauMarche() {
  S.marche.vu = true;
  let h = '<h2>Le marché</h2><p>Installé en périphérie, récemment. L\'orge et le houblon ne manquent jamais. Le reste arrive par charrettes, toutes les trois heures, et part vite.</p><div class="grille">';
  for (const [k, I] of Object.entries(INGREDIENTS)) {
    const verrou = !I.base && S.niv < I.niv;
    const reste = I.base ? Infinity : (S.marche.stock[k] || 0);
    h += '<div class="carte-b' + (verrou ? ' verrou' : '') + '"><div class="ligne entre"><b>' + esc(I.nom) + '</b><span class="sous">' + I.prix + ' écu' + (I.prix > 1 ? 's' : '') + ' pièce</span></div>';
    if (verrou) h += '<p class="sous">Les marchands ne t\'en proposent pas encore (renommée ' + I.niv + ').</p>';
    else {
      h += '<p class="sous">' + (I.base ? 'En quantité' : reste ? 'Reste ' + reste + ' sur l\'étal' : 'Épuisé jusqu\'au prochain arrivage') + ' — tu en as ' + (S.ingr[k] || 0) + '</p><div class="ligne">';
      for (const q of [1, 5, 20]) h += '<button type="button" class="btn petit sobre" data-acheter="' + k + '" data-q="' + q + '"' + (S.ecus >= I.prix && reste > 0 ? '' : ' disabled') + '>+' + q + '</button>';
      h += '</div>';
    }
    h += '</div>';
  }
  return h + '</div>';
}

function panneauCarte() {
  const ok = new Set(atteignables());
  let h = '<div class="ligne entre"><h2>Le carnet des rumeurs</h2><span class="sous">' + nbRumeurs() + ' / 48 rumeurs</span></div><p>Trois rumeurs sur une contrée, et la brume se lève sur la carte. La troisième ne se confie qu\'à qui a su lire une commande en devinette.</p><div class="carnet">';
  const ordre = Object.keys(CONTREES).sort((x, y) => (S.reveles[y] ? 2 : ok.has(y) ? 1 : 0) - (S.reveles[x] ? 2 : ok.has(x) ? 1 : 0) || CONTREES[x].niv - CONTREES[y].niv);
  for (const id of ordre) {
    const C = CONTREES[id], n = rumeursDe(id);
    const connu = S.reveles[id] || n > 0;
    const titreC = connu ? esc(C.nom) + ' <span class="sous">— ' + esc(C.sous) + '</span>' : ok.has(id) ? 'Une contrée sous la brume' : '<span class="sous">Trop loin, pour l\'instant</span>';
    h += '<div class="carte-b' + (connu || ok.has(id) ? '' : ' verrou') + '"><h3>' + titreC + '</h3>';
    for (let i = 0; i < 3; i++) {
      const r = S.rumeurs[id + ':' + i];
      h += r ? '<p class="rumeur">« ' + esc(RUMEURS[id][i]) + ' »<br><span class="sous">— ' + esc(r.de) + '</span></p>' : '<p class="rumeur cachee">' + (i === 2 ? 'Rumeur scellée : se mérite sur devinette.' : 'Rumeur à entendre.') + '</p>';
    }
    if (C.sanctuaire && !S.reveles[id] && ok.has(id)) h += '<p class="sous">Personne n\'en vient. On n\'en entend parler que par ceux de ' + esc(sourcesSanctuaire(id).map((s) => CONTREES[s].nom).join(', ')) + '.</p>';
    h += '</div>';
  }
  return h + '</div>';
}

function panneauArdoise() {
  majFripouille();
  const J = S.jour;
  let h = '<div class="ardoise"><h3>L\'ardoise du ' + new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + '</h3>';
  for (const t of J.taches) {
    const v = Math.min(J.p[t.cle] || 0, t.n);
    h += '<div class="tache"><span class="' + (t.fait ? 'fait' : '') + '">' + esc(t.txt) + '</span><progress max="' + t.n + '" value="' + v + '"></progress><span>' + v + '/' + t.n + '</span></div>';
  }
  const tout = J.taches.every((t) => t.fait);
  h += '<div class="ligne"><button type="button" class="btn" data-action="coffret"' + (tout && !J.coffret ? '' : ' disabled') + '>' + (J.coffret ? 'Coffret ouvert — à demain' : 'Ouvrir le coffret du jour') + '</button><span class="sous" style="color:#b8bdb3">Nouvelle ardoise à minuit.</span></div>';
  h += '<p style="color:#cfd3c9">Série : ' + S.serie.n + ' jour(s)' + (bonusSerie() ? ' — pourboires +' + Math.round(bonusSerie() * 100) + ' %' : '') + '. Un coffret par jour tient la série ; chaque 7ᵉ jour, une fiole de brume.</p><div class="jours">';
  for (let i = 1; i <= 7; i++) h += '<span class="' + ((S.serie.n % 7 || (S.serie.n ? 7 : 0)) >= i ? 'ok' : '') + '">' + (i === 7 ? '✦' : i) + '</span>';
  h += '</div></div>';
  // Pari
  const reste = 3 - S.fripouille.parties;
  h += '<div class="carte-b"><div class="ligne"><img src="assets/fripouille.webp" alt="" style="width:56px;border-radius:50%"><div><h3>Le pari de la Fripouille</h3><p class="sous">Deux dés chacun, le plus haut gagne la mise. Égalité pour elle. Elle a un dé « de voyage » : si tu vois un 7, dénonce-la vite, elle paie double.</p></div></div>';
  if (partie) {
    const d = (v, roule) => '<span class="de' + (roule ? ' roule' : '') + (v === 7 ? ' sept' : '') + '">' + v + '</span>';
    h += '<div class="des"><div class="paire"><div>' + d(partie.toi[0], !partie.fin) + d(partie.toi[1], !partie.fin) + '</div><span class="sous">Toi</span></div><div class="paire"><div>' + d(partie.elle[0], !partie.fin) + d(partie.elle[1], !partie.fin) + '</div><span class="sous">La Fripouille</span></div></div>';
    if (!partie.fin && partie.triche) h += '<div class="ligne" style="justify-content:center"><button type="button" class="btn" data-action="attraper">Un 7 ?! Tricheuse !</button></div>';
    if (partie.fin) h += '<p style="text-align:center;max-width:none"><b>' + partie.res + ' écus</b></p>';
  } else if (reste > 0) {
    const mises = [10, 25, 60].concat(S.niv >= 5 ? [150] : []);
    h += '<div class="ligne">' + mises.map((m) => '<button type="button" class="btn sobre petit" data-parier="' + m + '"' + (S.ecus >= m ? '' : ' disabled') + '>Miser ' + m + '</button>').join('') + '<span class="sous">' + reste + ' partie(s) aujourd\'hui</span></div>';
  } else h += '<p class="vide">' + esc(FRIPOUILLE.fini) + '</p>';
  return h + '</div>';
}

function panneauTravaux() {
  let h = '<h2>Travaux</h2><div class="grille">';
  for (const [k, T] of Object.entries(TRAVAUX)) {
    const p = prixTravaux(k);
    const n = S.travaux[k] || 0;
    const etat = T.max ? (k === 'tables' ? nbTables() : nbTonneaux()) + ' / ' + T.max : n ? 'Fait' : '';
    h += '<div class="carte-b' + (p && S.niv < p.niv ? ' verrou' : '') + '"><div class="ligne entre"><b>' + esc(T.nom) + '</b><span class="sous">' + etat + '</span></div><p class="sous">' + esc(T.desc) + '</p>';
    if (p) h += S.niv < p.niv ? '<p class="sous">Renommée ' + p.niv + ' requise.</p>' : '<button type="button" class="btn petit" data-construire="' + k + '"' + (S.ecus >= p.prix ? '' : ' disabled') + '>' + nb(p.prix) + ' écus</button>';
    h += '</div>';
  }
  h += '</div><h2>Musiciens</h2><p class="sous">Chacun joue vingt minutes. Ils ont leurs habitudes à la taverne depuis longtemps' + (a('scene') ? '.' : ' — encore faut-il une scène.') + '</p><div class="grille">';
  for (const [k, M] of Object.entries(MUSICIENS)) {
    const joue = musique(k);
    h += '<div class="carte-b' + (!a('scene') || S.niv < M.niv ? ' verrou' : '') + '"><div class="ligne entre"><b>' + esc(M.nom) + '</b><span class="sous">' + esc(M.effet) + '</span></div><p class="sous">' + esc(M.desc) + '</p>';
    if (joue) h += '<p>Joue encore <span data-fin="' + S.musique[k] + '" data-pret="fini">' + duree(S.musique[k] - Date.now()) + '</span></p>';
    else if (S.niv < M.niv) h += '<p class="sous">Renommée ' + M.niv + ' requise.</p>';
    else h += '<button type="button" class="btn petit" data-engager="' + k + '"' + (a('scene') && S.ecus >= M.prix ? '' : ' disabled') + '>Engager — ' + M.prix + ' écus</button>';
    h += '</div>';
  }
  return h + '</div>';
}

// ——— Registre (stats, sauvegarde) ———
function ouvrirRegistre() {
  const rencontres = Object.entries(S.carnet).filter(([id]) => PEUPLES[id]).map(([id, c]) => '<li><b>' + esc(S.reveles[PEUPLES[id].contree] ? PEUPLES[id].pluriel : 'Voyageurs encapuchonnés') + '</b> — servis ' + c.servis + ' fois' + (c.connus.length ? ', aiment : ' + esc(c.connus.map((b) => BOISSONS[b].nom.toLowerCase()).join(', ')) : '') + '</li>').join('');
  let code = '';
  try { code = btoa(unescape(encodeURIComponent(JSON.stringify(S)))); } catch (e) { code = ''; }
  modale('<h2>Le registre</h2><p class="sous">' + esc(titre()) + ' — renommée ' + S.niv + ' — au comptoir depuis le ' + new Date(S.cree).toLocaleDateString('fr-FR') + '</p>'
    + '<p>' + nb(S.stats.servis) + ' voyageurs servis, ' + nb(S.stats.devines) + ' devinettes trouvées, ' + nb(S.stats.perdus) + ' repartis sans boire, ' + nb(S.stats.gains) + ' écus encaissés, ' + S.stats.parisGagnes + ' paris gagnés contre la Fripouille.' + (S.stats.vieil ? ' Un vieil homme est passé ' + S.stats.vieil + ' fois.' : '') + '</p>'
    + '<h3>Peuples rencontrés</h3>' + (rencontres ? '<ul>' + rencontres + '</ul>' : '<p class="vide">Personne encore.</p>')
    + '<h3>Emporter sa partie</h3><p class="sous">La partie vit dans ce navigateur. Pour la reprendre ailleurs, copie ce code et colle-le dans l\'autre navigateur.</p><textarea id="code-save" readonly>' + code + '</textarea><div class="ligne"><button type="button" class="btn sobre petit" data-action="copier">Copier le code</button></div>'
    + '<label for="code-import" class="sous">Reprendre une partie depuis un code :</label><textarea id="code-import" placeholder="Colle ton code ici"></textarea><div class="ligne"><button type="button" class="btn sobre petit" data-action="importer">Charger ce code</button><button type="button" class="btn sobre petit" data-action="reset1">Tout recommencer</button></div><p id="msg-registre" class="sous"></p>'
    + '<button type="button" class="btn" data-fermer>Fermer</button>');
}

// ——— Événements ———
document.addEventListener('click', (e) => {
  const t = e.target.closest('button, [data-cid]');
  if (!t) { if (e.target.id === 'modale' && S.tuto.lance) fermerModale(); return; }
  const d = t.dataset;
  if (d.onglet) return changerOnglet(d.onglet);
  if (d.cid) {
    choisi = +d.cid;
    if (onglet !== 'salle') changerOnglet('salle');
    rendreCalque(); rendrePanneau();
    const p = $('#panneau'); if (p.getBoundingClientRect().top > window.innerHeight - 120) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (d.servir) { const cid = choisi; return servir(cid, d.servir); }
  if (d.tonneau !== undefined) {
    const i = +d.tonneau, tn = S.tonneaux[i];
    if (!tn) { caveChoix = i; rendrePanneau(); }
    else if (tn.fin <= Date.now()) tirer(i);
    return;
  }
  if (d.brasser) return brasser(caveChoix, d.brasser);
  if (d.acheter) return acheter(d.acheter, +d.q);
  if (d.construire) return construire(d.construire);
  if (d.engager) return engager(d.engager);
  if (d.parier) return parier(+d.parier);
  if (d.fermer !== undefined) { fermerModale(); if (d.aller) changerOnglet(d.aller); return; }
  if (t.id === 'b-son') { S.son = !S.son; son('piece'); sauver(); majHud(); return; }
  if (t.id === 'b-menu') return ouvrirRegistre();
  switch (d.action) {
    case 'deselect': choisi = null; rendreCalque(); rendrePanneau(); break;
    case 'annuler-cave': caveChoix = null; rendrePanneau(); break;
    case 'coffret': ouvrirCoffret(); break;
    case 'attraper': attraper(); break;
    case 'fripouille': direFripouille(choix(FRIPOUILLE.accroche)); changerOnglet('ardoise'); setTimeout(() => $('.ardoise + .carte-b')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); break;
    case 'commencer': fermerModale(); S.tuto.lance = true; dire(TAVERNIER.accueil[0], true); prochainClient = Date.now() + 2500; sauver(); break;
    case 'copier': {
      const ta = $('#code-save');
      navigator.clipboard?.writeText(ta.value).then(() => { $('#msg-registre').textContent = 'Code copié.'; }, () => { ta.select(); $('#msg-registre').textContent = 'Copie refusée par le navigateur : le code est sélectionné, fais Ctrl+C.'; });
      break;
    }
    case 'importer': {
      try {
        const obj = JSON.parse(decodeURIComponent(escape(atob($('#code-import').value.trim()))));
        if (!obj || obj.v !== 1) throw new Error('version');
        S = Object.assign(etatNeuf(), obj); clients = []; choisi = null; sauver(); fermerModale(); rendre(); majHud();
        toast('Partie reprise.');
      } catch (err) { $('#msg-registre').textContent = 'Ce code n\'est pas lisible. Vérifie qu\'il est complet.'; }
      break;
    }
    case 'reset1': t.dataset.action = 'reset2'; t.textContent = 'Vraiment ? Tout sera perdu'; t.classList.remove('sobre'); break;
    case 'reset2': S = etatNeuf(); S.tuto.lance = true; clients = []; choisi = null; majJour(); majMarche(true); sauver(); fermerModale(); rendre(); majHud(); break;
  }
});
function fermerModale() {
  $('#modale').hidden = true; $('#modale').innerHTML = '';
  if (fileModales.length) { const [h, l] = fileModales.shift(); setTimeout(() => modale(h, l), 150); }
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modale').hidden && S.tuto.lance) fermerModale();
  if (onglet === 'salle' && choisi && /^[1-8]$/.test(e.key)) {
    const b = ORDRE_BOISSONS.filter(boissonDispo)[+e.key - 1];
    if (b) servir(choisi, b);
  }
});
function changerOnglet(o) {
  onglet = o;
  if (o !== 'cave') caveChoix = null;
  document.querySelectorAll('.onglets button').forEach((b) => b.classList.toggle('actif', b.dataset.onglet === o));
  rendre();
}

// ——— Démarrage ———
(function init() {
  const neuf = !S;
  if (neuf) S = etatNeuf();
  majJour(); majMarche(false);
  const r = neuf ? null : rattraper(S.vu);
  rendre(); majHud();
  if (neuf || !S.tuto.lance) {
    modale('<div class="ouverture"><img src="assets/titre.webp" alt=""><div><h1>L\'Oreille de Myrhaven</h1><p>La Taverne du Gaming tient le centre exact des dix-sept contrées. Tout le monde y passe. Les pièces paient la bière. Les nouvelles, elles, paient tout le reste.</p><p>Le tavernier cherche un commis qui sert vite et retient ce qu\'on lui dit. Seize contrées dorment sous la brume : à toi de les faire parler.</p><button type="button" class="btn" data-action="commencer">Pousser la porte</button></div></div>', true);
    derniereReplique = Date.now();
    $('#replique').textContent = 'La porte est ouverte. Entre, ou ferme-la, y a du courant.';
    prochainClient = Date.now() + 60 * 60 * 1000;
  } else {
    dire(choix(TAVERNIER.calme), true);
    rapportAbsence(r);
  }
  sauver();
  demarrer();
})();
