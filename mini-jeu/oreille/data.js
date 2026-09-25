// L'Oreille de Myrhaven — contenu du jeu (textes, équilibrage). Aucune logique ici.
'use strict';

const BOISSONS = {
  blonde:   { nom: 'Blonde du Carrefour', art: 'une blonde du Carrefour', prix: 3,  duree: 60,    recette: { orge: 2, houblon: 1 }, niv: 1, couleur: '#e3b34a' },
  brune:    { nom: 'Cervoise brune',      art: 'une cervoise brune',      prix: 4,  duree: 240,   recette: { orge: 3, houblon: 1 }, niv: 2, couleur: '#6b3a1c' },
  cidre:    { nom: 'Cidre de Lys',        art: 'un cidre de Lys',         prix: 5,  duree: 600,   recette: { pomme: 4 },            niv: 3, couleur: '#d9c06a' },
  hydromel: { nom: 'Hydromel',            art: 'un hydromel',             prix: 7,  duree: 1800,  recette: { miel: 3 },             niv: 4, couleur: '#c98a2b' },
  vin:      { nom: 'Rouge de Syl',        art: 'un rouge de Syl',         prix: 9,  duree: 3600,  recette: { raisin: 4 },           niv: 5, couleur: '#7d1f2e' },
  grog:     { nom: 'Grog de Nyr',         art: 'un grog de Nyr',          prix: 11, duree: 7200,  recette: { miel: 1, epices: 2 },  niv: 6, couleur: '#a0522d' },
  eaudefeu: { nom: 'Eau-de-feu de Vor',   art: 'une eau-de-feu de Vor',   prix: 14, duree: 14400, recette: { piment: 2, orge: 2 },  niv: 7, couleur: '#d4562a' },
  liqueur:  { nom: 'Liqueur de brume',    art: 'une liqueur de brume',    prix: 24, duree: 28800, recette: { brume: 1, miel: 2 },   niv: 8, couleur: '#8c93b8' },
};
const ORDRE_BOISSONS = Object.keys(BOISSONS);

// base : toujours en vente (jamais de blocage). Les autres arrivent par arrivage toutes les 3 h.
const INGREDIENTS = {
  orge:    { nom: 'Orge',            prix: 1,  base: true },
  houblon: { nom: 'Houblon',         prix: 2,  base: true },
  pomme:   { nom: 'Pommes',          prix: 1,  lot: [16, 26], niv: 3 },
  miel:    { nom: 'Miel',            prix: 3,  lot: [10, 16], niv: 4 },
  raisin:  { nom: 'Raisin',          prix: 3,  lot: [10, 14], niv: 5 },
  epices:  { nom: 'Épices',          prix: 5,  lot: [6, 10],  niv: 6 },
  piment:  { nom: 'Piment de Vor',   prix: 6,  lot: [4, 8],   niv: 7 },
  brume:   { nom: 'Fiole de brume',  prix: 40, lot: [0, 2],   niv: 8 },
};

const INDICES = {
  blonde:   ['Quelque chose de clair et d\'honnête. Comme moi.', 'Du simple. J\'ai eu une journée compliquée.', 'Ce que boit tout le monde, mais en mieux.'],
  brune:    ['Du sombre, qui tient au corps.', 'Ce que boivent les gens qui creusent.', 'Quelque chose de la couleur d\'une porte de cave.'],
  cidre:    ['Un truc qui a été une pomme, un jour.', 'Du doux qui pique.', 'Ce qu\'un verger boirait s\'il avait soif.'],
  hydromel: ['Ce que les abeilles boiraient si elles avaient soif.', 'Du miel, mais en plus convaincant.', 'Quelque chose de doré qui a pris son temps.'],
  vin:      ['Du rouge. Bien rouge. Sans questions.', 'Quelque chose qui a vieilli mieux que moi.', 'Ce qu\'on sert aux gens qui ont des manières.'],
  grog:     ['Ce qu\'on boit quand on a vu la mer de trop près.', 'Chaud, épicé, et je ne veux pas savoir ce qu\'il y a dedans.', 'Un verre qui réchauffe les os mouillés.'],
  eaudefeu: ['Quelque chose qui répond quand on le boit.', 'Ce qui enlève la rouille. La mienne.', 'Le verre qu\'on boit debout.'],
  liqueur:  ['La bouteille du fond. Celle que tu gardes.', 'Quelque chose de trouble, qui ressemble au dehors.', 'Ce qui se boit à petites gorgées et se regrette à grandes.'],
};

