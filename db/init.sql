-- =====================================================================
-- BPM Platform — schéma PostgreSQL 16
-- Exécuté automatiquement au premier démarrage du conteneur postgres
-- (monté sur /docker-entrypoint-initdb.d/init.sql)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Fonction générique de mise à jour de updated_at
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Types énumérés
-- ---------------------------------------------------------------------
CREATE TYPE process_status AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE instance_status AS ENUM ('RUNNING', 'COMPLETED', 'CANCELLED');
CREATE TYPE task_status AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');
CREATE TYPE notification_type AS ENUM (
  'TASK_ASSIGNED', 'TASK_DELEGATED', 'TASK_REASSIGNED',
  'PROCESS_COMPLETED', 'ACCOUNT_DEACTIVATED', 'GENERIC'
);
CREATE TYPE page_access_level AS ENUM ('NONE', 'VIEW', 'FULL');

-- ---------------------------------------------------------------------
-- roles
-- ---------------------------------------------------------------------
CREATE TABLE roles (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(50) UNIQUE NOT NULL,
  description VARCHAR(255)
);

-- ---------------------------------------------------------------------
-- users — IAM, désactivation, congés, chaîne de suppléance à 2 niveaux
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               VARCHAR(255) UNIQUE NOT NULL,
  password_hash       VARCHAR(255) NOT NULL,
  full_name           VARCHAR(255) NOT NULL,
  first_name          VARCHAR(255),
  last_name           VARCHAR(255),
  phone               VARCHAR(50),
  avatar_url          VARCHAR(500),
  email_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  absence_start       DATE,
  absence_end         DATE,
  delegate_user_1_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  delegate_user_2_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_delegate_not_self_1 CHECK (delegate_user_1_id IS NULL OR delegate_user_1_id <> id),
  CONSTRAINT chk_delegate_not_self_2 CHECK (delegate_user_2_id IS NULL OR delegate_user_2_id <> id),
  CONSTRAINT chk_delegates_distinct CHECK (
    delegate_user_1_id IS NULL OR delegate_user_2_id IS NULL OR delegate_user_1_id <> delegate_user_2_id
  ),
  CONSTRAINT chk_absence_period CHECK (
    absence_start IS NULL OR absence_end IS NULL OR absence_end >= absence_start
  )
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_users_delegate_1 ON users(delegate_user_1_id);
CREATE INDEX idx_users_delegate_2 ON users(delegate_user_2_id);

-- ---------------------------------------------------------------------
-- user_roles
-- ---------------------------------------------------------------------
CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- ---------------------------------------------------------------------
-- role_page_permissions — accès configurable par rôle aux pages
-- d'administration/conception (le rôle ADMIN a toujours accès à tout et
-- n'est jamais présent ici ; l'absence de ligne pour un couple
-- (rôle, page) vaut NONE).
-- ---------------------------------------------------------------------
CREATE TABLE role_page_permissions (
  role_id      INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  page_key     VARCHAR(50) NOT NULL,
  access_level page_access_level NOT NULL DEFAULT 'NONE',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID REFERENCES users(id),
  PRIMARY KEY (role_id, page_key)
);

CREATE TRIGGER trg_role_page_permissions_updated_at
  BEFORE UPDATE ON role_page_permissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- processes — définitions BPMN 2.0
-- ---------------------------------------------------------------------
CREATE TABLE processes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_key VARCHAR(100) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  bpmn_xml    TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  status      process_status NOT NULL DEFAULT 'DRAFT',
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (process_key, version)
);

CREATE TRIGGER trg_processes_updated_at
  BEFORE UPDATE ON processes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_processes_key ON processes(process_key);
CREATE INDEX idx_processes_status ON processes(status);

