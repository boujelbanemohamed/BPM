import { Pool, PoolClient } from 'pg';
import { CommentRow } from '../types';

export type CommentWithAuthor = CommentRow & { author_name: string; task_step_name: string | null };

export async function listComments(client: Pool | PoolClient, instanceId: string): Promise<CommentWithAuthor[]> {
  const { rows } = await client.query<CommentWithAuthor>(
    `SELECT c.*, u.full_name AS author_name, t.step_name AS task_step_name
     FROM comments c
     JOIN users u ON u.id = c.author_id
     LEFT JOIN tasks t ON t.id = c.task_id
     WHERE c.instance_id = $1
     ORDER BY c.created_at ASC`,
    [instanceId]
  );
  return rows;
}

export async function addComment(
  client: Pool | PoolClient,
  params: { instanceId: string; taskId: string | null; authorId: string; body: string }
): Promise<CommentRow> {
  const { rows } = await client.query<CommentRow>(
    `INSERT INTO comments (instance_id, task_id, author_id, body) VALUES ($1, $2, $3, $4) RETURNING *`,
    [params.instanceId, params.taskId, params.authorId, params.body]
  );
  return rows[0];
}