// Les 16 contrées (coordonnées = étiquettes de carte.webp, 1536x1024). `voisins` = d'où la brume recule ensuite.
const CONTREES = {
  'nyr-alen':    { nom: "Nyr'Alen",    sous: 'Cité des Mers',             x: 530,  y: 532, voisins: ['vor-kel', 'lys-fae'],             niv: 1 },
  'kor-thar':    { nom: "Kor'Thar",    sous: 'Royaume des Nains',         x: 740,  y: 276, voisins: ['kael-syl', 'isen-drak'],          niv: 1 },
  'syl-vandell': { nom: "Syl'Vandell", sous: 'Les Forêts Ancestrales',    x: 380,  y: 386, voisins: ['kael-syl', 'vor-kel'],            niv: 1 },
  'val-lys':     { nom: "Val'Lys",     sous: 'Terres Sauvages',           x: 990,  y: 386, voisins: ['nyr-mor', 'nyr-murk', 'aer-drak'], niv: 2 },
  'nyr-murk':    { nom: "Nyr'Murk",    sous: 'Les Marais des Eaux Mortes', x: 958, y: 552, voisins: ['fae-mor', 'mor-kor', 'lys-fae'],  niv: 3 },
  'kael-syl':    { nom: "Kael'Syl",    sous: 'Les Cimes des Elfes',       x: 617,  y: 125, voisins: ['isen-drak'],                      niv: 3 },
  'vor-kel':     { nom: "Vor'Kel",     sous: 'Terres des Orcs',           x: 372,  y: 682, voisins: ['vor-drak'],                       niv: 4 },
  'lys-fae':     { nom: "Lys'Fae",     sous: 'La Vallée Féerique',        x: 820,  y: 704, voisins: ['fae-mor', 'vor-drak', 'drag-or'], niv: 4 },
  'nyr-mor':     { nom: "Nyr'Mor",     sous: 'Le Port Brumeux',           x: 1385, y: 330, voisins: ['mor-kor', 'aer-drak'],            niv: 5 },
  'fae-mor':     { nom: "Fae'Mor",     sous: 'Forêts des Loups-Garous',   x: 1062, y: 705, voisins: ['abyr-nox', 'drag-or'],            niv: 5 },
  'mor-kor':     { nom: "Mor'Kor",     sous: 'Le Château Noir',           x: 1224, y: 495, voisins: ['abyr-nox'],                       niv: 6 },
  'abyr-nox':    { nom: "Abyr'Nox",    sous: 'La Faille des Abysses',     x: 1392, y: 766, voisins: ['drag-or'],                        niv: 7 },
  'isen-drak':   { nom: "Isen'Drak",   sous: 'Sanctuaire du Givre',       x: 820,  y: 150, voisins: [], sanctuaire: true,               niv: 6 },
  'aer-drak':    { nom: "Aer'Drak",    sous: "Sanctuaire de l'Orage",     x: 1182, y: 118, voisins: [], sanctuaire: true,               niv: 7 },
  'vor-drak':    { nom: "Vor'Drak",    sous: 'Sanctuaire du Feu',         x: 410,  y: 955, voisins: [], sanctuaire: true,               niv: 8 },
  'drag-or':     { nom: "Drag'Or",     sous: "Sanctuaire d'Or",           x: 1128, y: 955, voisins: [], sanctuaire: true,               niv: 9 },
};
const DEPART = ['nyr-alen', 'kor-thar', 'syl-vandell', 'val-lys'];

