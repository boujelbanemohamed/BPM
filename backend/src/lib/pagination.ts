import { z } from 'zod';

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Ajoute limit/offset à la fin d'un tableau de paramètres SQL déjà
 * construit (filtres, etc.) et retourne la clause `LIMIT $n OFFSET $m`
 * correspondante, à concaténer après ORDER BY.
 */
export function paginationClause(params: unknown[], pagination: PaginationQuery): string {
  params.push(pagination.limit);
  const limitParam = params.length;
  params.push(pagination.offset);
  const offsetParam = params.length;
  return `LIMIT $${limitParam} OFFSET $${offsetParam}`;
}
