'use strict';
/* Générateur de titres et descriptions qui vendent (100 % local, pas d'IA externe) */

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
function sample(r, arr, n) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const CATS = {
  tech: {
    kw: ['bluetooth', 'écouteur', 'écouteurs', 'ecouteur', 'earphone', 'earbuds', 'headphone', 'casque', 'chargeur', 'charger', 'câble', 'cable', 'usb', 'power bank', 'batterie externe', 'speaker', 'enceinte', 'haut-parleur', 'smartwatch', 'montre connectée', 'gadget', 'caméra', 'camera', 'projecteur', 'projector', 'clavier', 'keyboard', 'souris', 'mouse', 'téléphone', 'phone', 'tablette', 'wifi', 'sans fil', 'wireless', 'led', 'tws', 'gaming'],
    hooks: ['la technologie qui simplifie votre quotidien, sans compromis.', 'performance, design et simplicité réunis dans un seul appareil.', 'l’accessoire high-tech que vous ne quitterez plus.'],
    benefits: ['Prise en main immédiate : c’est prêt en quelques secondes', 'Design compact et léger, il se glisse partout', 'Composants fiables pensés pour durer', 'Compatible avec la plupart de vos appareils', 'Des performances au rendez-vous, jour après jour', 'Une finition soignée qui fait la différence']
  },
  beaute: {
    kw: ['maquillage', 'makeup', 'make-up', 'cils', 'lash', 'ongle', 'ongles', 'nail', 'vernis', 'skin', 'peau', 'visage', 'face', 'sérum', 'serum', 'crème', 'cream', 'cheveux', 'hair', 'pinceau', 'pinceaux', 'massage', 'masseur', 'beauté', 'beauty', 'cosmétique', 'lisseur', 'boucleur', 'épilateur', 'manucure'],
    hooks: ['votre nouveau rituel beauté, simple et efficace.', 'prenez soin de vous comme vous le méritez.', 'l’allié beauté qui va transformer votre routine.'],
    benefits: ['Un résultat soigné en quelques minutes', 'Facile à utiliser, même pour les débutant·e·s', 'Format pratique, à la maison comme en voyage', 'Un vrai moment de bien-être au quotidien', 'Un objet élégant qui trouve sa place dans votre salle de bain', 'Le cadeau parfait pour se faire plaisir ou faire plaisir']
  },
  mode: {
    kw: ['robe', 'dress', 't-shirt', 'tshirt', 'shirt', 'chemise', 'pantalon', 'pants', 'jean', 'jeans', 'veste', 'jacket', 'manteau', 'coat', 'sweat', 'hoodie', 'pull', 'sweater', 'chaussure', 'chaussures', 'shoes', 'sneakers', 'baskets', 'bottes', 'boots', 'sac', 'bag', 'casquette', 'chapeau', 'hat', 'lunettes', 'sunglasses', 'écharpe', 'scarf', 'ceinture', 'belt', 'legging', 'short', 'jupe', 'skirt', 'femme', 'homme', 'women', 'men'],
    hooks: ['le style sans effort, le confort en plus.', 'la pièce qui va twister toutes vos tenues.', 'élégance et confort au quotidien.'],
    benefits: ['Une coupe flatteuse pour toutes les silhouettes', 'Agréable à porter toute la journée', 'Facile à associer avec votre garde-robe', 'Des finitions soignées dans les moindres détails', 'Idéal pour le quotidien comme pour les sorties', 'Entretien facile']
  },
  bijoux: {
    kw: ['collier', 'necklace', 'bracelet', 'bague', 'ring', 'boucles d’oreilles', "boucles d'oreilles", 'earrings', 'pendentif', 'pendant', 'montre', 'watch', 'bijou', 'bijoux', 'jewelry', 'jewellery', 'chaîne', 'chain', 'perle', 'pearl', 'zircon', 'cristal', 'plaqué or', 'acier inoxydable'],
    hooks: ['le détail qui illumine chaque tenue.', 'un bijou qui raconte votre style.', 'l’élégance intemporelle, à porter chaque jour.'],
    benefits: ['Une brillance qui attire les regards', 'Un design raffiné, du quotidien aux grandes occasions', 'Léger et confortable à porter', 'Une idée cadeau qui fait toujours plaisir', 'Se marie avec toutes vos tenues', 'Une finition soignée et élégante']
  },
  maison: {
    kw: ['cuisine', 'kitchen', 'déco', 'deco', 'décoration', 'decor', 'coussin', 'cushion', 'rangement', 'storage', 'organisateur', 'organizer', 'salle de bain', 'bathroom', 'ustensile', 'ustensiles', 'tapis', 'rug', 'rideau', 'curtain', 'lampe', 'lamp', 'veilleuse', 'vase', 'plante', 'mug', 'tasse', 'nettoyage', 'cleaning', 'maison', 'home', 'mural', 'étagère', 'shelf', 'bougie', 'candle', 'humidificateur', 'diffuseur'],
    hooks: ['le petit plus qui change tout à la maison.', 'un intérieur plus pratique et plus beau, en un geste.', 'l’objet malin dont votre maison avait besoin.'],
    benefits: ['Gain de place et de temps au quotidien', 'Un design moderne qui s’intègre à tous les intérieurs', 'Installation et utilisation ultra simples', 'Des matériaux durables et faciles à entretenir', 'Tellement pratique qu’on se demande comment on faisait avant', 'Une idée cadeau originale pour une crémaillère']
  },
  animaux: {
    kw: ['chien', 'chiens', 'dog', 'chat', 'chats', 'cat', 'chiot', 'puppy', 'chaton', 'kitten', 'animal', 'animaux', 'pet', 'laisse', 'leash', 'harnais', 'harness', 'gamelle', 'litière', 'griffoir', 'aquarium', 'oiseau'],
    hooks: ['parce que votre compagnon mérite ce qu’il y a de mieux.', 'pour encore plus de moments de bonheur avec votre boule de poils.', 'le confort de votre animal, la tranquillité pour vous.'],
    benefits: ['Pensé pour le confort et le bien-être de votre animal', 'Facile à nettoyer et à entretenir', 'Des matériaux résistants, même pour les plus joueurs', 'Simple à utiliser au quotidien', 'Un design mignon et pratique', 'Idéal à la maison comme en balade']
  },
  sport: {
    kw: ['fitness', 'yoga', 'gym', 'sport', 'vélo', 'velo', 'bike', 'cyclisme', 'running', 'course', 'musculation', 'haltère', 'haltères', 'dumbbell', 'élastique', 'gourde', 'camping', 'randonnée', 'hiking', 'outdoor', 'tente', 'pêche', 'fishing', 'natation', 'football', 'tennis', 'boxe'],
    hooks: ['repoussez vos limites, à votre rythme.', 'l’équipement qui booste chacune de vos séances.', 'bougez plus, plus facilement.'],
    benefits: ['Conçu pour suivre vos efforts, séance après séance', 'Léger et facile à transporter', 'Une prise en main confortable', 'Idéal pour débutants comme confirmés', 'Robuste et pensé pour durer', 'À la maison, en salle ou en extérieur']
  },
  auto: {
    kw: ['voiture', 'car', 'auto', 'moto', 'motorcycle', 'véhicule', 'vehicle', 'volant', 'pare-brise', 'tableau de bord', 'dashcam'],
    hooks: ['des trajets plus agréables, à chaque fois.', 'l’accessoire malin pour votre véhicule.', 'la route n’a jamais été aussi pratique.'],
    benefits: ['Installation rapide, sans outils compliqués', 'Compatible avec la plupart des véhicules', 'Un design discret qui s’intègre à votre habitacle', 'Des matériaux solides pour un usage quotidien', 'Le cadeau idéal pour les passionnés d’auto', 'L’essentiel toujours à portée de main']
  },
  enfant: {
    kw: ['bébé', 'bebe', 'baby', 'enfant', 'enfants', 'kids', 'children', 'jouet', 'jouets', 'toy', 'toys', 'puzzle', 'peluche', 'plush', 'éducatif', 'educational', 'montessori', 'poupée', 'doll'],
    hooks: ['des sourires garantis pour les petits… et les grands.', 'apprendre et s’amuser, enfin réunis.', 'le cadeau qui va faire briller leurs yeux.'],
    benefits: ['Stimule la créativité et l’imagination', 'Des couleurs vives et un design attractif', 'Facile à prendre en main pour les petites mains', 'Pour jouer seul ou à plusieurs', 'Une idée cadeau parfaite pour les anniversaires et les fêtes', 'Facile à ranger et à emporter']
  },
  general: {
    kw: [],
    hooks: ['le produit malin dont vous ne pourrez plus vous passer.', 'simple, pratique et terriblement efficace.', 'la petite trouvaille qui change le quotidien.'],
    benefits: ['Simple à utiliser dès la première fois', 'Un design moderne et soigné', 'Des matériaux de qualité pensés pour durer', 'Pratique au quotidien', 'Compact et facile à ranger', 'Une idée cadeau qui fait plaisir']
  }
};

