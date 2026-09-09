# BPM Platform

Plateforme de Business Process Management (BPM) légère, open-source, sur mesure : modélisation BPMN 2.0 visuelle, moteur d'exécution, gestion des utilisateurs avec délégation/suppléance à 2 niveaux, RBAC fin par processus/étape/rôle, audit trail complet et notifications multi-canaux (in-app + email).

## Stack technique

| Couche | Techno |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + Lucide Icons + [bpmn-js](https://bpmn.io) |
| Backend | Node.js + Express + TypeScript + `pg` (SQL brut, transactions explicites) |
| Base de données | PostgreSQL 16 |
| Auth | JWT (HS256) + bcrypt |
| Email | Nodemailer (templates HTML) |
| Logs | Winston (fichiers + console en dev) |
| Conteneurisation | Docker / Podman, images non-root, compatible RHEL + SELinux (`:z`) |

## Arborescence

```
bpm-platform-pro/
├── backend/                 API Node/Express TypeScript
│   ├── src/
│   │   ├── config/env.ts        validation des variables d'environnement (zod)
│   │   ├── db/                  pool pg, repository users
│   │   ├── middleware/          auth JWT, RBAC, gestion d'erreurs
│   │   ├── lib/                 logger, mailer, audit, parseur BPMN, évaluateur de conditions
│   │   ├── services/            délégation/suppléance, moteur de workflow, permissions, notifications
│   │   ├── routes/               auth, users, admin/users, processes, instances, tasks, documents, notifications, audit, roles
│   │   └── index.ts              bootstrap Express
│   └── Dockerfile
├── frontend/                 SPA React/TypeScript
│   ├── src/
│   │   ├── api/client.ts         client HTTP typé
│   │   ├── context/AuthContext.tsx
│   │   ├── components/           Layout, BpmnDesigner (éditeur BPMN + panneau de propriétés custom)
│   │   ├── bpmn/                 extension moddle BPMN custom (bpm:assigneeRole, ...)
│   │   └── pages/                Processus, Designer, Matrice de droits, Tâches, Instances, Notifications, Profil, Admin, Audit
│   ├── nginx.conf
│   └── Dockerfile
├── db/init.sql               DDL PostgreSQL complet + données de démo (exécuté au 1er démarrage du conteneur postgres)
├── docker-compose.yml        orchestration Podman/Docker (RHEL + SELinux)
├── .env.example               identifiants PostgreSQL pour docker-compose
├── pgdata/ logs/ uploads/     points de montage (bind mounts `:z`)
```

## Modèle métier

- **Processus** : un diagramme **BPMN 2.0** (XML standard) contenant `startEvent`, `userTask`, `exclusiveGateway`, `endEvent` et des `sequenceFlow`. Les tâches utilisateur portent des attributs custom dans le namespace `bpm:` (`bpm:assigneeRole`, `bpm:assigneeUserId`, `bpm:formFields` — JSON du formulaire) ; les transitions utilisent l'élément BPMN standard `conditionExpression` avec une expression simple `champ OPERATEUR valeur` (`==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`), évaluée sans `eval()`.
- **Instance** : une exécution d'un processus publié. Le moteur (`services/workflowEngine.ts`) avance automatiquement à travers les passerelles jusqu'à la prochaine tâche humaine ou la fin du processus.
- **Tâche** : assignée soit à un **rôle** (pool ouvert à tout titulaire actif du rôle), soit à un **utilisateur nommé** (résolu dynamiquement via la chaîne de suppléance).
- **Suppléance à 2 niveaux** (`services/delegationService.ts`, fonction `resolveEffectiveAssignee`) : si le titulaire est inactif ou en congé, la tâche est automatiquement routée vers Suppléant 1, puis Suppléant 2 si celui-ci est également indisponible. La désactivation d'un compte (`POST /api/admin/users/:id/deactivate`) réassigne **instantanément** toutes ses tâches en attente.
- **Matrice de droits** (`permissions_matrix`) : par processus + étape + rôle, définit les champs de formulaire lisibles/éditables et l'accès aux documents joints. Le rôle étant porté par la tâche (`assignee_role_id`), un suppléant hérite automatiquement des mêmes droits que le titulaire pour cette étape.
- **Audit trail** (`audit_logs`) : connexions, désactivation de compte, modification de formulaire, consultation/dépôt de document, exécution par suppléance, transitions du workflow — tout est tracé avec acteur, IP et horodatage.
- **Notifications** : centre in-app (lu/non-lu, `/notifications`) + email HTML (Nodemailer) envoyés automatiquement au titulaire ou au suppléant actif à chaque assignation/délégation de tâche, désactivation de compte, ou fin de processus.

## Sécurité

- Mots de passe hachés bcrypt (12 rounds), jamais stockés/loggués en clair.
- JWT signé HS256, secret ≥ 16 caractères imposé par la validation d'environnement.
- `helmet` (en-têtes HTTP), CORS restreint à l'origine du frontend, rate-limiting sur `/api/auth/login` (20 tentatives/15 min).
- Toutes les requêtes SQL sont paramétrées (`$1, $2...`), aucune concaténation de chaînes.
- Upload de documents : liste blanche de types MIME, taille limitée (`MAX_UPLOAD_MB`), noms de fichiers randomisés sur disque, téléchargement exclusivement via un endpoint authentifié + contrôle RBAC (jamais de service de fichiers statique sur `uploads/`).
- Conditions BPMN évaluées par un parseur dédié (`lib/conditions.ts`), aucun `eval()`/`Function()`.
- Images Docker non-root, compatibles contrainte SCC "restricted" RHEL/OpenShift (répertoires accessibles en écriture au groupe 0).
- Toute exception asynchrone est capturée (`asyncHandler`) : aucune route ne peut faire planter le process Node.

**Limitations connues et acceptées** (documentées plutôt que corrigées à l'aveugle pour ne pas déstabiliser une base fonctionnelle et testée) :
- `qs` (dépendance transitive d'Express 4.22.x, dernière version 4.x publiée) reste sur un avis modéré (bypass de limite de tableau / DoS). Aucune route de cette plateforme n'accepte de paramètres de requête imbriqués construits à partir d'entrée utilisateur non validée (les seuls `req.query` utilisés — `/api/audit` — sont des chaînes simples validées par zod), donc la surface d'exploitation réelle est nulle en l'état. Un passage à Express 5 lèverait l'avis mais n'a pas été fait ici pour ne pas risquer de régression sur toutes les routes.
- `esbuild` (utilisé par Vite 5 en développement) a un avis modéré permettant à une page web de lire les réponses du serveur de dev. Cela n'affecte **que** `npm run dev` (le build de production servi par Nginx ne l'utilise pas). Un passage à Vite 8 (majeur, tout récent) n'a pas été effectué faute de pouvoir le valider entièrement dans le temps imparti.

## Démarrage — développement local (sans conteneurs)

Prérequis : Node.js 20+, PostgreSQL 16.

```bash
# 1. Base de données
createdb bpm_pro   # ou via psql : CREATE DATABASE bpm_pro OWNER <user>;
psql -d bpm_pro -f db/init.sql

# 2. Backend
cd backend
cp .env.example .env   # ajuster DATABASE_URL (host "localhost" en local), JWT_SECRET, SMTP...
npm install
npm run dev              # API sur http://localhost:4000

# 3. Frontend (autre terminal)
cd frontend
npm install
npm run dev               # http://localhost:5173 (proxy /api -> backend)
```

Comptes de démo (mot de passe **`Admin123!`**) :

| Email | Rôle |
|---|---|
| `admin@bpm.local` | ADMIN |
| `validator@bpm.local` | VALIDATOR (suppléants : backup1, backup2) |
| `operator@bpm.local` | OPERATOR |
| `backup1@bpm.local` | VALIDATOR (Suppléant 1 de validator) |
| `backup2@bpm.local` | VALIDATOR (Suppléant 2 de validator) |

Un processus **"Demande de congés"** est déjà publié pour tester le cycle complet (saisie → validation manager → passerelle conditionnelle → fin).

## Déploiement production — Podman / RHEL

```bash
# 1. Configuration
cp .env.example .env                       # identifiants PostgreSQL du compose
cp backend/.env.example backend/.env        # secrets applicatifs — VÉRIFIER que DATABASE_URL
                                             # utilise l'hôte "postgres" (nom du service compose)
                                             # et que POSTGRES_USER/PASSWORD/DB dans .env
                                             # correspondent EXACTEMENT à ceux de DATABASE_URL.
# Éditer .env et backend/.env : mots de passe, JWT_SECRET (32+ caractères aléatoires), SMTP.

# 2. Démarrage (Podman)
podman-compose up -d --build

# — ou avec Docker Compose —
docker compose up -d --build
```

L'application est servie par Nginx sur **`http://<serveur>:8080`** ; Nginx sert le build React et fait office de reverse-proxy vers l'API backend (`/api/*`) sur le réseau interne du compose — le backend et PostgreSQL ne sont jamais exposés directement à l'extérieur.

### SELinux

Les trois volumes montés en bind mount (`./pgdata`, `./logs`, `./uploads`) portent le flag `:z` dans `docker-compose.yml`, ce qui relabelle leur contexte SELinux pour un partage conteneur/hôte. Aucune action manuelle (`chcon`, `setsebool`) n'est nécessaire au-delà de `podman-compose up`.

### Vérifier le déploiement

```bash
curl -f http://localhost:8080/                 # frontend
curl -f http://localhost:8080/api/health        # backend via le reverse-proxy Nginx
podman-compose logs -f backend
```
