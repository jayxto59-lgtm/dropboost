"""DropBoost : lien AliExpress -> fiche produit avec photos IA -> publication Etsy / eBay.

Le serveur ne garde rien : les produits et les connexions Etsy/eBay restent dans le
navigateur. Les clés secrètes (IA, Etsy, eBay) sont dans les variables d'environnement.
"""
import base64
import hashlib
import hmac
import html as H
import io
import json
import os
import re
import secrets
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlencode

import requests
from flask import Flask, Response, jsonify, redirect, request, send_from_directory, session
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix


def env(key, default=''):
    return os.environ.get(key, default).strip()


app = Flask(__name__, static_folder='static', static_url_path='/static')
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
app.secret_key = env('SECRET_KEY') or secrets.token_hex(32)
app.config.update(
    MAX_CONTENT_LENGTH=60 * 1024 * 1024,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_HTTPONLY=True,
    PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 365,
)

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'


class Oops(Exception):
    """Erreur affichée telle quelle à l'utilisateur."""

    def __init__(self, msg, status=400, code=0):
        super().__init__(msg)
        self.status = status
        self.code = code


@app.errorhandler(Oops)
def on_oops(e):
    return jsonify(error=str(e)), e.status


@app.errorhandler(Exception)
def on_error(e):
    if isinstance(e, HTTPException):
        return e
    app.logger.exception(e)
    if isinstance(e, requests.RequestException):
        return jsonify(error='Le service distant ne répond pas, réessaie dans un instant.'), 502
    return jsonify(error=f'Erreur inattendue : {e}'), 500


def base_url():
    return (env('PUBLIC_URL') or env('RENDER_EXTERNAL_URL') or request.host_url).rstrip('/')


def body():
    return request.get_json(silent=True) or {}


def api_error(r, who):
    try:
        j = r.json()
        if isinstance(j, list):
            j = j[0] if j else {}
        if isinstance(j.get('error'), dict):
            msg = j['error'].get('message')
        elif j.get('errors'):
            msg = ' · '.join(e.get('longMessage') or e.get('message', '') for e in j['errors'])
        else:
            msg = j.get('error_description') or j.get('error') or j.get('message')
    except ValueError:
        msg = r.text[:300]
    return f'{who} : {msg or "erreur " + str(r.status_code)}'


def data_url_bytes(d):
    try:
        head, b64 = d.split(',', 1)
        return base64.b64decode(b64), head.split(';')[0].split(':')[1]
    except (ValueError, AttributeError, IndexError):
        raise Oops('Image invalide.')


# ---------------------------------------------------------------- mot de passe

PASSWORD = env('APP_PASSWORD')
OPEN_PATHS = ('/login', '/api/login', '/favicon.ico')


@app.before_request
def guard():
    p = request.path
    if not PASSWORD or session.get('ok') or p in OPEN_PATHS or p.startswith('/static/'):
        return None
    if p.startswith('/api/'):
        return jsonify(error='Mot de passe requis, recharge la page.'), 401
    return redirect('/login')


@app.get('/login')
def login_page():
    return send_from_directory('static', 'login.html')


@app.post('/api/login')
def api_login():
    pw = str(body().get('password', ''))
    if PASSWORD and not hmac.compare_digest(pw.encode(), PASSWORD.encode()):
        time.sleep(0.6)
        raise Oops('Mot de passe incorrect.', 401)
    session.permanent = True
    session['ok'] = True
    return jsonify(ok=True)


@app.get('/')
def home():
    return send_from_directory('static', 'index.html')


@app.get('/favicon.ico')
def favicon():
    return send_from_directory('static', 'favicon.svg', mimetype='image/svg+xml')


# ---------------------------------------------------------------- état de la configuration

def ai_provider():
    wanted = env('IMAGE_PROVIDER').lower()
    if wanted == 'openai' and env('OPENAI_API_KEY'):
        return 'openai'
    if wanted == 'gemini' and env('GEMINI_API_KEY'):
        return 'gemini'
    if env('GEMINI_API_KEY'):
        return 'gemini'
    if env('OPENAI_API_KEY'):
        return 'openai'
    return None


