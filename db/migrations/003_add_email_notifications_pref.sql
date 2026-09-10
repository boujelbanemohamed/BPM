-- Migration incrémentale pour une base déjà initialisée avec une version
-- antérieure de db/init.sql (avant la préférence de notification email).
-- Sans effet si déjà appliquée.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
