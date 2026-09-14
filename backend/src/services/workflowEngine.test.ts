import { Pool, PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { pool, withTransaction } from '../db/pool';
import { completeTaskAndAdvance, fireDueTimer, startProcessInstance } from './workflowEngine';
import { createTestProcess, seedUserId, withRollback } from '../test/dbTestHelpers';
import { ProcessRow, TaskRow } from '../types';

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

// Fin en une seule branche, sans parallélisme : l'instance atteint
// directement un endEvent portant un <bpmn:errorEventDefinition>.
const SIMPLE_ERROR_END_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   id="Definitions_err" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_err" isExecutable="true">
    <bpmn:startEvent id="Start" name="Début" />
    <bpmn:endEvent id="End_Error" name="Rejeté">
      <bpmn:errorEventDefinition id="ErrorEventDefinition_1" />
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_start" sourceRef="Start" targetRef="End_Error" />
  </bpmn:process>
</bpmn:definitions>`;

// Fork parallèle où une branche (Flow_A, traitée en premier — voir l'ordre
// des <bpmn:sequenceFlow> ci-dessous) crée une tâche en attente, tandis que
// l'autre (Flow_toError) atteint directement une fin d'erreur : sert à
// vérifier qu'une fin d'erreur interrompt bien l'instance même si une
// branche sœur a encore une tâche non traitée.
const FORK_THEN_ERROR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpm="http://bpm-platform.local/schema/1.0"
                   id="Definitions_forkerr" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_forkerr" isExecutable="true">
    <bpmn:startEvent id="Start" name="Début" />
    <bpmn:parallelGateway id="Fork" name="Fork" />
    <bpmn:userTask id="Task_A" name="Tâche A" bpm:assigneeRole="OPERATOR" />
    <bpmn:endEvent id="End_Error" name="Rejeté">
      <bpmn:errorEventDefinition id="ErrorEventDefinition_1" />
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_start" sourceRef="Start" targetRef="Fork" />
    <bpmn:sequenceFlow id="Flow_A" sourceRef="Fork" targetRef="Task_A" />
    <bpmn:sequenceFlow id="Flow_toError" sourceRef="Fork" targetRef="End_Error" />
  </bpmn:process>
</bpmn:definitions>`;

describe('workflowEngine — error/cancel end event', () => {
  it('marks the instance CANCELLED (not COMPLETED) and records a PROCESS_CANCELLED audit entry', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, SIMPLE_ERROR_END_XML, adminId);

      const instance = await startProcessInstance(client, { process, startedById: adminId });

      expect(instance.status).toBe('CANCELLED');
      expect(instance.current_step_name).toBe('Rejeté');

      const { rows: auditRows } = await client.query<{ action: string }>(
        `SELECT action FROM audit_logs WHERE entity_type = 'process_instance' AND entity_id = $1 ORDER BY created_at`,
        [instance.id]
      );
      expect(auditRows.map((r) => r.action)).toContain('PROCESS_CANCELLED');
      expect(auditRows.map((r) => r.action)).not.toContain('PROCESS_COMPLETED');
    });
  });

  it('reaching an error end event on one parallel branch cancels the instance and any still-pending task from a sibling branch', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, FORK_THEN_ERROR_XML, adminId);

      const instance = await startProcessInstance(client, { process, startedById: adminId });

      expect(instance.status).toBe('CANCELLED');

      const pending = await pendingTasks(client, instance.id);
      expect(pending).toHaveLength(0);

      const { rows: taskARows } = await client.query<TaskRow>(
        `SELECT * FROM tasks WHERE instance_id = $1 AND step_name = 'Tâche A'`,
        [instance.id]
      );
      expect(taskARows[0]?.status).toBe('CANCELLED');
    });
  });
});

// Start -> Timer (PT30M) -> End : sert à vérifier que l'instance s'arrête
// au minuteur sans avancer plus loin, puis reprend correctement une fois
// fireDueTimer appelé.
const TIMER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   id="Definitions_timer" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_timer" isExecutable="true">
    <bpmn:startEvent id="Start" name="Début" />
    <bpmn:intermediateCatchEvent id="Timer1" name="Attendre 30 min">
      <bpmn:timerEventDefinition>
        <bpmn:timeDuration>PT30M</bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="End" name="Fin" />
    <bpmn:sequenceFlow id="Flow_start" sourceRef="Start" targetRef="Timer1" />
    <bpmn:sequenceFlow id="Flow_timer" sourceRef="Timer1" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

