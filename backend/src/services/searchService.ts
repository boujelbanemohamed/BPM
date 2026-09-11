import { Pool, PoolClient } from 'pg';
import { AuthenticatedUser } from '../types';

const RESULT_LIMIT = 8;

export interface SearchProcessResult {
  id: string;
  reference: string;
  name: string;
  status: string;
}

export interface SearchInstanceResult {
  id: string;
  status: string;
  currentStepName: string | null;
  processName: string;
  clientName: string | null;
}

export type SearchDocumentResult =
  | { type: 'folder'; id: string; label: string }
  | { type: 'document'; id: string; label: string; folderId: string; folderName: string };

export interface SearchResults {
  processes: SearchProcessResult[];
  instances: SearchInstanceResult[];
  documents: SearchDocumentResult[];
}

/**
 * Recherche globale sur les processus, les instances et la bibliothèque de
 * documents. Reprend exactement les mêmes règles de visibilité que les
 * endpoints de liste existants, pour ne jamais faire remonter à un
 * utilisateur un résultat qu'il ne pourrait pas voir en naviguant
 * normalement (GET /processes, GET /instances, GET /library/*) :
 *   - instances : administrateur = tout ; sinon uniquement les instances
 *     démarrées par l'utilisateur ou comportant une tâche qui lui est
 *     assignée (directement ou via son rôle) — même clause que GET /instances.
 *   - documents (dossiers + fichiers) : uniquement si l'utilisateur a au
 *     moins un accès VIEW sur la page DOCUMENTS (matrice de droits par
 *     rôle) — sinon la catégorie est simplement vide, sans erreur.
 *   - processus : pas de restriction (déjà consultables par tout
 *     utilisateur connecté via GET /processes).
 */
export async function performSearch(
  client: Pool | PoolClient,
  params: { query: string; user: Pick<AuthenticatedUser, 'id' | 'roles' | 'roleIds'>; documentsAccessLevel: string }
): Promise<SearchResults> {
  const { query, user, documentsAccessLevel } = params;
  const like = `%${query}%`;
  const isAdmin = user.roles.includes('ADMIN');

  const { rows: processRows } = await client.query<SearchProcessResult>(
    `SELECT id, reference, name, status
     FROM processes
     WHERE deleted_at IS NULL AND (name ILIKE $1 OR reference ILIKE $1)
     ORDER BY name ASC
     LIMIT $2`,
    [like, RESULT_LIMIT]
  );

  const instanceParams: unknown[] = [like, RESULT_LIMIT];
  let instanceVisibility = '';
  if (!isAdmin) {
    instanceVisibility = `AND (pi.started_by = $3 OR EXISTS (
      SELECT 1 FROM tasks t WHERE t.instance_id = pi.id
      AND (t.effective_assignee_id = $3 OR t.assignee_role_id = ANY($4::int[]))
    ))`;
    instanceParams.push(user.id, user.roleIds);
  }
  const { rows: instanceRows } = await client.query<{
    id: string;
    status: string;
    current_step_name: string | null;
    process_name: string;
    client_name: string | null;
  }>(
    `SELECT pi.id, pi.status, pi.current_step_name, p.name AS process_name, c.name AS client_name
     FROM process_instances pi
     JOIN processes p ON p.id = pi.process_id
     LEFT JOIN clients c ON c.id = pi.client_id
     WHERE (p.name ILIKE $1 OR pi.current_step_name ILIKE $1 OR c.name ILIKE $1)
     ${instanceVisibility}
     ORDER BY pi.started_at DESC
     LIMIT $2`,
    instanceParams
  );
  const instances: SearchInstanceResult[] = instanceRows.map((r) => ({
    id: r.id,
    status: r.status,
    currentStepName: r.current_step_name,
    processName: r.process_name,
    clientName: r.client_name,
  }));

  let documents: SearchDocumentResult[] = [];
  if (documentsAccessLevel !== 'NONE') {
    const { rows: folderRows } = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM document_folders WHERE name ILIKE $1 ORDER BY name ASC LIMIT $2`,
      [like, RESULT_LIMIT]
    );
    const { rows: docRows } = await client.query<{
      id: string;
      filename: string;
      folder_id: string;
      folder_name: string;
    }>(
      `SELECT d.id, d.filename, d.folder_id, f.name AS folder_name
       FROM library_documents d
       JOIN document_folders f ON f.id = d.folder_id
       WHERE d.filename ILIKE $1
       ORDER BY d.filename ASC
       LIMIT $2`,
      [like, RESULT_LIMIT]
    );
    documents = [
      ...folderRows.map((f): SearchDocumentResult => ({ type: 'folder', id: f.id, label: f.name })),
      ...docRows.map(
        (d): SearchDocumentResult => ({
          type: 'document',
          id: d.id,
          label: d.filename,
          folderId: d.folder_id,
          folderName: d.folder_name,
        })
      ),
    ];
  }

  return { processes: processRows, instances, documents };
}
