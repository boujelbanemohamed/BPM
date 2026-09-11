import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { ProcessRow } from '../types';

/**
 * Exécute `fn` dans une transaction toujours annulée (ROLLBACK) en sortie,
 * y compris en cas d'erreur : la base de dev reste inchangée après chaque
 * test, sans nettoyage manuel à écrire. Adapté aux tests qui n'ont pas
 * besoin de vraies transactions concurrentes (voir `withRealTransaction`
 * pour le cas contraire, ex. tests de verrouillage/concurrence).
 */
export async function withRollback<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

/**
 * Récupère l'id d'un utilisateur seedé (ex. admin@bpm.local). Les tests
 * d'intégration du moteur de workflow s'appuient sur les données de seed
 * de db/init.sql (utilisateurs, rôles) : ils supposent une base de dev
 * initialisée, comme l'application elle-même.
 */
export async function seedUserId(client: PoolClient, email: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  if (!rows[0]) {
    throw new Error(
      `Utilisateur de seed introuvable : ${email}. Ces tests nécessitent une base de dev initialisée (db/init.sql).`
    );
  }
  return rows[0].id;
}

/** Crée un processus PUBLISHED minimal pour les tests, avec le XML fourni. */
export async function createTestProcess(client: PoolClient, bpmnXml: string, createdBy: string): Promise<ProcessRow> {
  const { rows } = await client.query<ProcessRow>(
    `INSERT INTO processes (process_key, name, bpmn_xml, status, created_by)
     VALUES ($1, $2, $3, 'PUBLISHED', $4) RETURNING *`,
    [`test-process-${Date.now()}-${Math.random().toString(36).slice(2)}`, 'Processus de test', bpmnXml, createdBy]
  );
  return rows[0];
}
