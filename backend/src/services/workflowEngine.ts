import { PoolClient } from 'pg';
import { BpmnGraph, BpmnNode, findNode, outgoingFlows, parseBpmnXml } from '../lib/bpmnParser';
import { evaluateExpression } from '../lib/conditions';
import { resolveEffectiveAssignee } from './delegationService';
import { notifyProcessCompleted, notifyTaskAssigned } from './notificationService';
import { writeAuditLogTx } from '../lib/audit';
import { findUserById } from '../db/usersRepo';
import { HttpError } from '../middleware/errorHandler';
import { ProcessInstanceRow, ProcessRow, TaskRow } from '../types';

async function getRoleIdByName(client: PoolClient, name: string): Promise<number | null> {
  const { rows } = await client.query<{ id: number }>('SELECT id FROM roles WHERE name = $1', [name]);
  return rows[0]?.id ?? null;
}

async function activeUsersWithRole(
  client: PoolClient,
  roleId: number
): Promise<Array<{ id: string; email: string; full_name: string }>> {
  const { rows } = await client.query<{ id: string; email: string; full_name: string }>(
    `SELECT u.id, u.email, u.full_name
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     WHERE ur.role_id = $1 AND u.is_active = TRUE`,
    [roleId]
  );
  return rows;
}

function pickNextFlow(graph: BpmnGraph, node: BpmnNode, context: Record<string, unknown>) {
  const flows = outgoingFlows(graph, node.id);
  const conditional = flows.filter((f) => f.conditionExpression);
  for (const flow of conditional) {
    if (evaluateExpression(flow.conditionExpression!, context)) return flow;
  }
  const defaultFlow = flows.find((f) => f.id === node.defaultFlowId);
  if (defaultFlow) return defaultFlow;
  return flows.find((f) => !f.conditionExpression) ?? null;
}

