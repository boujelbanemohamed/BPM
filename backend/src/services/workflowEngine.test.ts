import { Pool, PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { pool, withTransaction } from '../db/pool';
import { completeTaskAndAdvance, startProcessInstance } from './workflowEngine';
import { createTestProcess, seedUserId, withRollback } from '../test/dbTestHelpers';
import { TaskRow } from '../types';

const FORK_JOIN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpm="http://bpm-platform.local/schema/1.0"
                   id="Definitions_test" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_test" isExecutable="true">
    <bpmn:startEvent id="Start" name="Début" />
    <bpmn:parallelGateway id="Fork" name="Fork" />
    <bpmn:userTask id="Task_A" name="Tâche A" bpm:assigneeRole="OPERATOR" />
    <bpmn:userTask id="Task_B" name="Tâche B" bpm:assigneeRole="VALIDATOR" />
    <bpmn:parallelGateway id="Join" name="Join" />
    <bpmn:userTask id="Task_C" name="Tâche C" bpm:assigneeRole="ADMIN" />
    <bpmn:endEvent id="End" name="Fin" />
    <bpmn:sequenceFlow id="Flow_start" sourceRef="Start" targetRef="Fork" />
    <bpmn:sequenceFlow id="Flow_A" sourceRef="Fork" targetRef="Task_A" />
    <bpmn:sequenceFlow id="Flow_B" sourceRef="Fork" targetRef="Task_B" />
    <bpmn:sequenceFlow id="Flow_A2" sourceRef="Task_A" targetRef="Join" />
    <bpmn:sequenceFlow id="Flow_B2" sourceRef="Task_B" targetRef="Join" />
    <bpmn:sequenceFlow id="Flow_C" sourceRef="Join" targetRef="Task_C" />
    <bpmn:sequenceFlow id="Flow_end" sourceRef="Task_C" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

// Passerelle exclusive seule (pas de parallélisme) : sert de test de
// non-régression, pour s'assurer que le routage conditionnel existant
// n'a pas été cassé par la refonte de advance() en advanceViaFlow().
const EXCLUSIVE_ONLY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpm="http://bpm-platform.local/schema/1.0"
                   id="Definitions_excl" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_excl" isExecutable="true">
    <bpmn:startEvent id="Start" name="Début" />
    <bpmn:userTask id="Task_Input" name="Saisie" bpm:assigneeRole="OPERATOR"
      bpm:formFields="[{&quot;key&quot;:&quot;montant&quot;,&quot;label&quot;:&quot;Montant&quot;,&quot;type&quot;:&quot;number&quot;,&quot;required&quot;:true}]" />
    <bpmn:exclusiveGateway id="Gateway" name="Montant élevé ?" default="Flow_low" />
    <bpmn:userTask id="Task_High" name="Validation renforcée" bpm:assigneeRole="VALIDATOR" />
    <bpmn:userTask id="Task_Low" name="Enregistrement rapide" bpm:assigneeRole="OPERATOR" />
    <bpmn:endEvent id="End" name="Fin" />
    <bpmn:sequenceFlow id="Flow_start" sourceRef="Start" targetRef="Task_Input" />
    <bpmn:sequenceFlow id="Flow_toGateway" sourceRef="Task_Input" targetRef="Gateway" />
    <bpmn:sequenceFlow id="Flow_high" sourceRef="Gateway" targetRef="Task_High">
      <bpmn:conditionExpression>montant &gt; 1000</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_low" sourceRef="Gateway" targetRef="Task_Low" />
    <bpmn:sequenceFlow id="Flow_end1" sourceRef="Task_High" targetRef="End" />
    <bpmn:sequenceFlow id="Flow_end2" sourceRef="Task_Low" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

// Passerelle inclusive (OR) : Gateway_Inc active Flow_toA si montant > 100,
// Flow_toB si urgent == true — potentiellement les deux à la fois, ou une
// seule. Join_Inc doit attendre exactement les branches activées, pas
// forcément les deux flux entrants dessinés dans le diagramme.
const INCLUSIVE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpm="http://bpm-platform.local/schema/1.0"
                   id="Definitions_inc" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_inc" isExecutable="true">
    <bpmn:startEvent id="Start" name="Début" />
    <bpmn:inclusiveGateway id="Gateway_Inc" name="Fork inclusif" />
    <bpmn:userTask id="Task_A" name="Tâche A" bpm:assigneeRole="OPERATOR" />
    <bpmn:userTask id="Task_B" name="Tâche B" bpm:assigneeRole="VALIDATOR" />
    <bpmn:inclusiveGateway id="Join_Inc" name="Join inclusif" />
    <bpmn:userTask id="Task_C" name="Tâche C" bpm:assigneeRole="ADMIN" />
    <bpmn:endEvent id="End" name="Fin" />
    <bpmn:sequenceFlow id="Flow_start" sourceRef="Start" targetRef="Gateway_Inc" />
    <bpmn:sequenceFlow id="Flow_toA" sourceRef="Gateway_Inc" targetRef="Task_A">
      <bpmn:conditionExpression>montant &gt; 100</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_toB" sourceRef="Gateway_Inc" targetRef="Task_B">
      <bpmn:conditionExpression>urgent == true</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_A2" sourceRef="Task_A" targetRef="Join_Inc" />
    <bpmn:sequenceFlow id="Flow_B2" sourceRef="Task_B" targetRef="Join_Inc" />
    <bpmn:sequenceFlow id="Flow_C" sourceRef="Join_Inc" targetRef="Task_C" />
    <bpmn:sequenceFlow id="Flow_end" sourceRef="Task_C" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

async function pendingTasks(client: Pool | PoolClient, instanceId: string): Promise<TaskRow[]> {
  const { rows } = await client.query<TaskRow>(
    `SELECT * FROM tasks WHERE instance_id = $1 AND status = 'PENDING' ORDER BY step_name`,
    [instanceId]
  );
  return rows;
}

describe('workflowEngine — parallel gateway (fork/join)', () => {
  it('fork: starting an instance creates one pending task per outgoing branch simultaneously', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, FORK_JOIN_XML, adminId);

      const instance = await startProcessInstance(client, { process, startedById: adminId });

      const pending = await pendingTasks(client, instance.id);
      expect(pending.map((t) => t.step_name).sort()).toEqual(['Tâche A', 'Tâche B']);
    });
  });

  it('join waits: completing only one of two sibling branches does not create the downstream task', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, FORK_JOIN_XML, adminId);
      const instance = await startProcessInstance(client, { process, startedById: adminId });

      const initialPending = await pendingTasks(client, instance.id);
      const taskA = initialPending.find((t) => t.step_name === 'Tâche A')!;
      const updated = await completeTaskAndAdvance(client, {
        task: taskA,
        instance,
        process,
        completedById: adminId,
        formData: {},
      });

      expect(updated.status).toBe('RUNNING');
      const pending = await pendingTasks(client, instance.id);
      // Tâche B est toujours en attente ; Tâche C (après la jointure) ne
      // doit PAS exister tant que Tâche B n'est pas, elle aussi, complétée.
      expect(pending.map((t) => t.step_name)).toEqual(['Tâche B']);

      const { rows: auditRows } = await client.query<{ action: string }>(
        `SELECT action FROM audit_logs WHERE entity_id = $1 AND action = 'PARALLEL_GATEWAY_WAITING'`,
        [instance.id]
      );
      expect(auditRows.length).toBe(1);
    });
  });

  it('join fires: completing both sibling branches creates the downstream task exactly once', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, FORK_JOIN_XML, adminId);
      let instance = await startProcessInstance(client, { process, startedById: adminId });

      let pending = await pendingTasks(client, instance.id);
      const taskA = pending.find((t) => t.step_name === 'Tâche A')!;
      instance = await completeTaskAndAdvance(client, { task: taskA, instance, process, completedById: adminId, formData: {} });

      pending = await pendingTasks(client, instance.id);
      const taskB = pending.find((t) => t.step_name === 'Tâche B')!;
      instance = await completeTaskAndAdvance(client, { task: taskB, instance, process, completedById: adminId, formData: {} });

      pending = await pendingTasks(client, instance.id);
      expect(pending.map((t) => t.step_name)).toEqual(['Tâche C']);

      // La table de synchronisation doit être vidée une fois la jointure franchie.
      const { rows: arrivalRows } = await client.query(
        `SELECT * FROM gateway_arrivals WHERE instance_id = $1 AND gateway_element_id = 'Join'`,
        [instance.id]
      );
      expect(arrivalRows.length).toBe(0);

      const { rows: joinedAudit } = await client.query<{ action: string }>(
        `SELECT action FROM audit_logs WHERE entity_id = $1 AND action = 'PARALLEL_GATEWAY_JOINED'`,
        [instance.id]
      );
      expect(joinedAudit.length).toBe(1);
    });
  });

  it('completing the final task after the join reaches the end event and completes the instance', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, FORK_JOIN_XML, adminId);
      let instance = await startProcessInstance(client, { process, startedById: adminId });

      for (const stepName of ['Tâche A', 'Tâche B']) {
        const pending = await pendingTasks(client, instance.id);
        const task = pending.find((t) => t.step_name === stepName)!;
        instance = await completeTaskAndAdvance(client, { task, instance, process, completedById: adminId, formData: {} });
      }

      const pending = await pendingTasks(client, instance.id);
      const taskC = pending.find((t) => t.step_name === 'Tâche C')!;
      instance = await completeTaskAndAdvance(client, { task: taskC, instance, process, completedById: adminId, formData: {} });

      expect(instance.status).toBe('COMPLETED');
      expect(instance.current_step_name).toBe('Fin');
    });
  });

  it('a second attempt to complete an already-completed task is rejected (409)', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, FORK_JOIN_XML, adminId);
      const instance = await startProcessInstance(client, { process, startedById: adminId });

      const pending = await pendingTasks(client, instance.id);
      const taskA = pending.find((t) => t.step_name === 'Tâche A')!;
      await completeTaskAndAdvance(client, { task: taskA, instance, process, completedById: adminId, formData: {} });

      await expect(
        completeTaskAndAdvance(client, { task: taskA, instance, process, completedById: adminId, formData: {} })
      ).rejects.toThrow('Cette tâche a déjà été traitée');
    });
  });
});

