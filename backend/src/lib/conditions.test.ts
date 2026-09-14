import { describe, expect, it } from 'vitest';
import { evaluateExpression, parseCondition } from './conditions';

describe('parseCondition', () => {
  it('parses a simple equality condition', () => {
    expect(parseCondition('montant == 100')).toEqual({ field: 'montant', operator: '==', value: 100 });
  });

  it('parses a contains condition with a quoted string value', () => {
    expect(parseCondition('motif contains "urgent"')).toEqual({
      field: 'motif',
      operator: 'contains',
      value: 'urgent',
    });
  });

  it("does not mistake an operator-like substring inside the quoted value for the condition's own operator", () => {
    // Le " == " à l'intérieur des guillemets ne doit pas être pris pour
    // l'opérateur de la condition — c'est bien "contains" qui doit être
    // détecté, avec la valeur littérale complète (guillemets exclus).
    expect(parseCondition('motif contains "urgent == oui"')).toEqual({
      field: 'motif',
      operator: 'contains',
      value: 'urgent == oui',
    });
  });

  it('handles a quoted value containing single quotes when the expression uses double quotes', () => {
    expect(parseCondition(`motif contains "l'urgent"`)).toEqual({
      field: 'motif',
      operator: 'contains',
      value: "l'urgent",
    });
  });

  it('returns null for an unparseable expression', () => {
    expect(parseCondition('ceci ne veut rien dire')).toBeNull();
  });
});

describe('evaluateExpression', () => {
  it('evaluates a contains condition whose quoted value contains an operator-like substring', () => {
    expect(evaluateExpression('motif contains "urgent == oui"', { motif: 'Dossier urgent == oui à traiter' })).toBe(
      true
    );
    expect(evaluateExpression('motif contains "urgent == oui"', { motif: 'Rien à voir' })).toBe(false);
  });

  it('evaluates numeric comparisons', () => {
    expect(evaluateExpression('montant > 100', { montant: 150 })).toBe(true);
    expect(evaluateExpression('montant > 100', { montant: 50 })).toBe(false);
  });
});