// Peuples de passage. `heures` : [début, fin] de présence (heure réelle du joueur) ; `pic` : fenêtre où ils sont 3x plus nombreux.
const PEUPLES = {
  marchand: { nom: 'Marchand de Nyr\'Alen', pluriel: 'Marchands de Nyr\'Alen', contree: 'nyr-alen', gouts: ['blonde', 'cidre', 'vin'], cape: '#2f5d7a', trait: 'chapeau',
    syl: [['Ald', 'Bren', 'Cass', 'Ivo', 'Mael', 'Oss', 'Tib'], ['ric', 'enne', 'ard', 'ois', 'elin', 'amo']],
    dit: ['{D}, et je paie tout de suite. Comptez-la, je l\'ai déjà comptée.', 'Je prendrai {d}. Le prix ? Ne dites rien, je le connais mieux que vous.', '{D}. Et si vous avez des nouvelles du port, je les achète aussi.'],
    bon: 'Juste prix, juste verre. On refera affaire.', faux: 'Ce n\'est pas ce que j\'ai commandé. Je le note. Je note tout.' },
  nain: { nom: 'Nain de Kor\'Thar', pluriel: 'Nains de Kor\'Thar', contree: 'kor-thar', gouts: ['brune', 'blonde', 'eaudefeu'], cape: '#7a4a24', trait: 'barbe', pic: [5, 11],
    syl: [['Bor', 'Dur', 'Thra', 'Grim', 'Kel', 'Brun', 'Ork'], ['in', 'ak', 'dur', 'ok', 'grim', 'rik']],
    dit: ['{D}. Et une chaise solide.', '{D}. Pas de mousse, la mousse c\'est pour les elfes.', 'Tu as {d} ? Bien. La pierre tient.'],
    bon: 'La pierre tient.', faux: 'C\'est pas ça. Mais je bois, par respect pour la maison.' },
  elfe_bois: { nom: 'Elfe de Syl\'Vandell', pluriel: 'Elfes des Bois', contree: 'syl-vandell', gouts: ['cidre', 'vin', 'hydromel'], cape: '#3f6b3a', trait: 'oreilles',
    syl: [['Ae', 'Lir', 'Syl', 'Ela', 'Thae', 'Ny'], ['wen', 'ariel', 'ith', 'orn', 'lian', 'vael']],
    dit: ['{D}, s\'il vous plaît. Sans hâte. Rien ne presse jamais vraiment.', 'Je voudrais {d}. Dans un verre qui n\'a pas connu la hache. Je plaisante. À moitié.', '{D}. Votre charpente a quel âge ? Non, je préfère ne pas savoir.'],
    bon: 'Parfait. L\'arbre qui a fait cette table vous pardonne.', faux: 'Ce n\'est pas ce que j\'espérais. J\'attendrai la prochaine saison.' },
  chasseur: { nom: 'Chasseur de Val\'Lys', pluriel: 'Chasseurs de Val\'Lys', contree: 'val-lys', gouts: ['hydromel', 'brune', 'blonde'], cape: '#8a6a3a', trait: 'capuche',
    syl: [['Bran', 'Hal', 'Rok', 'Wen', 'Gar', 'Tor'], ['ric', 'dan', 'ulf', 'ard', 'ek', 'wyn']],
    dit: ['{D}. J\'ai marché trois jours, et le vent avait tort.', '{D}, et je garde mes bottes, merci.', '{D}. Si un cheval sans selle entre, il est avec moi.'],
    bon: 'Ça, c\'est un verre qui a de la route.', faux: 'Hm. Le vent m\'avait prévenu.' },
  elfe_cimes: { nom: 'Elfe de Kael\'Syl', pluriel: 'Elfes des Cimes', contree: 'kael-syl', gouts: ['hydromel', 'vin', 'liqueur'], cape: '#a9b9c9', trait: 'oreilles',
    syl: [['Ith', 'Kae', 'Vael', 'Aer', 'Lune', 'Isil'], ['diel', 'rin', 'wyn', 'thas', 'andra', 'ion']],
    dit: ['{D}. Il fait chaud ici, non ? Non ? Ah.', '{D}. On respire si épais, en bas.', '{D}. Et si vous pouviez ouvrir une fenêtre. Ou deux.'],
    bon: 'Presque aussi pur que l\'air de chez moi. Presque.', faux: 'Curieux. En bas, même les erreurs ont un goût.' },
  marin: { nom: 'Marin de Nyr\'Mor', pluriel: 'Marins de Nyr\'Mor', contree: 'nyr-mor', gouts: ['grog', 'brune', 'eaudefeu'], cape: '#34495e', trait: 'bonnet', pic: [18, 23],
    syl: [['Jor', 'Mael', 'Sten', 'Hask', 'Nil', 'Ev'], ['en', 'ric', 'ald', 'ow', 'ine', 'as']],
    dit: ['{D}, et vite, le sol ne tangue pas assez.', '{D}. Et une place près du feu, j\'ai encore la brume dans le col.', '{D}. J\'ai compté les cloches en arrivant. Il y en avait une de trop.'],
    bon: 'Voilà qui remet le pont d\'aplomb.', faux: 'Ça tangue pas comme il faut, ça.' },
  passeur: { nom: 'Passeur de Nyr\'Murk', pluriel: 'Passeurs des marais', contree: 'nyr-murk', gouts: ['grog', 'eaudefeu', 'brune'], cape: '#4d5a3a', trait: 'capuche',
    syl: [['Murr', 'Ob', 'Sael', 'Dro', 'Vesk', 'Ul'], ['in', 'as', 'ek', 'o', 'ard', 'ume']],
    dit: ['{D}. Ne faites pas attention à l\'eau, elle part toute seule.', '{D}, et je paie à la fin. Habitude du métier.', '{D}. Si vous voyez une lumière derrière moi, ne la suivez pas.'],
    bon: 'Bon passage. Vous êtes arrivé sans vous perdre.', faux: 'Mauvais chemin. Mais on arrive quand même, c\'est ça qui compte.' },
  vampire: { nom: 'Seigneur de Mor\'Kor', pluriel: 'Seigneurs de Mor\'Kor', contree: 'mor-kor', gouts: ['vin', 'liqueur'], cape: '#3a1020', trait: 'col', heures: [20, 6],
    syl: [['Vla', 'Mor', 'Cas', 'Sev', 'Ister', 'Lu'], ['imir', 'ane', 'ius', 'eline', 'ard', 'ya']],
    dit: ['{D}. Je ne mords pas. Plus. Enfin, pas ici.', 'Je prendrai {d}. Et fermez ce volet, la lune me dévisage.', '{D}. Servi dans le noir, si possible. Vos chandelles sont d\'un enthousiasme.'],
    bon: 'Exquis. Je reviendrai. Je reviens toujours.', faux: 'Quel dommage. J\'ai tout mon temps, remarquez.' },
  orc: { nom: 'Orc de Vor\'Kel', pluriel: 'Orcs des Cendres', contree: 'vor-kel', gouts: ['eaudefeu', 'brune', 'grog'], cape: '#5b3a2a', trait: 'crocs',
    syl: [['Gor', 'Ruk', 'Maz', 'Thok', 'Ug', 'Kra'], ['ash', 'ok', 'gul', 'nar', 'rak', 'tuk']],
    dit: ['{D} ! Il cogne la table. Poliment, pour un orc.', '{D}. Grand. Plus grand. Voilà.', '{D}. Et si quelqu\'un rit, c\'est pas moi qui ai commencé.'],
    bon: 'BON. Il te tape l\'épaule. Tu la retrouveras demain.', faux: 'Pas ça. Mais bois quand même. Moi. Je bois quand même.' },
  fee: { nom: 'Fée de Lys\'Fae', pluriel: 'Fées de Lys\'Fae', contree: 'lys-fae', gouts: ['cidre', 'hydromel', 'liqueur'], cape: '#b98ab5', trait: 'ailes', pic: [17, 21],
    syl: [['Lys', 'Pim', 'Aelis', 'Fen', 'Tilly', 'Oria'], ['ette', 'elle', 'wyn', 'a', 'iane', 'ine']],
    dit: ['{D}. Mais ne me remerciez pas, surtout.', 'Je veux {d}. Et une toute petite chaise.', '{D}, et je vous donne un conseil en échange. Non ? Dommage.'],
    bon: 'Charmant. Je ne dirai pas merci. Vous savez pourquoi.', faux: 'Oh. Je m\'en souviendrai. Je me souviens de tout.' },
  gnome: { nom: 'Gnome de Ner\'Lin', pluriel: 'Gnomes de Ner\'Lin', contree: 'lys-fae', gouts: ['brune', 'cidre', 'eaudefeu'], cape: '#3d7a6e', trait: 'bonnet_pointu',
    syl: [['Fiz', 'Nim', 'Bol', 'Tink', 'Wob', 'Pell'], ['wick', 'bin', 'nob', 'sprock', 'le', 'dle']],
    dit: ['{D}. J\'ai inventé un verre qui se remplit tout seul. Il se vide aussi tout seul.', '{D}, et gardez la monnaie. Enfin, rendez-la. Je compte.', '{D}. Votre tireuse fuit de trois gouttes par jour. Je dis ça.'],
    bon: 'Rendement excellent. Je note la recette. Non, je plaisante. Si.', faux: 'Erreur de calibrage. Ça arrive aux meilleurs. Surtout aux autres.' },
  loup: { nom: 'Loup-garou de Fae\'Mor', pluriel: 'Loups-garous de Fae\'Mor', contree: 'fae-mor', gouts: ['hydromel', 'brune', 'vin'], cape: '#4a4038', trait: 'oreilles_loup', pic: [21, 4],
    syl: [['Wol', 'Ran', 'Fen', 'Lup', 'Gar', 'Ulv'], ['ric', 'ulf', 'rir', 'ane', 'hild', 'en']],
    dit: ['{D}. Et pas de ragoût, merci, j\'ai déjà mangé. Il ne précise pas quoi.', '{D}. Fort. La lune est grosse ce soir.', '{D}. Je frappe toujours avant d\'entrer. Désolé pour la porte.'],
    bon: 'Il remue quelque chose sous sa cape. Ça ressemble à de la joie.', faux: 'Il grogne. Très bas. Presque gentiment.' },
  demon: { nom: 'Démon d\'Abyr\'Nox', pluriel: 'Démons d\'Abyr\'Nox', contree: 'abyr-nox', gouts: ['eaudefeu', 'liqueur', 'grog'], cape: '#4b1f3a', trait: 'cornes',
    syl: [['Az', 'Bel', 'Mal', 'Xar', 'Oriax', 'Zeph'], ['iel', 'oth', 'phas', 'ur', 'aël', 'eon']],
    dit: ['Je sollicite {d}, conformément à l\'usage. Signez ici. Je plaisante. Presque.', '{D}, je vous prie. Votre maison est d\'une neutralité admirable.', '{D}. Et votre âme n\'est pas incluse dans le prix. Je vérifie, c\'est tout.'],
    bon: 'Prestation conforme. Je laisse une appréciation favorable.', faux: 'Écart constaté. Je ne réclame rien. Pour cette fois.' },
};

