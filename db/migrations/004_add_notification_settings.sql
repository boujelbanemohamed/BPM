-- Migration incrémentale pour une base déjà initialisée avec une version
-- antérieure de db/init.sql (avant les paramètres SMTP et les modèles
-- d'emails éditables depuis l'UI admin). Sans effet si déjà appliquée.

CREATE TABLE IF NOT EXISTS smtp_settings (
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_smtp_settings_updated_at') THEN
    CREATE TRIGGER trg_smtp_settings_updated_at
      BEFORE UPDATE ON smtp_settings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

INSERT INTO smtp_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS notification_templates (
  key         VARCHAR(50) PRIMARY KEY,
  heading     VARCHAR(255) NOT NULL,
  subject     VARCHAR(255) NOT NULL,
  body_html   TEXT NOT NULL,
  variables   TEXT[] NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES users(id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notification_templates_updated_at') THEN
    CREATE TRIGGER trg_notification_templates_updated_at
      BEFORE UPDATE ON notification_templates
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

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
   ARRAY['recipientName','processName','outcome'])
ON CONFLICT (key) DO NOTHING;

-- Copie figée du contenu ci-dessus, jamais modifiée par l'UI admin,
-- utilisée uniquement pour la fonction "Réinitialiser" d'un modèle.
CREATE TABLE IF NOT EXISTS notification_templates_defaults (
  key       VARCHAR(50) PRIMARY KEY,
  heading   VARCHAR(255) NOT NULL,
  subject   VARCHAR(255) NOT NULL,
  body_html TEXT NOT NULL
);

INSERT INTO notification_templates_defaults (key, heading, subject, body_html)
  SELECT key, heading, subject, body_html FROM notification_templates
ON CONFLICT (key) DO NOTHING;