async function advance(
  client: PoolClient,
  graph: BpmnGraph,
  process: ProcessRow,
  instance: ProcessInstanceRow,
  fromNodeId: string
): Promise<ProcessInstanceRow> {
  const fromNode = findNode(graph, fromNodeId);
  const flow = pickNextFlow(graph, fromNode, instance.form_data);
  if (!flow) {
    throw new HttpError(400, `Aucune transition sortante valide depuis le nœud "${fromNode.id}" (impasse BPMN)`);
  }

  const targetNode = findNode(graph, flow.target);

  if (targetNode.type === 'endEvent') {
    const { rows } = await client.query<ProcessInstanceRow>(
      `UPDATE process_instances
       SET status = 'COMPLETED', current_step_name = $1, current_element_id = $2, completed_at = now()
       WHERE id = $3 RETURNING *`,
      [targetNode.name, targetNode.id, instance.id]
    );
    const updated = rows[0];

    await writeAuditLogTx(client, {
      userId: null,
      action: 'PROCESS_COMPLETED',
      entityType: 'process_instance',
      entityId: instance.id,
      details: { endEvent: targetNode.name },
    });

    const starter = await findUserById(client, instance.started_by);
    if (starter) {
      await notifyProcessCompleted(client, {
        userId: starter.id,
        email: starter.email,
        fullName: starter.fullName,
        processName: process.name,
        outcome: targetNode.name,
        instanceId: instance.id,
      });
    }

    return updated;
  }

  if (targetNode.type === 'exclusiveGateway') {
    await writeAuditLogTx(client, {
      userId: null,
      action: 'GATEWAY_EVALUATED',
      entityType: 'process_instance',
      entityId: instance.id,
      details: { gateway: targetNode.id },
    });
    return advance(client, graph, process, instance, targetNode.id);
  }

  if (targetNode.type === 'userTask') {
    let effectiveAssigneeId: string | null = null;
    let isDelegated = false;
    let roleId: number | null = null;

    if (targetNode.assigneeRole) {
      roleId = await getRoleIdByName(client, targetNode.assigneeRole);
      if (!roleId) {
        throw new HttpError(400, `Rôle BPMN inconnu : "${targetNode.assigneeRole}" (tâche ${targetNode.id})`);
      }
    }

    let originalAssigneeId: string | null = null;
    if (targetNode.assigneeUserId) {
      const resolved = await resolveEffectiveAssignee(client, targetNode.assigneeUserId);
      originalAssigneeId = targetNode.assigneeUserId;
      effectiveAssigneeId = resolved.userId;
      isDelegated = resolved.isDelegated;
    }

    const { rows: taskRows } = await client.query<TaskRow>(
      `INSERT INTO tasks (instance_id, element_id, step_name, original_assignee_id, effective_assignee_id, assignee_role_id, is_delegated, form_schema)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        instance.id,
        targetNode.id,
        targetNode.name,
        originalAssigneeId,
        effectiveAssigneeId,
        roleId,
        isDelegated,
        JSON.stringify(targetNode.formFields),
      ]
    );
    const task = taskRows[0];

    const { rows: instRows } = await client.query<ProcessInstanceRow>(
      `UPDATE process_instances SET current_step_name = $1, current_element_id = $2 WHERE id = $3 RETURNING *`,
      [targetNode.name, targetNode.id, instance.id]
    );

    await writeAuditLogTx(client, {
      userId: null,
      action: 'TASK_CREATED',
      entityType: 'task',
      entityId: task.id,
      details: { stepName: targetNode.name, effectiveAssigneeId, roleId, isDelegated },
    });

    if (effectiveAssigneeId) {
      const recipient = await findUserById(client, effectiveAssigneeId);
      const original = isDelegated && originalAssigneeId ? await findUserById(client, originalAssigneeId) : null;
      if (recipient) {
        await notifyTaskAssigned(client, {
          recipientId: recipient.id,
          recipientEmail: recipient.email,
          recipientName: recipient.fullName,
          taskName: targetNode.name,
          processName: process.name,
          isDelegated,
          originalAssigneeName: original?.fullName,
        });
      }
    } else if (roleId) {
      // Tâche ouverte au pool de rôle : notifier tous les titulaires actifs
      const pool = await activeUsersWithRole(client, roleId);
      for (const member of pool) {
        await notifyTaskAssigned(client, {
          recipientId: member.id,
          recipientEmail: member.email,
          recipientName: member.full_name,
          taskName: targetNode.name,
          processName: process.name,
          isDelegated: false,
        });
      }
    }

    return instRows[0];
  }

  throw new HttpError(400, `Type de nœud BPMN non supporté comme cible : ${targetNode.type}`);
}

export async function startProcessInstance(
  client: PoolClient,
  params: { process: ProcessRow; startedById: string; initialFormData?: Record<string, unknown> }
): Promise<ProcessInstanceRow> {
  const { process, startedById, initialFormData } = params;
  const graph = parseBpmnXml(process.bpmn_xml);
  const startNode = graph.nodes.find((n) => n.type === 'startEvent');
  if (!startNode) throw new HttpError(400, "Le processus ne contient pas d'événement de début");

  const resolvedFormData = { ...(initialFormData ?? {}) };
  let clientId: string | null = null;
  const clientField = startNode.formFields.find((f) => f.type === 'client');
  if (clientField && resolvedFormData[clientField.key]) {
    const { rows: clientRows } = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM clients WHERE id = $1',
      [resolvedFormData[clientField.key]]
    );
    const foundClient = clientRows[0];
    if (!foundClient) throw new HttpError(400, 'Client sélectionné introuvable');
    clientId = foundClient.id;
    resolvedFormData[clientField.key] = foundClient.name;
  }

  const { rows } = await client.query<ProcessInstanceRow>(
    `INSERT INTO process_instances (process_id, client_id, current_step_name, current_element_id, form_data, started_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [process.id, clientId, startNode.name, startNode.id, JSON.stringify(resolvedFormData), startedById]
  );
  const instance = rows[0];

  await writeAuditLogTx(client, {
    userId: startedById,
    action: 'INSTANCE_STARTED',
    entityType: 'process_instance',
    entityId: instance.id,
    details: { processName: process.name },
  });

  return advance(client, graph, process, instance, startNode.id);
}

export async function completeTaskAndAdvance(
  client: PoolClient,
  params: {
    task: TaskRow;
    instance: ProcessInstanceRow;
    process: ProcessRow;
    completedById: string;
    formData: Record<string, unknown>;
  }
): Promise<ProcessInstanceRow> {
  const { task, instance, process, completedById, formData } = params;
  const graph = parseBpmnXml(process.bpmn_xml);

  await client.query(
    `UPDATE tasks SET status = 'COMPLETED', form_data = $1, completed_at = now(), completed_by = $2 WHERE id = $3`,
    [JSON.stringify(formData), completedById, task.id]
  );

  const mergedContext = { ...instance.form_data, ...formData };
  const { rows } = await client.query<ProcessInstanceRow>(
    `UPDATE process_instances SET form_data = $1 WHERE id = $2 RETURNING *`,
    [JSON.stringify(mergedContext), instance.id]
  );
  const updatedInstance = rows[0];

  await writeAuditLogTx(client, {
    userId: completedById,
    action: 'TASK_COMPLETED',
    entityType: 'task',
    entityId: task.id,
    details: { stepName: task.step_name, formData },
  });

  return advance(client, graph, process, updatedInstance, task.element_id);
}

export function parseGraph(bpmnXml: string): BpmnGraph {
  return parseBpmnXml(bpmnXml);
}
