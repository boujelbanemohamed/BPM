/**
 * Safe evaluator for BPMN sequenceFlow conditionExpression strings, written
 * by process designers as simple comparisons: `field OPERATOR value`.
 * No eval()/Function() is ever used — expressions are parsed into a
 * {field, operator, value} triple and matched against the instance context.
 */

const OPERATOR_TOKENS = ['==', '!=', '>=', '<=', '>', '<', 'contains'] as const;
type Operator = (typeof OPERATOR_TOKENS)[number];

export interface ParsedCondition {
  field: string;
  operator: Operator;
  value: string | number | boolean;
}

function coerceLiteral(raw: string): string | number | boolean {
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, '');
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return trimmed;
}

export function parseCondition(expression: string): ParsedCondition | null {
  const expr = expression.trim();
  for (const token of OPERATOR_TOKENS) {
    const idx = expr.indexOf(` ${token} `);
    if (idx !== -1) {
      const field = expr.slice(0, idx).trim();
      const rawValue = expr.slice(idx + token.length + 2).trim();
      return { field, operator: token, value: coerceLiteral(rawValue) };
    }
  }
  return null;
}

export function evaluateExpression(expression: string, context: Record<string, unknown>): boolean {
  const condition = parseCondition(expression);
  if (!condition) return false;

  const actual = context[condition.field];
  switch (condition.operator) {
    case '==':
      return actual === condition.value;
    case '!=':
      return actual !== condition.value;
    case '>':
      return Number(actual) > Number(condition.value);
    case '>=':
      return Number(actual) >= Number(condition.value);
    case '<':
      return Number(actual) < Number(condition.value);
    case '<=':
      return Number(actual) <= Number(condition.value);
    case 'contains':
      return typeof actual === 'string' && actual.includes(String(condition.value));
    default:
      return false;
  }
}
