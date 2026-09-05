# Flash-Archi — Sauvegarde & Restauration

## Emplacement de la base

Par défaut : `./data/flash-archi.db` (variable `DB_PATH`, vide = mémoire seule).

## Sauvegarde

Utilise `better-sqlite3` (pas la CLI `sqlite3`) : aucune dépendance externe.

```bash
DB_PATH=./data/flash-archi.db BACKUP_DIR=./backups node scripts/backup-db.js
```

- Écrit une sauvegarde horodatée dans `BACKUP_DIR` (`./backups` par défaut).
- Utilise la commande `VACUUM INTO` / `.backup` de SQLite : sûre même pendant
  que le service écrit (pas de copie brute du fichier).
- La notification de succès apparaît sur stdout ; en cas d'échec (base en
  mémoire, fichier absent), un message d'erreur est émis et le code de sortie
  est non nul (pratique pour un cron / healthcheck).

### Shell wrapper

```bash
./scripts/backup-db.sh    # délègue à la version node
```

## Fréquence recommandée

- Staging : toutes les heures.
- Pré-production réelle : quotidien minimum.
- Rétention : 7 jours minimum, idéalement 30 jours (à automatiser hors périmètre).

### Exemple cron

```cron
0 * * * * /app/scripts/backup-db.sh >> /var/log/flash-archi-backup.log 2>&1
```

## Restauration

```bash
node scripts/restore-db.js ./backups/flash-archi-2026-08-31T18-57-22-891Z.db
```

ou via le wrapper :

```bash
./scripts/restore-db.sh ./backups/flash-archi-<ts>.db
```

- Vérifie l'existence du fichier backup.
- Sauvegarde l'état courant en `.before-restore.<ts>` avant d'écraser.
- Copie le backup vers `DB_PATH`.

## Vérification après restauration

1. Relancer le service.
2. `curl -i http://localhost:8094/readyz` → attendu `200`.
3. Interroger un job connu : `curl http://localhost:8094/api/flash-archi/jobs/<id>`.

## Bonnes pratiques

- Ne **jamais** copier brutalement le fichier SQLite si la connexion est ouverte
  (sauf WAL maîtrisé) : utiliser le script (command VACUUM INTO).
- Stocker les backups hors du répertoire applicatif et hors du serveur si
  possible (bucket objet privé chiffré).
- Tester une restauration **au moins une fois** avant de faire confiance au
  processus, puis périodiquement (mensuel).