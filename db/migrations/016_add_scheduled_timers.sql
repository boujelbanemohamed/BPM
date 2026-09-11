-- Minuteurs BPMN (bpmn:intermediateCatchEvent + bpmn:timerEventDefinition) :
-- une instance qui atteint un tel nœud s'y arrête et attend d'être
-- relancée par le poller interne (voir backend/src/services/timerPoller.ts)
-- une fois le délai écoulé, sans requête HTTP. Sans effet si déjà
-- appliquée.

CREATE TABLE IF NOT EXISTS scheduled_timers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES process_instances(id) ON DELETE CASCADE,
  element_id  VARCHAR(255) NOT NULL,
  fire_at     TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instance_id, element_id)
);
CREATE INDEX IF NOT EXISTS idx_scheduled_timers_fire_at ON scheduled_timers(fire_at);
