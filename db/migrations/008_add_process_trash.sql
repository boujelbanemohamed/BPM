-- Corbeille pour les processus : suppression logique (soft-delete) avant
-- suppression définitive. Sans effet si déjà appliquée.

ALTER TABLE processes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE processes ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_processes_deleted_at ON processes(deleted_at);