const CAPUCHE = {
  dit: ['… {d}.', '{D}. Et pas de question sur la route que j\'ai prise.', '{D}. Vous ne m\'avez pas vu.', '{D}. D\'où je viens ? D\'un endroit que votre carte ne montre pas encore.'],
  bon: 'Un hochement de tête sous la capuche. C\'est beaucoup.', faux: 'Silence. On sent la déception à travers le tissu.',
};

// 3 rumeurs par contrée. La 3ᵉ ne se livre qu'à qui a servi le bon verre sur indice (voir `scellee`).
const RUMEURS = {
  'nyr-alen': [
    'À Nyr\'Alen, les marchands pèsent tout, même les promesses. Une promesse légère se revend moins cher.',
    'Le port de Nyr\'Alen a une loi : un navire qui rentre sans cargaison doit rentrer avec une histoire. Les douaniers taxent les deux.',
    'Une famille de Nyr\'Alen possède une clé pour chaque porte de la cité, sauf la sienne. Ils dorment chez les voisins depuis trois générations.',
  ],
  'kor-thar': [
    'Les nains de Kor\'Thar ne disent pas bonjour. Ils disent « la pierre tient ». Réponds « elle tiendra » et tu as un ami pour la vie.',
    'À Kor\'Thar, un escalier n\'est jamais fini : chaque génération y ajoute une marche. Personne ne sait où il mène, mais il est très beau.',
    'Un nain de Kor\'Thar a creusé si profond qu\'il a entendu quelqu\'un creuser vers lui. Il a rebouché. Proprement.',
  ],
  'syl-vandell': [
    'Dans Syl\'Vandell, les vieux arbres ont un nom, et les elfes s\'excusent quand ils marchent sur leurs racines. Les jours de pluie, ça prend des heures.',
    'Les elfes de Syl\'Vandell n\'abattent jamais un arbre. Ils attendent qu\'il tombe. Leurs menuisiers ont donc beaucoup de retard.',
    'Une clairière de Syl\'Vandell change de place chaque nuit. Les elfes la retrouvent à l\'odeur. Les humains, jamais.',
  ],
  'val-lys': [
    'À Val\'Lys, on ne ferme pas les portes. Le vent les ouvre de toute façon, et là-bas le vent a toujours raison.',
    'Les chasseurs de Val\'Lys comptent leurs saisons en bottes usées. Le plus vieux du pays en est à quarante paires.',
    'Il y a dans Val\'Lys un troupeau de chevaux que personne ne possède. Ceux qui ont voulu les monter sont revenus à pied, mais plus sages.',
  ],
  'nyr-murk': [
    'Les passeurs de Nyr\'Murk connaissent chaque chemin du marais. Le problème, c\'est que les chemins ne les connaissent pas toujours.',
    'À Nyr\'Murk, on paie le passeur à l\'arrivée, jamais au départ. C\'est une question de motivation.',
    'La nuit, des lumières dansent sur les eaux mortes. Les passeurs disent de ne pas les suivre. Ils ne disent pas pourquoi ils les saluent.',
  ],
  'kael-syl': [
    'Les elfes des Cimes vivent si haut qu\'ils descendent à Kor\'Thar pour avoir chaud. C\'est dire.',
    'À Kael\'Syl, on chante pour appeler le vent. Il vient, mais il fait des remarques.',
    'Les elfes des Cimes affirment qu\'on voit la Taverne depuis leurs sommets par temps clair. Ils ajoutent qu\'elle a l\'air plus petite. C\'est vexant.',
  ],
  'vor-kel': [
    'Les orcs de Vor\'Kel se saluent en se cognant le front. Ceux à qui il manque une dent sont les plus polis.',
    'À Vor\'Kel, la cendre tombe comme la neige ailleurs. Les enfants font des bonshommes de cendre. Ils sont gris, tristes, et très réussis.',
    'Un chef de Vor\'Kel a juré de ne jamais s\'asseoir tant qu\'un seul ennemi vivrait. Il a une chaise quand même. Par principe.',
  ],
  'lys-fae': [
    'Dans Lys\'Fae, ne remercie jamais une fée. Elle considère que tu lui dois quelque chose, et elle a très bonne mémoire.',
    'Les gnomes de Ner\'Lin, au bord de Lys\'Fae, ont bâti une machine à cueillir les pommes. Elle marche. Elle cueille aussi les chapeaux.',
    'La lumière de Lys\'Fae tombe plus bas qu\'ailleurs, comme si le soleil se penchait pour mieux voir. Les fées disent qu\'il est curieux.',
  ],
  'nyr-mor': [
    'À Nyr\'Mor, la brume est si épaisse que les marins s\'y adossent pour dormir.',
    'Un capitaine de Nyr\'Mor jure avoir croisé son propre navire, en sens inverse, avec lui-même à la barre. Ils se sont salués. Ils ne se parlent plus depuis.',
    'Au port de Nyr\'Mor, on sonne une cloche pour chaque navire qui rentre. Certaines nuits, elle sonne seule, et au matin il y a un navire de plus à quai. Personne ne le réclame.',
  ],
  'fae-mor': [
    'À Fae\'Mor, on compte les jours en lunes et les dettes en pleines lunes. Tout le monde rembourse avant la pleine lune. Tout le monde.',
    'Les loups-garous de Fae\'Mor sont très fiers de leur politesse. Ils frappent toujours avant d\'entrer. Parfois avec la porte.',
    'Dans les forêts de Fae\'Mor, il y a un sentier où les loups ne vont pas. Ils disent que c\'est par respect. Leurs oreilles disent autre chose.',
  ],
  'mor-kor': [
    'Au Château Noir, on dîne à minuit et on déjeune à minuit aussi. Les horaires sont simples, c\'est le menu qui est compliqué.',
    'Les seigneurs de Mor\'Kor collectionnent les miroirs. Pas pour s\'y voir. Pour savoir qui d\'autre est dans la pièce.',
    'À Mor\'Kor, il est impoli de demander son âge à quelqu\'un. Pas par pudeur : la réponse prend toute la nuit.',
  ],
  'abyr-nox': [
    'Les démons d\'Abyr\'Nox signent tout. Même un bonjour. Surtout un bonjour.',
    'Au bord de la Faille, les démons tiennent le registre de ceux qui y sont tombés. Il est très court. Ils disent que la Faille rend presque tout.',
    'Un démon d\'Abyr\'Nox m\'a juré que la Faille n\'a pas de fond. Puis il a ajouté : « enfin, pas encore ». Il n\'a pas voulu développer.',
  ],
  'isen-drak': [
    'Un nain qui revenait d\'Isen\'Drak disait que la neige y tombe vers le haut. Il a bu trois brunes et il a maintenu sa version.',
    'Les elfes des Cimes ne montent jamais jusqu\'au sanctuaire du Givre. Ils disent qu\'on les y attend, et qu\'ils n\'aiment pas être attendus.',
    'À Isen\'Drak, la glace garde les voix. Ceux qui y collent l\'oreille entendent des gens parler d\'eux. Au passé.',
  ],
  'aer-drak': [
    'Un marin de Nyr\'Mor dit que la foudre tombe sur Aer\'Drak à heure fixe. Il règle ses quarts dessus depuis vingt ans.',
    'Quand l\'orage vient du nord-est, les chevaux sauvages de Val\'Lys se tournent vers Aer\'Drak et ne bougent plus. Même la pluie a l\'air d\'attendre.',
    'Personne n\'a vu le sommet d\'Aer\'Drak sans nuage. Un chasseur prétend l\'avoir vu une fois. Il refuse de dire de quelle couleur il était.',
  ],
  'vor-drak': [
    'Les orcs de Vor\'Kel vont chercher leur braise à Vor\'Drak. Ils partent à trois et reviennent à trois, mais ne sont jamais d\'accord sur qui était parti.',
    'La terre est si chaude autour de Vor\'Drak que les gnomes y cuisent leur pain sans four. Il a un goût de montagne.',
    'Une fois l\'an, Vor\'Drak soupire. Toute la montagne. Et les orcs se taisent pour l\'écouter.',
  ],
  'drag-or': [
    'Drag\'Or, on y est allé pour l\'or. Ceux qui en sont revenus n\'en parlent pas. Ceux qui n\'en parlent pas, on ne sait pas s\'ils sont revenus.',
    'Un marchand de Nyr\'Alen vend des pièces de Drag\'Or. Elles sont trop lourdes pour leur taille. Il les vend au poids et perd de l\'argent à chaque vente. Il continue.',
    'Les démons eux-mêmes ne signent rien qui mentionne Drag\'Or. Ils disent que ce nom n\'a pas sa place dans un contrat.',
  ],
};