const TONES = {
  pro: {
    h: { why: '✨ Pourquoi vous allez l’adorer', specs: '📋 Caractéristiques', variants: '🎨 Disponible en', ship: '🚚 Livraison & garantie' },
    bullet: () => '✔ ',
    prefix: null,
    closing: ['Commandez dès aujourd’hui et profitez de notre garantie satisfait ou remboursé.', 'Ajoutez-le à votre panier : vous vous demanderez comment vous faisiez sans.', 'Rejoignez nos clients satisfaits et commandez le vôtre dès maintenant.']
  },
  fun: {
    h: { why: '😍 Pourquoi c’est un must', specs: '🔍 Les détails', variants: '🌈 Les options', ship: '📦 Livraison & tranquillité' },
    bullet: (r) => pick(r, ['🔥', '⚡', '💯', '🙌', '✅', '🚀']) + ' ',
    prefix: ['Stop, on a trouvé la pépite ! ', 'Coup de cœur assuré ! ', 'Attention, produit addictif ! '],
    closing: ['Le stock part vite… ne passez pas à côté ! 🛒', 'Faites-vous plaisir, vous le méritez 😉', 'Une fois adopté, impossible de s’en passer. À vous de jouer ! 🎉']
  },
  luxe: {
    h: { why: 'L’essentiel', specs: 'Caractéristiques', variants: 'Déclinaisons', ship: 'Livraison & service' },
    bullet: () => '',
    prefix: null,
    closing: ['Une pièce choisie avec exigence, pour celles et ceux qui apprécient les belles choses.', 'Offrez-vous l’exception.', 'Le raffinement se cache dans les détails.']
  }
};

