'use strict';
/* DropBoost — interface. Les produits restent dans ce navigateur (IndexedDB). */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');

/* ---------- Réglages et connexions (navigateur) ---------- */
const DEFAULT_SETTINGS = {
  shopName: 'Ma Boutique', multiplier: 2.5, compareRatio: 1.7, feePct: 2.9, feeFixed: 0.3, adsPerSale: 0, tone: 'pro',
  shippingText: 'Livraison suivie offerte (7 à 15 jours ouvrés)', returnText: 'Satisfait ou remboursé sous 14 jours',
  city: '', postalCode: '', myStyle: ''
};
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage plein ou bloqué */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* rien */ } }
};
let settings = { ...DEFAULT_SETTINGS, ...ls.get('db_settings', {}) };
const saveSettings = () => ls.set('db_settings', settings);
const getAuth = (pf) => ls.get('db_auth_' + pf, null);
let STATUS = { ai: null, etsy: false, ebay: false, currency: 'EUR' };

/* ---------- Produits (IndexedDB : les photos IA prennent de la place) ---------- */
const DB = (() => {
  let opening;
  const open = () => opening || (opening = new Promise((res, rej) => {
    const r = indexedDB.open('dropboost', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('products', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('products', mode);
      const req = fn(t.objectStore('products'));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    all: () => run('readonly', (s) => s.getAll()),
    get: (id) => run('readonly', (s) => s.get(id)),
    put: (p) => run('readwrite', (s) => s.put(p)),
    del: (id) => run('readwrite', (s) => s.delete(id))
  };
})();

/* ---------- Outils ---------- */
const money = (v) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(v || 0);
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), Math.max(2600, msg.length * 70));
}
async function api(path, data) {
  const r = await fetch(path, data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  let j = {};
  try { j = await r.json(); } catch { /* réponse vide */ }
  if (r.status === 401 && /mot de passe/i.test(j.error || '')) { location.href = '/login'; throw new Error(j.error); }
  if (!r.ok) throw new Error(j.error || (r.status >= 500 ? 'Le serveur se réveille ou a un souci, réessaie dans 30 secondes.' : 'Erreur ' + r.status));
  return j;
}
// Appel avec la connexion Etsy/eBay du navigateur ; le serveur renvoie la connexion rafraîchie
async function platformApi(pf, path, data = {}) {
  const res = await api(path, { ...data, auth: getAuth(pf) });
  if (res.auth) ls.set('db_auth_' + pf, { ...getAuth(pf), ...res.auth });
  return res;
}
const imgSrc = (u) => (/^(data|blob):/.test(u) ? u : '/api/img?u=' + encodeURIComponent(u));
const isAtelier = () => STATUS.mode === 'atelier';
async function toJpeg(u, max = 1600, q = 0.9) {
  const r = await fetch(imgSrc(u));
  if (!r.ok) throw new Error('Photo inaccessible');
  const bmp = await createImageBitmap(await r.blob());
  const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * sc);
  c.height = Math.round(bmp.height * sc);
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
// Copie du texte ; la description part aussi en HTML pour garder la mise en forme quand on la colle
async function copyText(text, html) {
  try {
    if (html && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })]);
    } else {
      await navigator.clipboard.writeText(text);
    }
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
function flash(btn, ok) {
  const label = btn.dataset.label || (btn.dataset.label = btn.textContent);
  btn.textContent = ok ? 'Copié ✓' : 'Copie impossible';
  btn.classList.toggle('copied', ok);
  setTimeout(() => { btn.textContent = label; btn.classList.remove('copied'); }, 1600);
}
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'produit';

/* ---------- Prix ---------- */
const psych = (x) => (x <= 0 ? 0 : Math.round((Math.floor(x) + 0.99) * 100) / 100);
function pricing(e) {
  const base = (+e.cost || 0) + (+e.shipping || 0);
  const auto = psych(base * (+e.multiplier || settings.multiplier));
  const price = e.priceOverride != null && !isNaN(e.priceOverride) ? +e.priceOverride : auto;
  const compare = psych(price * settings.compareRatio);
  const fees = price > 0 ? (price * settings.feePct) / 100 + settings.feeFixed : 0;
  const profit = price - base - fees - settings.adsPerSale;
  return { base, price, compare, fees, profit, margin: price > 0 ? (profit / price) * 100 : 0, discount: compare > price ? Math.round((1 - price / compare) * 100) : 0 };
}

/* ---------- Photos IA : le prompt ---------- */
const STYLES = {
  studio: { label: 'Studio', hint: 'Fond blanc pro', scene: 'a clean professional e-commerce packshot on a seamless pure white background, soft diffused studio lighting, a subtle natural shadow under the product, centered composition' },
  lifestyle: { label: 'En situation', hint: 'Utilisé dans la vraie vie', scene: null },
  premium: { label: 'Premium', hint: 'Fond sombre, luxe', scene: 'a luxurious high-end advertising photo on a dark elegant background, dramatic rim lighting, subtle glossy reflections, premium brand campaign look' },
  pastel: { label: 'Pastel', hint: 'Coloré, style Insta', scene: 'a trendy social-media style photo on a soft pastel colored background with a few simple geometric props, bright even lighting, modern minimal aesthetic' },
  nature: { label: 'Naturel', hint: 'Bois, lumière du jour', scene: 'a warm natural photo on a light wooden surface near a window, soft daylight, a few tasteful natural props such as plants or linen, cozy authentic mood' }
};
const SCENES = {
  tech: 'on a modern minimalist desk next to a laptop and a coffee cup, natural daylight, lifestyle tech photography',
  beaute: 'on a bright marble bathroom counter with soft towels and greenery, fresh clean beauty photography',
  mode: 'worn by a model in a bright urban street setting, natural light, fashion lookbook photography',
  bijoux: 'worn by a model, elegant close-up, soft warm light, jewelry campaign photography',
  maison: 'in a beautiful bright Scandinavian interior where it is naturally used, natural daylight, interior design photography',
  animaux: 'being enjoyed by a happy dog or cat in a cozy bright home, natural light, pet lifestyle photography',
  sport: 'being used by an athletic person outdoors at golden hour, dynamic sports lifestyle photography',
  auto: 'installed inside a modern clean car interior, natural light, automotive lifestyle photography',
  enfant: 'in a bright colorful kids playroom, cheerful natural light, family lifestyle photography',
  general: 'in a bright modern home setting where it is naturally used, natural daylight, lifestyle product photography'
};
// "Mon style" : le prompt perso des Réglages, plus une consigne fixe pour ne jamais changer le produit
const hasMyStyle = () => !!(settings.myStyle || '').trim();
const defaultStyle = () => (hasMyStyle() ? 'mine' : 'studio');
const styleChoices = () => [
  ...(hasMyStyle() ? [['mine', 'Mon style', 'Ton prompt perso']] : []),
  ...Object.entries(STYLES).map(([k, v]) => [k, v.label, v.hint])
];

