-- Sécurité de l'authentification :
--   1) mot de passe oublié en libre-service (lien à durée limitée)
--   2) authentification à deux facteurs (TOTP + codes de secours)
--   3) rafraîchissement silencieux de session (au lieu d'une déconnexion
--      sèche à l'expiration du token d'accès)
-- Sans effet si déjà appliquée.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);

-- Un token opaque (haute entropie, aléatoire côté serveur) est identifié par
-- le hash SHA-256 de sa valeur brute : contrairement à un mot de passe, il
-- n'y a rien à protéger d'une attaque par dictionnaire, donc un hash rapide
-- suffit et permet une recherche directe par égalité (bcrypt ne le permet
-- pas, puisqu'il faudrait comparer contre chaque ligne).
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(64) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  replaced_by UUID REFERENCES refresh_tokens(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS two_factor_backup_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  VARCHAR(255) NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_two_factor_backup_codes_user ON two_factor_backup_codes(user_id);

INSERT INTO notification_templates (key, heading, subject, body_html, variables) VALUES
  ('PASSWORD_RESET_REQUESTED', 'Réinitialisation de votre mot de passe', '[BPM] Réinitialisation de votre mot de passe',
   '<p>Bonjour {{recipientName}},</p>
     <p>Vous avez demandé la réinitialisation du mot de passe de votre compte BPM Platform.</p>
     <p><a href="{{resetUrl}}" style="color:#2f5ce0;">Choisir un nouveau mot de passe</a></p>
     <p style="background:#fff8e8;border:1px solid #f0d999;border-radius:6px;padding:10px 12px;">
       Ce lien expire dans {{expiresInMinutes}} minutes. Si vous n''êtes pas à l''origine de cette demande, ignorez cet email : votre mot de passe actuel reste valide.
     </p>',
   ARRAY['recipientName','resetUrl','expiresInMinutes'])
ON CONFLICT (key) DO NOTHING;

INSERT INTO notification_templates_defaults (key, heading, subject, body_html)
  SELECT key, heading, subject, body_html FROM notification_templates WHERE key = 'PASSWORD_RESET_REQUESTED'
ON CONFLICT (key) DO NOTHING;