@app.get('/api/status')
def api_status():
    b = base_url()
    return jsonify(
        ai=ai_provider(),
        etsy=bool(env('ETSY_KEYSTRING') and env('ETSY_SHARED_SECRET')),
        ebay=bool(env('EBAY_CLIENT_ID') and env('EBAY_CLIENT_SECRET') and env('EBAY_RUNAME')),
        etsyRedirect=f'{b}/auth/etsy/callback',
        ebayAccept=f'{b}/auth/ebay/callback',
        marketplace=ebay_market()['label'],
        currency=ebay_market()['cur'],
    )


# ---------------------------------------------------------------- AliExpress

ID_RE = re.compile(r'/(?:item|i)/(\d{6,})|productIds?=(\d{6,})|/(\d{12,})\.html')
IMG_HOST = re.compile(r'^https://(?:[a-z0-9-]+\.)*(?:alicdn|aliexpress-media|aliexpress)\.com/', re.I)


def ae_get(url):
    # Le serveur est aux États-Unis : ces cookies demandent la version française (titres en français, prix en euros)
    return requests.get(url, timeout=20, allow_redirects=True, headers={
        'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.6',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cookie': 'aep_usuc_f=site=fra&c_tp=EUR&region=FR&b_locale=fr_FR; intl_locale=fr_FR; xman_us_f=x_locale=fr_FR&x_l=0',
    })


def product_id(text):
    m = ID_RE.search(text or '')
    return next((g for g in m.groups() if g), None) if m else None