-- ---------------------------------------------------------------------
-- clients — tiers externes (donneurs d'ordre) liés aux instances
-- ---------------------------------------------------------------------
CREATE TABLE clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  email       VARCHAR(255),
  phone       VARCHAR(50),
  address     TEXT,
  notes       TEXT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_clients_name ON clients(name);

-- ---------------------------------------------------------------------
-- process_instances
-- ---------------------------------------------------------------------
CREATE TABLE process_instances (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id         UUID NOT NULL REFERENCES processes(id),
  client_id          UUID REFERENCES clients(id),
  status             instance_status NOT NULL DEFAULT 'RUNNING',
  current_step_name  VARCHAR(255),
  current_element_id VARCHAR(255),
  form_data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_by         UUID NOT NULL REFERENCES users(id),
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ
);

CREATE INDEX idx_instances_process ON process_instances(process_id);
CREATE INDEX idx_instances_status ON process_instances(status);
CREATE INDEX idx_instances_started_by ON process_instances(started_by);
CREATE INDEX idx_instances_client ON process_instances(client_id);

-- ---------------------------------------------------------------------
-- tasks — attribution directe / rôle / suppléance
-- ---------------------------------------------------------------------
CREATE TABLE tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id           UUID NOT NULL REFERENCES process_instances(id) ON DELETE CASCADE,
  element_id            VARCHAR(255) NOT NULL,
  step_name             VARCHAR(255) NOT NULL,
  status                task_status NOT NULL DEFAULT 'PENDING',
  original_assignee_id  UUID REFERENCES users(id),
  effective_assignee_id UUID REFERENCES users(id),
  assignee_role_id      INTEGER REFERENCES roles(id),
  is_delegated          BOOLEAN NOT NULL DEFAULT FALSE,
  form_schema           JSONB NOT NULL DEFAULT '[]'::jsonb,
  form_data             JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  completed_by          UUID REFERENCES users(id)
);

CREATE INDEX idx_tasks_instance ON tasks(instance_id);
CREATE INDEX idx_tasks_effective_assignee ON tasks(effective_assignee_id, status);
CREATE INDEX idx_tasks_original_assignee ON tasks(original_assignee_id, status);
CREATE INDEX idx_tasks_role ON tasks(assignee_role_id, status);

-- ---------------------------------------------------------------------
-- documents — pièces jointes, téléchargement contrôlé par RBAC
-- ---------------------------------------------------------------------
CREATE TABLE documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id   UUID NOT NULL REFERENCES process_instances(id) ON DELETE CASCADE,
  task_id       UUID REFERENCES tasks(id) ON DELETE SET NULL,
  filename      VARCHAR(500) NOT NULL,
  mime_type     VARCHAR(150) NOT NULL,
  size_bytes    BIGINT NOT NULL,
  storage_path  VARCHAR(1000) NOT NULL,
  uploaded_by   UUID NOT NULL REFERENCES users(id),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_instance ON documents(instance_id);
CREATE INDEX idx_documents_task ON documents(task_id);

-- ---------------------------------------------------------------------
-- permissions_matrix — droits fins par processus / étape / rôle
-- field_permissions: {"<field_key>": {"read": bool, "write": bool}, ...}
-- Résolu par le rôle REQUIS de l'étape (task.assignee_role_id), donc
-- hérité automatiquement par tout suppléant qui traite la tâche.
-- ---------------------------------------------------------------------
CREATE TABLE permissions_matrix (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id            UUID NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  step_name             VARCHAR(255) NOT NULL,
  role_id               INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  field_permissions     JSONB NOT NULL DEFAULT '{}'::jsonb,
  can_view_documents    BOOLEAN NOT NULL DEFAULT TRUE,
  can_upload_documents  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (process_id, step_name, role_id)
);

CREATE TRIGGER trg_permissions_matrix_updated_at
  BEFORE UPDATE ON permissions_matrix
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_permissions_process_step ON permissions_matrix(process_id, step_name);

-- ---------------------------------------------------------------------
-- audit_logs — traçabilité complète
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100),
  entity_id   VARCHAR(255),
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address  VARCHAR(64),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);

-- ---------------------------------------------------------------------
-- notifications — centre in-app (lu/non-lu) + déclencheur d'email
-- ---------------------------------------------------------------------
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       notification_type NOT NULL DEFAULT 'GENERIC',
  title      VARCHAR(255) NOT NULL,
  message    TEXT NOT NULL,
  link       VARCHAR(500),
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

