import { describe, expect, it, vi } from 'vitest';
import { MulterError } from 'multer';
import { Request, Response } from 'express';
import { errorHandler, HttpError } from './errorHandler';

function run(err: unknown) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
  errorHandler(err, { path: '/x', method: 'GET' } as Request, res, vi.fn());
  return { status: (res.status as any).mock.calls[0][0], body: (res.json as any).mock.calls[0][0] };
}

describe('errorHandler', () => {
  it('keeps HttpError status and message', () => {
    expect(run(new HttpError(409, 'Conflit'))).toEqual({ status: 409, body: { error: 'Conflit' } });
  });

  it('maps an invalid uuid (PostgreSQL 22P02) to 400 instead of 500', () => {
    expect(run(Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' })).status).toBe(400);
  });

  it('maps an oversized upload to 413', () => {
    expect(run(new MulterError('LIMIT_FILE_SIZE')).status).toBe(413);
  });

  it('maps malformed JSON bodies to 400', () => {
    expect(run(Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed' })).status).toBe(400);
  });

  it('still answers 500 for unexpected errors', () => {
    expect(run(new Error('boom'))).toEqual({ status: 500, body: { error: 'Erreur interne du serveur' } });
  });
});
