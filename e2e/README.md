# Tests de bout en bout (Playwright)

Suite qui pilote un vrai navigateur sur la plateforme en cours d'exécution :
authentification, navigation, processus (designer, cycle de vie, corbeille,
import XML, matrice de droits), workflow complet opérateur → valideur, tâches,
instances, commentaires, documents, clients, bibliothèque, notifications,
profil, tableau de bord, administration (utilisateurs, rôles, audit, champs,
base de données, modèles d'emails), contrôle d'accès, sécurité et traduction EN.

## Prérequis

- Backend (`:4000`) et frontend (`:5173`) démarrés avec `npm run dev`.
- Base initialisée avec `db/init.sql` (comptes de démo `admin@`, `operator@`,
  `validator@bpm.local`, mot de passe `Admin123!`).

## Lancer

```bash
cd e2e
npm install
npx playwright install chromium   # une seule fois
npm test                          # toute la suite (~2 min)
npx playwright test workflow      # un seul fichier
npm run test:headed               # en voyant le navigateur
npm run report                    # rapport HTML du dernier passage
```

Variables facultatives : `E2E_WEB_URL`, `E2E_API_URL`, `E2E_ADMIN_EMAIL`,
`E2E_OPERATOR_EMAIL`, `E2E_VALIDATOR_EMAIL`, `E2E_PASSWORD`.

## Données créées

Chaque exécution crée ses propres données, toutes préfixées `E2E … <id>` :
processus, instances, clients, dossiers, utilisateurs `e2e-…@example.com` et un
rôle `E2E_<ID>` (les rôles ne sont pas supprimables). Les données de démo ne
sont pas modifiées, la configuration SMTP et les modèles d'emails non plus.
À lancer sur une base de développement ou de recette, jamais en production.

## Sessions

Les jetons de chaque rôle sont conservés dans `e2e/.auth/` (ignoré par git) et
rafraîchis au besoin, pour limiter les connexions. Si la base a été
réinitialisée, supprimer ce dossier.