const JUNK = /(^|[^\p{L}\p{N}])(?:20[12]\d|new|neuf|nouveau|nouvelle|nouveaux|hot|sale|vente chaude|vente|free shipping|livraison gratuite|dropshipping|drop shipping|wholesale|en gros|haute qualité|high quality|top quality|best seller|bestseller|offre spéciale|promotion|promo|cheap|pas cher|original|genuine|authentique|global version|version globale|arrivée)(?=$|[^\p{L}\p{N}])/giu;

function cleanTitle(raw) {
  let t = String(raw || '')
    .replace(/\s*[-|–]\s*AliExpress.*$/i, '')
    .replace(/[【】\[\]{}|_*#~"“”]/g, ' ')
    .replace(JUNK, '$1')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
  const seen = new Set();
  t = t.split(' ').filter((w) => {
    const k = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (!k) return true;
    if (k.length > 2 && seen.has(k)) return false;
    seen.add(k);
    return true;
  }).join(' ');
  t = t.replace(/(,\s*){2,}/g, ', ').replace(/^[,.\-\s]+|[,.\-\s]+$/g, '');
  if (t.length > 70) {
    t = t.slice(0, 70);
    const sp = t.lastIndexOf(' ');
    if (sp > 40) t = t.slice(0, sp);
    t = t.replace(/[,\s\-]+$/, '');
  }
  return t ? cap(t) : 'Nouveau produit';
}

const DANGLING = /^(à|a|au|aux|de|du|des|d’|d'|la|le|les|l’|l'|en|et|avec|pour|sur|par|un|une|with|and|for|the|of)$/i;

function shortName(title) {
  const words = title.split(',')[0].split(' ').filter(Boolean).slice(0, 6);
  while (words.length > 2 && DANGLING.test(words[words.length - 1])) words.pop(); // pas de "… coulée à la"
  return words.join(' ');
}

function detectCat(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  let best = 'general', score = 0;
  for (const [name, c] of Object.entries(CATS)) {
    let s = 0;
    for (const k of c.kw) {
      const re = new RegExp('(^|[^\\p{L}])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}])', 'iu');
      if (re.test(t)) s++;
    }
    if (s > score) { score = s; best = name; }
  }
  return best;
}

const SPEC_SKIP = /marque|brand|origine|origin|mod[eè]le|model|certif|chemical|chimique|choice|^cn$|semi|type de vente|sale type|numéro|number|upc|ean|acg|emballage|packag|^état$|condition|est électrique|is electric|télécommande|remote control|dropship|stock/i;
const SPEC_JUNK_VAL = /^(no|non|yes|oui|aucun|aucune|none|null|autre|other|n\/a|-)$|null|stock/i;

function generateCopy(src, tone, seed, settings) {
  const r = rng(hashStr(src.id) + (seed || 0) * 7919);
  const T = TONES[tone] || TONES.pro;
  const cat = CATS[detectCat(src.title + ' ' + (src.specs || []).map((s) => s.join(' ')).join(' '))];
  const title = cleanTitle(src.title);
  const nom = shortName(title);
  const L = [];

  const hook = cap(pick(r, cat.hooks));
  L.push(`**${nom}** — ${T.prefix ? pick(r, T.prefix) : ''}${hook}`);
  L.push('');
  L.push('## ' + T.h.why);
  sample(r, cat.benefits, 4).forEach((b) => L.push('- ' + T.bullet(r) + b));

  const specs = (src.specs || []).filter(([k, v]) => k && v && !SPEC_SKIP.test(k) && v.length < 80 && !SPEC_JUNK_VAL.test(v.trim())).slice(0, 8);
  if (specs.length) {
    L.push('', '## ' + T.h.specs);
    specs.forEach(([k, v]) => L.push(`- **${k}** : ${v}`));
  }

  const vars = (src.variants || []).filter((v) => v.values.length > 1).slice(0, 2);
  if (vars.length) {
    L.push('', '## ' + T.h.variants);
    vars.forEach((v) => {
      const shown = v.values.slice(0, 8).join(', ');
      const more = v.values.length > 8 ? ` + ${v.values.length - 8} autres` : '';
      L.push(`- **${v.name}** : ${shown}${more}`);
    });
  }

  L.push('', '## ' + T.h.ship);
  [settings.shippingText, settings.returnText, 'Paiement 100 % sécurisé', 'Service client à votre écoute 7j/7']
    .filter(Boolean)
    .forEach((x) => L.push('- ' + T.bullet(r) + x));

  L.push('', pick(r, T.closing));
  return { title, description: L.join('\n') };
}

// "## titre", "- puce", "**gras**" -> HTML (pour l'aperçu et Shopify)
function mdToHtml(src) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const out = [];
  let list = null, para = [];
  const flushP = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
  const flushL = () => { if (list) { out.push('<ul>' + list.map((li) => '<li>' + inline(li) + '</li>').join('') + '</ul>'); list = null; } };
  for (const raw of String(src || '').split('\n')) {
    const l = raw.trim();
    if (!l) { flushP(); flushL(); continue; }
    if (l.startsWith('## ')) { flushP(); flushL(); out.push('<h3>' + inline(l.slice(3)) + '</h3>'); }
    else if (/^[-•]\s+/.test(l)) { flushP(); (list = list || []).push(l.replace(/^[-•]\s+/, '')); }
    else { flushL(); para.push(l); }
  }
  flushP(); flushL();
  return out.join('\n');
}

function mdToText(src) {
  // "- ✔ texte" garde son emoji comme puce ; "- texte" devient "• texte"
  return String(src || '').replace(/^##\s+/gm, '').replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^-\s+(?=[\p{L}\p{N}])/gmu, '• ').replace(/^-\s+/gm, '');
}
