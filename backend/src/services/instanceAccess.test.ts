import { describe, expect, it } from 'vitest';
import { isInstanceParticipant } from './instanceAccess';

const ADMIN = { id: 'admin-id', roles: ['ADMIN'], roleIds: [] };
const STARTER = { id: 'starter-id', roles: ['OPERATOR'], roleIds: [3] };
const ASSIGNEE = { id: 'assignee-id', roles: ['VALIDATOR'], roleIds: [2] };
const ROLE_MATCH = { id: 'role-match-id', roles: ['VALIDATOR'], roleIds: [2] };
const STRANGER = { id: 'stranger-id', roles: ['OPERATOR'], roleIds: [3] };

const INSTANCE = { started_by: STARTER.id };
const TASKS = [{ effective_assignee_id: ASSIGNEE.id, assignee_role_id: 2 as number | null }];

describe('instanceAccess — isInstanceParticipant', () => {
  it('an admin is always a participant, regardless of the instance', () => {
    expect(isInstanceParticipant(INSTANCE, TASKS, ADMIN)).toBe(true);
  });

  it('the user who started the instance is a participant', () => {
    expect(isInstanceParticipant(INSTANCE, TASKS, STARTER)).toBe(true);
  });

  it('a user directly assigned to one of the tasks is a participant', () => {
    expect(isInstanceParticipant(INSTANCE, TASKS, ASSIGNEE)).toBe(true);
  });

  it('a user whose role matches a task pool (no direct assignee yet) is a participant', () => {
    expect(isInstanceParticipant(INSTANCE, [{ effective_assignee_id: null, assignee_role_id: 2 }], ROLE_MATCH)).toBe(true);
  });

  it('a user with no relation to the instance is not a participant', () => {
    expect(isInstanceParticipant(INSTANCE, TASKS, STRANGER)).toBe(false);
  });

  it('an instance with no tasks yet is only visible to its starter (or an admin)', () => {
    expect(isInstanceParticipant(INSTANCE, [], STARTER)).toBe(true);
    expect(isInstanceParticipant(INSTANCE, [], STRANGER)).toBe(false);
  });
});