// Le tavernier tutoie, coupe court, ne finit pas ses phrases quand il sert.
const TAVERNIER = {
  accueil: ['T\'es le nouveau. Tu sers, tu écoutes, tu retiens. Dans cet ordre.'],
  tuto: [
    'Un client. Clique dessus, sers-lui ce qu\'il demande. Le reste viendra.',
    'Bien. Ceux qui parlent en devinettes, trouve le bon verre : ils paient double et ils causent.',
    'Les chopes, ça se brasse en bas. Va voir la cave quand t\'as un moment.',
    'Une rumeur ! Elle va sur la carte. Trois par contrée, et la brume recule. C\'est comme ça qu\'on voit le monde, ici.',
  ],
  calme: [
    'Une table vide, c\'est une nouvelle qu\'on n\'entendra pas.',
    'Essuie le comptoir. Non, pas avec ça.',
    'Tout passe par cette porte. Tout. Faut juste être là quand ça passe.',
    'Le crâne de cerf de l\'autre salle ? Il était là avant moi. Il sera là après toi.',
    'La porte du bas ? Sers.',
    'Les pièces, c\'est pour la cave. Les nouvelles, c\'est pour la carte.',
    'Vingt ans que je tiens la maison. Vingt ans que personne paie à l\'heure. Sauf les nains.',
    'Si un client te parle de l\'endroit d\'où il vient, tu hoches la tête et tu retiens. Tu notes pas. Tu retiens.',
    'On dit que la Fripouille triche. C\'est faux. Elle arrange.',
  ],
  nuit: ['À cette heure-ci, on sert ceux qui ne dorment pas. Les regarde pas trop dans les yeux.', 'La nuit, les nouvelles sont plus lourdes. Écoute bien.'],
  matin: ['Les nains sont levés. Enfin, ils se sont pas couchés.', 'Le matin, on sert du clair. Le reste, c\'est pour les gens qui ont des soucis.'],
  rupture: 'Plus de {n}. Descends à la cave, ou apprends à mentir poliment.',
  pret: 'Ça sent le prêt, en bas. Va tirer…',
  niveau: ['Pas mal. Je dirai pas « bien ». Pas encore.', 'Tu tiens le comptoir comme quelqu\'un qui l\'a déjà tenu. Continue.', 'Les clients commencent à demander après toi. C\'est bon signe. Ou c\'est qu\'ils ont une dette.'],
  rumeur: ['Retiens-la, celle-là. La carte en a faim.', 'Hm. Ça, c\'est une nouvelle qui vaut plus que la chope…', 'Note rien. Retiens.'],
  brume: '{c}… On y voit plus clair. Je me doutais que c\'était par là.',
  parti: ['Parti. Avec sa soif et sa nouvelle.', 'Il a attendu, il est reparti. On le reverra. Ou pas.'],
  faux: ['Il boira. Mais il parlera pas.', 'C\'est pas ce qu\'il voulait, et il le sait.'],
  devine: ['Bien vu. Il te regarde autrement, là.', 'Tu l\'as lu comme une carte. Bien.'],
  absence: ['T\'étais où ? J\'ai tenu. Voilà les comptes.', 'Pendant que tu dormais, j\'ai servi. Pas écouté, servi. Les nouvelles, c\'est ton travail.'],
  vieil: 'Il a pris de l\'eau chaude et il a payé avec ça. Garde-la. Et en parle à personne…',
};