describe('workflowEngine — exclusive gateway (non-regression after advanceViaFlow refactor)', () => {
  it('routes to the conditional branch when the condition is met', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, EXCLUSIVE_ONLY_XML, adminId);
      let instance = await startProcessInstance(client, { process, startedById: adminId });

      let pending = await pendingTasks(client, instance.id);
      expect(pending.map((t) => t.step_name)).toEqual(['Saisie']);

      instance = await completeTaskAndAdvance(client, {
        task: pending[0],
        instance,
        process,
        completedById: adminId,
        formData: { montant: 5000 },
      });

      pending = await pendingTasks(client, instance.id);
      expect(pending.map((t) => t.step_name)).toEqual(['Validation renforcée']);
    });
  });

  it('routes to the default branch when the condition is not met', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, EXCLUSIVE_ONLY_XML, adminId);
      let instance = await startProcessInstance(client, { process, startedById: adminId });

      const pending = await pendingTasks(client, instance.id);
      instance = await completeTaskAndAdvance(client, {
        task: pending[0],
        instance,
        process,
        completedById: adminId,
        formData: { montant: 10 },
      });

      const nextPending = await pendingTasks(client, instance.id);
      expect(nextPending.map((t) => t.step_name)).toEqual(['Enregistrement rapide']);
    });
  });
});

