-- Ajoute une référence unique générée automatiquement à chaque processus
-- (ex: PRC-00001), utilisée notamment pour identifier de façon stable les
-- différentes versions/duplications d'un même processus. Sans effet si déjà
-- appliquée.

CREATE SEQUENCE IF NOT EXISTS process_reference_seq;

ALTER TABLE processes ADD COLUMN IF NOT EXISTS reference VARCHAR(20);

-- Backfill des lignes existantes, dans l'ordre de création, avant de rendre
-- la colonne obligatoire.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM processes
  WHERE reference IS NULL
)
UPDATE processes p
SET reference = 'PRC-' || lpad(rn::text, 5, '0')
FROM ordered o
WHERE o.id = p.id;

SELECT setval('process_reference_seq', GREATEST((SELECT COUNT(*) FROM processes), 1));

ALTER TABLE processes ALTER COLUMN reference SET DEFAULT ('PRC-' || lpad(nextval('process_reference_seq')::text, 5, '0'));
ALTER TABLE processes ALTER COLUMN reference SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'processes_reference_key'
  ) THEN
    ALTER TABLE processes ADD CONSTRAINT processes_reference_key UNIQUE (reference);
  END IF;
END $$;
