-- Bibliothèque de documents générale (indépendante des instances de
-- processus) : dossiers + documents rangés dedans. Sans effet si déjà
-- appliquée.

CREATE TABLE IF NOT EXISTS document_folders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_document_folders_updated_at'
  ) THEN
    CREATE TRIGGER trg_document_folders_updated_at
      BEFORE UPDATE ON document_folders
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS library_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id     UUID NOT NULL REFERENCES document_folders(id) ON DELETE CASCADE,
  filename      VARCHAR(500) NOT NULL,
  mime_type     VARCHAR(150) NOT NULL,
  size_bytes    BIGINT NOT NULL,
  storage_path  VARCHAR(1000) NOT NULL,
  uploaded_by   UUID NOT NULL REFERENCES users(id),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_library_documents_folder ON library_documents(folder_id);