-- ---------------------------------------------------------------------
-- smtp_settings — configuration SMTP éditable depuis l'UI admin
-- (ligne singleton ; si host est vide, le backend retombe sur les
-- variables d'environnement du fichier .env)
-- ---------------------------------------------------------------------
CREATE TABLE smtp_settings (
  id           INTEGER PRIMARY KEY DEFAULT 1,
  host         VARCHAR(255),
  port         INTEGER NOT NULL DEFAULT 587,
  secure       BOOLEAN NOT NULL DEFAULT FALSE,
  username     VARCHAR(255),
  password     VARCHAR(255),
  from_address VARCHAR(255),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID REFERENCES users(id),
  CONSTRAINT chk_smtp_settings_singleton CHECK (id = 1)
);

CREATE TRIGGER trg_smtp_settings_updated_at
  BEFORE UPDATE ON smtp_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO smtp_settings (id) VALUES (1);

-- ---------------------------------------------------------------------
-- notification_templates — contenu des emails, éditable depuis l'UI admin
-- ---------------------------------------------------------------------
CREATE TABLE notification_templates (
  key         VARCHAR(50) PRIMARY KEY,
  heading     VARCHAR(255) NOT NULL,
  subject     VARCHAR(255) NOT NULL,
  body_html   TEXT NOT NULL,
  variables   TEXT[] NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES users(id)
);

CREATE TRIGGER trg_notification_templates_updated_at
  BEFORE UPDATE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO notification_templates (key, heading, subject, body_html, variables) VALUES
  ('WELCOME', 'Bienvenue sur BPM Platform', '[BPM] Bienvenue — votre compte a été créé',
   '<p>Bonjour {{recipientName}},</p>
     <p>Un compte vient d''être créé pour vous sur BPM Platform par un administrateur.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f4f6f9;border-radius:6px;margin:12px 0;">
       <tr><td style="padding:10px 12px;"><strong>Email :</strong> {{email}}</td></tr>
       <tr><td style="padding:0 12px 10px;"><strong>Mot de passe temporaire :</strong> {{temporaryPassword}}</td></tr>
     </table>
     <p>Nous vous recommandons de changer ce mot de passe dès votre première connexion, depuis la page "Mon profil".</p>
     <p><a href="{{loginUrl}}" style="color:#2f5ce0;">Me connecter</a></p>',
   ARRAY['recipientName','email','temporaryPassword','loginUrl']),

  ('PASSWORD_CHANGED_SELF', 'Mot de passe modifié', '[BPM] Votre mot de passe a été modifié',
   '<p>Bonjour {{recipientName}},</p>
     <p>Le mot de passe de votre compte BPM Platform vient d''être modifié.</p>
     <p style="background:#fff8e8;border:1px solid #f0d999;border-radius:6px;padding:10px 12px;">
       Si vous n''êtes pas à l''origine de cette action, contactez immédiatement un administrateur.
     </p>',
   ARRAY['recipientName']),

  ('PASSWORD_CHANGED_BY_ADMIN', 'Mot de passe modifié', '[BPM] Votre mot de passe a été modifié',
   '<p>Bonjour {{recipientName}},</p>
     <p>Le mot de passe de votre compte BPM Platform vient d''être réinitialisé par un administrateur.</p>
     <p style="background:#fff8e8;border:1px solid #f0d999;border-radius:6px;padding:10px 12px;">
       Si vous n''êtes pas à l''origine de cette action, contactez immédiatement un administrateur.
     </p>',
   ARRAY['recipientName']),

  ('TASK_ASSIGNED', 'Nouvelle tâche à traiter', '[BPM] Nouvelle tâche : {{taskName}}',
   '<p>Bonjour {{recipientName}},</p>
     <p>La tâche <strong>{{taskName}}</strong> du processus <strong>{{processName}}</strong> vous a été assignée et attend votre traitement.</p>
     <p><a href="{{tasksUrl}}" style="color:#2f5ce0;">Ouvrir mes tâches</a></p>',
   ARRAY['recipientName','taskName','processName','tasksUrl']),

  ('TASK_DELEGATED', 'Nouvelle tâche à traiter', '[BPM] Nouvelle tâche : {{taskName}}',
   '<p>Bonjour {{recipientName}},</p>
     <p>La tâche <strong>{{taskName}}</strong> du processus <strong>{{processName}}</strong> vous a été assignée et attend votre traitement.</p>
     <p style="background:#fff8e8;border:1px solid #f0d999;border-radius:6px;padding:10px 12px;">
       Cette tâche vous est confiée <strong>en tant que suppléant</strong> de {{originalAssigneeName}}.
     </p>
     <p><a href="{{tasksUrl}}" style="color:#2f5ce0;">Ouvrir mes tâches</a></p>',
   ARRAY['recipientName','taskName','processName','originalAssigneeName','tasksUrl']),

  ('ACCOUNT_DEACTIVATED', 'Compte désactivé', '[BPM] Votre compte a été désactivé',
   '<p>Bonjour {{recipientName}},</p>
     <p>Votre compte BPM Platform vient d''être désactivé par un administrateur.</p>
     <p>{{reassignedCount}} tâche(s) en attente ont été automatiquement réassignées à votre chaîne de suppléance.</p>',
   ARRAY['recipientName','reassignedCount']),

  ('PROCESS_COMPLETED', 'Processus terminé', '[BPM] Processus terminé : {{processName}}',
   '<p>Bonjour {{recipientName}},</p>
     <p>Le processus <strong>{{processName}}</strong> que vous avez démarré est terminé.</p>
     <p>Issue : <strong>{{outcome}}</strong></p>',
   ARRAY['recipientName','processName','outcome']);

-- Copie figée du contenu ci-dessus, jamais modifiée par l'UI admin,
-- utilisée uniquement pour la fonction "Réinitialiser" d'un modèle.
CREATE TABLE notification_templates_defaults (
  key       VARCHAR(50) PRIMARY KEY,
  heading   VARCHAR(255) NOT NULL,
  subject   VARCHAR(255) NOT NULL,
  body_html TEXT NOT NULL
);

INSERT INTO notification_templates_defaults (key, heading, subject, body_html)
  SELECT key, heading, subject, body_html FROM notification_templates;

-- =====================================================================
-- Seed : rôles, utilisateurs de démo, chaîne de suppléance, processus
-- =====================================================================

INSERT INTO roles (name, description) VALUES
  ('ADMIN',     'Administrateur de la plateforme'),
  ('VALIDATOR', 'Validateur de workflow'),
  ('OPERATOR',  'Opérateur / utilisateur standard');

-- Accès par défaut des rôles non-admin : consultation des processus
-- (comportement déjà existant avant l'introduction de cette permission,
-- préservé pour ne pas régresser). Tout le reste (Utilisateurs, Audit,
-- Base de données, Champs, Notifications, Rôles, Matrice de droits)
-- reste à NONE tant qu'un administrateur ne l'octroie pas explicitement.
INSERT INTO role_page_permissions (role_id, page_key, access_level)
  SELECT id, 'PROCESSES_DESIGN', 'VIEW' FROM roles WHERE name <> 'ADMIN';

-- Mot de passe de tous les comptes de démo : Admin123!
INSERT INTO users (id, email, password_hash, full_name, first_name, last_name, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin@bpm.local',     crypt('Admin123!', gen_salt('bf', 12)), 'Administrateur Système', 'Administrateur', 'Système',     TRUE),
  ('22222222-2222-2222-2222-222222222222', 'validator@bpm.local', crypt('Admin123!', gen_salt('bf', 12)), 'Valérie Validateur',     'Valérie',        'Validateur',  TRUE),
  ('33333333-3333-3333-3333-333333333333', 'operator@bpm.local',  crypt('Admin123!', gen_salt('bf', 12)), 'Olivier Opérateur',      'Olivier',        'Opérateur',   TRUE),
  ('44444444-4444-4444-4444-444444444444', 'backup1@bpm.local',   crypt('Admin123!', gen_salt('bf', 12)), 'Brigitte Suppléant1',    'Brigitte',       'Suppléant1',  TRUE),
  ('55555555-5555-5555-5555-555555555555', 'backup2@bpm.local',   crypt('Admin123!', gen_salt('bf', 12)), 'Bernard Suppléant2',     'Bernard',        'Suppléant2',  TRUE);

INSERT INTO user_roles (user_id, role_id)
SELECT '11111111-1111-1111-1111-111111111111', id FROM roles WHERE name = 'ADMIN';
INSERT INTO user_roles (user_id, role_id)
SELECT '22222222-2222-2222-2222-222222222222', id FROM roles WHERE name = 'VALIDATOR';
INSERT INTO user_roles (user_id, role_id)
SELECT '33333333-3333-3333-3333-333333333333', id FROM roles WHERE name = 'OPERATOR';
INSERT INTO user_roles (user_id, role_id)
SELECT '44444444-4444-4444-4444-444444444444', id FROM roles WHERE name = 'VALIDATOR';
INSERT INTO user_roles (user_id, role_id)
SELECT '55555555-5555-5555-5555-555555555555', id FROM roles WHERE name = 'VALIDATOR';

-- Chaîne de suppléance de démonstration : Valérie (VALIDATOR) a pour
-- suppléant 1 Brigitte et suppléant 2 Bernard.
UPDATE users
SET delegate_user_1_id = '44444444-4444-4444-4444-444444444444',
    delegate_user_2_id = '55555555-5555-5555-5555-555555555555'
WHERE id = '22222222-2222-2222-2222-222222222222';

-- Processus de démonstration publié : "Demande de congés"
INSERT INTO processes (id, process_key, name, description, bpmn_xml, version, status, created_by)
VALUES (
  '66666666-6666-6666-6666-666666666666',
  'demande-conges',
  'Demande de congés',
  'Processus de demande et validation de congés avec délégation.',
  $BPMN$<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                   xmlns:bpm="http://bpm-platform.local/schema/1.0"
                   id="Definitions_1" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_conges" name="Demande de congés" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Début">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Task_Submit" name="Saisie de la demande"
                   bpm:assigneeRole="OPERATOR"
                   bpm:formFields='[{"key":"reason","label":"Motif","type":"text","required":true},{"key":"days","label":"Nombre de jours","type":"number","required":true}]'>
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:userTask id="Task_Approve" name="Validation manager"
                   bpm:assigneeRole="VALIDATOR"
                   bpm:formFields='[{"key":"approved","label":"Approuvé ?","type":"boolean","required":true},{"key":"comment","label":"Commentaire","type":"text","required":false}]'>
      <bpmn:incoming>Flow_2</bpmn:incoming>
      <bpmn:outgoing>Flow_3</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="Gateway_Decision" name="Décision" default="Flow_Rejected">
      <bpmn:incoming>Flow_3</bpmn:incoming>
      <bpmn:outgoing>Flow_Approved</bpmn:outgoing>
      <bpmn:outgoing>Flow_Rejected</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:endEvent id="EndEvent_Approved" name="Approuvée">
      <bpmn:incoming>Flow_Approved</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:endEvent id="EndEvent_Rejected" name="Rejetée">
      <bpmn:incoming>Flow_Rejected</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_Submit" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Submit" targetRef="Task_Approve" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Task_Approve" targetRef="Gateway_Decision" />
    <bpmn:sequenceFlow id="Flow_Approved" sourceRef="Gateway_Decision" targetRef="EndEvent_Approved">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">approved == true</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_Rejected" sourceRef="Gateway_Decision" targetRef="EndEvent_Rejected" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_conges">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="152" y="182" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Submit_di" bpmnElement="Task_Submit">
        <dc:Bounds x="240" y="160" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Approve_di" bpmnElement="Task_Approve">
        <dc:Bounds x="400" y="160" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_Decision_di" bpmnElement="Gateway_Decision" isMarkerVisible="true">
        <dc:Bounds x="560" y="175" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_Approved_di" bpmnElement="EndEvent_Approved">
        <dc:Bounds x="672" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_Rejected_di" bpmnElement="EndEvent_Rejected">
        <dc:Bounds x="672" y="242" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="188" y="200" />
        <di:waypoint x="240" y="200" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="340" y="200" />
        <di:waypoint x="400" y="200" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_3_di" bpmnElement="Flow_3">
        <di:waypoint x="500" y="200" />
        <di:waypoint x="560" y="200" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Approved_di" bpmnElement="Flow_Approved">
        <di:waypoint x="585" y="175" />
        <di:waypoint x="585" y="120" />
        <di:waypoint x="672" y="120" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Rejected_di" bpmnElement="Flow_Rejected">
        <di:waypoint x="585" y="225" />
        <di:waypoint x="585" y="260" />
        <di:waypoint x="672" y="260" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
$BPMN$,
  1,
  'PUBLISHED',
  '11111111-1111-1111-1111-111111111111'
);

-- Matrice de droits par défaut pour le processus de démo
INSERT INTO permissions_matrix (process_id, step_name, role_id, field_permissions, can_view_documents, can_upload_documents)
SELECT '66666666-6666-6666-6666-666666666666', 'Task_Submit', id,
       '{"reason": {"read": true, "write": true}, "days": {"read": true, "write": true}}'::jsonb,
       TRUE, TRUE
FROM roles WHERE name = 'OPERATOR';

INSERT INTO permissions_matrix (process_id, step_name, role_id, field_permissions, can_view_documents, can_upload_documents)
SELECT '66666666-6666-6666-6666-666666666666', 'Task_Approve', id,
       '{"reason": {"read": true, "write": false}, "days": {"read": true, "write": false}, "approved": {"read": true, "write": true}, "comment": {"read": true, "write": true}}'::jsonb,
       TRUE, FALSE
FROM roles WHERE name = 'VALIDATOR';
