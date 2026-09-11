import { PoolClient } from 'pg';
import { BpmnFlow, BpmnGraph, BpmnNode, findNode, incomingFlows, outgoingFlows, parseBpmnXml } from '../lib/bpmnParser';
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

/**
 * Passerelle inclusive (OR) : contrairement à l'exclusive qui ne retient
 * qu'UN flux, celle-ci active TOUS les flux conditionnels vrais à la fois
 * (potentiellement plusieurs). Si aucune condition n'est vraie, retombe
 * sur le flux par défaut seul, puis sur l'unique flux sans condition —
 * même repli que pickNextFlow.
 */
function pickInclusiveFlows(graph: BpmnGraph, node: BpmnNode, context: Record<string, unknown>): BpmnFlow[] {
  const flows = outgoingFlows(graph, node.id);
  const conditional = flows.filter((f) => f.conditionExpression);
  const matched = conditional.filter((f) => evaluateExpression(f.conditionExpression!, context));
  if (matched.length > 0) return matched;
  const defaultFlow = flows.find((f) => f.id === node.defaultFlowId);
  if (defaultFlow) return [defaultFlow];
  const fallback = flows.find((f) => !f.conditionExpression);
  return fallback ? [fallback] : [];
}

/**
 * Détermine si `branchFlow` (un flux sortant de la passerelle inclusive
 * divergente `forkNode`) serait activé pour ce contexte — utilisé pour
 * savoir, côté jointure, si une de ses branches d'origine était réellement
 * attendue.
 */
function isFlowActivatedByFork(
  graph: BpmnGraph,
  forkNode: BpmnNode,
  branchFlow: BpmnFlow,
  context: Record<string, unknown>
): boolean {
  return pickInclusiveFlows(graph, forkNode, context).some((f) => f.id === branchFlow.id);
}

/**
 * Remonte le graphe en amont d'un flux entrant de jointure, à travers les
 * nœuds à sortie unique (pas de rebranchement), jusqu'à trouver soit une
 * passerelle divergente (qui décide si cette branche est attendue), soit
 * un départ de branche (toujours attendu). Hypothèse assumée (cf. portée
 * validée) : chaque branche issue d'une passerelle inclusive divergente
 * mène directement à sa jointure, sans repasser par une autre passerelle
 * divergente en chemin.
 */
function isIncomingFlowExpected(graph: BpmnGraph, incomingFlow: BpmnFlow, context: Record<string, unknown>): boolean {
  let flow = incomingFlow;
  for (let hops = 0; hops < graph.nodes.length + 1; hops++) {
    const sourceNode = findNode(graph, flow.source);
    const sourceOutgoing = outgoingFlows(graph, sourceNode.id);

    if (sourceOutgoing.length > 1) {
      // Nœud divergent : une passerelle inclusive filtre selon ses
      // conditions ; toute autre passerelle divergente (parallèle...)
      // active systématiquement toutes ses branches.
      if (sourceNode.type === 'inclusiveGateway') {
        return isFlowActivatedByFork(graph, sourceNode, flow, context);
      }
      return true;
    }

    const sourceIncoming = incomingFlows(graph, sourceNode.id);
    if (sourceIncoming.length !== 1) {
      // Départ de branche (aucune entrée), ou jointure amont (plusieurs
      // entrées, hors périmètre de cette heuristique) : toujours attendu.
      return true;
    }
    flow = sourceIncoming[0];
  }
  // Garde-fou : ce moteur ne supporte pas les boucles BPMN, une chaîne
  // aussi longue signale un graphe anormal plutôt qu'une vraie remontée.
  return true;
}

/** Sous-ensemble des flux entrants d'une jointure réellement attendus dans ce contexte. */
function expectedIncomingFlows(graph: BpmnGraph, joinNode: BpmnNode, context: Record<string, unknown>): BpmnFlow[] {
  return incomingFlows(graph, joinNode.id).filter((f) => isIncomingFlowExpected(graph, f, context));
}