function buildPrompt(src, style) {
  if (style === 'mine' && hasMyStyle()) {
    return `${settings.myStyle.trim()}

Use the exact product shown in the reference image and keep it 100% identical: same shape, colors, materials, proportions, pattern and details. Show it only once. Do not add any text, price, badge or watermark.

Product: ${cleanTitle(src.title)}`;
  }
  const scene = (STYLES[style] && STYLES[style].scene) || SCENES[detectCat(src.title)];
  return `Create a new professional product photo of the exact product shown in the reference image: ${scene}.

Keep the product 100% identical to the reference: same shape, colors, materials, proportions, pattern and details. Show it only once.
Remove any text, logos, stickers, watermarks or collage layout from the original photo. Do not add any text, price, badge or watermark.
Square format, photorealistic, sharp focus, high resolution, appealing composition for an online shop.

Product: ${cleanTitle(src.title)}`;
}

/* ---------- Nouveau produit ---------- */
// Les notes du créateur (matières, taille, fabrication) passent juste après l'accroche
function withNotes(description, notes) {
  if (!notes || !notes.trim()) return description;
  const i = description.indexOf('\n\n');
  return i < 0 ? description + '\n\n' + notes.trim() : description.slice(0, i) + '\n\n' + notes.trim() + description.slice(i);
}

function newEdit(src, cost, shipping) {
  const g = generateCopy(src, settings.tone, 0, settings);
  return {
    title: g.title, description: withNotes(g.description, src.notes), tone: settings.tone, seed: 0,
    cost, shipping, multiplier: settings.multiplier, priceOverride: null,
    ai: { style: defaultStyle(), prompt: buildPrompt(src, defaultStyle()), ref: 0, count: 2 },
    gen: [], photos: (src.images || []).slice(0, 8), etsy: null, ebay: null
  };
}

/* ---------- Vue : accueil ---------- */
const myProducts = async () => (await DB.all())
  .filter((p) => (p.source.kind === 'atelier') === isAtelier())
  .sort((a, b) => b.createdAt - a.createdAt);

async function viewHome(prefill) {
  if (isAtelier()) return viewAtelierHome();
  const list = await myProducts();
  app.innerHTML = `<div class="view home">
    <section class="card hero">
      <div class="hero-text">
        <h1>Nouvelle fiche produit</h1>
        <p>Colle le lien d’un produit AliExpress. DropBoost récupère le titre et les photos ; ensuite tu crées de nouvelles photos avec l’IA, tu ajustes le prix et tu publies sur eBay ou Etsy.</p>
      </div>
      <form id="newForm" class="new-form" novalidate>
        <label>Lien du produit AliExpress<input id="nUrl" type="text" inputmode="url" placeholder="https://fr.aliexpress.com/item/…" autocomplete="off"></label>
        <div class="grid2">
          <label>Prix sur AliExpress (€)<input id="nCost" type="number" step="0.01" min="0" placeholder="ex : 6,42"></label>
          <label>Livraison AliExpress (€)<input id="nShip" type="number" step="0.01" min="0" value="0"></label>
        </div>
        <button class="primary big" type="submit" id="nGo">Créer la fiche →</button>
        <p class="form-err" id="nErr" role="alert"></p>
      </form>
    </section>
    <section class="card ext">
      <div class="ext-text">
        <h2>🚀 Extension AliExpress</h2>
        <p>Un bouton « Envoyer à DropBoost » apparaît sur chaque produit AliExpress : un clic, et la fiche se crée ici avec le prix.</p>
        <a class="btn primary" href="/extension.zip" download>⬇ Télécharger l’extension</a>
      </div>
      <ol class="ext-steps">
        <li>Dézippe le fichier téléchargé.</li>
        <li>Ouvre <code>opera://extensions</code> (Opera GX) ou <code>chrome://extensions</code> (Chrome) et active le <b>mode développeur</b>.</li>
        <li>Clique sur <b>Charger l’extension non empaquetée</b> et choisis le dossier <b>DropBoost</b>.</li>
      </ol>
    </section>
    <section>
      <h2 class="section-h">Mes produits <span>${list.length || ''}</span></h2>
      ${list.length ? `<div class="grid">${list.map(card).join('')}</div>`
        : '<p class="empty">Aucun produit pour l’instant. Ta première fiche apparaîtra ici.</p>'}
    </section>
  </div>`;

  $('#newForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('#nErr'), btn = $('#nGo');
    const url = $('#nUrl').value.trim(), cost = parseFloat($('#nCost').value), ship = parseFloat($('#nShip').value) || 0;
    err.textContent = '';
    if (!url) { err.textContent = 'Colle le lien du produit.'; return; }
    if (!(cost > 0)) { err.textContent = 'Indique le prix affiché sur AliExpress (il sert à calculer ton bénéfice).'; return; }
    btn.disabled = true;
    btn.textContent = 'Lecture du produit…';
    try {
      const src = await api('/api/import', { url });
      const old = await DB.get(src.id);
      const p = old ? { ...old, source: src } : { id: src.id, source: src, createdAt: Date.now(), edit: newEdit(src, cost, ship) };
      if (old) { p.edit.cost = cost; p.edit.shipping = ship; }
      await DB.put(p);
      location.hash = '#/p/' + src.id;
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = 'Créer la fiche →';
    }
  });

  // Produit envoyé par l'extension : on remplit et, si le prix est connu, on crée la fiche directement
  if (prefill && prefill.url) {
    $('#nUrl').value = prefill.url;
    if (prefill.ship) $('#nShip').value = prefill.ship;
    if (parseFloat(prefill.cost) > 0) {
      $('#nCost').value = prefill.cost;
      $('#newForm').requestSubmit();
    } else {
      $('#nErr').textContent = 'Produit reçu ! Le prix n’a pas pu être lu : tape-le puis clique sur « Créer la fiche ».';
      $('#nCost').focus();
    }
  }
}