// Fork parallèle où une branche passe par un minuteur et l'autre crée une
// tâche : vérifie que programmer un minuteur n'affecte pas une branche
// sœur toujours en attente.
const FORK_THEN_TIMER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpm="http://bpm-platform.local/schema/1.0"
                   id="Definitions_forktimer" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_forktimer" isExecutable="true">
    <bpmn:startEvent id="Start" name="Début" />
    <bpmn:parallelGateway id="Fork" name="Fork" />
    <bpmn:userTask id="Task_A" name="Tâche A" bpm:assigneeRole="OPERATOR" />
    <bpmn:intermediateCatchEvent id="Timer1" name="Attendre">
      <bpmn:timerEventDefinition>
        <bpmn:timeDuration>PT1H</bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="Flow_start" sourceRef="Start" targetRef="Fork" />
    <bpmn:sequenceFlow id="Flow_A" sourceRef="Fork" targetRef="Task_A" />
    <bpmn:sequenceFlow id="Flow_timer" sourceRef="Fork" targetRef="Timer1" />
  </bpmn:process>
</bpmn:definitions>`;

async function markTimerDue(client: Pool | PoolClient, instanceId: string, elementId: string): Promise<void> {
  await client.query(
    `UPDATE scheduled_timers SET fire_at = now() - interval '1 second' WHERE instance_id = $1 AND element_id = $2`,
    [instanceId, elementId]
  );
}

describe('workflowEngine — timer catch event', () => {
  it('stops the instance at the timer (does not advance further) and schedules it in scheduled_timers', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, TIMER_XML, adminId);

      const instance = await startProcessInstance(client, { process, startedById: adminId });

      expect(instance.status).toBe('RUNNING');
      expect(instance.current_step_name).toBe('Attendre 30 min');
      expect(instance.current_element_id).toBe('Timer1');

      const { rows: timerRows } = await client.query<{ fire_at: Date }>(
        `SELECT fire_at FROM scheduled_timers WHERE instance_id = $1 AND element_id = 'Timer1'`,
        [instance.id]
      );
      expect(timerRows).toHaveLength(1);
      const expectedFireAt = Date.now() + 30 * 60 * 1000;
      expect(new Date(timerRows[0].fire_at).getTime()).toBeGreaterThan(Date.now());
      expect(Math.abs(new Date(timerRows[0].fire_at).getTime() - expectedFireAt)).toBeLessThan(5000);

      const { rows: auditRows } = await client.query<{ action: string }>(
        `SELECT action FROM audit_logs WHERE entity_type = 'process_instance' AND entity_id = $1 ORDER BY created_at`,
        [instance.id]
      );
      expect(auditRows.map((r) => r.action)).toContain('TIMER_SCHEDULED');
    });
  });

  it('fireDueTimer advances the instance past the timer once its delay is due', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, TIMER_XML, adminId);
      const instance = await startProcessInstance(client, { process, startedById: adminId });

      await markTimerDue(client, instance.id, 'Timer1');

      const updated = await fireDueTimer(client, { instanceId: instance.id, elementId: 'Timer1' });

      expect(updated?.status).toBe('COMPLETED');
      expect(updated?.current_step_name).toBe('Fin');

      const { rows: timerRows } = await client.query(
        `SELECT * FROM scheduled_timers WHERE instance_id = $1 AND element_id = 'Timer1'`,
        [instance.id]
      );
      expect(timerRows).toHaveLength(0);

      const { rows: auditRows } = await client.query<{ action: string }>(
        `SELECT action FROM audit_logs WHERE entity_type = 'process_instance' AND entity_id = $1 ORDER BY created_at`,
        [instance.id]
      );
      expect(auditRows.map((r) => r.action)).toContain('TIMER_FIRED');
    });
  });

  it('fireDueTimer is a no-op (returns null) if the timer is not actually due yet', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, TIMER_XML, adminId);
      const instance = await startProcessInstance(client, { process, startedById: adminId });

      // Le minuteur programmé par startProcessInstance déclenche dans 30
      // minutes : pas encore dû, on ne le force pas ici.
      const result = await fireDueTimer(client, { instanceId: instance.id, elementId: 'Timer1' });
      expect(result).toBeNull();

      const { rows: instRows } = await client.query(`SELECT status FROM process_instances WHERE id = $1`, [
        instance.id,
      ]);
      expect(instRows[0].status).toBe('RUNNING');
    });
  });

  it('a timer on one parallel branch does not affect a sibling branch still awaiting task completion', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, FORK_THEN_TIMER_XML, adminId);

      const instance = await startProcessInstance(client, { process, startedById: adminId });

      expect(instance.status).toBe('RUNNING');
      const pending = await pendingTasks(client, instance.id);
      expect(pending.map((t) => t.step_name)).toEqual(['Tâche A']);

      const { rows: timerRows } = await client.query(
        `SELECT * FROM scheduled_timers WHERE instance_id = $1 AND element_id = 'Timer1'`,
        [instance.id]
      );
      expect(timerRows).toHaveLength(1);
    });
  });
});

// Sous-processus réutilisable (bpmn:callActivity) : un processus PARENT
// délègue une portion de son flux à un AUTRE processus, publié séparément
// et référencé par sa process_key. Le parent se met en pause au nœud
// callActivity jusqu'à ce que l'instance enfant se termine.
function parentXmlCallingChild(calledProcessKey: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   id="Definitions_parent" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_parent" isExecutable="true">
    <bpmn:startEvent id="ParentStart" name="Début parent" />
    <bpmn:callActivity id="Call1" name="Sous-processus" calledElement="${calledProcessKey}" />
    <bpmn:endEvent id="ParentEnd" name="Fin parent" />
    <bpmn:sequenceFlow id="Flow1" sourceRef="ParentStart" targetRef="Call1" />
    <bpmn:sequenceFlow id="Flow2" sourceRef="Call1" targetRef="ParentEnd" />
  </bpmn:process>
</bpmn:definitions>`;
}

