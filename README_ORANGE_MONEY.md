# Paiement Orange Money Burkina Faso (OMBF) — Flash-Archi SaaS

Intégration **directe** (sans agrégateur) de l'API Orange Money Burkina
(`om-webpay`) pour les abonnements en **Franc CFA**.

> Documentation officielle : https://developer.orange.com/apis/om-webpay/bf

---

## 1. Obtenir un compte marchand Orange Money Burkina

1. Créez un compte développeur sur https://developer.orange.com.
2. Créez un projet **« Orange Money Web Payment »** — zone **Burkina Faso (BF)**.
3. Orange fournit, après validation de votre dossier marchand :
   - **Client ID** (identifiant OAuth2) ;
   - **Client Secret** (secret OAuth2 — jamais commité) ;
   - **Merchant Key** (clé de transaction du compte marchand).
4. Le projet activé en prod délivre aussi un **certificat IP** pour la
   signature des requêtes sortantes (à installer côté serveur si requis).
5. Fournissez à Orange vos URLs de callback :
   - **return_url** : page de succès (`https://app.flash-archi.com/checkout/success`)
   - **cancel_url** : page d'annulation (`https://app.flash-archi.com/checkout/cancel`)
   - **notif_url** : webhook (`https://api.flash-archi.com/api/payment/orange/webhook`)

> Le compte marchand OMBF est ouvert auprès d'Orange Burkina. Un dépôt de
> garantie / dossier KYC est généralement requis. Support : votre chargé
> d'affaires Orange Money BF + support développeur Orange.

---

## 2. Configuration des identifiants API

Copiez `.env.example` vers `.env` (jamais commité) et renseignez :

```env
# ORANGE_API_ENV=test  ou  prod
ORANGE_API_ENV=test
ORANGE_CLIENT_ID=your_client_id
ORANGE_CLIENT_SECRET=your_client_secret
ORANGE_MERCHANT_KEY=your_merchant_key

ORANGE_RETURN_URL=https://app.flash-archi.com/checkout/success
ORANGE_CANCEL_URL=https://app.flash-archi.com/checkout/cancel
ORANGE_NOTIF_URL=https://api.flash-archi.com/api/payment/orange/webhook
```

### Mode simulation (démo sans credentials réels)

Ajoutez `ORANGE_SIMULATE=true`. Dans ce mode le service **ne contacte pas
Orange** : chaque paiement est créé avec un token local et immédiatement
considéré **accepté** — le flux complet est déterministe (tests, démos).

> ⚠️ En production, **retirez** `ORANGE_SIMULATE` et passez
> `ORANGE_API_ENV=prod`. Ne commettez jamais un secret.

Environnements URL (gérés automatiquement par `src/services/orange-money.js`) :

| Mode    | Base API                        | OAuth2                          |
|---------|---------------------------------|---------------------------------|
| `test`  | `https://api-s2.orange.com/orangemoney/v1/bf` | `https://api-s2.orange.com/oauth/v3/token` |
| `prod`  | `https://api.orange.com/orangemoney/v1/bf`    | `https://api.orange.com/oauth/v3/token`    |

---

## 3. Endpoints exposés

| Méthode | Route                                | Auth    | Description                                    |
|---------|--------------------------------------|---------|------------------------------------------------|
| POST    | `/api/payment/create`                | Bearer  | Initie un paiement → renvoie `paymentUrl` + `orderId` (rate-limite 5/min/IP). |
| POST    | `/api/payment/orange/webhook`        | **Publique** | Reçoit la notification Orange → met à jour DB. |
| GET     | `/api/payment/status/:orderId`       | Bearer  | Statut du paiement (relecture Orange si pending). |
| GET     | `/api/payment/account/:userId`       | Bearer  | Quota + plan + historique (page `/account`). |

Flux type :

```
Frontend --POST /api/payment/create--> Backend
  Backend --OAuth2 token--> Orange (client_credentials)
  Backend --webpayment--> Orange → { webpay_url, token }
Backend --≥ { paymentUrl, orderId }--> Frontend
Frontend --redirect--> Orange webpay (ou page sandbox)
Orange  --notif_url (webhook)--> POST /api/payment/orange/webhook
  Backend --checkPaymentStatus(token)--> Orange { SUCCESSFUL }
  Backend → payment.status='accepted', user.plan='pro', quota=50
Frontend --GET /api/payment/status/:orderId (polling)--> 'accepted'
```

---

## 4. Test du flux de paiement (mode sandbox)

### A. Backend en mode simulation (le plus simple)

```bash
cd /home/betsa/flash-archi
LLM_PROVIDER=mock AUTH_ENABLED=true API_KEY=test-key \
ORANGE_SIMULATE=true PORT=8099 node src/index.js
```

Puis :

