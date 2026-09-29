/**
 * Parseur CSV minimal (RFC 4180) : gère les champs entre guillemets, les
 * virgules et guillemets échappés à l'intérieur, et les fins de ligne CRLF/LF.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const content = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r') {
      // ignoré, traité via \n
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

// Un tableur interprète comme une formule toute cellule commençant par l'un de
// ces caractères (injection CSV : =HYPERLINK(...), =cmd|...). Les valeurs
// exportées viennent en partie des utilisateurs (noms de clients, données de
// dossier) : on les neutralise par une apostrophe. Une valeur faite uniquement
// de chiffres (nombre négatif, téléphone "+33 6 12 34 56 78") ne peut appeler
// aucune fonction et reste donc lisible telle quelle.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?[\d\s().,]+$/;

function csvEscape(raw: string): string {
  const value = FORMULA_PREFIX.test(raw) && !PLAIN_NUMBER.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Sérialise des lignes en CSV (RFC 4180, séparateur virgule, fin de ligne CRLF). */
export function toCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(row.map((v) => csvEscape(v === null || v === undefined ? '' : String(v))).join(','));
  }
  return lines.join('\r\n');
}

export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, idx) => {
      record[header] = (row[idx] ?? '').trim();
    });
    return record;
  });
}
