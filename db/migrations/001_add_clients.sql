-- Migration incrémentale pour une base déjà initialisée avec une version
-- antérieure de db/init.sql (avant l'introduction du module Clients).
-- Sans effet si déjà appliquée (IF NOT EXISTS partout).

CREATE TABLE IF NOT EXISTS clients (
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_clients_updated_at'
  ) THEN
    CREATE TRIGGER trg_clients_updated_at
      BEFORE UPDATE ON clients
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);

ALTER TABLE process_instances ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
CREATE INDEX IF NOT EXISTS idx_instances_client ON process_instances(client_id);
