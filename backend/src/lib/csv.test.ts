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

  it('neutralises cells a spreadsheet would run as a formula (CSV injection)', () => {
    const csv = toCsv(['V'], [['=HYPERLINK("http://x","clic")'], ['+1+1'], ['@SUM(A1)'], ['-2+3'], ['\tcmd']]);
    expect(csv).toBe('V\r\n"\'=HYPERLINK(""http://x"",""clic"")"\r\n\'+1+1\r\n\'@SUM(A1)\r\n\'-2+3\r\n\'\tcmd');
  });

  it('keeps plain negative numbers and phone numbers readable', () => {
    expect(toCsv(['N'], [['-42'], ['-3,5'], ['+33 6 12 34 56 78']])).toBe('N\r\n-42\r\n"-3,5"\r\n+33 6 12 34 56 78');
  });
});
