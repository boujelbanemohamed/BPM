-- Migration incrémentale pour une base déjà initialisée avec une version
-- antérieure de db/init.sql (avant l'accès aux pages configurable par
-- rôle). Sans effet si déjà appliquée.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'page_access_level') THEN
    CREATE TYPE page_access_level AS ENUM ('NONE', 'VIEW', 'FULL');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS role_page_permissions (
  role_id      INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  page_key     VARCHAR(50) NOT NULL,
  access_level page_access_level NOT NULL DEFAULT 'NONE',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID REFERENCES users(id),
  PRIMARY KEY (role_id, page_key)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_role_page_permissions_updated_at') THEN
    CREATE TRIGGER trg_role_page_permissions_updated_at
      BEFORE UPDATE ON role_page_permissions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Préserve le comportement actuel (les rôles non-admin peuvent déjà
-- consulter/parcourir les processus) : sans cette ligne, cette migration
-- retirerait silencieusement un accès dont ils disposaient de fait.
INSERT INTO role_page_permissions (role_id, page_key, access_level)
  SELECT id, 'PROCESSES_DESIGN', 'VIEW' FROM roles WHERE name <> 'ADMIN'
ON CONFLICT (role_id, page_key) DO NOTHING;