const CHILD_WITH_TASK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpm="http://bpm-platform.local/schema/1.0"
                   id="Definitions_childtask" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_childtask" isExecutable="true">
    <bpmn:startEvent id="ChildStart" name="Début enfant" />
    <bpmn:userTask id="ChildTask" name="Tâche enfant" bpm:assigneeRole="OPERATOR" />
    <bpmn:endEvent id="ChildEnd" name="Fin enfant" />
    <bpmn:sequenceFlow id="Flow1" sourceRef="ChildStart" targetRef="ChildTask" />
    <bpmn:sequenceFlow id="Flow2" sourceRef="ChildTask" targetRef="ChildEnd" />
  </bpmn:process>
</bpmn:definitions>`;

const CHILD_WITH_ERROR_END_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpm="http://bpm-platform.local/schema/1.0"
                   id="Definitions_childerr" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_childerr" isExecutable="true">
    <bpmn:startEvent id="ChildStart" name="Début enfant" />
    <bpmn:userTask id="ChildTask" name="Tâche enfant" bpm:assigneeRole="OPERATOR" />
    <bpmn:endEvent id="ChildErrorEnd" name="Enfant en erreur">
      <bpmn:errorEventDefinition />
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow1" sourceRef="ChildStart" targetRef="ChildTask" />
    <bpmn:sequenceFlow id="Flow2" sourceRef="ChildTask" targetRef="ChildErrorEnd" />
  </bpmn:process>
</bpmn:definitions>`;

const CHILD_TRIVIAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   id="Definitions_childtrivial" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_childtrivial" isExecutable="true">
    <bpmn:startEvent id="ChildStart" name="Début enfant" />
    <bpmn:endEvent id="ChildEnd" name="Fin enfant" />
    <bpmn:sequenceFlow id="Flow1" sourceRef="ChildStart" targetRef="ChildEnd" />
  </bpmn:process>
