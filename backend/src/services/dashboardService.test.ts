import { describe, expect, it } from 'vitest';
import { findUserById } from '../db/usersRepo';
import { getDashboardSummary } from './dashboardService';
import { completeTaskAndAdvance, startProcessInstance } from './workflowEngine';
import { createTestProcess, seedUserId, withRollback } from '../test/dbTestHelpers';
import { TaskRow } from '../types';

const SIMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpm="http://bpm-platform.local/schema/1.0"
                   id="Definitions_dash" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_dash" isExecutable="true">
    <bpmn:startEvent id="Start" name="Début" />
    <bpmn:userTask id="Task1" name="Tâche du tableau de bord" bpm:assigneeRole="OPERATOR" />
    <bpmn:endEvent id="End" name="Fin" />
    <bpmn:sequenceFlow id="Flow1" sourceRef="Start" targetRef="Task1" />
    <bpmn:sequenceFlow id="Flow2" sourceRef="Task1" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

const UNIQUE = `Dash${Date.now()}`;

describe('dashboardService — getDashboardSummary', () => {
  it('statusBreakdown always includes all 3 statuses, zero-filled when absent', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const admin = await findUserById(client, adminId);

      const summary = await getDashboardSummary(client, admin!);

      expect(summary.statusBreakdown.map((s) => s.status).sort()).toEqual(['CANCELLED', 'COMPLETED', 'RUNNING']);
      for (const entry of summary.statusBreakdown) {
        expect(entry.count).toBeGreaterThanOrEqual(0);
      }
    });
  });

  it('a running instance is counted in kpis.runningInstances and statusBreakdown', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const admin = await findUserById(client, adminId);
      const process = await createTestProcess(client, SIMPLE_XML, adminId);

      const before = await getDashboardSummary(client, admin!);
      await startProcessInstance(client, { process, startedById: adminId });
      const after = await getDashboardSummary(client, admin!);

      expect(after.kpis.runningInstances).toBe(before.kpis.runningInstances + 1);
      const runningEntry = after.statusBreakdown.find((s) => s.status === 'RUNNING')!;
      const runningBefore = before.statusBreakdown.find((s) => s.status === 'RUNNING')!;
      expect(runningEntry.count).toBe(runningBefore.count + 1);
    });
  });

  it("weeklyVolume covers exactly the last 8 weeks and counts an instance started today in the current week", async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const admin = await findUserById(client, adminId);
      const process = await createTestProcess(client, SIMPLE_XML, adminId);

      const before = await getDashboardSummary(client, admin!);
      expect(before.weeklyVolume).toHaveLength(8);

      await startProcessInstance(client, { process, startedById: adminId });
      const after = await getDashboardSummary(client, admin!);

      const lastWeek = after.weeklyVolume[after.weeklyVolume.length - 1];
      const lastWeekBefore = before.weeklyVolume[before.weeklyVolume.length - 1];
      expect(lastWeek.weekStart).toBe(lastWeekBefore.weekStart);
      expect(lastWeek.count).toBe(lastWeekBefore.count + 1);
    });
  });

  it('myTasks previews only PENDING tasks assigned to the caller (directly or via role), oldest first', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const operatorId = await seedUserId(client, 'operator@bpm.local');
      const operator = await findUserById(client, operatorId);

      // La préview est plafonnée (LIMIT 5, plus anciennes en premier) : sur
      // une base de dev réelle et persistante (pas remise à zéro entre les
      // sessions), d'autres tâches PENDING déjà anciennes peuvent occuper
      // les 5 places et masquer celle créée par ce test. On neutralise ce
      // risque en soldant les tâches PENDING préexistantes d'operator (rôle
      // ou affectation directe) — sans effet hors de cette transaction,
      // annulée en sortie par withRollback.
      await client.query(
        `UPDATE tasks SET status = 'CANCELLED'
         WHERE status = 'PENDING'
           AND (effective_assignee_id = $1 OR (effective_assignee_id IS NULL AND assignee_role_id = ANY($2::int[])))`,
        [operatorId, operator!.roleIds]
      );

      const process = await createTestProcess(client, SIMPLE_XML, adminId);
      await client.query(`UPDATE processes SET name = $1 WHERE id = $2`, [`Processus ${UNIQUE}`, process.id]);
      const updatedProcess = { ...process, name: `Processus ${UNIQUE}` };

      const instance = await startProcessInstance(client, { process: updatedProcess, startedById: adminId });

      const summary = await getDashboardSummary(client, operator!);

      const match = summary.myTasks.find((t) => t.instanceId === instance.id);
      expect(match).toBeDefined();
      expect(match?.stepName).toBe('Tâche du tableau de bord');
      expect(match?.processName).toBe(`Processus ${UNIQUE}`);
    });
  });

  it('completing a task removes it from myTasks and the instance shows up in recentActivity as COMPLETED', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const operatorId = await seedUserId(client, 'operator@bpm.local');
      const admin = await findUserById(client, adminId);
      const process = await createTestProcess(client, SIMPLE_XML, adminId);

      const instance = await startProcessInstance(client, { process, startedById: adminId });
      const { rows: taskRows } = await client.query<TaskRow>(
        `SELECT * FROM tasks WHERE instance_id = $1 AND status = 'PENDING'`,
        [instance.id]
      );
      const task = taskRows[0];

      await completeTaskAndAdvance(client, {
        task,
        instance,
        process,
        completedById: operatorId,
        formData: {},
      });

      const summary = await getDashboardSummary(client, admin!);

      expect(summary.myTasks.some((t) => t.id === task.id)).toBe(false);
      const activityMatch = summary.recentActivity.find((a) => a.instanceId === instance.id && a.event === 'COMPLETED');
      expect(activityMatch).toBeDefined();
    });
  });

  it('instance visibility: a non-admin unrelated to an instance does not see it in kpis/statusBreakdown/recentActivity', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const validator = await findUserById(client, await seedUserId(client, 'validator@bpm.local'));
      const process = await createTestProcess(client, SIMPLE_XML, adminId);

      const before = await getDashboardSummary(client, validator!);
      const instance = await startProcessInstance(client, { process, startedById: adminId });
      const after = await getDashboardSummary(client, validator!);

      expect(after.kpis.runningInstances).toBe(before.kpis.runningInstances);
      expect(after.recentActivity.some((a) => a.instanceId === instance.id)).toBe(false);
    });
  });
});