/* ---------- Vue : accueil de l'Atelier (créations faites main) ---------- */
async function viewAtelierHome() {
  const list = await myProducts();
  app.innerHTML = `<div class="view home">
    <section class="card hero">
      <div class="hero-text">
        <h1>Nouvelle création</h1>
        <p>Ajoute les photos de ton produit fait main. L’IA les met en valeur sans changer ta création, le site écrit la description et calcule le prix, puis tu publies sur Etsy.</p>
      </div>
      <form id="newForm" class="new-form" novalidate>
        <label>Nom du produit<input id="aName" type="text" placeholder="ex : Bougie parfumée à la vanille" autocomplete="off"></label>
        <label>Photos de ta création<input id="aPhotos" type="file" accept="image/*" multiple></label>
        <div class="previews" id="aPrev"></div>
        <label>Quelques mots dessus <small>matières, taille, fabrication… (facultatif)</small><textarea id="aNotes" rows="3" placeholder="ex : Cire de soja coulée à la main, mèche en coton, 200 g, environ 40 h de combustion."></textarea></label>
        <div class="grid2">
          <label>Coût de fabrication (€)<input id="aCost" type="number" step="0.01" min="0" placeholder="ex : 4,50"></label>
          <label>Frais d’envoi (€)<input id="aShip" type="number" step="0.01" min="0" value="0"></label>
        </div>
        <button class="primary big" type="submit" id="aGo">Créer la fiche →</button>
        <p class="form-err" id="aErr" role="alert"></p>
      </form>
    </section>
    <section>
      <h2 class="section-h">Mes créations <span>${list.length || ''}</span></h2>
      ${list.length ? `<div class="grid">${list.map(card).join('')}</div>`
        : '<p class="empty">Aucune création pour l’instant. Ta première fiche apparaîtra ici.</p>'}
    </section>
  </div>`;

  let files = [];
  $('#aPhotos').addEventListener('change', (ev) => {
    files = [...ev.target.files].filter((f) => f.type.startsWith('image/')).slice(0, 10);
    $('#aPrev').innerHTML = files.map((f) => `<img src="${URL.createObjectURL(f)}" alt="">`).join('');
  });

  $('#newForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('#aErr'), btn = $('#aGo');
    const name = $('#aName').value.trim(), cost = parseFloat($('#aCost').value), ship = parseFloat($('#aShip').value) || 0;
    err.textContent = '';
    if (!name) { err.textContent = 'Donne un nom à ton produit.'; return; }
    if (!files.length) { err.textContent = 'Ajoute au moins une photo de ta création.'; return; }
    if (!(cost > 0)) { err.textContent = 'Indique ce que te coûte la fabrication (il sert à calculer ton bénéfice).'; return; }
    btn.disabled = true;
    btn.textContent = 'Préparation des photos…';
    try {
      const images = [];
      for (const f of files) {
        const url = URL.createObjectURL(f);
        images.push(await toJpeg(url, 1600, 0.9));
        URL.revokeObjectURL(url);
      }
      const id = 'a' + Date.now().toString(36);
      const src = { id, kind: 'atelier', url: '', title: name, images, notes: $('#aNotes').value.trim() };
      await DB.put({ id, source: src, createdAt: Date.now(), edit: newEdit(src, cost, ship) });
      location.hash = '#/p/' + id;
    } catch (e) {
      err.textContent = 'Impossible de lire ces photos : ' + e.message;
      btn.disabled = false;
      btn.textContent = 'Créer la fiche →';
    }
  });
}

function card(p) {
  const pr = pricing(p.edit), img = p.edit.photos[0] || p.source.images[0];
  const pub = [p.edit.ebay && 'eBay', p.edit.etsy && 'Etsy'].filter(Boolean);
  return `<a class="pcard" href="#/p/${encodeURIComponent(p.id)}">
    <div class="pimg">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}${pub.length ? `<span class="badge">En ligne · ${pub.join(' + ')}</span>` : ''}</div>
    <div class="pbody">
      <h3>${esc(p.edit.title)}</h3>
      <div class="pprices"><b>${money(pr.price)}</b><span class="${pr.profit > 0 ? 'pos' : 'neg'}">${pr.profit > 0 ? '+' : ''}${money(pr.profit)} / vente</span></div>
    </div>
  </a>`;
}