describe('workflowEngine — parallel join under real concurrency', () => {
  const createdProcessIds: string[] = [];

  afterAll(async () => {
    for (const id of createdProcessIds) {
      await pool.query('DELETE FROM process_instances WHERE process_id = $1', [id]);
      await pool.query('DELETE FROM processes WHERE id = $1', [id]);
    }
  });

  it('completing both sibling branches at the same time creates the downstream task exactly once', async () => {
    const adminId = await pool
      .query<{ id: string }>('SELECT id FROM users WHERE email = $1', ['admin@bpm.local'])
      .then((r) => r.rows[0].id);

    const process = await withTransaction((client) => createTestProcess(client, FORK_JOIN_XML, adminId));
    createdProcessIds.push(process.id);

    const instance = await withTransaction((client) => startProcessInstance(client, { process, startedById: adminId }));

    const { rows: pending } = await pool.query<TaskRow>(
      `SELECT * FROM tasks WHERE instance_id = $1 AND status = 'PENDING'`,
      [instance.id]
    );
    const taskA = pending.find((t) => t.step_name === 'Tâche A')!;
    const taskB = pending.find((t) => t.step_name === 'Tâche B')!;

    // Deux transactions réellement distinctes, lancées en parallèle : c'est
    // le scénario que le verrou SELECT ... FOR UPDATE (posé en tout début de
    // completeTaskAndAdvance) doit sérialiser pour éviter tout double
    // déclenchement de la jointure.
    await Promise.all([
      withTransaction((client) =>
        completeTaskAndAdvance(client, { task: taskA, instance, process, completedById: adminId, formData: {} })
      ),
      withTransaction((client) =>
        completeTaskAndAdvance(client, { task: taskB, instance, process, completedById: adminId, formData: {} })
      ),
    ]);

    const { rows: finalTasks } = await pool.query<TaskRow>(`SELECT * FROM tasks WHERE instance_id = $1`, [instance.id]);
    const taskCCount = finalTasks.filter((t) => t.step_name === 'Tâche C').length;
    expect(taskCCount).toBe(1);
  });
});

