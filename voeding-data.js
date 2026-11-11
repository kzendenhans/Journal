// Voeding — menu's, trainingsschema en prijsschattingen.
// Voedingswaarden zijn schattingen per portie in gram (kh = koolhydraten, vz = verzadigd vet).
// Ingrediënten: [hoeveelheid, eenheid, naam, categorie]
// when: 'train' = enkel op trainingsdagen, 'rest' = enkel op rustdagen, leeg = altijd.
// De eerste passende variant per maaltijd is de standaard.
// own: jouw eigen gewoonte · duur: duurdere variant · norot: niet in de weekrotatie (wel via Wissel)
// rot (bij een maaltijd): standaard wisselt per weekdag (ma = 1e variant, di = 2e, …)
'use strict';

const VOEDING_DATA = (() => {
  const SLOTS = [
    { key: 'ontbijt',   label: 'Ontbijt',             time: '07:30' },
    { key: 'tussen1',   label: 'Tussendoor ochtend',  trainLabel: 'Na de training', time: '09:45' },
    { key: 'lunch',     label: 'Lunch',               time: '12:30' },
    { key: 'tussen2',   label: 'Tussendoor namiddag', time: '16:00' },
    { key: 'avondmaal', label: 'Avondmaal',           time: '18:00', rot: true },
    { key: 'avond',     label: 'Avond',               time: '21:30' },
  ];

  const TRAINING_DEFAULT = {
    start: '08:00', end: '09:30',
    days: { 0: '', 1: 'Push', 2: 'Pull', 3: 'Legs', 4: '', 5: 'Upper body', 6: 'Lower body' },
    // vaste cardio per weekdag (naast de krachttraining)
    cardio: { 3: { name: 'Zwemmen', start: '19:00', end: '20:00' } },
  };
  const TRAINING_TYPES = ['', 'Push', 'Pull', 'Legs', 'Upper body', 'Lower body', 'Full body', 'Cardio'];

  const CAT = {
    Z: 'Zuivel & eieren',
    V: 'Vlees, vis & vegetarisch',
    G: 'Groenten & fruit',
    K: 'Graan, brood & peulvruchten',
    N: 'Noten, zaden & olie',
    O: 'Overig',
  };

  // Ruwe prijsschatting (huismerk, Belgische supermarkt, eind 2026) per eenheid zoals in de ingrediënten.
  const PRICES = {
    'Havermout': { g: 0.0012 },
    'Wheypoeder': { g: 0.024 },
    'Magere skyr': { g: 0.0033 },
    'Magere kwark': { g: 0.0024 },
    'Magere melk': { ml: 0.001 },
    'Cottage cheese (mager)': { g: 0.008 },
    'Ei': { st: 0.25 },
    'Aardbeien (diepvries)': { g: 0.004 },
    'Banaan': { st: 0.25 },
    'Appel': { st: 0.35 },
    'Chiazaad': { el: 0.10 },
    'Gemalen lijnzaad': { el: 0.03 },
    'Amandelen': { g: 0.012 },
    'Walnoten': { g: 0.014 },
    'Amandelen': { g: 0.012 },
    'Pindakaas (100% pinda)': { el: 0.08 },
    'Pindakaas (100% pinda)': { el: 0.18 },
    'Koolzaadolie': { tl: 0.015, el: 0.045 },
    'Koolzaadolie': { tl: 0.04, el: 0.12 },
    'Volkorenbrood': { sn: 0.10 },
    'Proteïnebrood (low carb)': { sn: 0.45 },
    'Volkorenrijst': { g: 0.0025 },
    'Volkorenpasta': { g: 0.0018 },
    'Aardappelen': { g: 0.001 },
    'Zoete aardappel': { g: 0.0025 },
    'Linzen (blik)': { g: 0.0035 },
    'Kidneybonen (blik)': { g: 0.0025 },
    'Sojabrokken (droog)': { g: 0.006 },
    'Tofu': { g: 0.005 },
    'Kipfilet': { g: 0.007 },
    'Zalmfilet': { g: 0.02 },
    'Makreel in tomatensaus': { blik: 1.5 },
    'Tonijn op water': { blik: 1.2 },
    'Kalkoenfilet (beleg)': { g: 0.015 },
    'Hummus': { g: 0.01 },
    'Edamame (diepvries)': { g: 0.005 },
    'Broccoli of bloemkool (diepvries)': { g: 0.002 },
    'Spinazie (diepvries)': { g: 0.002 },
    'Wokgroenten (diepvries)': { g: 0.0025 },
    'Champignons': { g: 0.004 },
    'Tomaat': { st: 0.30 },
    'Tomatenblokjes (blik)': { g: 0.00125 },
    'Paprika': { st: 0.60 },
    'Komkommer': { st: 0.80 },
    'Wortel': { st: 0.10 },
    'Ui': { st: 0.15 },
    'Ui': { st: 0.20 },
    'Snackgroenten (voorverpakt)': { g: 0.006 },
    'Kruiden (chili, komijn, paprika)': { tl: 0.05 },
    'Verse kruiden of bieslook': { el: 0.05 },
    'Sojasaus (minder zout)': { el: 0.05 },
  };

  const BASE_VARIANTS = [
    // ── Ontbijt
    { id: 'o0', slot: 'ontbijt', own: true, name: 'Havermout-proteïnebowl, hele banaan', eiwit: 43, kh: 80, vet: 13, vz: 2,
      ing: [[70,'g','Havermout','K'],[30,'g','Wheypoeder','O'],[60,'g','Magere skyr','Z'],[60,'g','Aardbeien (diepvries)','G'],[1,'st','Banaan','G'],[1,'el','Chiazaad','N'],[1,'el','Gemalen lijnzaad','N']] },
    { id: 'o0b', slot: 'ontbijt', own: true, name: 'Havermout-proteïnebowl, halve banaan', eiwit: 42, kh: 66, vet: 13, vz: 2,
      ing: [[70,'g','Havermout','K'],[30,'g','Wheypoeder','O'],[60,'g','Magere skyr','Z'],[60,'g','Aardbeien (diepvries)','G'],[0.5,'st','Banaan','G'],[1,'el','Chiazaad','N'],[1,'el','Gemalen lijnzaad','N']] },

    { id: 'o1', slot: 'ontbijt', name: 'Skyr-havermoutbowl met aardbeien en walnoten', eiwit: 31, kh: 40, vet: 14, vz: 1.7,
      ing: [[200,'g','Magere skyr','Z'],[40,'g','Havermout','K'],[100,'g','Aardbeien (diepvries)','G'],[1,'el','Gemalen lijnzaad','N'],[10,'g','Walnoten','N']] },

    // ── Na de training (trainingsdag)
    { id: 'p1', slot: 'tussen1', when: 'train', name: 'Eiwitshake met water en amandelen', eiwit: 27, kh: 3, vet: 8.5, vz: 1.1,
      ing: [[30,'g','Wheypoeder','O'],[15,'g','Amandelen','N']] },
    { id: 'p2', slot: 'tussen1', when: 'train', name: 'Skyr met walnoten', eiwit: 24, kh: 9, vet: 10, vz: 1.1,
      ing: [[200,'g','Magere skyr','Z'],[15,'g','Walnoten','N']] },

    // ── Tussendoor ochtend (rustdag)
    { id: 't4', slot: 'tussen1', when: 'rest', name: 'Skyr met appel en kaneel', eiwit: 22.5, kh: 26, vet: 0.7, vz: 0.2,
      ing: [[200,'g','Magere skyr','Z'],[1,'st','Appel','G']] },
    { id: 't3', slot: 'tussen1', when: 'rest', name: 'Skyr met amandelen', eiwit: 19, kh: 7, vet: 8, vz: 0.7,
      ing: [[150,'g','Magere skyr','Z'],[15,'g','Amandelen','N']] },

    // ── Lunch
    { id: 'l3', slot: 'lunch', name: 'Volkorenbrood met eieren, champignons en kwark', eiwit: 35, kh: 51, vet: 19.4, vz: 4.4,
      ing: [[3,'sn','Volkorenbrood','K'],[2,'st','Ei','Z'],[60,'g','Champignons','G'],[1,'st','Tomaat','G'],[30,'g','Spinazie (diepvries)','G'],[100,'g','Magere kwark','Z'],[1,'tl','Koolzaadolie','N']] },
    { id: 'l4', slot: 'lunch', name: 'Volkorenbrood met 1 ei, extra kwark en champignons', eiwit: 38, kh: 54.5, vet: 13.9, vz: 2.7,
      ing: [[3,'sn','Volkorenbrood','K'],[1,'st','Ei','Z'],[200,'g','Magere kwark','Z'],[60,'g','Champignons','G'],[1,'st','Tomaat','G'],[30,'g','Spinazie (diepvries)','G'],[1,'tl','Koolzaadolie','N']] },
    { id: 'l2', slot: 'lunch', name: 'Linzensalade met tonijn', eiwit: 43, kh: 34, vet: 12, vz: 1.9,
      ing: [[150,'g','Linzen (blik)','K'],[1,'blik','Tonijn op water','V'],[1,'st','Tomaat','G'],[0.25,'st','Komkommer','G'],[0.5,'st','Ui','G'],[1,'el','Koolzaadolie','N']] },

    // ── Tussendoor namiddag
    { id: 's2', slot: 'tussen2', name: 'Rauwkost met kruidendip en boterham met pindakaas', eiwit: 24, kh: 52, vet: 10.6, vz: 2.1,
      ing: [[0.5,'st','Komkommer','G'],[2,'st','Wortel','G'],[0.5,'st','Paprika','G'],[150,'g','Magere kwark','Z'],[1,'el','Verse kruiden of bieslook','O'],[2,'sn','Volkorenbrood','K'],[1,'el','Pindakaas (100% pinda)','N']] },
    { id: 's1', slot: 'tussen2', name: 'Skyr met noten en rauwkost', eiwit: 28, kh: 17, vet: 13, vz: 1.4,
      ing: [[200,'g','Magere skyr','Z'],[25,'g','Amandelen','N'],[0.5,'st','Komkommer','G'],[1,'st','Wortel','G']] },
    { id: 'n1', slot: 'tussen2', name: 'Eiwitshake met amandelen', eiwit: 27, kh: 3, vet: 8.5, vz: 1.1,
      ing: [[30,'g','Wheypoeder','O'],[15,'g','Amandelen','N']] },

    // ── Avondmaal
    { id: 'd0', slot: 'avondmaal', own: true, name: 'Kip met zoete aardappel en groenten', eiwit: 45, kh: 70, vet: 13.8, vz: 2.2,
      ing: [[300,'g','Zoete aardappel','G'],[150,'g','Kipfilet','V'],[250,'g','Broccoli of bloemkool (diepvries)','G'],[1,'el','Koolzaadolie','N']] },
    { id: 'd7', slot: 'avondmaal', name: 'Pangasius met aardappelen, broccoli en mosterd', eiwit: 36, kh: 61, vet: 15.5, vz: 1.6,
      ing: [[150,'g','Pangasiusfilet (diepvries, ASC)','V'],[300,'g','Aardappelen','G'],[250,'g','Broccoli of bloemkool (diepvries)','G'],[1,'el','Koolzaadolie','N']] },
    { id: 'd4', slot: 'avondmaal', name: 'Chili met kip, bonen en rijst', eiwit: 44, kh: 73, vet: 14.5, vz: 1.9,
      ing: [[120,'g','Kipfilet','V'],[120,'g','Kidneybonen (blik)','K'],[200,'g','Tomatenblokjes (blik)','G'],[1,'st','Paprika','G'],[1,'st','Ui','G'],[60,'g','Volkorenrijst','K'],[1,'tl','Kruiden (chili, komijn, paprika)','O'],[1,'el','Koolzaadolie','N']] },
    { id: 'd5', slot: 'avondmaal', name: 'Makreel met aardappelen en groenten', eiwit: 32, kh: 61, vet: 15.5, vz: 3.6,
      ing: [[1,'blik','Makreel in tomatensaus','V'],[300,'g','Aardappelen','G'],[250,'g','Broccoli of bloemkool (diepvries)','G']] },
    { id: 'd6', slot: 'avondmaal', name: 'Linzenbolognese met kip en volkorenpasta', eiwit: 46.5, kh: 80, vet: 13.5, vz: 2.2,
      ing: [[60,'g','Volkorenpasta','K'],[150,'g','Linzen (blik)','K'],[100,'g','Kipfilet','V'],[200,'g','Tomatenblokjes (blik)','G'],[1,'st','Ui','G'],[1,'st','Wortel','G'],[1,'el','Koolzaadolie','N']] },
    { id: 'd8', slot: 'avondmaal', name: 'Pangasius met zoete aardappel en spinazie', eiwit: 33, kh: 62, vet: 15.3, vz: 1.6,
      ing: [[150,'g','Pangasiusfilet (diepvries, ASC)','V'],[300,'g','Zoete aardappel','G'],[150,'g','Spinazie (diepvries)','G'],[1,'el','Koolzaadolie','N']] },
    { id: 'd1', slot: 'avondmaal', own: true, name: 'Kip met volkorenrijst en groenten', eiwit: 45, kh: 66, vet: 15, vz: 2.3,
      ing: [[75,'g','Volkorenrijst','K'],[150,'g','Kipfilet','V'],[250,'g','Broccoli of bloemkool (diepvries)','G'],[1,'el','Koolzaadolie','N']] },

    // ── Avond
    { id: 'e1', slot: 'avond', name: 'Boterham met pindakaas en banaan', eiwit: 7, kh: 37, vet: 9, vz: 1.7,
      ing: [[1,'sn','Volkorenbrood','K'],[1,'el','Pindakaas (100% pinda)','N'],[1,'st','Banaan','G']] },
    { id: 'e0', slot: 'avond', name: 'Kwark met pindakaas en kaneel', eiwit: 19.5, kh: 9, vet: 9.4, vz: 0.8,
      ing: [[200,'g','Magere kwark','Z'],[1,'el','Pindakaas (100% pinda)','N']] },
    { id: 'v1', slot: 'avond', name: 'Skyr met kaneel', eiwit: 17, kh: 6, vet: 0.3, vz: 0.2,
      ing: [[150,'g','Magere skyr','Z']] },
  ];

  const EXTRAS = [
    { name: 'Druivensuiker (4 tabl.)', kh: 12, eiwit: 0, vet: 0, vz: 0, hypo: true },
    { name: 'Glas fruitsap 150 ml', kh: 15, eiwit: 0.5, vet: 0, vz: 0, hypo: true },
    { name: 'Banaan (extra na cardio)', kh: 23, eiwit: 1.2, vet: 0.3, vz: 0.1 },
    { name: 'Snede volkorenbrood met pindakaas', kh: 17, eiwit: 7, vet: 9, vz: 1.7 },
    { name: 'Handje noten (25 g)', kh: 2, eiwit: 5, vet: 13, vz: 1.3 },
    { name: 'Rauwkost', kh: 6, eiwit: 1.5, vet: 0.3, vz: 0 },
    { name: 'Koekje', kh: 9, eiwit: 0.8, vet: 3, vz: 1.5 },
  ];

  // Uit je oude voedingslog (~/voedingslog.html); verzadigd vet geschat waar het niet ingevuld was.
  const LOGBOEK = [
    {name: "Skyr 250g", kh: 10.0, eiwit: 27.5, vet: 0.5, vz: 0.3},
    {name: "Ei (1 st. ~60g)", kh: 0.1, eiwit: 7.2, vet: 5.5, vz: 1.6},
    {name: "Proteïnepoeder 20g", kh: 1.8, eiwit: 14.0, vet: 0.9, vz: 0.5},
    {name: "Prot.brood 1 snede", kh: 10.0, eiwit: 7.1, vet: 2.0, vz: 0.4},
    {name: "Avocado 100g", kh: 9.0, eiwit: 2.0, vet: 15.0, vz: 2.1},
    {name: "Spek 1 plak (42g)", kh: 0.3, eiwit: 7.1, vet: 8.8, vz: 3.2},
    {name: "Kip 150g", kh: 0.0, eiwit: 46.0, vet: 5.5, vz: 1.5},
    {name: "Kip 200g", kh: 0.0, eiwit: 62.0, vet: 7.2, vz: 2},
    {name: "Tonijn blik 150g", kh: 0.0, eiwit: 39.0, vet: 1.5, vz: 0.4},
    {name: "Tonijn 140g uitgelekt", kh: 0.7, eiwit: 43.4, vet: 1.1, vz: 0.3},
    {name: "Zoete aardappel 150g", kh: 30.0, eiwit: 2.4, vet: 0.2, vz: 0},
    {name: "Hardgek. ei (1 st.)", kh: 0.1, eiwit: 7.2, vet: 5.5, vz: 1.6},
    {name: "Maiswafels paprika ×3", kh: 20.0, eiwit: 2.1, vet: 2.2, vz: 0.3},
    {name: "Maiswafels proteïne ×4", kh: 9.0, eiwit: 3.8, vet: 0.4, vz: 0.1},
    {name: "Augurk (1 st.)", kh: 1.4, eiwit: 0.1, vet: 0.05, vz: 0},
    {name: "Kalkoenfilet (snede)", kh: 0.3, eiwit: 2.3, vet: 0.4, vz: 0.1},
    {name: "Hummus pikant (10g)", kh: 1.1, eiwit: 0.6, vet: 2.4, vz: 0.3},
    {name: "Zomerfruit/bessen 125g", kh: 16.0, eiwit: 1.3, vet: 0.4, vz: 0},
    {name: "Aardbeien 125g", kh: 6.4, eiwit: 0.9, vet: 0.0, vz: 0},
    {name: "Pindakaas (15g)", kh: 1.8, eiwit: 4.1, vet: 7.1, vz: 1.3},
    {name: "Barebells peanut caramel", kh: 16.0, eiwit: 16.0, vet: 11.0, vz: 5},
    {name: "Havermout (40g)", kh: 24.0, eiwit: 5.6, vet: 2.8, vz: 0.5},
    {name: "Chiazaad (25g)", kh: 10.5, eiwit: 4.1, vet: 7.7, vz: 0.8},
    {name: "Amandeldrink 200ml", kh: 1.6, eiwit: 1.0, vet: 2.2, vz: 0.2},
    {name: "Boter (10g)", kh: 0.1, eiwit: 0.1, vet: 8.2, vz: 5.3},
    {name: "Champignons 100g", kh: 3.3, eiwit: 3.1, vet: 0.3, vz: 0},
    {name: "Dextro tablet (1 st.)", kh: 3.7, eiwit: 0.0, vet: 0.0, vz: 0, hypo: true},
    {name: "Mayonaise light (15g)", kh: 1.5, eiwit: 0.2, vet: 4.3, vz: 0.4},
    {name: "Olijfolie (10ml)", kh: 0.0, eiwit: 0.0, vet: 9.0, vz: 1.4},
    {name: "Sperziebonen 100g", kh: 3.8, eiwit: 1.9, vet: 0.0, vz: 0},
    {name: "Energy nut mix 100g", kh: 30.9, eiwit: 20.3, vet: 28.3, vz: 3.5},
    {name: "Appel (1 st. ~150g)", kh: 21.0, eiwit: 0.5, vet: 0.3, vz: 0},
    {name: "Courgette 100g", kh: 3.1, eiwit: 1.2, vet: 0.3, vz: 0},
    {name: "Erwtendrink 200ml", kh: 3.8, eiwit: 6.6, vet: 5.0, vz: 0.6},
    {name: "Romatomaat 100g", kh: 3.8, eiwit: 0.9, vet: 0.2, vz: 0},
    {name: "Gerookte zalm (50g)", kh: 0.0, eiwit: 11.0, vet: 5.5, vz: 1},
    {name: "Hüttenkäse 50g", kh: 0.8, eiwit: 6.0, vet: 1.9, vz: 1.2},
    {name: "Aardappelen 100g", kh: 17.0, eiwit: 2.0, vet: 0.1, vz: 0},
    {name: "Broccoli 100g", kh: 7.0, eiwit: 2.8, vet: 0.4, vz: 0},
    {name: "Chipolata kip 100g", kh: 2.9, eiwit: 17.0, vet: 6.6, vz: 1.9},
    {name: "Banaan (1 st. ~120g)", kh: 27.0, eiwit: 1.3, vet: 0.4, vz: 0.1},
    {name: "Kippengehakt 100g", kh: 0.4, eiwit: 18.0, vet: 12.0, vz: 3.5},
    {name: "Kipburger jalapeño 100g", kh: 1.9, eiwit: 17.0, vet: 9.1, vz: 2.5},
    {name: "Rijstkoeken 100g", kh: 82.0, eiwit: 8.0, vet: 2.5, vz: 0.5},
    {name: "Geitenkaas Aldi 30g", kh: 0.6, eiwit: 2.4, vet: 3.6, vz: 2.5},
    {name: "Heinz Baked Beans 100g", kh: 15.5, eiwit: 4.8, vet: 0.4, vz: 0.1},
    {name: "Griekse yoghurt Aldi 100g", kh: 2.5, eiwit: 6.0, vet: 2.0, vz: 1.3},
  ];


  // Albert Heijn (ah.nl), goedkoopste geschikte product per ingrediënt.
  // q/u = inhoud van één verpakking in de eenheid van het menu; c = zekerheid van de prijs.
  // Bron: jouw winkelmandje (10/11/2026) of zoekresultaten van ah.nl/supermarktscanner (november 2026).
  const AH = {
    'Magere skyr':                  { p: 'AH Skyr IJslandse stijl', size: '500 g', q: 500, u: 'g', price: 1.39, c: 'mandje' },
    'Ei':                           { p: 'AH Verse scharreleieren M', size: '20 stuks', q: 20, u: 'st', price: 5.99, c: 'mandje' },
    'Havermout':                    { p: 'AH Volkoren havermout fijne vlokken', size: '1 kg', q: 1000, u: 'g', price: 0.95, c: 'mandje' },
    'Champignons':                  { p: 'AH Witte champignons', size: '400 g', q: 400, u: 'g', price: 1.34, c: 'mandje' },
    'Aardbeien (diepvries)':        { p: 'AH Zakje met aardbeien', size: '1 kg', q: 1000, u: 'g', price: 3.99, c: 'mandje' },
    'Tonijn op water':              { p: 'Statesman Tonijn stukken in water', size: '160 g', q: 1, u: 'blik', price: 1.19, c: 'mandje' },
    'Edamame (diepvries)':          { p: 'AH Terra Gepelde edamame boontjes', size: '450 g', q: 450, u: 'g', price: 2.89, c: 'mandje' },
    'Aardappelen':                  { p: 'AH Iets kruimige aardappelen', size: '1 kg', q: 1000, u: 'g', price: 3.09, c: 'mandje' },
    'Magere kwark':                 { p: 'De Zaanse Hoeve Magere kwark', size: '1 kg', q: 1000, u: 'g', price: 1.99, c: 'zoek' },
    'Wheypoeder':                   { p: 'AH Whey protein shake vanille', size: '330 g', q: 330, u: 'g', price: 6.89, c: 'zoek' },
    'Kipfilet':                     { p: 'AH Scharrel kipfilet voordeelverpakking', size: '1 kg', q: 1000, u: 'g', price: 11.49, c: 'zoek' },
    'Zoete aardappel':              { p: 'AH Nederlandse zoete aardappelen', size: '750 g', q: 750, u: 'g', price: 2.49, c: 'onzeker' },
    'Broccoli of bloemkool (diepvries)': { p: 'AH Broccoliroosjes (diepvries)', size: '1 kg', q: 1000, u: 'g', price: 2.49, c: 'zoek' },
    'Spinazie (diepvries)':         { p: 'AH Bladspinazie grof gesneden', size: '450 g', q: 450, u: 'g', price: 1.25, c: 'onzeker' },
    'Volkorenbrood':                { p: 'AH Extra lang lekker tijger volkoren', size: '±20 sneden', q: 20, u: 'sn', price: 1.25, c: 'onzeker' },
    'Chiazaad':                     { p: 'AH Biologisch Chiazaad', size: '275 g', q: 275, u: 'g', price: 3.99, c: 'zoek' },
    'Gemalen lijnzaad':             { p: 'AH Lijnzaad gebroken', size: '500 g', q: 500, u: 'g', price: 2.99, c: 'zoek' },
    'Banaan':                       { p: 'AH Bananen tros', size: '±5 stuks', q: 5, u: 'st', price: 1.45, c: 'onzeker' },
    'Appel':                        { p: 'AH Elstar zak', size: '1,5 kg (±8 stuks)', q: 8, u: 'st', price: 2.39, c: 'zoek' },
    'Wortel':                       { p: 'AH Winterpeen', size: '1 kg (±8 stuks)', q: 8, u: 'st', price: 1.39, c: 'zoek' },
    'Paprika':                      { p: 'AH Paprika mix', size: '3 stuks', q: 3, u: 'st', price: 1.99, c: 'onzeker' },
    'Ui':                           { p: 'AH Gele uien', size: '1 kg (±8 stuks)', q: 8, u: 'st', price: 0.99, c: 'zoek' },
    'Komkommer':                    { p: 'AH Komkommer', size: '1 stuk', q: 1, u: 'st', price: 0.99, c: 'zoek' },
    'Linzen (blik)':                { p: 'AH Terra Linzen', size: '400 g (±240 g uitgelekt)', q: 240, u: 'g', price: 1.09, c: 'zoek' },
    'Kidneybonen (blik)':           { p: 'AH Terra Kidneybonen', size: '400 g (±240 g uitgelekt)', q: 240, u: 'g', price: 0.65, c: 'onzeker' },
    'Tomatenblokjes (blik)':        { p: 'AH Tomatenblokjes', size: '400 g', q: 400, u: 'g', price: 0.55, c: 'zoek' },
    'Volkorenrijst':                { p: 'AH Zilvervliesrijst', size: '1 kg', q: 1000, u: 'g', price: 1.49, c: 'zoek' },
    'Volkorenpasta':                { p: 'AH Biologisch Volkoren spaghetti', size: '500 g', q: 500, u: 'g', price: 0.85, c: 'zoek' },
    'Koolzaadolie':                 { p: 'AH Slaolie (raapzaad)', size: '1 l', q: 1000, u: 'ml', price: 3.29, c: 'zoek' },
    'Pindakaas (100% pinda)':       { p: 'AH Terra 100% pindakaas naturel', size: '1 kg', q: 1000, u: 'g', price: 5.69, c: 'zoek' },
    'Amandelen':                    { p: 'AH Terra Ongebrande amandelen', size: '200 g', q: 200, u: 'g', price: 2.29, c: 'onzeker' },
    'Walnoten':                     { p: 'AH Terra Walnoten ongebrand', size: '200 g', q: 200, u: 'g', price: 2.49, c: 'onzeker' },
    'Pangasiusfilet (diepvries, ASC)': { p: 'AH Pangasiusfilet (diepvries)', size: '675 g', q: 675, u: 'g', price: 4.49, c: 'onzeker' },
    'Makreel in tomatensaus':       { p: 'Statesman Makreel in tomatensaus', size: '125 g', q: 1, u: 'blik', price: 1.29, c: 'onzeker' },
    'Magere melk':                  { p: 'AH Magere melk', size: '1 l', q: 1000, u: 'ml', price: 1.19, c: 'zoek' },
  };
  // omrekening van lepels naar gram/ml
  const CONV = { el: { g: 12, ml: 13 }, tl: { g: 4, ml: 4.5 } };
  const CONV_SPECIFIC = { 'Gemalen lijnzaad': { el: 7 }, 'Pindakaas (100% pinda)': { el: 15 } };

  return { AH, CONV, CONV_SPECIFIC, LOGBOEK, SLOTS, TRAINING_DEFAULT, TRAINING_TYPES, CAT, PRICES, BASE_VARIANTS, EXTRAS };
})();
