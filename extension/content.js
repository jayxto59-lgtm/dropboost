// Bouton "Envoyer à DropBoost" sur les pages produit AliExpress
(() => {
  if (window.__dropboost) return;
  window.__dropboost = true;

  const SITE = '__SITE__';
  const isProduct = () => /\/(item|i)\/\d+/.test(location.pathname);
  const txt = (el) => (el ? el.innerText || el.textContent || '' : '').replace(/\s+/g, ' ').trim();
  const first = (sels) => {
    for (const s of sels) for (const el of document.querySelectorAll(s)) if (txt(el)) return el;
    return null;
  };

  // "12,34 €", "US $12.34", "1 234,56€" -> 12.34
  function price(text) {
    const m = (text || '').replace(/[  ]/g, ' ').match(/\d[\d\s.,]*/);
    if (!m) return null;
    let n = m[0].trim().replace(/\s/g, '');
    const c = n.lastIndexOf(','), d = n.lastIndexOf('.');
    if (c > -1 && d > -1) n = c > d ? n.replace(/\./g, '').replace(',', '.') : n.replace(/,/g, '');
    else if (c > -1) n = /,\d{1,2}$/.test(n) ? n.replace(',', '.') : n.replace(/,/g, '');
    else if (d > -1 && !/\.\d{1,2}$/.test(n)) n = n.replace(/\./g, '');
    const v = parseFloat(n);
    return isNaN(v) ? null : v;
  }

  function send() {
    const cost = price(txt(first([
      '[class*="price-default--current"]', '[class*="price--currentPriceText"]', '[class*="price--current"]',
      '.product-price-current', '[class*="currentPrice"]'
    ])));
    const shipText = txt(first(['[class*="dynamic-shipping"]', '[class*="shipping--wrap"]']));
    let ship = 0;
    if (shipText && !/gratuit|free|offert/i.test(shipText)) {
      const m = shipText.match(/(?:€|\$|£)\s?\d[\d.,]*|\d[\d.,]*\s?(?:€|\$|£)/);
      ship = (m && price(m[0])) || 0;
    }
    const q = new URLSearchParams({ u: location.origin + location.pathname, p: cost || '', s: ship });
    window.open(SITE + '/#/import?' + q.toString(), '_blank');
  }

  let btn;
  function sync() {
    if (isProduct() && !btn) {
      btn = document.createElement('button');
      btn.id = 'dropboost-send';
      btn.textContent = '🚀 Envoyer à DropBoost';
      btn.addEventListener('click', send);
      document.documentElement.appendChild(btn);
    }
    if (btn) btn.style.display = isProduct() ? 'flex' : 'none';
  }
  sync();
  setInterval(sync, 1000); // AliExpress change de page sans recharger
})();