describe('workflowEngine — inclusive gateway (OR fork/join)', () => {
  it('activates only the branches whose condition is true (single branch)', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, INCLUSIVE_XML, adminId);

      // montant > 100 → Flow_toA vrai ; urgent absent (falsy) → Flow_toB faux.
      const instance = await startProcessInstance(client, {
        process,
        startedById: adminId,
        initialFormData: { montant: 500 },
      });

      const pending = await pendingTasks(client, instance.id);
      expect(pending.map((t) => t.step_name)).toEqual(['Tâche A']);
    });
  });

  it('activates both branches when both conditions are true', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, INCLUSIVE_XML, adminId);

      const instance = await startProcessInstance(client, {
        process,
        startedById: adminId,
        initialFormData: { montant: 500, urgent: true },
      });

      const pending = await pendingTasks(client, instance.id);
      expect(pending.map((t) => t.step_name).sort()).toEqual(['Tâche A', 'Tâche B']);
    });
  });

  it('join fires immediately when only one branch was activated (does not wait for the untaken branch)', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, INCLUSIVE_XML, adminId);
      let instance = await startProcessInstance(client, {
        process,
        startedById: adminId,
        initialFormData: { montant: 500 }, // seule Tâche A est activée
      });

      let pending = await pendingTasks(client, instance.id);
      expect(pending.map((t) => t.step_name)).toEqual(['Tâche A']);

      instance = await completeTaskAndAdvance(client, {
        task: pending[0],
        instance,
        process,
        completedById: adminId,
        formData: {},
      });

      // La jointure ne doit PAS attendre Tâche B (jamais activée) : elle
      // franchit aussitôt et Tâche C doit déjà exister.
      pending = await pendingTasks(client, instance.id);
      expect(pending.map((t) => t.step_name)).toEqual(['Tâche C']);

      const { rows: firedAudit } = await client.query<{ action: string }>(
        `SELECT action FROM audit_logs WHERE entity_id = $1 AND action = 'INCLUSIVE_GATEWAY_JOINED'`,
        [instance.id]
      );
      expect(firedAudit.length).toBe(1);
      const { rows: waitingAudit } = await client.query<{ action: string }>(
        `SELECT action FROM audit_logs WHERE entity_id = $1 AND action = 'INCLUSIVE_GATEWAY_WAITING'`,
        [instance.id]
      );
      expect(waitingAudit.length).toBe(0);
    });
  });

  it('join waits for both branches when both were activated, then fires once the second arrives', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, INCLUSIVE_XML, adminId);
      let instance = await startProcessInstance(client, {
        process,
        startedById: adminId,
        initialFormData: { montant: 500, urgent: true },
      });

      let pending = await pendingTasks(client, instance.id);
      const taskA = pending.find((t) => t.step_name === 'Tâche A')!;
      instance = await completeTaskAndAdvance(client, { task: taskA, instance, process, completedById: adminId, formData: {} });

      pending = await pendingTasks(client, instance.id);
      // Tâche B toujours en attente ; Tâche C ne doit pas exister tant que
      // Tâche B (activée elle aussi) n'a pas été complétée.
      expect(pending.map((t) => t.step_name)).toEqual(['Tâche B']);

      const taskB = pending[0];
      instance = await completeTaskAndAdvance(client, { task: taskB, instance, process, completedById: adminId, formData: {} });

      pending = await pendingTasks(client, instance.id);
      expect(pending.map((t) => t.step_name)).toEqual(['Tâche C']);
    });
  });

  it('falls back to the default flow when no condition matches', async () => {
    const DEFAULT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   id="Definitions_incdef" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_incdef" isExecutable="true">
    <bpmn:startEvent id="Start" name="Début" />
    <bpmn:inclusiveGateway id="Gateway" name="Fork" default="Flow_default" />
    <bpmn:userTask id="Task_Cond" name="Conditionnelle" />
    <bpmn:userTask id="Task_Default" name="Défaut" />
    <bpmn:sequenceFlow id="Flow_start" sourceRef="Start" targetRef="Gateway" />
    <bpmn:sequenceFlow id="Flow_cond" sourceRef="Gateway" targetRef="Task_Cond">
      <bpmn:conditionExpression>montant &gt; 100</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_default" sourceRef="Gateway" targetRef="Task_Default" />
  </bpmn:process>
</bpmn:definitions>`;

    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, DEFAULT_XML, adminId);
      const instance = await startProcessInstance(client, {
        process,
        startedById: adminId,
        initialFormData: { montant: 10 }, // condition fausse → repli sur le flux par défaut
      });

      const pending = await pendingTasks(client, instance.id);
      expect(pending.map((t) => t.step_name)).toEqual(['Défaut']);
    });
  });
});