```bash
# 1. Créer un paiement (userId = votre clé API)
curl -s -X POST http://127.0.0.1:8099/api/payment/create \
  -H "Authorization: Bearer test-key" -H "Content-Type: application/json" \
  -d '{"amount":17400,"description":"Plan Pro","userId":"test-key","plan":"pro","phone":"+22670123456","email":"demo@test.bf"}'

# 2. Vérifier le statut (en sim -> accepted + quota 50)
curl -s http://127.0.0.1:8099/api/payment/status/<orderId> \
  -H "Authorization: Bearer test-key"

# 3. Compte (plan=pro, quotaRemaining=50, historique)
curl -s http://127.0.0.1:8099/api/payment/account/test-key \
  -H "Authorization: Bearer test-key"
```

Un test E2E automatisé est disponible :

```bash
node tests/e2e-payment-sim.mjs   # vérifie create→status→account→quota (49)
```

### B. Backend avec vraie API Orange (test)

1. Met `ORANGE_API_ENV=test` + les credentials sandbox (`ORANGE_CLIENT_ID`,
   `ORANGE_CLIENT_SECRET`, `ORANGE_MERCHANT_KEY`) dans `.env`.
2. **Retire** `ORANGE_SIMULATE`.
3. Expose ton API localement : `ngrok http 8080`.
4. Renseigne l'URL ngrok comme `ORANGE_NOTIF_URL` (webhook) — ou configure-la
   dans la console Orange — pour que les callbacks vous atteignent.
5. Déclenche un paiement test depuis `/checkout` et valide-le sur ton téléphone.

### C. Flow complet via l'interface web

`/pricing` → « S'abonner avec Orange Money » → `/checkout?plan=pro` →
formulaire (nom, email, numéro +226) → POST create → redirection Orange →
code USSD simulé → `/checkout/success` (polling) → quota 50.

---

## 5. Gestion des webhooks

- Le webhook est **public** (sans Bearer), exclu de l'auth dans `app.js`.
- Le backend **ne fait pas confiance au corps seul** : il rappelle
  `orangeMoneyService.checkPaymentStatus(token)` et ne met à jour l'état que
  sur un statut Orange confirmé (`SUCCESSFUL`).
- **Montant vérifié** : si le montant reçu ≠ montant attendu, le paiement
  passe en `failed` (anti-altération).

Pour une sécurité renforcée en production (quand Orange le documente) :
- vérifier la **signature HMAC** du payload avec `ORANGE_MERCHANT_KEY` ;
- permettre une IP-whitelist des serveurs Orange.

---

## 6. Monitoring des transactions

- Table SQLite `payments` : `order_id`, `status`, `amount`, `phone`,
  `orange_token`, `orange_reference`, `txid`, timestamps.
- Table `users` : `plan`, `quota_remaining`, `quota_reset_at`,
  `subscription_status`, `last_payment_id`.
- Logs structurés (`pino`) : `payment created`, `webhook: orange status`,
  `payment accepted, plan activated`, etc.
- Quota mensuel : remise à zéro automatique au 1er du mois
  (`applyMonthlyReset` / `nextMonthlyReset` dans `src/payments-store.js`).

Cas d'erreur gérés :
1. API Orange indisponible → HTTP 502 « Service temporairement indisponible ».
2. Paiement resté `pending` > 5 min → le GET `/status/:orderId` relit Orange.
3. Webhook non reçu → la page `/checkout/success` poll toutes les 3 s
   pendant 2 min, et consulte l'état auprès d'Orange.
4. Numéro invalide → validation frontend `+226XXXXXXXX` avant envoi.
5. Refus/annulation → `refused` / `cancelled`, page dédiée.

---

## 7. Support client

- **Support produit (Flux-Archi)** : `contact@flash-archi.com`
- **Support développeur Orange** : https://developer.orange.com (ticket)
- **Commercial Orange Money BF** : votre chargé d'affaires Orange Burkina.
- En cas de litige sur une transaction : conserver `order_id`, `orange_reference`
  et `txid` (Jetons d'audit dans `GET /api/payment/account/:userId`).

---

## Sécurité (rappel)

1. `ORANGE_CLIENT_SECRET` et `ORANGE_MERCHANT_KEY` : **jamais commités**, jamais
   exposés côté frontend. Voir `.env.example` (placeholders) et `.gitignore`.
2. Le webhook est validé par relecture de l'état Orange, pas par confiance au corps.
3. Rate limiting sur `/api/payment/create` : 5 requêtes/min/IP.
4. La clé API utilisateur sert d'identifiant de quota. L'activation d'un plan
   requiert un paiement Orange confirmé.
5. Tous les paiements sont loggés pour audit.

---

## Fichiers concernés

- Backend : `src/services/orange-money.js`, `src/payments-store.js`,
  `src/routes/payment.js`, intégrations dans `src/app.js` et `.env.example`.
- Frontend : `src/views/{Pricing,Checkout,CheckoutSuccess,CheckoutCancel,Account}View.vue`,
  `src/router/index.ts`, `src/api/{client,types}.ts`, `src/components/AppNavBar.vue`.
- Tests : `tests/e2e-payment-sim.mjs`.