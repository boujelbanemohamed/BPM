import { describe, expect, it } from 'vitest';
import { findUserById } from '../db/usersRepo';
import { performSearch } from './searchService';
import { createTestProcess, seedUserId, withRollback } from '../test/dbTestHelpers';

const MINIMAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   id="Definitions_search" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_search" isExecutable="true">
    <bpmn:startEvent id="Start" name="Début" />
  </bpmn:process>
</bpmn:definitions>`;

const UNIQUE = `RechAlpha${Date.now()}`;

describe('searchService — performSearch', () => {
  it('finds a process by (partial, case-insensitive) name', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const admin = await findUserById(client, adminId);
      const process = await createTestProcess(client, MINIMAL_XML, adminId);
      await client.query(`UPDATE processes SET name = $1 WHERE id = $2`, [`Processus ${UNIQUE} Congés`, process.id]);

      const results = await performSearch(client, {
        query: UNIQUE.toLowerCase(),
        user: admin!,
        documentsAccessLevel: 'FULL',
      });

      expect(results.processes.map((p) => p.id)).toContain(process.id);
    });
  });

  it('finds a process by reference', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const admin = await findUserById(client, adminId);
      const process = await createTestProcess(client, MINIMAL_XML, adminId);

      const results = await performSearch(client, {
        query: process.reference,
        user: admin!,
        documentsAccessLevel: 'FULL',
      });

      expect(results.processes.map((p) => p.id)).toContain(process.id);
    });
  });

  it('returns empty results (not an error) when nothing matches', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const admin = await findUserById(client, adminId);

      const results = await performSearch(client, {
        query: `NoSuchThing${Date.now()}`,
        user: admin!,
        documentsAccessLevel: 'FULL',
      });

      expect(results).toEqual({ processes: [], instances: [], documents: [] });
    });
  });

  it('instance visibility: a non-admin who neither started nor is assigned to the instance does not see it', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const operatorId = await seedUserId(client, 'operator@bpm.local');
      const validator = await findUserById(client, await seedUserId(client, 'validator@bpm.local'));

      const process = await createTestProcess(client, MINIMAL_XML, adminId);
      await client.query(`UPDATE processes SET name = $1 WHERE id = $2`, [`Instance ${UNIQUE} Test`, process.id]);
      const { rows } = await client.query(
        `INSERT INTO process_instances (process_id, current_step_name, current_element_id, started_by)
         VALUES ($1, 'Début', 'Start', $2) RETURNING id`,
        [process.id, operatorId]
      );
      const instanceId = rows[0].id;

      const results = await performSearch(client, {
        query: UNIQUE.toLowerCase(),
        user: validator!,
        documentsAccessLevel: 'FULL',
      });

      expect(results.instances.map((i) => i.id)).not.toContain(instanceId);
    });
  });

  it('instance visibility: the user who started the instance does see it', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const operatorId = await seedUserId(client, 'operator@bpm.local');
      const operator = await findUserById(client, operatorId);

      const process = await createTestProcess(client, MINIMAL_XML, adminId);
      await client.query(`UPDATE processes SET name = $1 WHERE id = $2`, [`Instance ${UNIQUE} Bis`, process.id]);
      const { rows } = await client.query(
        `INSERT INTO process_instances (process_id, current_step_name, current_element_id, started_by)
         VALUES ($1, 'Début', 'Start', $2) RETURNING id`,
        [process.id, operatorId]
      );
      const instanceId = rows[0].id;

      const results = await performSearch(client, {
        query: UNIQUE.toLowerCase(),
        user: operator!,
        documentsAccessLevel: 'FULL',
      });

      expect(results.instances.map((i) => i.id)).toContain(instanceId);
    });
  });

  it('instance visibility: an admin sees every matching instance regardless of who started it', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const admin = await findUserById(client, adminId);
      const operatorId = await seedUserId(client, 'operator@bpm.local');

      const process = await createTestProcess(client, MINIMAL_XML, adminId);
      await client.query(`UPDATE processes SET name = $1 WHERE id = $2`, [`Instance ${UNIQUE} Admin`, process.id]);
      const { rows } = await client.query(
        `INSERT INTO process_instances (process_id, current_step_name, current_element_id, started_by)
         VALUES ($1, 'Début', 'Start', $2) RETURNING id`,
        [process.id, operatorId]
      );
      const instanceId = rows[0].id;

      const results = await performSearch(client, {
        query: UNIQUE.toLowerCase(),
        user: admin!,
        documentsAccessLevel: 'FULL',
      });

      expect(results.instances.map((i) => i.id)).toContain(instanceId);
    });
  });

  it('documents: hidden entirely when the caller has no DOCUMENTS access', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const admin = await findUserById(client, adminId);
      await client.query(`INSERT INTO document_folders (name, created_by) VALUES ($1, $2)`, [
        `Dossier ${UNIQUE}`,
        adminId,
      ]);

      const results = await performSearch(client, {
        query: UNIQUE.toLowerCase(),
        user: admin!,
        documentsAccessLevel: 'NONE',
      });

      expect(results.documents).toEqual([]);
    });
  });

  it('documents: a folder is found by name when the caller has VIEW access', async () => {
    await withRollback(async (client) => {
      const adminId = await seedUserId(client, 'admin@bpm.local');
      const admin = await findUserById(client, adminId);
      const { rows } = await client.query(`INSERT INTO document_folders (name, created_by) VALUES ($1, $2) RETURNING id`, [
        `Dossier ${UNIQUE}`,
        adminId,
      ]);

      const results = await performSearch(client, {
        query: UNIQUE.toLowerCase(),
        user: admin!,
        documentsAccessLevel: 'VIEW',
      });

      expect(results.documents).toEqual([{ type: 'folder', id: rows[0].id, label: `Dossier ${UNIQUE}` }]);
    });
  });
});
