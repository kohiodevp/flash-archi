# Guide de Lancement Flash-Archi

## URLs de production
- Frontend : https://flasharchi.74.50.88.4.sslip.io
- API : https://flasharchi.74.50.88.4.sslip.io/api
- Admin NPM : http://74.50.88.4:81 (via tunnel SSH si bloqué)

## Identifiants & Clés
- Clé API de démo : `[générée via openssl rand -base64 32]` — à garder privée, voir `.env` (non versionné)
- Admin NPM : [à renseigner par l'utilisateur]

## Checklist de lancement
- [ ] Nom de domaine acheté et configuré (ou sslip.io)
- [ ] Certificats SSL valides (NPM) : vérifié via `ssl-check.sh`
- [ ] Monitoring actif : `health-check.sh` (toutes les 5 min)
- [ ] Sauvegardes quotidiennes vérifiées : `backup-db.sh` (tous les jours à 3h)
- [X] Page pricing en ligne (déployée)
- [ ] Annonce Product Hunt programmée

## Contacts & Support
- Email support : support@flash-archi.com
- Email commercial : contact@flash-archi.com
