-- Sous-processus réutilisables (bpmn:callActivity) : une instance qui
-- atteint un tel nœud crée une instance enfant sur un AUTRE processus publié
-- (référencé par process_key) et se met en pause jusqu'à ce que cette
-- instance enfant se termine (voir backend/src/services/workflowEngine.ts,
-- startSubProcess/resumeParentAfterChildCompletion). Sans effet si déjà
-- appliquée.

ALTER TABLE process_instances
  ADD COLUMN IF NOT EXISTS parent_instance_id UUID REFERENCES process_instances(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS parent_element_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_instances_parent ON process_instances(parent_instance_id);