/* ---------- Vue : fiche produit ---------- */
async function viewProduct(id) {
  const p = await DB.get(id);
  if (!p || (p.source.kind === 'atelier') !== isAtelier()) { location.hash = '#/'; return; }
  const s = p.source, e = p.edit;
  let saveTimer;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => DB.put(p), 250); };

  const chips = (name, val, opts) => `<div class="chips" data-chips="${name}">${opts.map(([v, l, h]) =>
    `<button type="button" data-v="${v}" class="${val === v ? 'on' : ''}">${l}${h ? `<small>${h}</small>` : ''}</button>`).join('')}</div>`;

  app.innerHTML = `<div class="view product">
    <div class="crumbs"><a href="#/">← ${s.kind === 'atelier' ? 'Mes créations' : 'Mes produits'}</a>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">Voir sur AliExpress ↗</a>` : ''}</div>
    <div class="product-grid">
      <div class="steps">

        <section class="card step">
          <header><span class="num">1</span><div><h2>Photos</h2><p>${s.kind === 'atelier' ? 'Mets ta création en valeur : l’IA garde ton produit tel quel et change seulement le décor et la lumière.' : 'Crée de nouvelles photos à partir d’une photo du fournisseur : même produit, nouveau décor.'}</p></div></header>
          <div class="sub">Photo de référence</div>
          <div class="refs">${s.images.map((u, i) => `<button type="button" class="ref ${i === e.ai.ref ? 'on' : ''}" data-ref="${i}" aria-label="Photo ${i + 1}"><img src="${esc(u)}" alt="" loading="lazy"></button>`).join('')}</div>
          <div class="sub">Style</div>
          ${chips('style', e.ai.style, styleChoices())}
          ${hasMyStyle() ? '' : '<p class="hint">Astuce : colle ton propre prompt dans <a href="#/reglages">Réglages → Mon style de photos</a> pour que toutes tes photos aient le même style.</p>'}
          <details class="prompt"><summary>Voir ou modifier le prompt</summary>
            <textarea id="aiPrompt" rows="8">${esc(e.ai.prompt)}</textarea>
            <button type="button" class="link" data-act="prompt-reset">Remettre le prompt par défaut</button>
          </details>
          <div class="row">
            <button type="button" class="primary" data-act="ai-gen" ${STATUS.ai ? '' : 'disabled'}>✨ Générer les photos</button>
            <label class="inline">Nombre <select id="aiCount">${[1, 2, 3, 4].map((n) => `<option ${n === (e.ai.count || 2) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          </div>
          ${STATUS.ai ? '' : '<p class="note">L’IA n’est pas encore configurée : ajoute la clé GEMINI_API_KEY sur Render (voir Réglages).</p>'}
          <div class="ai-status" id="aiStatus" role="status"></div>
          <div class="sub">Photos de l’annonce <span class="muted">· clique pour ajouter ou retirer · ★ = photo principale</span></div>
          <div class="gallery" id="gallery"></div>
        </section>

        <section class="card step">
          <header><span class="num">2</span><div><h2>Titre et description</h2><p>Déjà écrits pour toi. Change le ton ou régénère si tu veux une autre version.</p></div></header>
          ${chips('tone', e.tone, [['pro', 'Pro'], ['fun', 'Fun 🔥'], ['luxe', 'Luxe']])}
          <label>Titre <small id="titleCount"></small><input type="text" id="fTitle" value="${esc(e.title)}" maxlength="140"></label>
          <label>Description<textarea id="fDesc" rows="12">${esc(e.description)}</textarea></label>
          <p class="hint">« ## » fait un intertitre, « - » une puce, **mot** met en gras.</p>
          <div class="row"><button type="button" class="ghost" data-act="regen">↻ Autre version</button></div>
        </section>

        <section class="card step">
          <header><span class="num">3</span><div><h2>Prix</h2><p>Le prix de vente est calculé pour que tu gagnes de l’argent, frais compris.</p></div></header>
          <div class="grid2">
            <label>${s.kind === 'atelier' ? 'Coût de fabrication (€)' : 'Prix AliExpress (€)'}<input type="number" step="0.01" min="0" id="fCost" value="${e.cost}"></label>
            <label>${s.kind === 'atelier' ? 'Frais d’envoi (€)' : 'Livraison AliExpress (€)'}<input type="number" step="0.01" min="0" id="fShip" value="${e.shipping}"></label>
          </div>
          <label>Marge : prix × <b id="multVal"></b><input type="range" min="1.3" max="5" step="0.1" id="fMult" value="${e.multiplier}"></label>
          <label>Prix de vente (€)<span class="row tight"><input type="number" step="0.01" min="0" id="fPrice"><button type="button" class="ghost sm" data-act="price-auto">Auto</button></span></label>
          <div class="kpis" id="kpis"></div>
        </section>

        <section class="card step">
          <header><span class="num">4</span><div><h2>Publier</h2><p>L’annonce part directement sur ton compte, avec les photos, le texte et le prix.</p></div></header>
          <div class="publish" id="publish"></div>
          <div class="manual">
            <div class="sub">Ou publier à la main <span class="muted">· sur n’importe quel site (Vinted, Leboncoin, Shopify…)</span></div>
            <div class="row">
              <button type="button" class="ghost" data-act="copy-title">Copier le titre</button>
              <button type="button" class="ghost" data-act="copy-desc">Copier la description</button>
              <button type="button" class="ghost" data-act="copy-price">Copier le prix</button>
              <button type="button" class="primary" data-act="dl-photos">⬇ Télécharger les photos</button>
            </div>
          </div>
          <div class="row"><button type="button" class="link danger" data-act="delete">Supprimer ce produit</button></div>
        </section>
      </div>

      <aside class="preview">
        <div class="preview-label">Aperçu de l’annonce</div>
        <div class="shop">
          <div class="shop-img"><img id="pvImg" alt=""></div>
          <div class="shop-info">
            <div class="shop-name">${esc(settings.shopName)}</div>
            <h3 id="pvTitle"></h3>
            <div class="price-row"><span class="price" id="pvPrice"></span><s id="pvCompare"></s><span class="off" id="pvOff"></span></div>
            <ul class="trust"><li>🚚 ${esc(settings.shippingText)}</li><li>↩️ ${esc(settings.returnText)}</li></ul>
            <div class="desc" id="pvDesc"></div>
          </div>
        </div>
      </aside>
    </div>
  </div>`;

  const root = $('.product');

  function renderGallery() {
    const all = [...e.gen, ...s.images.filter((u) => !e.gen.includes(u))];
    $('#gallery').innerHTML = all.map((u) => {
      const pos = e.photos.indexOf(u), isGen = e.gen.includes(u);
      return `<div class="tile ${pos >= 0 ? 'on' : ''}" data-photo="${esc(u)}" role="button" tabindex="0" aria-pressed="${pos >= 0}">
        <img src="${esc(u)}" alt="" loading="lazy">
        ${isGen ? '<span class="tag">IA</span>' : ''}
        ${pos >= 0 ? `<span class="pos">${pos === 0 ? '★' : pos + 1}</span>` : ''}
        ${pos > 0 ? '<button type="button" class="star" data-main title="Mettre en photo principale">★</button>' : ''}
        ${isGen ? '<button type="button" class="del" data-delgen title="Supprimer cette photo">✕</button>' : ''}
      </div>`;
    }).join('');
  }

  function renderPublish() {
    const block = (pf, name, cls) => {
      const configured = STATUS[pf], auth = getAuth(pf), done = e[pf];
      let action;
      if (!configured) action = `<p class="note">${name} n’est pas encore configuré sur le serveur. Voir Réglages.</p>`;
      else if (!auth) action = `<a class="btn ${cls}" href="/auth/${pf}/start">Connecter mon compte ${name}</a>`;
      else action = `<button type="button" class="btn ${cls}" data-act="pub-${pf}">${done ? 'Republier' : 'Publier'} sur ${name}</button>`;
      return `<div class="pf ${cls}"><div class="pf-head"><b>${name}</b>${done ? `<a href="${esc(done.url)}" target="_blank" rel="noopener" class="pill on">${done.state === 'draft' ? 'Brouillon' : 'En ligne'} · voir ↗</a>` : ''}</div>${action}</div>`;
    };
    // Etsy n'existe que dans l'Atelier (créations faites main) ; eBay que dans la boutique principale
    $('#publish').innerHTML = isAtelier() ? block('etsy', 'Etsy', 'etsy') : block('ebay', 'eBay', 'ebay');
  }

  function refresh() {
    const pr = pricing(e);
    $('#multVal').textContent = (+e.multiplier).toFixed(1);
    if (document.activeElement !== $('#fPrice')) $('#fPrice').value = pr.price.toFixed(2);
    const cls = pr.margin >= 40 ? 'good' : pr.margin >= 25 ? 'ok' : 'bad';
    $('#kpis').innerHTML = `
      <div class="kpi"><small>Coût total</small><b>${money(pr.base)}</b></div>
      <div class="kpi"><small>Frais de paiement</small><b>-${money(pr.fees + settings.adsPerSale)}</b></div>
      <div class="kpi big ${cls}"><small>Ton bénéfice par vente</small><b>${money(pr.profit)}</b><em>${pr.margin.toFixed(0)} % de marge · 10 ventes = ${money(pr.profit * 10)}</em></div>
      ${pr.margin < 25 ? '<p class="warn">Marge faible : monte le curseur.</p>' : ''}`;
    $('#titleCount').textContent = `${e.title.length} caractères${e.title.length > 80 ? ' (eBay coupe à 80)' : ''}`;
    $('#pvTitle').textContent = e.title;
    $('#pvPrice').textContent = money(pr.price);
    $('#pvCompare').textContent = pr.discount ? money(pr.compare) : '';
    $('#pvOff').textContent = pr.discount ? `-${pr.discount}%` : '';
    $('#pvDesc').innerHTML = mdToHtml(e.description);
    const main = e.photos[0];
    $('#pvImg').src = main || '';
    $('#pvImg').hidden = !main;
  }

  function regen(next) {
    if (next) e.seed = (e.seed || 0) + 1;
    const g = generateCopy(s, e.tone, e.seed, settings);
    e.title = g.title;
    e.description = withNotes(g.description, s.notes);
    $('#fTitle').value = e.title;
    $('#fDesc').value = e.description;
  }

  root.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'fTitle') e.title = t.value;
    else if (t.id === 'fDesc') e.description = t.value;
    else if (t.id === 'fCost') e.cost = parseFloat(t.value) || 0;
    else if (t.id === 'fShip') e.shipping = parseFloat(t.value) || 0;
    else if (t.id === 'fMult') { e.multiplier = parseFloat(t.value); e.priceOverride = null; }
    else if (t.id === 'fPrice') { const v = parseFloat(t.value); e.priceOverride = isNaN(v) ? null : v; }
    else if (t.id === 'aiPrompt') e.ai.prompt = t.value;
    else if (t.id === 'aiCount') e.ai.count = +t.value;
    else return;
    refresh();
    save();
  });

  root.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('.tile')) { ev.preventDefault(); ev.target.click(); }
  });

  root.addEventListener('click', async (ev) => {
    const chip = ev.target.closest('[data-chips] button');
    if (chip) {
      const group = chip.parentElement.dataset.chips, v = chip.dataset.v;
      $$('button', chip.parentElement).forEach((b) => b.classList.toggle('on', b === chip));
      if (group === 'style') { e.ai.style = v; e.ai.prompt = buildPrompt(s, v); $('#aiPrompt').value = e.ai.prompt; }
      if (group === 'tone') { e.tone = v; regen(false); }
      refresh(); save();
      return;
    }
    const ref = ev.target.closest('[data-ref]');
    if (ref) {
      e.ai.ref = +ref.dataset.ref;
      $$('.ref', root).forEach((b) => b.classList.toggle('on', b === ref));
      save();
      return;
    }
    const tile = ev.target.closest('[data-photo]');
    if (tile) {
      const u = tile.dataset.photo;
      if (ev.target.closest('[data-delgen]')) {
        e.gen = e.gen.filter((x) => x !== u);
        e.photos = e.photos.filter((x) => x !== u);
      } else if (ev.target.closest('[data-main]')) {
        e.photos = [u, ...e.photos.filter((x) => x !== u)];
      } else if (e.photos.includes(u)) {
        e.photos = e.photos.filter((x) => x !== u);
      } else {
        e.photos = [...e.photos, u];
      }
      renderGallery(); refresh(); save();
      return;
    }
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'prompt-reset') { e.ai.prompt = buildPrompt(s, e.ai.style); $('#aiPrompt').value = e.ai.prompt; save(); }
    if (act === 'regen') { regen(true); refresh(); save(); }
    if (act === 'price-auto') { e.priceOverride = null; refresh(); save(); }
    if (act === 'ai-gen') generate(ev.target.closest('button'));
    const btn = ev.target.closest('button');
    if (act === 'copy-title') flash(btn, await copyText(e.title));
    if (act === 'copy-desc') flash(btn, await copyText(mdToText(e.description), mdToHtml(e.description)));
    if (act === 'copy-price') flash(btn, await copyText(pricing(e).price.toFixed(2).replace('.', ',')));
    if (act === 'dl-photos') downloadPhotos(btn);
    if (act === 'pub-ebay') openEbay(p, () => { renderPublish(); save(); });
    if (act === 'pub-etsy') openEtsy(p, () => { renderPublish(); save(); });
    if (act === 'delete') confirmBox('Supprimer ce produit de DropBoost ? (Les annonces déjà publiées restent en ligne.)', async () => {
      await DB.del(p.id);
      location.hash = '#/';
    });
  });

  async function downloadPhotos(btn) {
    if (!e.photos.length) return toast('Choisis d’abord les photos de l’annonce (étape 1).');
    const label = btn.textContent;
    btn.disabled = true;
    try {
      for (let i = 0; i < e.photos.length; i++) {
        btn.textContent = `Photo ${i + 1}/${e.photos.length}…`;
        const a = document.createElement('a');
        a.href = await toJpeg(e.photos[i], 1600, 0.92);
        a.download = `${slug(e.title)}-${i + 1}.jpg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        await new Promise((r) => setTimeout(r, 400));
      }
      toast(`✅ ${e.photos.length} photo${e.photos.length > 1 ? 's' : ''} téléchargée${e.photos.length > 1 ? 's' : ''} (la 1re est la principale).`);
    } catch (err) {
      toast('❌ ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async function generate(btn) {
    const status = $('#aiStatus');
    const ref = s.images[e.ai.ref] || s.images[0];
    if (!ref) return toast('Il faut une photo de référence.');
    btn.disabled = true;
    status.className = 'ai-status busy';
    status.textContent = `Création de ${e.ai.count || 2} photo(s)… compte 20 à 60 secondes.`;
    try {
      const image = await toJpeg(ref, 1024);
      const res = await api('/api/generate', { image, prompt: e.ai.prompt, count: e.ai.count || 2 });
      const imgs = [];
      for (const d of res.images) imgs.push(await toJpeg(d, 1400, 0.9)); // plus léger à stocker
      const first = !e.gen.length;
      e.gen = [...imgs, ...e.gen].slice(0, 16);
      // Les nouvelles photos passent devant ; à la 1re génération, elles remplacent celles du fournisseur
      e.photos = first ? imgs : [...imgs, ...e.photos];
      status.className = 'ai-status ok';
      status.textContent = `✅ ${imgs.length} nouvelle${imgs.length > 1 ? 's' : ''} photo${imgs.length > 1 ? 's' : ''} ajoutée${imgs.length > 1 ? 's' : ''} à l’annonce.`;
      renderGallery(); refresh(); save();
    } catch (err) {
      status.className = 'ai-status err';
      status.textContent = '❌ ' + err.message;
    } finally {
      btn.disabled = false;
    }
  }

  renderGallery();
  renderPublish();
  refresh();
}

/* ---------- Fenêtres ---------- */
function modal(title, html) {
  const ov = document.createElement('div');
  ov.className = 'modal';
  ov.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="ghost sm" data-close aria-label="Fermer">✕</button></div>
    <div class="modal-body">${html}</div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', (ev) => { if (ev.target === ov || ev.target.closest('[data-close]')) ov.remove(); });
  return { body: $('.modal-body', ov), close: () => ov.remove() };
}
function confirmBox(text, onYes) {
  const m = modal('Confirmer', `<p>${esc(text)}</p><div class="row"><button type="button" class="primary danger-bg" id="yes">Oui, supprimer</button><button type="button" class="ghost" data-close>Annuler</button></div>`);
  $('#yes', m.body).addEventListener('click', () => { m.close(); onYes(); });
}
function progress(el) {
  el.innerHTML = '';
  return (msg, cls) => { const d = document.createElement('div'); d.textContent = msg; if (cls) d.className = cls; el.appendChild(d); };
}
async function preparePhotos(e, log) {
  const list = e.photos.slice(0, 10), out = [];
  for (let i = 0; i < list.length; i++) {
    log(`Préparation de la photo ${i + 1}/${list.length}…`);
    out.push(await toJpeg(list[i], 1600, 0.9));
  }
  if (!out.length) throw new Error('Choisis au moins une photo pour l’annonce (étape 1).');
  return out;
}
async function runPublish(btn, logEl, p, pf, fn) {
  const log = progress(logEl);
  btn.disabled = true;
  try {
    const res = await fn(log);
    p.edit[pf] = { id: res.id, url: res.url, state: res.state, at: Date.now() };
    await DB.put(p);
    (res.warnings || []).forEach((w) => log(w, 'warn'));
    const ok = document.createElement('div');
    ok.className = 'ok';
    ok.innerHTML = `🎉 ${res.state === 'draft' ? 'Brouillon créé' : 'Annonce en ligne'} ! <a href="${esc(res.url)}" target="_blank" rel="noopener">Voir l’annonce ↗</a>`;
    logEl.appendChild(ok);
    btn.textContent = 'Publié ✓';
    return true;
  } catch (err) {
    log('❌ ' + err.message, 'err');
    btn.disabled = false;
    return false;
  }
}

async function openEbay(p, onDone) {
  const e = p.edit, pr = pricing(e);
  const m = modal('Publier sur eBay', '<p class="muted">Chargement de ton compte eBay…</p>');
  let o;
  try { o = await platformApi('ebay', '/api/ebay/options', { query: shortName(e.title) }); }
  catch (err) { m.body.innerHTML = `<p class="err">${esc(err.message)}</p>`; return; }
  const sel = (id, list) => `<select id="${id}">${list.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('') || '<option value="">— aucune —</option>'}</select>`;
  const missing = !o.fulfillment.length || !o.payment.length || !o.returns.length;
  m.body.innerHTML = `
    <div class="sum"><img src="${esc(e.photos[0] || '')}" alt=""><div><b>${esc(e.title.slice(0, 80))}</b><span>${money(pr.price)} · ${e.photos.length} photo(s)</span></div></div>
    <label>Catégorie${sel('bCat', o.categories)}</label>
    <label>Caractéristiques obligatoires <small>une par ligne · Nom : valeur</small><textarea id="bAsp" rows="4"></textarea></label>
    <div class="grid2">
      <label>Livraison${sel('bShip', o.fulfillment)}</label>
      <label>Paiement${sel('bPay', o.payment)}</label>
      <label>Retours${sel('bRet', o.returns)}</label>
      <label>Quantité en vente<input type="number" id="bQty" min="1" value="10"></label>
      <label>Ville d’expédition<input type="text" id="bCity" value="${esc(settings.city)}"></label>
      <label>Code postal<input type="text" id="bZip" value="${esc(settings.postalCode)}"></label>
    </div>
    ${missing ? '<p class="err">Il te manque des règles de vente (livraison, paiement ou retours) sur eBay. <a href="https://www.bizpolicy.ebay.fr/businesspolicy/manage" target="_blank" rel="noopener">Les créer ↗</a> puis rouvre cette fenêtre.</p>' : ''}
    <div class="row"><button type="button" class="btn ebay big" id="bGo">Publier sur eBay</button></div>
    <div class="log" id="bLog"></div>`;
  const ta = $('#bAsp', m.body);
  const fill = async () => {
    const id = $('#bCat', m.body).value;
    if (!id) { ta.value = `Marque: ${o.brand}`; return; }
    ta.value = 'Chargement…';
    try {
      const r = await platformApi('ebay', '/api/ebay/aspects', { categoryId: id });
      const names = r.aspects.length ? r.aspects : [{ name: 'Marque' }];
      ta.value = names.map((a) => `${a.name}: ${/marque|brand|marke/i.test(a.name) ? o.brand : ''}`).join('\n');
    } catch { ta.value = `Marque: ${o.brand}`; }
  };
  $('#bCat', m.body).addEventListener('change', fill);
  fill();
  $('#bGo', m.body).addEventListener('click', async (ev) => {
    const logEl = $('#bLog', m.body);
    const aspects = {}, empty = [];
    ta.value.split('\n').forEach((line) => {
      const i = line.indexOf(':');
      if (i < 1) return;
      const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
      if (v) aspects[k] = v; else empty.push(k);
    });
    if (empty.length) { logEl.innerHTML = `<div class="err">Complète : ${esc(empty.join(', '))}</div>`; return; }
    settings.city = $('#bCity', m.body).value.trim();
    settings.postalCode = $('#bZip', m.body).value.trim();
    saveSettings();
    const item = {
      sku: p.id, title: e.title.slice(0, 80), description: mdToText(e.description), descriptionHtml: mdToHtml(e.description),
      price: pr.price, quantity: +$('#bQty', m.body).value || 1, categoryId: $('#bCat', m.body).value, aspects,
      fulfillmentId: $('#bShip', m.body).value, paymentId: $('#bPay', m.body).value, returnId: $('#bRet', m.body).value,
      city: settings.city, postalCode: settings.postalCode
    };
    if (!item.categoryId || !item.fulfillmentId || !item.paymentId || !item.returnId) { logEl.innerHTML = '<div class="err">Il manque la catégorie ou une règle de vente.</div>'; return; }
    if (!item.postalCode) { logEl.innerHTML = '<div class="err">Indique ton code postal d’expédition.</div>'; return; }
    if (await runPublish(ev.target, logEl, p, 'ebay', async (log) => {
      const images = await preparePhotos(e, log);
      log('Envoi sur eBay (photos, article, offre, mise en ligne)…');
      return platformApi('ebay', '/api/ebay/publish', { item, images });
    })) onDone();
  });
}

const ETSY_CAT = { tech: 'Electronics & Accessories', beaute: 'Bath & Beauty', mode: 'Clothing', bijoux: 'Jewelry', maison: 'Home & Living', animaux: 'Pet Supplies', sport: 'Sports & Outdoor Recreation', enfant: 'Toys & Games', auto: 'Home & Living', general: 'Home & Living' };
function etsyTags(title) {
  const stop = new Set(['pour', 'avec', 'sans', 'dans', 'des', 'les', 'une', 'aux', 'and', 'with', 'for', 'the', 'est', 'sur', 'par']);
  const w = String(title).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter((x) => x.length > 2 && !stop.has(x));
  const tags = [];
  for (let i = 0; i < w.length - 1 && tags.length < 6; i++) tags.push(w[i] + ' ' + w[i + 1]);
  w.forEach((x) => tags.push(x));
  return [...new Set(tags.map((t) => t.slice(0, 20).trim()))].slice(0, 13);
}
const etsyTitle = (t) => String(t).replace(/&/g, 'et').replace(/[%:]/g, ' ').replace(/[^\p{L}\p{N}\s\-'’,.()/]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 140);

async function openEtsy(p, onDone) {
  const e = p.edit, pr = pricing(e);
  const m = modal('Publier sur Etsy', '<p class="muted">Chargement de ta boutique Etsy…</p>');
  let o;
  try { o = await platformApi('etsy', '/api/etsy/options'); }
  catch (err) { m.body.innerHTML = `<p class="err">${esc(err.message)}</p>`; return; }
  const pre = o.taxonomy.find((t) => t.path === ETSY_CAT[detectCat(p.source.title)]);
  m.body.innerHTML = `
    <div class="sum"><img src="${esc(e.photos[0] || '')}" alt=""><div><b>${esc(etsyTitle(e.title))}</b><span>${money(pr.price)} · ${e.photos.length} photo(s)</span></div></div>
    <label>Catégorie Etsy <small>tape pour chercher (en anglais)</small><input type="text" list="etsyTaxo" id="eTaxo" value="${esc(pre ? pre.path : '')}">
      <datalist id="etsyTaxo">${o.taxonomy.map((t) => `<option value="${esc(t.path)}">`).join('')}</datalist></label>
    <div class="grid2">
      <label>Profil de livraison<select id="eShip">${o.shipping.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('') || '<option value="">— aucun —</option>'}</select></label>
      <label>Délai de préparation<select id="eReady">${o.readiness.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('') || '<option value="">Par défaut</option>'}</select></label>
      <label>Qui l’a fabriqué ?<select id="eWho"><option value="i_did">Moi</option><option value="collective">Moi + un partenaire de production</option></select></label>
      <label>Quantité en vente<input type="number" id="eQty" min="1" value="10"></label>
    </div>
    <label>Mots-clés <small>séparés par des virgules, 13 max</small><input type="text" id="eTags" value="${esc(etsyTags(e.title).join(', '))}"></label>
    ${o.shipping.length ? '' : '<p class="err">Crée d’abord un profil de livraison sur Etsy : <a href="https://www.etsy.com/your/shops/me/tools/shipping-profiles" target="_blank" rel="noopener">l’ouvrir ↗</a></p>'}
    <label class="check"><input type="checkbox" id="eActive" checked> Mettre en ligne tout de suite (sinon : brouillon)</label>
    <div class="row"><button type="button" class="btn etsy big" id="eGo">Publier sur Etsy</button></div>
    <div class="log" id="eLog"></div>`;
  $('#eGo', m.body).addEventListener('click', async (ev) => {
    const logEl = $('#eLog', m.body);
    const taxo = o.taxonomy.find((t) => t.path === $('#eTaxo', m.body).value.trim());
    if (!taxo) { logEl.innerHTML = '<div class="err">Choisis une catégorie dans la liste proposée.</div>'; return; }
    if (!$('#eShip', m.body).value) { logEl.innerHTML = '<div class="err">Il faut un profil de livraison Etsy.</div>'; return; }
    const listing = {
      title: etsyTitle(e.title), description: mdToText(e.description), price: pr.price, quantity: +$('#eQty', m.body).value || 1,
      taxonomyId: taxo.id, shippingProfileId: $('#eShip', m.body).value, readinessId: $('#eReady', m.body).value,
      whoMade: $('#eWho', m.body).value, activate: $('#eActive', m.body).checked,
      tags: $('#eTags', m.body).value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 13)
    };
    if (await runPublish(ev.target, logEl, p, 'etsy', async (log) => {
      const images = await preparePhotos(e, log);
      log('Envoi sur Etsy (annonce, photos, mise en ligne)…');
      return platformApi('etsy', '/api/etsy/publish', { listing, images });
    })) onDone();
  });
}

/* ---------- Vue : réglages ---------- */
function viewSettings() {
  const f = (k, label, type = 'number', extra = '') => `<label>${label}<input name="${k}" type="${type}" value="${esc(settings[k])}" ${extra}></label>`;
  const conn = (pf, name, urlLabel, url) => {
    const auth = getAuth(pf);
    if (!STATUS[pf]) {
      return `<div class="conn"><div class="conn-head"><b>${name}</b><span class="pill">À configurer</span></div>
        <p class="note">Les clés ${name} ne sont pas encore sur Render. Suis le guide (GUIDE.md), section ${name}. ${urlLabel} :</p>
        <code class="copy" data-copy title="Cliquer pour copier">${esc(url)}</code></div>`;
    }
    return `<div class="conn"><div class="conn-head"><b>${name}</b><span class="pill ${auth ? 'on' : ''}">${auth ? 'Connecté' + (auth.shopName ? ' · ' + esc(auth.shopName) : '') : 'Non connecté'}</span></div>
      <div class="row">${auth ? `<button type="button" class="ghost" data-off="${pf}">Déconnecter</button>` : `<a class="btn ${pf}" href="/auth/${pf}/start">Connecter mon compte ${name}</a>`}</div></div>`;
  };
  app.innerHTML = `<div class="view settings">
    <h1>Réglages</h1>
    <section class="card">
      <h2>Connexions</h2>
      <div class="conn"><div class="conn-head"><b>Photos IA</b><span class="pill ${STATUS.ai ? 'on' : ''}">${STATUS.ai ? (STATUS.ai === 'gemini' ? 'Google Gemini' : 'OpenAI') : 'À configurer'}</span></div>
        ${STATUS.ai ? '<div class="row"><button type="button" class="ghost" data-act="test-ai">Tester l’IA</button><span id="aiTest" class="muted"></span></div>'
          : '<p class="note">Ajoute la variable GEMINI_API_KEY sur Render (voir GUIDE.md).</p>'}</div>
      ${isAtelier() ? conn('etsy', 'Etsy', 'Adresse de redirection à déclarer', STATUS.etsyRedirect || '')
        : conn('ebay', 'eBay', 'Adresse à mettre dans « Auth accepted URL »', STATUS.ebayAccept || '')}
    </section>
    <form class="card" id="setForm">
      <h2>Ma boutique</h2>
      ${f('shopName', 'Nom de la boutique', 'text')}
      <div class="grid2">
        ${f('multiplier', 'Marge par défaut (prix × …)', 'number', 'step="0.1" min="1"')}
        ${f('compareRatio', 'Prix barré (prix × …)', 'number', 'step="0.1" min="1"')}
        ${f('feePct', 'Frais de paiement (%)', 'number', 'step="0.1" min="0"')}
        ${f('feeFixed', 'Frais fixes par vente (€)', 'number', 'step="0.01" min="0"')}
        ${f('adsPerSale', 'Pub par vente (€)', 'number', 'step="0.5" min="0"')}
        <label>Ton des textes<select name="tone">${[['pro', 'Pro'], ['fun', 'Fun 🔥'], ['luxe', 'Luxe']].map(([v, l]) => `<option value="${v}" ${settings.tone === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${f('city', 'Ville d’expédition', 'text')}
        ${f('postalCode', 'Code postal d’expédition', 'text')}
      </div>
      ${f('shippingText', 'Texte livraison', 'text')}
      ${f('returnText', 'Texte retours', 'text')}
      <h2 class="sub-h">Mon style de photos</h2>
      <label>Ton prompt <small>décris le décor, la lumière, l’ambiance… Il sera utilisé pour tous tes nouveaux produits.</small>
        <textarea name="myStyle" rows="6" placeholder="ex : Photo produit sur fond lin beige, lumière naturelle douce venant de la gauche, quelques fleurs séchées autour, ambiance cosy et minimaliste, format carré.">${esc(settings.myStyle)}</textarea></label>
      <p class="hint">DropBoost ajoute toujours à la fin : « garde le produit 100 % identique, sans texte ni filigrane ».</p>
      <div class="row"><button class="primary" type="submit">Enregistrer</button><button type="button" class="link" data-act="surprise">Revoir la surprise 🎂</button></div>
    </form>
  </div>`;

  $('#setForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    for (const [k, v] of new FormData(ev.target).entries()) settings[k] = typeof DEFAULT_SETTINGS[k] === 'number' ? parseFloat(v) || 0 : v;
    saveSettings();
    toast('Réglages enregistrés ✅');
  });
  $('.settings').addEventListener('click', async (ev) => {
    const code = ev.target.closest('[data-copy]');
    if (code) { navigator.clipboard.writeText(code.textContent).then(() => toast('Adresse copiée ✅'), () => {}); return; }
    const off = ev.target.closest('[data-off]');
    if (off) { ls.del('db_auth_' + off.dataset.off); viewSettings(); toast('Compte déconnecté'); return; }
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'surprise') showSurprise();
    if (act === 'test-ai') {
      const out = $('#aiTest');
      out.textContent = 'Test en cours…';
      try { const r = await api('/api/test-ai', {}); out.textContent = `✅ Clé valide · modèle ${r.model}`; }
      catch (err) { out.textContent = '❌ ' + err.message; }
    }
  });
}

/* ---------- Surprise d'anniversaire ---------- */
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  const W = (c.width = innerWidth), H = (c.height = innerHeight);
  const cols = ['#e8462a', '#f2b134', '#1d1712', '#2f8f5a', '#3d6fe0'];
  const ps = Array.from({ length: 180 }, () => ({ x: Math.random() * W, y: -20 - Math.random() * H * 0.7, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, w: 6 + Math.random() * 8, h: 8 + Math.random() * 10, c: cols[(Math.random() * cols.length) | 0] }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, W, H);
    for (const q of ps) { q.x += q.vx; q.y += q.vy; q.r += q.vr; ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.r); ctx.fillStyle = q.c; ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h); ctx.restore(); }
    if (t - t0 < 6000) requestAnimationFrame(frame); else c.remove();
  })(t0);
}
function showSurprise() {
  const C = window.CADEAU || {};
  const pour = (C.pour || '').trim(), de = (C.de || '').trim();
  const msg = (C.message || '').trim() || 'Ton pote t’a préparé ta propre machine à fiches produits : un lien AliExpress, des photos IA, un prix rentable, et ça part sur eBay et Etsy. Que ton business explose cette année ! 🚀';
  const ov = document.createElement('div');
  ov.className = 'surprise';
  ov.innerHTML = `<div class="surprise-card"><div class="cake">🎂</div>
    <h1>Joyeux anniversaire${pour ? ' ' + esc(pour) : ''} !</h1><p>${esc(msg)}</p>${de ? `<p class="sig">— ${esc(de)}</p>` : ''}
    <button type="button" class="primary big">Ouvrir mon cadeau 🎁</button></div>`;
  document.body.appendChild(ov);
  confetti();
  ov.querySelector('button').addEventListener('click', () => { ov.remove(); ls.set('db_welcomed', true); });
}

