import { describe, expect, it } from 'vitest';
import { addComment, listComments } from './commentService';
import { createTestProcess, seedUserId, withRollback } from '../test/dbTestHelpers';

const MINIMAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   id="Definitions_comments" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_comments" isExecutable="true">
    <bpmn:startEvent id="Start" name="Début" />
  </bpmn:process>
</bpmn:definitions>`;

async function createInstance(client: Parameters<typeof createTestProcess>[0], processId: string, startedBy: string) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO process_instances (process_id, current_step_name, current_element_id, started_by)
     VALUES ($1, 'Début', 'Start', $2) RETURNING id`,
    [processId, startedBy]
  );
  return rows[0].id;
}

async function createTask(client: Parameters<typeof createTestProcess>[0], instanceId: string, stepName: string) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO tasks (instance_id, element_id, step_name) VALUES ($1, 'Task_1', $2) RETURNING id`,
    [instanceId, stepName]
  );
  return rows[0].id;
}

describe('commentService', () => {
  it('addComment then listComments returns the comment with the author name attached', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      // Le nom de ce compte peut avoir été personnalisé dans la base de dev
      // (ex. "Mohamed Boujelbane" au lieu de la valeur par défaut du seed) :
      // on récupère le nom réel plutôt que de supposer sa valeur.
      const { rows: adminRows } = await client.query<{ full_name: string }>('SELECT full_name FROM users WHERE id = $1', [
        adminId,
      ]);
      const adminName = adminRows[0].full_name;

      const process = await createTestProcess(client, MINIMAL_XML, adminId);
      const instanceId = await createInstance(client, process.id, adminId);

      const created = await addComment(client, { instanceId, taskId: null, authorId: adminId, body: 'Premier message' });

      const comments = await listComments(client, instanceId);

      expect(comments).toHaveLength(1);
      expect(comments[0].id).toBe(created.id);
      expect(comments[0].body).toBe('Premier message');
      expect(comments[0].author_name).toBe(adminName);
    });
  });

  it('orders comments chronologically by created_at', async () => {
    // now() est fixé pour toute la durée d'une transaction Postgres : deux
    // addComment() successifs dans le même withRollback recevraient le même
    // created_at. On insère donc ici directement avec des horodatages
    // explicitement distincts pour tester la clause ORDER BY elle-même.
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, MINIMAL_XML, adminId);
      const instanceId = await createInstance(client, process.id, adminId);

      const { rows: older } = await client.query<{ id: string }>(
        `INSERT INTO comments (instance_id, author_id, body, created_at) VALUES ($1, $2, 'Plus ancien', now() - interval '1 minute') RETURNING id`,
        [instanceId, adminId]
      );
      const { rows: newer } = await client.query<{ id: string }>(
        `INSERT INTO comments (instance_id, author_id, body, created_at) VALUES ($1, $2, 'Plus récent', now()) RETURNING id`,
        [instanceId, adminId]
      );

      const comments = await listComments(client, instanceId);

      expect(comments.map((c) => c.id)).toEqual([older[0].id, newer[0].id]);
    });
  });

  it('a comment can reference a specific task, and listComments returns that task\'s step name', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, MINIMAL_XML, adminId);
      const instanceId = await createInstance(client, process.id, adminId);
      const taskId = await createTask(client, instanceId, 'Validation manager');

      await addComment(client, { instanceId, taskId, authorId: adminId, body: 'Sur cette tâche précisément' });

      const comments = await listComments(client, instanceId);

      expect(comments).toHaveLength(1);
      expect(comments[0].task_id).toBe(taskId);
      expect(comments[0].task_step_name).toBe('Validation manager');
    });
  });

  it('listComments only returns comments for the requested instance', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const process = await createTestProcess(client, MINIMAL_XML, adminId);
      const instanceA = await createInstance(client, process.id, adminId);
      const instanceB = await createInstance(client, process.id, adminId);

      await addComment(client, { instanceId: instanceA, taskId: null, authorId: adminId, body: 'Pour A' });
      await addComment(client, { instanceId: instanceB, taskId: null, authorId: adminId, body: 'Pour B' });

      const commentsA = await listComments(client, instanceA);

      expect(commentsA).toHaveLength(1);
      expect(commentsA[0].body).toBe('Pour A');
    });
  });
});