const FRIPOUILLE = {
  accroche: ['Un petit pari, commis ? Je triche jamais. Presque jamais. Rarement le mardi.', 'Les dés sont honnêtes. Moi un peu moins, mais les dés, eux, sont honnêtes.', 'Allez, une partie. Si tu gagnes, je dis du bien de toi au patron. Il me croira pas, mais c\'est l\'intention.'],
  gagne: ['Bon. Tu as de la chance. La chance, ça se rembourse, tu sais.', 'Joli. Je te laisse gagner, c\'est pédagogique.', 'Hmpf. Les dés ont bu, ce soir.'],
  perd: ['À moi ! C\'était écrit. Pas lisiblement, mais c\'était écrit.', 'Merci pour la contribution. La maison… enfin, moi, apprécie.', 'Perdu. Mais tu as perdu avec beaucoup de dignité.'],
  egal: 'Égalité ! Et l\'égalité, c\'est pour moi. C\'est écrit en petit. Très petit.',
  triche: 'Un sept ? Ah. Ça, c\'est un dé de voyage. Il a pris des habitudes.',
  attrape: ['Pris la main dans le gobelet… Bon. Je paie double, et tu dis rien au patron.', 'D\'accord, d\'accord. Tu as l\'œil. Tiens, pour ton silence.'],
  fini: 'C\'est tout pour aujourd\'hui. Reviens demain, j\'aurai de nouveaux dés. Les mêmes, mais reposés.',
};

