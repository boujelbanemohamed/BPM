import { afterAll, describe, expect, it } from 'vitest';
import { pool, withTransaction } from '../db/pool';
import { startProcessInstance } from './workflowEngine';
import { pollAndFireDueTimers } from './timerPoller';
import { createTestProcess } from '../test/dbTestHelpers';

// Start -> Timer (PT30M) -> End. Utilisé en base réelle (pas de rollback,
// nettoyage via afterAll) car pollAndFireDueTimers interroge le pool
// directement, exactement comme le fait le poller en production.
const TIMER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   id="Definitions_pollertest" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_pollertest" isExecutable="true">
    <bpmn:startEvent id="Start" name="Début" />
    <bpmn:intermediateCatchEvent id="Timer1" name="Attendre">
      <bpmn:timerEventDefinition>
        <bpmn:timeDuration>PT30M</bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="End" name="Fin" />
    <bpmn:sequenceFlow id="Flow_start" sourceRef="Start" targetRef="Timer1" />
    <bpmn:sequenceFlow id="Flow_timer" sourceRef="Timer1" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

describe('timerPoller — pollAndFireDueTimers', () => {
  const createdProcessIds: string[] = [];

  afterAll(async () => {
    for (const id of createdProcessIds) {
      await pool.query('DELETE FROM process_instances WHERE process_id = $1', [id]);
      await pool.query('DELETE FROM processes WHERE id = $1', [id]);
    }
  });

  async function seedAdminId(): Promise<string> {
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', ['admin@bpm.local']);
    return rows[0].id;
  }

  it('finds a due timer via the real pool query, fires it, and advances the instance', async () => {
    const adminId = await seedAdminId();
    const process = await withTransaction((client) => createTestProcess(client, TIMER_XML, adminId));
    createdProcessIds.push(process.id);

    const instance = await withTransaction((client) => startProcessInstance(client, { process, startedById: adminId }));

    await pool.query(`UPDATE scheduled_timers SET fire_at = now() - interval '1 second' WHERE instance_id = $1`, [
      instance.id,
    ]);

    await pollAndFireDueTimers();

    const { rows } = await pool.query<{ status: string; current_step_name: string }>(
      'SELECT status, current_step_name FROM process_instances WHERE id = $1',
      [instance.id]
    );
    expect(rows[0].status).toBe('COMPLETED');
    expect(rows[0].current_step_name).toBe('Fin');

    const { rows: timerRows } = await pool.query('SELECT * FROM scheduled_timers WHERE instance_id = $1', [
      instance.id,
    ]);
    expect(timerRows).toHaveLength(0);
  });

  it('leaves a timer untouched when its delay is not yet due', async () => {
    const adminId = await seedAdminId();
    const process = await withTransaction((client) => createTestProcess(client, TIMER_XML, adminId));
    createdProcessIds.push(process.id);

    const instance = await withTransaction((client) => startProcessInstance(client, { process, startedById: adminId }));
    // fire_at reste dans le futur (30 min) : on ne le force pas.

    await pollAndFireDueTimers();

    const { rows } = await pool.query<{ status: string }>('SELECT status FROM process_instances WHERE id = $1', [
      instance.id,
    ]);
    expect(rows[0].status).toBe('RUNNING');

    const { rows: timerRows } = await pool.query('SELECT * FROM scheduled_timers WHERE instance_id = $1', [
      instance.id,
    ]);
    expect(timerRows).toHaveLength(1);
  });
});
