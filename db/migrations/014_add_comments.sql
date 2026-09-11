-- Fil de discussion (commentaires) sur une instance de processus, avec une
-- référence optionnelle à une tâche précise. Même schéma que la table
-- documents (instance_id obligatoire, task_id nullable) pour rester
-- cohérent avec le modèle existant de pièces jointes. Sans effet si déjà
-- appliquée.

CREATE TABLE IF NOT EXISTS comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES process_instances(id) ON DELETE CASCADE,
  task_id     UUID REFERENCES tasks(id) ON DELETE SET NULL,
  author_id   UUID NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_instance ON comments(instance_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