const MUSICIENS = {
  barde:      { nom: 'Le Barde',      desc: 'Joue fort, joue juste, joue longtemps. Les pourboires suivent.', effet: '+30 % de pourboires', prix: 40,  niv: 3 },
  menestrel:  { nom: 'Le Ménestrel',  desc: 'Des ballades lentes. Les gens patientent sans s\'en rendre compte.', effet: '+40 % de patience', prix: 60,  niv: 3 },
  troubadour: { nom: 'Le Troubadour', desc: 'Chante dans la rue avant d\'entrer. Les passants suivent.', effet: '+40 % de voyageurs', prix: 80,  niv: 4 },
  conteur:    { nom: 'Le Conteur',    desc: 'Raconte une histoire et en attend une en retour.', effet: 'Rumeurs ×2', prix: 110, niv: 5 },
};
const DUREE_MUSIQUE = 20 * 60;

const TRAVAUX = {
  tables:  { nom: 'Une table de plus',        desc: 'Plus de places, plus d\'oreilles.', paliers: [60, 180, 520], max: 6, base: 3, niv: [1, 2, 4] },
  tonneaux:{ nom: 'Un tonneau de plus',       desc: 'Brasser plusieurs choses à la fois.', paliers: [80, 260, 700, 1800], max: 6, base: 2, niv: [1, 3, 5, 7] },
  chene:   { nom: 'Tonneaux de chêne noir',   desc: 'Chaque brassin donne 4 chopes de plus.', paliers: [450], niv: [4] },
  atre:    { nom: 'Raviver l\'âtre',          desc: 'Les voyageurs patientent 25 % plus longtemps au chaud.', paliers: [150], niv: [2] },
  enseigne:{ nom: 'Repeindre l\'enseigne',    desc: '20 % de voyageurs en plus.', paliers: [320], niv: [3] },
  scene:   { nom: 'Monter la scène',          desc: 'Permet d\'engager les musiciens.', paliers: [250], niv: [3] },
  comptoir:{ nom: 'Cirer le comptoir',        desc: 'Les chopes se vendent 10 % plus cher. Ça brille, ça rassure.', paliers: [600], niv: [5] },
  chambres:{ nom: 'Ouvrir les chambres',      desc: 'Le tavernier tient jusqu\'à 14 h en ton absence, au lieu de 8.', paliers: [900], niv: [6] },
};