@app.post('/api/import')
def api_import():
    raw = str(body().get('url', '')).strip()
    found = re.search(r'https?://\S+', raw)
    url = found.group(0).rstrip(').,;!') if found else raw
    if not url:
        raise Oops('Colle le lien du produit AliExpress.')
    pid = product_id(url)
    if not pid and 'aliexpress' in url.lower():
        pid = product_id(ae_get(url).url)  # lien court partagé depuis l'appli
    if not pid:
        raise Oops('Lien non reconnu. Ouvre le produit sur AliExpress et copie l’adresse de la page (elle contient « /item/ »).')

    r = ae_get(f'https://fr.aliexpress.com/item/{pid}.html')
    page = r.text
    if '/punish' in r.url or 'captcha' in page[:5000].lower():
        raise Oops('AliExpress bloque la lecture pour le moment (anti-robot). Réessaie dans une minute.', 502)

    data = {}
    i = page.find('DCData = ')
    if i >= 0:
        try:
            data, _ = json.JSONDecoder().raw_decode(page, i + len('DCData = '))
        except ValueError:
            data = {}
    images = []
    for u in data.get('imagePathList') or []:
        u = u if u.startswith('http') else 'https:' + u
        if u not in images:
            images.append(u)
    mt = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]*)"', page)
    title = H.unescape(mt.group(1)) if mt else ''
    title = re.sub(r'\s*[-|–]\s*AliExpress.*$', '', title, flags=re.I).strip()
    if not images:
        mi = re.search(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"', page)
        if mi:
            images = [mi.group(1)]
    if not title and not images:
        raise Oops('Produit introuvable : vérifie le lien, ou réessaie dans une minute.', 404)
    return jsonify(id=pid, url=f'https://fr.aliexpress.com/item/{pid}.html', title=title, images=images[:12])


@app.get('/api/img')
def api_img():
    u = request.args.get('u', '')
    if not IMG_HOST.match(u):
        raise Oops('Image refusée.')
    r = requests.get(u, timeout=20, headers={'User-Agent': UA, 'Accept': 'image/jpeg,image/png,image/webp,image/*;q=0.8'})
    if r.status_code != 200:
        raise Oops('Image introuvable.', 404)
    return Response(r.content, mimetype=r.headers.get('Content-Type', 'image/jpeg'),
                    headers={'Cache-Control': 'public, max-age=604800'})


# ---------------------------------------------------------------- photos IA

GEMINI = 'https://generativelanguage.googleapis.com/v1beta'
GEMINI_FALLBACK = ['gemini-3.1-flash-image', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image',
                   'gemini-3-pro-image-preview', 'gemini-2.5-flash-image']
OPENAI_FALLBACK = ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1']
_models = {}


def gemini_models():
    """Les modèles d'image réellement disponibles pour cette clé, du meilleur au moins bon."""
    r = requests.get(f'{GEMINI}/models', params={'pageSize': 1000}, headers={'x-goog-api-key': env('GEMINI_API_KEY')}, timeout=20)
    if r.status_code != 200:
        raise Oops(api_error(r, 'Gemini'), 502, r.status_code)
    names = [m['name'].split('/', 1)[1] for m in r.json().get('models', [])
             if 'generateContent' in (m.get('supportedGenerationMethods') or [])
             and 'image' in m['name'] and 'imagen' not in m['name']]

    def rank(n):
        return (0 if 'flash-image' in n and 'lite' not in n else 1 if 'pro-image' in n else 2,
                'preview' in n, [-int(x) for x in re.findall(r'\d+', n)])
    return sorted(names, key=rank) or GEMINI_FALLBACK


def openai_models():
    r = requests.get('https://api.openai.com/v1/models', headers={'Authorization': 'Bearer ' + env('OPENAI_API_KEY')}, timeout=20)
    if r.status_code != 200:
        raise Oops(api_error(r, 'OpenAI'), 502, r.status_code)
    ids = [m['id'] for m in r.json().get('data', []) if m['id'].startswith('gpt-image') and 'mini' not in m['id']]
    return sorted(ids, key=lambda n: [-int(x) for x in re.findall(r'\d+', n)]) or OPENAI_FALLBACK


def candidate_models(provider):
    if env('IMAGE_MODEL'):
        return [env('IMAGE_MODEL')]
    if provider in _models:
        return [_models[provider]]
    try:
        return gemini_models() if provider == 'gemini' else openai_models()
    except Oops as e:
        if e.code in (400, 401, 403):
            raise Oops(('Clé Gemini' if provider == 'gemini' else 'Clé OpenAI') + ' refusée : vérifie-la sur Render. (' + str(e) + ')', 400)
        return GEMINI_FALLBACK if provider == 'gemini' else OPENAI_FALLBACK


GEMINI_NO_BILLING = ('Ta clé Gemini est en mode gratuit : Google ne permet pas de générer des images sans facturation. '
                     'Active la facturation sur aistudio.google.com (menu « Billing » / « Facturation »), puis réessaie. '
                     'Rien à changer sur Render.')


def gemini_check(r):
    if r.status_code == 200:
        return
    if r.status_code == 429:
        if 'free_tier' in r.text and 'limit: 0' in r.text:
            raise Oops(GEMINI_NO_BILLING, 402, 429)
        raise Oops('Gemini reçoit trop de demandes en ce moment : réessaie dans une minute.', 429, 429)
    raise Oops(api_error(r, 'Gemini'), 502, r.status_code)


def gemini_image(model, prompt, img_b64, mime):
    r = requests.post(f'{GEMINI}/models/{model}:generateContent', timeout=170,
                      headers={'x-goog-api-key': env('GEMINI_API_KEY')},
                      json={'contents': [{'parts': [{'text': prompt}, {'inline_data': {'mime_type': mime, 'data': img_b64}}]}],
                            'generationConfig': {'responseModalities': ['TEXT', 'IMAGE']}})
    gemini_check(r)
    cand = (r.json().get('candidates') or [{}])[0]
    for part in (cand.get('content') or {}).get('parts') or []:
        d = part.get('inlineData') or part.get('inline_data')
        if d and d.get('data'):
            return f"data:{d.get('mimeType') or d.get('mime_type') or 'image/png'};base64,{d['data']}"
    raise Oops(f"Gemini n’a pas renvoyé d’image ({cand.get('finishReason') or 'refus'}). Essaie une autre photo de référence ou un autre style.", 502)


def openai_image(model, prompt, img, n, fidelity=True):
    data = {'model': model, 'prompt': prompt, 'size': '1024x1024', 'n': str(n)}
    if fidelity:
        data['input_fidelity'] = 'high'
    r = requests.post('https://api.openai.com/v1/images/edits', timeout=230, data=data,
                      headers={'Authorization': 'Bearer ' + env('OPENAI_API_KEY')},
                      files={'image': ('reference.jpg', img, 'image/jpeg')})
    if r.status_code != 200:
        msg = api_error(r, 'OpenAI')
        if fidelity and 'input_fidelity' in msg:
            return openai_image(model, prompt, img, n, False)
        raise Oops(msg, 502, r.status_code)
    return ['data:image/png;base64,' + d['b64_json'] for d in r.json().get('data', []) if d.get('b64_json')]


def model_problem(e):
    return e.code == 404 or re.search(r'not found|not supported|does not exist|unknown model|invalid model|is not available', str(e), re.I)


@app.post('/api/generate')
def api_generate():
    j = body()
    provider = ai_provider()
    if not provider:
        raise Oops('Aucune clé d’IA configurée. Ajoute GEMINI_API_KEY dans Render (voir le guide).')
    prompt = str(j.get('prompt', '')).strip()
    if len(prompt) < 10:
        raise Oops('Le prompt est vide.')
    img, mime = data_url_bytes(j.get('image', ''))
    n = max(1, min(4, int(j.get('count') or 2)))
    last = None
    for model in candidate_models(provider):
        try:
            if provider == 'gemini':
                b64 = base64.b64encode(img).decode()
                with ThreadPoolExecutor(n) as ex:
                    futures = [ex.submit(gemini_image, model, prompt, b64, mime) for _ in range(n)]
                out, errors = [], []
                for f in futures:
                    try:
                        out.append(f.result())
                    except Oops as e:
                        errors.append(e)
                if not out:
                    raise errors[0]
            else:
                out = openai_image(model, prompt, img, n)
            _models[provider] = model
            return jsonify(images=out, model=model)
        except Oops as e:
            last = e
            if env('IMAGE_MODEL') or not model_problem(e):
                raise
    raise last or Oops('Aucune image générée.', 502)


@app.post('/api/test-ai')
def api_test_ai():
    provider = ai_provider()
    if not provider:
        raise Oops('Aucune clé d’IA configurée sur Render.')
    models = candidate_models(provider)
    if provider == 'gemini':
        # Une toute petite demande texte : révèle une clé sans facturation (quota d'images à 0)
        r = requests.post(f'{GEMINI}/models/{models[0]}:generateContent', timeout=60,
                          headers={'x-goog-api-key': env('GEMINI_API_KEY')},
                          json={'contents': [{'parts': [{'text': 'Reply with OK.'}]}], 'generationConfig': {'maxOutputTokens': 5}})
        gemini_check(r)
    return jsonify(ok=True, provider='Google Gemini' if provider == 'gemini' else 'OpenAI', model=models[0])


# ---------------------------------------------------------------- extension navigateur

@app.get('/extension.zip')
def extension_zip():
    """L'extension, avec l'adresse de ce site déjà dedans."""
    buf = io.BytesIO()
    root = os.path.join(app.root_path, 'extension')
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in sorted(os.listdir(root)):
            with open(os.path.join(root, name), encoding='utf-8') as f:
                z.writestr('DropBoost/' + name, f.read().replace('__SITE__', base_url()))
    return Response(buf.getvalue(), mimetype='application/zip',
                    headers={'Content-Disposition': 'attachment; filename=DropBoost-extension.zip'})


# ---------------------------------------------------------------- connexion (OAuth)

def b64url(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')


def done_page(platform, auth=None, error=None):
    """Range la connexion dans le navigateur puis revient aux réglages."""
    payload = json.dumps({'platform': platform, 'auth': auth, 'error': error}).replace('<', '\\u003c')
    return Response(f"""<!doctype html><meta charset="utf-8"><title>Connexion…</title>
<body style="font-family:system-ui;padding:40px">Connexion en cours…<script>
const r = {payload};
try {{ if (r.auth) localStorage.setItem('db_auth_' + r.platform, JSON.stringify(r.auth)); }} catch (e) {{}}
try {{ sessionStorage.setItem('db_flash', JSON.stringify(r)); }} catch (e) {{}}
location.replace('/#/reglages');
</script></body>""", mimetype='text/html')


def need(*keys):
    missing = [k for k in keys if not env(k)]
    if missing:
        raise Oops('Configuration manquante sur Render : ' + ', '.join(missing))


# ---------------------------------------------------------------- Etsy

ETSY_API = 'https://api.etsy.com/v3'
ETSY_SCOPES = 'listings_w listings_r shops_r shops_w'
_etsy_taxo = []


def etsy_token(params):
    r = requests.post(f'{ETSY_API}/public/oauth/token', data=params, timeout=20)
    if r.status_code != 200:
        raise Oops(api_error(r, 'Etsy'), 400)
    j = r.json()
    return {'token': j['access_token'], 'refresh': j['refresh_token'], 'expires': int(time.time()) + int(j.get('expires_in', 3600)) - 60}


def etsy_call(auth, method, path, data=None, files=None):
    r = requests.request(method, ETSY_API + path, data=data, files=files, timeout=60, headers={
        'x-api-key': f"{env('ETSY_KEYSTRING')}:{env('ETSY_SHARED_SECRET')}",
        'Authorization': 'Bearer ' + auth['token'],
    })
    if r.status_code >= 300:
        raise Oops(api_error(r, 'Etsy'), 400, r.status_code)
    return r.json() if r.content else {}


def etsy_auth(j):
    """La connexion envoyée par le navigateur, rafraîchie si besoin."""
    need('ETSY_KEYSTRING', 'ETSY_SHARED_SECRET')
    auth = j.get('auth') or {}
    if not auth.get('token'):
        raise Oops('Etsy n’est pas connecté : va dans Réglages.', 401)
    if auth.get('expires', 0) < time.time():
        auth = {**auth, **etsy_token({'grant_type': 'refresh_token', 'client_id': env('ETSY_KEYSTRING'), 'refresh_token': auth.get('refresh', '')})}
    return auth


@app.get('/auth/etsy/start')
def etsy_start():
    need('ETSY_KEYSTRING', 'ETSY_SHARED_SECRET')
    verifier = secrets.token_urlsafe(48)
    state = secrets.token_urlsafe(16)
    session['etsy'] = {'v': verifier, 's': state}
    return redirect('https://www.etsy.com/oauth/connect?' + urlencode({
        'response_type': 'code', 'client_id': env('ETSY_KEYSTRING'), 'redirect_uri': base_url() + '/auth/etsy/callback',
        'scope': ETSY_SCOPES, 'state': state,
        'code_challenge': b64url(hashlib.sha256(verifier.encode()).digest()), 'code_challenge_method': 'S256',
    }))


@app.get('/auth/etsy/callback')
def etsy_callback():
    pk = session.pop('etsy', None)
    if request.args.get('error'):
        return done_page('etsy', error=request.args.get('error_description') or request.args.get('error'))
    if not pk or request.args.get('state') != pk['s']:
        return done_page('etsy', error='La connexion a expiré, recommence.')
    try:
        auth = etsy_token({'grant_type': 'authorization_code', 'client_id': env('ETSY_KEYSTRING'),
                           'redirect_uri': base_url() + '/auth/etsy/callback',
                           'code': request.args.get('code', ''), 'code_verifier': pk['v']})
        me = etsy_call(auth, 'GET', '/application/users/me')
        if not me.get('shop_id'):
            return done_page('etsy', error='Ce compte Etsy n’a pas encore de boutique.')
        shop = etsy_call(auth, 'GET', f"/application/shops/{me['shop_id']}")
        auth.update(shopId=me['shop_id'], shopName=shop.get('shop_name'), currency=shop.get('currency_code'))
        return done_page('etsy', auth)
    except Oops as e:
        return done_page('etsy', error=str(e))


@app.post('/api/etsy/options')
def etsy_options():
    auth = etsy_auth(body())
    global _etsy_taxo
    if not _etsy_taxo:
        flat = []

        def walk(nodes, path):
            for n in nodes:
                full = f"{path} › {n['name']}" if path else n['name']
                flat.append({'id': n['id'], 'path': full})
                walk(n.get('children') or [], full)
        walk(etsy_call(auth, 'GET', '/application/seller-taxonomy/nodes').get('results', []), '')
        _etsy_taxo = flat
    shop = auth['shopId']
    shipping = etsy_call(auth, 'GET', f'/application/shops/{shop}/shipping-profiles').get('results', [])
    try:
        ready = etsy_call(auth, 'GET', f'/application/shops/{shop}/readiness-state-definitions').get('results', [])
    except Oops:
        ready = []
    if not ready:
        try:
            ready = [etsy_call(auth, 'POST', f'/application/shops/{shop}/readiness-state-definitions', data={
                'readiness_state': 'ready_to_ship', 'min_processing_time': 1, 'max_processing_time': 3, 'processing_time_unit': 'days'})]
        except Oops:
            ready = []
    return jsonify(auth=auth, taxonomy=_etsy_taxo,
                   shipping=[{'id': s['shipping_profile_id'], 'name': s.get('title')} for s in shipping],
                   readiness=[{'id': r['readiness_state_id'],
                               'name': f"{'Sur commande' if r.get('readiness_state') == 'made_to_order' else 'Prêt à expédier'} · "
                                       f"{r.get('min_processing_time')}-{r.get('max_processing_time')} {'sem.' if r.get('processing_time_unit') == 'weeks' else 'j'}"}
                              for r in ready])


@app.post('/api/etsy/publish')
def etsy_publish():
    j = body()
    auth = etsy_auth(j)
    L = j.get('listing') or {}
    images = j.get('images') or []
    if not images:
        raise Oops('Il faut au moins une photo.')
    shop = auth['shopId']
    data = {
        'quantity': int(L.get('quantity') or 1), 'title': L.get('title', '')[:140], 'description': L.get('description', ''),
        'price': f"{float(L.get('price') or 0):.2f}", 'who_made': L.get('whoMade') or 'someone_else',
        'when_made': 'made_to_order', 'taxonomy_id': L.get('taxonomyId'),
        'shipping_profile_id': L.get('shippingProfileId'), 'type': 'physical',
    }
    if L.get('readinessId'):
        data['readiness_state_id'] = L['readinessId']
    if data['who_made'] == 'someone_else':
        data['is_supply'] = 'true'
    listing = etsy_call(auth, 'POST', f'/application/shops/{shop}/listings', data=data)
    lid = listing['listing_id']
    for i, d in enumerate(images[:10]):
        raw, mime = data_url_bytes(d)
        etsy_call(auth, 'POST', f'/application/shops/{shop}/listings/{lid}/images',
                  data={'rank': i + 1}, files={'image': (f'photo-{i + 1}.jpg', raw, mime)})
    warnings = []
    tags = [t for t in (L.get('tags') or []) if t][:13]
    if tags:
        try:
            etsy_call(auth, 'PATCH', f'/application/shops/{shop}/listings/{lid}', data={'tags': ','.join(tags)})
        except Oops as e:
            warnings.append('Tags non ajoutés : ' + str(e))
    state = 'draft'
    if L.get('activate'):
        etsy_call(auth, 'PATCH', f'/application/shops/{shop}/listings/{lid}', data={'state': 'active'})
        state = 'active'
    url = f'https://www.etsy.com/listing/{lid}' if state == 'active' else f'https://www.etsy.com/your/shops/me/listing-editor/edit/{lid}'
    return jsonify(auth=auth, id=lid, state=state, url=url, warnings=warnings)


# ---------------------------------------------------------------- eBay

EBAY_API = 'https://api.ebay.com'
EBAY_SCOPES = ' '.join(['https://api.ebay.com/oauth/api_scope', 'https://api.ebay.com/oauth/api_scope/sell.inventory',
                        'https://api.ebay.com/oauth/api_scope/sell.account'])
MARKETS = {
    'EBAY_FR': {'label': 'eBay France', 'tree': 71, 'lang': 'fr-FR', 'cur': 'EUR', 'site': 'https://www.ebay.fr', 'country': 'FR', 'brand': 'Sans marque'},
    'EBAY_BE': {'label': 'eBay Belgique', 'tree': 23, 'lang': 'fr-BE', 'cur': 'EUR', 'site': 'https://www.befr.ebay.be', 'country': 'BE', 'brand': 'Sans marque'},
    'EBAY_DE': {'label': 'eBay Allemagne', 'tree': 77, 'lang': 'de-DE', 'cur': 'EUR', 'site': 'https://www.ebay.de', 'country': 'DE', 'brand': 'Markenlos'},
    'EBAY_GB': {'label': 'eBay UK', 'tree': 3, 'lang': 'en-GB', 'cur': 'GBP', 'site': 'https://www.ebay.co.uk', 'country': 'GB', 'brand': 'Unbranded'},
    'EBAY_US': {'label': 'eBay USA', 'tree': 0, 'lang': 'en-US', 'cur': 'USD', 'site': 'https://www.ebay.com', 'country': 'US', 'brand': 'Unbranded'},
}


def ebay_market():
    key = env('EBAY_MARKETPLACE', 'EBAY_FR').upper()
    return {**MARKETS.get(key, MARKETS['EBAY_FR']), 'id': key if key in MARKETS else 'EBAY_FR'}


def ebay_token(params):
    basic = base64.b64encode(f"{env('EBAY_CLIENT_ID')}:{env('EBAY_CLIENT_SECRET')}".encode()).decode()
    r = requests.post(f'{EBAY_API}/identity/v1/oauth2/token', data=params, timeout=20,
                      headers={'Authorization': 'Basic ' + basic})
    if r.status_code != 200:
        raise Oops(api_error(r, 'eBay'), 400)
    j = r.json()
    out = {'token': j['access_token'], 'expires': int(time.time()) + int(j.get('expires_in', 7200)) - 60}
    if j.get('refresh_token'):
        out['refresh'] = j['refresh_token']
    return out


def ebay_call(auth, method, path, payload=None):
    m = ebay_market()
    headers = {'Authorization': 'Bearer ' + auth['token'], 'Accept-Language': m['lang'], 'X-EBAY-C-MARKETPLACE-ID': m['id']}
    if payload is not None:
        headers['Content-Language'] = m['lang']
    r = requests.request(method, EBAY_API + path, json=payload, headers=headers, timeout=60)
    if r.status_code >= 300:
        raise Oops(api_error(r, 'eBay'), 400, r.status_code)
    return r.json() if r.content else {}


def ebay_auth(j):
    need('EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'EBAY_RUNAME')
    auth = j.get('auth') or {}
    if not auth.get('token'):
        raise Oops('eBay n’est pas connecté : va dans Réglages.', 401)
    if auth.get('expires', 0) < time.time():
        auth = {**auth, **ebay_token({'grant_type': 'refresh_token', 'refresh_token': auth.get('refresh', ''), 'scope': EBAY_SCOPES})}
    return auth


@app.get('/auth/ebay/start')
def ebay_start():
    need('EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'EBAY_RUNAME')
    state = secrets.token_urlsafe(16)
    session['ebay'] = state
    return redirect('https://auth.ebay.com/oauth2/authorize?' + urlencode({
        'client_id': env('EBAY_CLIENT_ID'), 'response_type': 'code', 'redirect_uri': env('EBAY_RUNAME'),
        'scope': EBAY_SCOPES, 'state': state,
    }))


@app.get('/auth/ebay/callback')
def ebay_callback():
    state = session.pop('ebay', None)
    if request.args.get('error'):
        return done_page('ebay', error=request.args.get('error_description') or request.args.get('error'))
    if not state or request.args.get('state') != state:
        return done_page('ebay', error='La connexion a expiré, recommence.')
    try:
        auth = ebay_token({'grant_type': 'authorization_code', 'code': request.args.get('code', ''), 'redirect_uri': env('EBAY_RUNAME')})
        auth['market'] = ebay_market()['label']
        return done_page('ebay', auth)
    except Oops as e:
        return done_page('ebay', error=str(e))


@app.post('/api/ebay/options')
def ebay_options():
    j = body()
    auth = ebay_auth(j)
    m = ebay_market()
    with ThreadPoolExecutor(4) as ex:
        f = ex.submit(ebay_call, auth, 'GET', f"/sell/account/v1/fulfillment_policy?marketplace_id={m['id']}")
        p = ex.submit(ebay_call, auth, 'GET', f"/sell/account/v1/payment_policy?marketplace_id={m['id']}")
        r = ex.submit(ebay_call, auth, 'GET', f"/sell/account/v1/return_policy?marketplace_id={m['id']}")
        c = ex.submit(ebay_call, auth, 'GET', f"/commerce/taxonomy/v1/category_tree/{m['tree']}/get_category_suggestions?" + urlencode({'q': j.get('query', '')[:100]}))
        pol = []
        for fut, key, idk in ((f, 'fulfillmentPolicies', 'fulfillmentPolicyId'), (p, 'paymentPolicies', 'paymentPolicyId'), (r, 'returnPolicies', 'returnPolicyId')):
            try:
                pol.append([{'id': x[idk], 'name': x.get('name')} for x in fut.result().get(key, [])])
            except Oops as e:
                if 'not eligible' in str(e).lower() or 'opt' in str(e).lower():
                    raise Oops('Active les « règles de vente » (Business Policies) sur ton compte vendeur eBay, puis réessaie.')
                raise
        try:
            sugg = c.result().get('categorySuggestions', [])
        except Oops:
            sugg = []
    cats = [{'id': s['category']['categoryId'],
             'name': ' › '.join([a['categoryName'] for a in reversed(s.get('categoryTreeNodeAncestors') or [])] + [s['category']['categoryName']])}
            for s in sugg]
    return jsonify(auth=auth, categories=cats, fulfillment=pol[0], payment=pol[1], returns=pol[2], brand=m['brand'], currency=m['cur'])


@app.post('/api/ebay/aspects')
def ebay_aspects():
    j = body()
    auth = ebay_auth(j)
    m = ebay_market()
    res = ebay_call(auth, 'GET', f"/commerce/taxonomy/v1/category_tree/{m['tree']}/get_item_aspects_for_category?category_id={j.get('categoryId')}")
    req = [{'name': a['localizedAspectName'], 'values': [v['localizedValue'] for v in (a.get('aspectValues') or [])[:40]]}
           for a in res.get('aspects', []) if (a.get('aspectConstraint') or {}).get('aspectRequired')]
    return jsonify(auth=auth, aspects=req)


def ebay_upload(auth, raw, mime):
    r = requests.post('https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_file', timeout=60,
                      headers={'Authorization': 'Bearer ' + auth['token']}, files={'image': ('photo.jpg', raw, mime)})
    if r.status_code >= 300:
        raise Oops(api_error(r, 'eBay (photo)'), 400)
    try:
        url = r.json().get('imageUrl')
    except ValueError:
        url = None
    if not url and r.headers.get('Location'):
        g = requests.get(r.headers['Location'], headers={'Authorization': 'Bearer ' + auth['token']}, timeout=30)
        url = g.json().get('imageUrl') if g.status_code == 200 else None
    if not url:
        raise Oops('eBay n’a pas renvoyé l’adresse de la photo.', 502)
    return url


@app.post('/api/ebay/publish')
def ebay_publish():
    j = body()
    auth = ebay_auth(j)
    m = ebay_market()
    item = j.get('item') or {}
    images = j.get('images') or []
    if not images:
        raise Oops('Il faut au moins une photo.')
    if not item.get('postalCode'):
        raise Oops('Indique ton code postal d’expédition.')

    urls = [ebay_upload(auth, *data_url_bytes(d)) for d in images[:12]]

    locations = ebay_call(auth, 'GET', '/sell/inventory/v1/location').get('locations', [])
    loc = locations[0]['merchantLocationKey'] if locations else None
    if not loc:
        loc = 'dropboost'
        ebay_call(auth, 'POST', f'/sell/inventory/v1/location/{loc}', {
            'location': {'address': {'city': item.get('city') or '', 'postalCode': item['postalCode'], 'country': m['country']}},
            'locationTypes': ['WAREHOUSE'], 'name': 'DropBoost', 'merchantLocationStatus': 'ENABLED'})

    sku = 'DB-' + re.sub(r'[^A-Za-z0-9-]', '', str(item.get('sku') or secrets.token_hex(4)))[:40]
    aspects = {k: [v] for k, v in (item.get('aspects') or {}).items() if k and v}
    ebay_call(auth, 'PUT', f'/sell/inventory/v1/inventory_item/{sku}', {
        'availability': {'shipToLocationAvailability': {'quantity': int(item.get('quantity') or 1)}},
        'condition': 'NEW',
        'product': {'title': item.get('title', '')[:80], 'description': item.get('description', '')[:3900], 'aspects': aspects, 'imageUrls': urls},
    })
    offer = {
        'availableQuantity': int(item.get('quantity') or 1), 'categoryId': str(item.get('categoryId')),
        'listingDescription': item.get('descriptionHtml') or item.get('description', ''),
        'listingPolicies': {'fulfillmentPolicyId': item.get('fulfillmentId'), 'paymentPolicyId': item.get('paymentId'), 'returnPolicyId': item.get('returnId')},
        'pricingSummary': {'price': {'value': f"{float(item.get('price') or 0):.2f}", 'currency': m['cur']}},
        'merchantLocationKey': loc, 'format': 'FIXED_PRICE',
    }
    existing = []
    try:
        existing = ebay_call(auth, 'GET', f"/sell/inventory/v1/offer?sku={sku}&marketplace_id={m['id']}").get('offers', [])
    except Oops:
        pass
    if existing:
        offer_id = existing[0]['offerId']
        ebay_call(auth, 'PUT', f'/sell/inventory/v1/offer/{offer_id}', offer)
    else:
        offer_id = ebay_call(auth, 'POST', '/sell/inventory/v1/offer', {'sku': sku, 'marketplaceId': m['id'], **offer})['offerId']
    listing = ebay_call(auth, 'POST', f'/sell/inventory/v1/offer/{offer_id}/publish')
    lid = listing.get('listingId')
    return jsonify(auth=auth, id=lid, state='active', url=f"{m['site']}/itm/{lid}")


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=int(env('PORT', '5050')), debug=False, threaded=True)