/**
 * Fait progresser un unique token le long de `flow` jusqu'à son nœud
 * cible, et traite ce nœud. Une passerelle parallèle "diverge" (fan-out)
 * en appelant cette fonction une fois par flux sortant ; elle "converge"
 * (join) en enregistrant l'arrivée de chaque token et ne relance
 * l'exécution qu'une fois tous ses flux entrants livrés — voir
 * `advanceParallelGateway`.
 */
async function advanceViaFlow(
  client: PoolClient,
  graph: BpmnGraph,
  process: ProcessRow,
  instance: ProcessInstanceRow,
  flow: BpmnFlow
): Promise<ProcessInstanceRow> {
  const targetNode = findNode(graph, flow.target);

  if (targetNode.type === 'parallelGateway') {
    return advanceParallelGateway(client, graph, process, instance, targetNode, flow);
  }

  if (targetNode.type === 'inclusiveGateway') {
    return advanceInclusiveGateway(client, graph, process, instance, targetNode, flow);
  }

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
    const nextFlow = pickNextFlow(graph, targetNode, instance.form_data);
    if (!nextFlow) {
      throw new HttpError(400, `Aucune transition sortante valide depuis la passerelle "${targetNode.id}" (impasse BPMN)`);
    }
    return advanceViaFlow(client, graph, process, instance, nextFlow);
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

interface GatewaySyncOptions {
  /** Flux entrants réellement attendus dans ce contexte (statiques pour la parallèle, dynamiques pour l'inclusive). */
  expectedIncoming: (context: Record<string, unknown>) => BpmnFlow[];
  /** Flux sortants à emprunter une fois la passerelle franchie (tous pour la parallèle, filtrés par condition pour l'inclusive). */
  outgoingToTake: (context: Record<string, unknown>) => BpmnFlow[];
  waitingAction: string;
  firedAction: string;
  gatewayLabel: string;
}

/**
 * Mécanique commune de synchronisation/duplication d'exécution, partagée
 * par les passerelles parallèle et inclusive : moins d'une "attendue" →
 * le token traverse aussitôt et relance les flux sortants retenus (fork) ;
 * plusieurs attendues → l'arrivée de `arrivingFlow` est enregistrée et
 * cette branche s'arrête ici, jusqu'à ce que toutes les branches attendues
 * aient chacune livré un token (join). Les branches étant complétées
 * séparément (chacune dans sa propre transaction), le verrou posé sur
 * l'instance en amont (voir `completeTaskAndAdvance`) empêche deux
 * arrivées concurrentes de se compter en double.
 */
async function advanceGatewaySync(
  client: PoolClient,
  graph: BpmnGraph,
  process: ProcessRow,
  instance: ProcessInstanceRow,
  gatewayNode: BpmnNode,
  arrivingFlow: BpmnFlow,
  options: GatewaySyncOptions
): Promise<ProcessInstanceRow> {
  const expected = options.expectedIncoming(instance.form_data);
  const expectedIds = new Set([...expected.map((f) => f.id), arrivingFlow.id]);

  if (expectedIds.size > 1) {
    await client.query(
      `INSERT INTO gateway_arrivals (instance_id, gateway_element_id, incoming_flow_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (instance_id, gateway_element_id, incoming_flow_id) DO NOTHING`,
      [instance.id, gatewayNode.id, arrivingFlow.id]
    );

    const { rows: arrivedRows } = await client.query<{ incoming_flow_id: string }>(
      `SELECT incoming_flow_id FROM gateway_arrivals WHERE instance_id = $1 AND gateway_element_id = $2`,
      [instance.id, gatewayNode.id]
    );
    const arrivedIds = new Set(arrivedRows.map((r) => r.incoming_flow_id));

    const allArrived = [...expectedIds].every((id) => arrivedIds.has(id));
    if (!allArrived) {
      await writeAuditLogTx(client, {
        userId: null,
        action: options.waitingAction,
        entityType: 'process_instance',
        entityId: instance.id,
        details: { gateway: gatewayNode.id, arrived: arrivedIds.size, expected: expectedIds.size, viaFlow: arrivingFlow.id },
      });
      return instance;
    }

    await client.query(`DELETE FROM gateway_arrivals WHERE instance_id = $1 AND gateway_element_id = $2`, [
      instance.id,
      gatewayNode.id,
    ]);
  }

  const outgoing = options.outgoingToTake(instance.form_data);
  if (outgoing.length === 0) {
    throw new HttpError(400, `${options.gatewayLabel} "${gatewayNode.id}" n'a aucune transition sortante activée`);
  }

  await writeAuditLogTx(client, {
    userId: null,
    action: options.firedAction,
    entityType: 'process_instance',
    entityId: instance.id,
    details: { gateway: gatewayNode.id, branches: outgoing.length },
  });

  let current = instance;
  for (const outFlow of outgoing) {
    current = await advanceViaFlow(client, graph, process, current, outFlow);
  }
  return current;
}

async function advanceParallelGateway(
  client: PoolClient,
  graph: BpmnGraph,
  process: ProcessRow,
  instance: ProcessInstanceRow,
  gatewayNode: BpmnNode,
  arrivingFlow: BpmnFlow
): Promise<ProcessInstanceRow> {
  const incoming = incomingFlows(graph, gatewayNode.id);
  return advanceGatewaySync(client, graph, process, instance, gatewayNode, arrivingFlow, {
    expectedIncoming: () => incoming,
    outgoingToTake: () => outgoingFlows(graph, gatewayNode.id),
    waitingAction: 'PARALLEL_GATEWAY_WAITING',
    firedAction: incoming.length > 1 ? 'PARALLEL_GATEWAY_JOINED' : 'PARALLEL_GATEWAY_FORKED',
    gatewayLabel: 'La passerelle parallèle',
  });
}

/**
 * Passerelle inclusive (OR) : comme la parallèle, elle peut synchroniser
 * (join) ou dupliquer (fork) l'exécution, mais de façon *sélective* — elle
 * n'active que les branches sortantes dont la condition est vraie, et sa
 * jointure n'attend en retour que ces branches-là (voir
 * `expectedIncomingFlows`), pas forcément toutes les branches dessinées
 * dans le diagramme.
 */
async function advanceInclusiveGateway(
  client: PoolClient,
  graph: BpmnGraph,
  process: ProcessRow,
  instance: ProcessInstanceRow,
  gatewayNode: BpmnNode,
  arrivingFlow: BpmnFlow
): Promise<ProcessInstanceRow> {
  return advanceGatewaySync(client, graph, process, instance, gatewayNode, arrivingFlow, {
    expectedIncoming: (context) => expectedIncomingFlows(graph, gatewayNode, context),
    outgoingToTake: (context) => pickInclusiveFlows(graph, gatewayNode, context),
    waitingAction: 'INCLUSIVE_GATEWAY_WAITING',
    firedAction:
      incomingFlows(graph, gatewayNode.id).length > 1 ? 'INCLUSIVE_GATEWAY_JOINED' : 'INCLUSIVE_GATEWAY_FORKED',
    gatewayLabel: 'La passerelle inclusive',
  });
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
  return advanceViaFlow(client, graph, process, instance, flow);
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
  const { task, process, completedById, formData } = params;
  const graph = parseBpmnXml(process.bpmn_xml);

  // Verrouille l'instance pour toute la durée de la transaction : deux
  // branches parallèles complétées quasi simultanément (deux requêtes,
  // deux transactions distinctes) doivent s'exécuter en série, sinon
  // leurs arrivées sur une même passerelle de jointure pourraient se
  // perdre ou se compter en double.
  const { rows: lockedRows } = await client.query<ProcessInstanceRow>(
    `SELECT * FROM process_instances WHERE id = $1 FOR UPDATE`,
    [params.instance.id]
  );
  const instance = lockedRows[0];
  if (!instance) throw new HttpError(404, 'Instance introuvable');

  const { rowCount } = await client.query(
    `UPDATE tasks SET status = 'COMPLETED', form_data = $1, completed_at = now(), completed_by = $2
     WHERE id = $3 AND status = 'PENDING'`,
    [JSON.stringify(formData), completedById, task.id]
  );
  if (rowCount === 0) throw new HttpError(409, 'Cette tâche a déjà été traitée');

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