const TITRES = ['Commis', 'Plongeur promu', 'Garçon de salle', 'Tireur de pinte', 'Échanson', 'Maître de chai', 'Confident du comptoir', 'Bras droit du tavernier', 'Mémoire de la maison', 'Oreille de Myrhaven'];

// Tâches de l'ardoise (tirées au sort chaque jour). `n` est multiplié selon le niveau.
const TACHES = [
  { id: 'servir',   txt: 'Servir {n} voyageurs',                 n: [12, 20, 30], cle: 'servis' },
  { id: 'deviner',  txt: 'Trouver {n} commandes sur indice',     n: [2, 4, 6],    cle: 'devines' },
  { id: 'tirer',    txt: 'Tirer {n} tonneaux à la cave',         n: [2, 4, 6],    cle: 'tires' },
  { id: 'gagner',   txt: 'Encaisser {n} écus',                   n: [60, 150, 400], cle: 'gains' },
  { id: 'rumeur',   txt: 'Recueillir {n} rumeur(s)',             n: [1, 1, 2],    cle: 'rumeurs' },
  { id: 'marche',   txt: 'Acheter {n} ingrédients au marché',    n: [10, 20, 40], cle: 'achats' },
  { id: 'parfait',  txt: 'Servir {n} voyageurs d\'affilée sans en perdre un', n: [8, 12, 16], cle: 'serie' },
  { id: 'peuples',  txt: 'Servir {n} peuples différents',        n: [2, 3, 5],    cle: 'peuplesJour' },
];
const SERIE_BONUS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35];
