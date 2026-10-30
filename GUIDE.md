# DropBoost : mise en ligne

Le site s'utilise avec un simple lien : on colle un lien AliExpress, on génère des photos avec l'IA, et on publie sur eBay ou Etsy.

Il faut le mettre en ligne **une seule fois** (environ 15 minutes), puis brancher les clés.

---

## 1. Mettre le site en ligne sur Render (gratuit)

1. Crée un compte sur **github.com**, puis un nouveau dépôt (bouton **New**). Nom : `dropboost`. Laisse-le **Public** et clique sur **Create repository**.
2. Sur la page du dépôt, clique sur **uploading an existing file**. Glisse **tout le contenu** du dossier `dropboost-web` (le fichier `app.py`, le dossier `static`, etc., pas le dossier lui-même), puis clique sur **Commit changes**.
3. Crée un compte sur **render.com** (avec ton compte GitHub, c'est plus simple).
4. Sur Render, clique sur **New +** → **Blueprint**, puis choisis le dépôt `dropboost`.
5. Render affiche les réglages à remplir :
   - `APP_PASSWORD` : le mot de passe pour entrer sur le site (choisis-en un et donne-le à ton pote).
   - `GEMINI_API_KEY` : la clé pour les photos IA (voir étape 2). Tu peux la mettre plus tard.
   - Les clés eBay et Etsy : laisse vide pour l'instant.
6. Clique sur **Apply**. Après 2 à 3 minutes, ton site est en ligne à une adresse du type **`https://dropboost-xxxx.onrender.com`**.

C'est ce lien qu'on envoie à ton pote. 🎉

> Pour modifier une clé plus tard : Render → ton service **dropboost** → **Environment** → modifie → **Save changes**. Le site redémarre tout seul.

---

## 2. Photos IA (Google Gemini)

1. Va sur **aistudio.google.com/apikey** et clique sur **Create API key**.
2. Active la facturation sur ce compte Google : la génération d'images est payante, environ 0,04 € par photo.
3. Colle la clé dans Render, dans `GEMINI_API_KEY`.
4. Sur le site, va dans **Réglages** → **Tester l'IA** : tu dois voir « Clé valide ».

Le site choisit tout seul le meilleur modèle d'image disponible pour cette clé.

---

## 3. eBay

**Côté développeur** (une fois) :

1. Crée un compte sur **developer.ebay.com** (la validation peut prendre jusqu'à un jour).
2. Va dans **Application Keys** et crée un jeu de clés **Production**.
   Si eBay parle de « Marketplace account deletion », choisis l'option d'exemption (le site ne stocke aucune donnée eBay).
3. Note l'**App ID** et le **Cert ID**.
4. Va dans **User Tokens** → **Get a Token from eBay via Your Application** → **Add eBay Redirect URL**. Remplis :
   - **Auth accepted URL** : `https://TON-SITE.onrender.com/auth/ebay/callback`
   - **Auth declined URL** : la même adresse
   - **Privacy policy URL** : `https://TON-SITE.onrender.com`

   Enregistre, puis copie le **RuName** (un nom du type `Prenom_Nom-Prenom-dropbo-abcdef`).
5. Dans Render, remplis `EBAY_CLIENT_ID` (App ID), `EBAY_CLIENT_SECRET` (Cert ID) et `EBAY_RUNAME` (RuName).

**Côté vendeur** (le compte eBay de ton pote) :

6. Crée les **règles de vente** : une pour la livraison, une pour le paiement et une pour les retours (eBay → Mon compte → Préférences du vendeur → Règles de vente).
7. Sur DropBoost, va dans **Réglages** → **Connecter mon compte eBay**, puis connecte-toi.

L'adresse exacte à copier s'affiche aussi dans **Réglages** du site.

---

## 4. Etsy

> ⚠️ Etsy accepte le fait-main, le vintage et les fournitures. Revendre un produit AliExpress tel quel peut faire suspendre la boutique. eBay n'a pas cette règle.

1. Va sur **etsy.com/developers/register** et crée une application. La validation d'Etsy peut prendre quelques jours.
2. Dans l'application, ajoute l'adresse de redirection (Callback URL) : `https://TON-SITE.onrender.com/auth/etsy/callback`
3. Dans Render, remplis `ETSY_KEYSTRING` et `ETSY_SHARED_SECRET`.
4. Sur DropBoost, va dans **Réglages** → **Connecter mon compte Etsy**.

---

## Utilisation

1. Ouvre le lien du site et entre le mot de passe.
2. Colle le lien du produit AliExpress et le prix affiché, puis clique sur **Créer la fiche**.
3. **Photos** : choisis une photo de référence et un style, puis clique sur **Générer les photos**. Clique sur les photos pour choisir celles de l'annonce (★ = photo principale).
4. **Texte** : il est déjà écrit. Tu peux changer le ton ou demander une autre version.
5. **Prix** : règle la marge avec le curseur. Le bénéfice s'affiche en direct.
6. **Publier** : clique sur **Publier sur eBay** ou **Publier sur Etsy**, vérifie la catégorie, puis clique sur **Publier**.

## Bon à savoir

- **Version gratuite de Render** : le site s'endort après 15 minutes sans visite. La première ouverture prend alors environ 1 minute, ensuite tout est rapide.
- Les produits sont enregistrés **dans le navigateur** utilisé. Garde le même navigateur (sur ordinateur, c'est le plus confortable).
- Si une publication échoue, le message d'erreur d'eBay ou d'Etsy s'affiche dans la fenêtre. Le plus souvent, c'est une caractéristique obligatoire à compléter ou une règle de vente qui manque.
- Pour personnaliser la surprise d'anniversaire, modifie `static/cadeau.js` (les prénoms) avant de l'envoyer sur GitHub.