/* ---------- Routeur ---------- */
async function route() {
  $$('.modal').forEach((m) => m.remove());
  const h = location.hash;
  const m = h.match(/^#\/p\/(.+)$/);
  const imp = h.match(/^#\/import\?(.*)$/);
  if (imp) {
    const q = new URLSearchParams(imp[1]);
    history.replaceState(null, '', '/#/');
    await viewHome({ url: q.get('u'), cost: q.get('p'), ship: q.get('s') });
  } else if (m) await viewProduct(decodeURIComponent(m[1]));
  else if (h === '#/reglages') viewSettings();
  else await viewHome();
  $$('[data-nav]').forEach((a) => a.classList.toggle('on', (a.dataset.nav === 'settings') === (h === '#/reglages')));
  window.scrollTo(0, 0);
}

function updateDots() {
  const ok = isAtelier() ? [STATUS.ai, STATUS.etsy && getAuth('etsy')] : [STATUS.ai, STATUS.ebay && getAuth('ebay')];
  $('#navDots').innerHTML = ok.map((x) => `<i class="${x ? 'on' : ''}"></i>`).join('');
}

(async function init() {
  try { STATUS = await api('/api/status'); } catch (err) { toast(err.message); }
  if (isAtelier()) {
    document.body.classList.add('atelier');
    $('.brand').innerHTML = '<span class="logo">D</span>DropBoost <em>Atelier</em>';
    $('[data-nav="home"]').textContent = 'Mes créations';
    document.title = 'DropBoost Atelier';
  }
  if (STATUS.locked) $('nav').insertAdjacentHTML('beforeend', '<a href="/logout" title="Changer de mot de passe">Quitter</a>');
  updateDots();
  window.addEventListener('hashchange', route);
  await route();
  // Retour d'une connexion eBay / Etsy
  const flash = (() => { try { const f = sessionStorage.getItem('db_flash'); sessionStorage.removeItem('db_flash'); return f && JSON.parse(f); } catch { return null; } })();
  if (flash) {
    const name = flash.platform === 'ebay' ? 'eBay' : 'Etsy';
    toast(flash.error ? `❌ Connexion ${name} : ${flash.error}` : `✅ Compte ${name} connecté !`);
    updateDots();
  }
  if (!ls.get('db_welcomed', false)) showSurprise();
})();
