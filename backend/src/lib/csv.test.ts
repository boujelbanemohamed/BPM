import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('joins headers and rows with commas and CRLF line endings', () => {
    const csv = toCsv(['Nom', 'Statut'], [['Dupont SA', 'RUNNING']]);
    expect(csv).toBe('Nom,Statut\r\nDupont SA,RUNNING');
  });

  it('quotes fields containing commas, quotes or newlines and escapes embedded quotes', () => {
    const csv = toCsv(['Notes'], [['Contient, une virgule'], ['Contient "des guillemets"'], ['Multi\nligne']]);
    expect(csv).toBe('Notes\r\n"Contient, une virgule"\r\n"Contient ""des guillemets"""\r\n"Multi\nligne"');
  });

  it('renders null/undefined values as empty fields', () => {
    const csv = toCsv(['A', 'B'], [[null, undefined]]);
    expect(csv).toBe('A,B\r\n,');
  });
});
