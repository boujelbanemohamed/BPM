import { describe, expect, it } from 'vitest';
import { paginationClause, paginationQuerySchema } from './pagination';

describe('pagination', () => {
  it('applies sensible defaults when no query params are given', () => {
    const parsed = paginationQuerySchema.parse({});
    expect(parsed).toEqual({ limit: 50, offset: 0 });
  });

  it('coerces string query params to numbers', () => {
    const parsed = paginationQuerySchema.parse({ limit: '20', offset: '40' });
    expect(parsed).toEqual({ limit: 20, offset: 40 });
  });

  it('rejects a limit above the cap', () => {
    expect(() => paginationQuerySchema.parse({ limit: '500' })).toThrow();
  });

  it('rejects a negative offset', () => {
    expect(() => paginationQuerySchema.parse({ offset: '-1' })).toThrow();
  });

  it('appends limit/offset after any existing filter params and returns the matching placeholders', () => {
    const params: unknown[] = ['some-filter-value'];
    const clause = paginationClause(params, { limit: 25, offset: 50 });

    expect(clause).toBe('LIMIT $2 OFFSET $3');
    expect(params).toEqual(['some-filter-value', 25, 50]);
  });

  it('produces $1/$2 when there are no prior filter params', () => {
    const params: unknown[] = [];
    const clause = paginationClause(params, { limit: 10, offset: 0 });

    expect(clause).toBe('LIMIT $1 OFFSET $2');
    expect(params).toEqual([10, 0]);
  });
});