</bpmn:definitions>`;

/** Comme createTestProcess, mais avec une process_key choisie (nécessaire pour les tests de cycle A<->B). */
async function createTestProcessWithKey(
  client: PoolClient,
  processKey: string,
  bpmnXml: string,
  createdBy: string
): Promise<ProcessRow> {
  const { rows } = await client.query<ProcessRow>(
    `INSERT INTO processes (process_key, name, bpmn_xml, status, created_by)
     VALUES ($1, $2, $3, 'PUBLISHED', $4) RETURNING *`,
    [processKey, 'Processus de test (clé fixe)', bpmnXml, createdBy]
  );
  return rows[0];
}

describe('workflowEngine — callActivity (sous-processus réutilisable)', () => {
  it('starting the parent creates a RUNNING child instance and pauses the parent at the callActivity node', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const childProcess = await createTestProcess(client, CHILD_WITH_TASK_XML, adminId);
      const parentProcess = await createTestProcess(client, parentXmlCallingChild(childProcess.process_key), adminId);

      const parentInstance = await startProcessInstance(client, { process: parentProcess, startedById: adminId });

      expect(parentInstance.status).toBe('RUNNING');
      expect(parentInstance.current_element_id).toBe('Call1');

      const { rows: childRows } = await client.query(`SELECT * FROM process_instances WHERE parent_instance_id = $1`, [
        parentInstance.id,
      ]);
      expect(childRows).toHaveLength(1);
      expect(childRows[0].status).toBe('RUNNING');
      expect(childRows[0].parent_element_id).toBe('Call1');

      const childPending = await pendingTasks(client, childRows[0].id);
      expect(childPending.map((t) => t.step_name)).toEqual(['Tâche enfant']);

      const parentPending = await pendingTasks(client, parentInstance.id);
      expect(parentPending).toHaveLength(0);
    });
  });

  it('completing the child task through to its end event resumes the parent past the callActivity', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const childProcess = await createTestProcess(client, CHILD_WITH_TASK_XML, adminId);
      const parentProcess = await createTestProcess(client, parentXmlCallingChild(childProcess.process_key), adminId);

      const parentInstance = await startProcessInstance(client, { process: parentProcess, startedById: adminId });
      const { rows: childRows } = await client.query(`SELECT * FROM process_instances WHERE parent_instance_id = $1`, [
        parentInstance.id,
      ]);
      const childInstance = childRows[0];
      const childTask = (await pendingTasks(client, childInstance.id))[0];

      await completeTaskAndAdvance(client, {
        task: childTask,
        instance: childInstance,
        process: childProcess,
        completedById: adminId,
        formData: {},
      });

      const { rows: finalParentRows } = await client.query('SELECT * FROM process_instances WHERE id = $1', [
        parentInstance.id,
      ]);
      expect(finalParentRows[0].status).toBe('COMPLETED');
      expect(finalParentRows[0].current_step_name).toBe('Fin parent');

      const { rows: auditRows } = await client.query<{ action: string }>(
        `SELECT action FROM audit_logs WHERE entity_type = 'process_instance' AND entity_id = $1 ORDER BY created_at`,
        [parentInstance.id]
      );
      expect(auditRows.map((r) => r.action)).toContain('SUBPROCESS_COMPLETED');
    });
  });

  it('the child reaching an error end event cascades cancellation to the parent', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const childProcess = await createTestProcess(client, CHILD_WITH_ERROR_END_XML, adminId);
      const parentProcess = await createTestProcess(client, parentXmlCallingChild(childProcess.process_key), adminId);

      const parentInstance = await startProcessInstance(client, { process: parentProcess, startedById: adminId });
      const { rows: childRows } = await client.query(`SELECT * FROM process_instances WHERE parent_instance_id = $1`, [
        parentInstance.id,
      ]);
      const childInstance = childRows[0];
      const childTask = (await pendingTasks(client, childInstance.id))[0];

      await completeTaskAndAdvance(client, {
        task: childTask,
        instance: childInstance,
        process: childProcess,
        completedById: adminId,
        formData: {},
      });

      const { rows: finalParentRows } = await client.query('SELECT * FROM process_instances WHERE id = $1', [
        parentInstance.id,
      ]);
      expect(finalParentRows[0].status).toBe('CANCELLED');

      const { rows: auditRows } = await client.query<{ action: string }>(
        `SELECT action FROM audit_logs WHERE entity_type = 'process_instance' AND entity_id = $1 ORDER BY created_at`,
        [parentInstance.id]
      );
      expect(auditRows.map((r) => r.action)).toContain('SUBPROCESS_CANCELLED');
      expect(auditRows.map((r) => r.action)).toContain('PROCESS_CANCELLED');
    });
  });

  it('a trivial sub-process with no user task resumes the parent synchronously, within the same call', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const childProcess = await createTestProcess(client, CHILD_TRIVIAL_XML, adminId);
      const parentProcess = await createTestProcess(client, parentXmlCallingChild(childProcess.process_key), adminId);

      const parentInstance = await startProcessInstance(client, { process: parentProcess, startedById: adminId });

      expect(parentInstance.status).toBe('COMPLETED');
      expect(parentInstance.current_step_name).toBe('Fin parent');
    });
  });

  it('rejects a callActivity referencing an unknown or unpublished process_key', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const parentProcess = await createTestProcess(client, parentXmlCallingChild('does-not-exist'), adminId);

      await expect(startProcessInstance(client, { process: parentProcess, startedById: adminId })).rejects.toThrow(
        /introuvable ou non publié/
      );
    });
  });

  it('rejects a direct self-referencing callActivity (cycle)', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const selfKey = `test-self-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const process = await createTestProcessWithKey(client, selfKey, parentXmlCallingChild(selfKey), adminId);

      await expect(startProcessInstance(client, { process, startedById: adminId })).rejects.toThrow(/circulaire/);
    });
  });

  it('rejects an indirect cycle (A calls B, B calls A)', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const keyA = `test-cycle-a-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const keyB = `test-cycle-b-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const processA = await createTestProcessWithKey(client, keyA, parentXmlCallingChild(keyB), adminId);
      await createTestProcessWithKey(client, keyB, parentXmlCallingChild(keyA), adminId);

      await expect(startProcessInstance(client, { process: processA, startedById: adminId })).rejects.toThrow(
        /circulaire/
      );
    });
  });
});
