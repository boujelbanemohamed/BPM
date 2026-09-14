import { PoolClient } from 'pg';
import { BpmnFlow, BpmnGraph, BpmnNode, findNode, incomingFlows, outgoingFlows, parseBpmnXml } from '../lib/bpmnParser';
import { evaluateExpression } from '../lib/conditions';
import { resolveEffectiveAssignee } from './delegationService';
import { notifyProcessCancelled, notifyProcessCompleted, notifyTaskAssigned } from './notificationService';
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
 * Programme la relance de l'instance à ce minuteur : insère (ou met à
 * jour, si déjà programmé) une ligne dans scheduled_timers avec la date
 * de déclenchement, puis s'arrête là — contrairement aux autres types de
 * nœud, aucun appel récursif à advanceViaFlow ici. C'est le poller
 * (timerPoller.ts, via fireDueTimer ci-dessous) qui reprendra le flux une
 * fois le délai écoulé, en dehors de toute requête HTTP.
 */
async function scheduleTimer(
  client: PoolClient,
  instance: ProcessInstanceRow,
  targetNode: BpmnNode
): Promise<ProcessInstanceRow> {
  const fireAt = new Date(Date.now() + targetNode.timerDurationMs!);

  await client.query(
    `INSERT INTO scheduled_timers (instance_id, element_id, fire_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (instance_id, element_id) DO UPDATE SET fire_at = EXCLUDED.fire_at`,
    [instance.id, targetNode.id, fireAt]
  );

  const { rows } = await client.query<ProcessInstanceRow>(
    `UPDATE process_instances SET current_step_name = $1, current_element_id = $2 WHERE id = $3 RETURNING *`,
    [targetNode.name, targetNode.id, instance.id]
  );

  await writeAuditLogTx(client, {
    userId: null,
    action: 'TIMER_SCHEDULED',
    entityType: 'process_instance',
    entityId: instance.id,
    details: { elementId: targetNode.id, fireAt: fireAt.toISOString() },
  });

  return rows[0];
}

/**
 * Remonte la chaîne parent_instance_id depuis `parentInstanceId` (inclus) et
 * indique si `calledProcessId` y apparaît déjà — c'est-à-dire si démarrer ce
 * sous-processus créerait un appel circulaire (direct ou indirect, via
 * plusieurs niveaux d'imbrication). Appelé avant toute création d'instance
 * enfant : sans cette garde, un cycle A→B→A bouclerait indéfiniment.
 */
async function wouldCreateCycle(
  client: PoolClient,
  parentInstanceId: string,
  calledProcessId: string
): Promise<boolean> {
  const { rows } = await client.query<{ process_id: string }>(
    `WITH RECURSIVE ancestors AS (
       SELECT id, process_id, parent_instance_id FROM process_instances WHERE id = $1
       UNION ALL
       SELECT pi.id, pi.process_id, pi.parent_instance_id
       FROM process_instances pi
       JOIN ancestors a ON pi.id = a.parent_instance_id
     )
     SELECT process_id FROM ancestors`,
    [parentInstanceId]
  );
  return rows.some((r) => r.process_id === calledProcessId);
}

/**
 * Sous-processus réutilisable (bpmn:callActivity) : instancie le processus
 * publié référencé par targetNode.calledProcessKey comme instance ENFANT de
 * `parentInstance` (même form_data en contexte initial), puis met le parent
 * en pause à ce nœud — comme pour un minuteur — jusqu'à ce que l'enfant
 * atteigne son propre événement de fin (voir resumeParentAfterChildCompletion,
 * appelée depuis la branche endEvent de advanceViaFlow). Si l'enfant se
 * termine de façon synchrone dans cet appel même (ex. un sous-processus
 * Début→Fin sans tâche humaine), le parent est déjà relancé au retour :
 * on relit donc son état à jour plutôt que de renvoyer la ligne "en pause"
 * écrite plus haut.
 */
async function startSubProcess(
  client: PoolClient,
  parentInstance: ProcessInstanceRow,
  targetNode: BpmnNode
): Promise<ProcessInstanceRow> {
  const { rows: childProcRows } = await client.query<ProcessRow>(
    `SELECT * FROM processes WHERE process_key = $1 AND status = 'PUBLISHED' AND deleted_at IS NULL
     ORDER BY version DESC LIMIT 1`,
    [targetNode.calledProcessKey]
  );
  const childProcess = childProcRows[0];
  if (!childProcess) {
    throw new HttpError(
      400,
      `Sous-processus introuvable ou non publié : "${targetNode.calledProcessKey}" (nœud ${targetNode.id})`
    );
  }

  if (await wouldCreateCycle(client, parentInstance.id, childProcess.id)) {
    throw new HttpError(
      400,
      `Appel de sous-processus circulaire détecté sur "${targetNode.calledProcessKey}" (nœud ${targetNode.id})`
    );
  }

  const childGraph = parseBpmnXml(childProcess.bpmn_xml);
  const childStartNode = childGraph.nodes.find((n) => n.type === 'startEvent');
  if (!childStartNode) {
    throw new HttpError(400, `Le sous-processus "${targetNode.calledProcessKey}" ne contient pas d'événement de début`);
  }

  const { rows: childRows } = await client.query<ProcessInstanceRow>(
    `INSERT INTO process_instances
       (process_id, client_id, current_step_name, current_element_id, form_data, started_by, parent_instance_id, parent_element_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      childProcess.id,
      parentInstance.client_id,
      childStartNode.name,
      childStartNode.id,
      JSON.stringify(parentInstance.form_data),
      parentInstance.started_by,
      parentInstance.id,
      targetNode.id,
    ]
  );
  const childInstance = childRows[0];

  await client.query(`UPDATE process_instances SET current_step_name = $1, current_element_id = $2 WHERE id = $3`, [
    targetNode.name,
    targetNode.id,
    parentInstance.id,
  ]);

  await writeAuditLogTx(client, {
    userId: null,
    action: 'SUBPROCESS_STARTED',
    entityType: 'process_instance',
    entityId: parentInstance.id,
    details: { childInstanceId: childInstance.id, calledProcessKey: targetNode.calledProcessKey, elementId: targetNode.id },
  });
  await writeAuditLogTx(client, {
    userId: null,
    action: 'INSTANCE_STARTED',
    entityType: 'process_instance',
    entityId: childInstance.id,
    details: { processName: childProcess.name, parentInstanceId: parentInstance.id },
  });

  await advance(client, childGraph, childProcess, childInstance, childStartNode.id);

  const { rows: freshParentRows } = await client.query<ProcessInstanceRow>(
    `SELECT * FROM process_instances WHERE id = $1`,
    [parentInstance.id]
  );
  return freshParentRows[0];
}

/**
 * Programme un minuteur d'échéance (bpmn:boundaryEvent attaché à une
 * userTask) : à la différence de scheduleTimer (minuteur "normal" qui EST
 * l'étape courante du flux), celui-ci s'ajoute en parallèle d'une tâche déjà
 * créée et ne touche donc jamais current_step_name/current_element_id — la
 * tâche reste l'étape affichée tant que le délai n'est pas écoulé.
 */
async function scheduleBoundaryTimer(
  client: PoolClient,
  instance: ProcessInstanceRow,
  boundaryNode: BpmnNode
): Promise<void> {
  const fireAt = new Date(Date.now() + boundaryNode.timerDurationMs!);
  await client.query(
    `INSERT INTO scheduled_timers (instance_id, element_id, fire_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (instance_id, element_id) DO UPDATE SET fire_at = EXCLUDED.fire_at`,
    [instance.id, boundaryNode.id, fireAt]
  );
  await writeAuditLogTx(client, {
    userId: null,
    action: 'TIMER_SCHEDULED',
    entityType: 'process_instance',
    entityId: instance.id,
    details: { elementId: boundaryNode.id, fireAt: fireAt.toISOString(), boundaryFor: boundaryNode.attachedToTaskId },
  });
}

/**
 * Annule tout minuteur d'échéance encore programmé pour la tâche
 * `taskElementId` (un ou plusieurs bpmn:boundaryEvent peuvent y être
 * attachés) : appelé quand cette tâche est complétée normalement (le délai
 * ne doit plus jouer), ou quand un premier minuteur d'échéance vient de la
 * faire expirer (les autres, désormais sans objet, sont nettoyés au passage
 * plutôt que de laisser des lignes orphelines dans scheduled_timers).
 */
async function cancelBoundaryTimers(
  client: PoolClient,
  graph: BpmnGraph,
  taskElementId: string,
  instanceId: string
): Promise<void> {
  const boundaryNodeIds = graph.nodes
    .filter((n) => n.type === 'boundaryTimerEvent' && n.attachedToTaskId === taskElementId)
    .map((n) => n.id);
  if (boundaryNodeIds.length === 0) return;
  await client.query(`DELETE FROM scheduled_timers WHERE instance_id = $1 AND element_id = ANY($2::text[])`, [
    instanceId,
    boundaryNodeIds,
  ]);
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
    // Tout événement de fin (erreur ou non) interrompt l'instance ENTIÈRE
    // dans ce moteur (pas de suivi de "jeton" par branche) : dès qu'une
    // branche l'atteint, plus rien d'autre ne doit rester actif dessus.
    // Toute tâche encore en attente sur une autre branche (ex. une
    // passerelle parallèle dont une seule branche a atteint cette sortie,
    // sans être repassée par une jointure) est donc systématiquement
    // annulée — pas seulement pour une fin d'erreur — pour ne jamais
    // laisser de tâche orpheline sur une instance déjà terminée.
    const finalStatus = targetNode.isError ? 'CANCELLED' : 'COMPLETED';

    const { rows } = await client.query<ProcessInstanceRow>(
      `UPDATE process_instances
       SET status = $1, current_step_name = $2, current_element_id = $3, completed_at = now()
       WHERE id = $4 RETURNING *`,
      [finalStatus, targetNode.name, targetNode.id, instance.id]
    );
    const updated = rows[0];

    await client.query(`UPDATE tasks SET status = 'CANCELLED' WHERE instance_id = $1 AND status = 'PENDING'`, [
      instance.id,
    ]);
    await client.query(`DELETE FROM scheduled_timers WHERE instance_id = $1`, [instance.id]);

    await writeAuditLogTx(client, {
      userId: null,
      action: targetNode.isError ? 'PROCESS_CANCELLED' : 'PROCESS_COMPLETED',
      entityType: 'process_instance',
      entityId: instance.id,
      details: { endEvent: targetNode.name },
    });

    if (!instance.parent_instance_id) {
      // Un sous-processus (instance enfant d'un callActivity) ne notifie pas
      // son créateur ici : ce n'est pas "son" processus mais un détail
      // d'implémentation de celui du parent — c'est ce dernier qui
      // notifiera, une fois relancé (ou annulé en cascade, voir
      // resumeParentAfterChildCompletion ci-dessous).
      const starter = await findUserById(client, instance.started_by);
      if (starter) {
        const notifyParams = {
          userId: starter.id,
          email: starter.email,
          fullName: starter.fullName,
          processName: process.name,
          outcome: targetNode.name,
          instanceId: instance.id,
        };
        if (targetNode.isError) {
          await notifyProcessCancelled(client, notifyParams);
        } else {
          await notifyProcessCompleted(client, notifyParams);
        }
      }
    }

    await resumeParentAfterChildCompletion(client, updated, finalStatus);

    return updated;
  }

  if (targetNode.type === 'timerCatchEvent') {
    return scheduleTimer(client, instance, targetNode);
  }

  if (targetNode.type === 'callActivity') {
    return startSubProcess(client, instance, targetNode);
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

    const attachedBoundaryTimers = graph.nodes.filter(
      (n) => n.type === 'boundaryTimerEvent' && n.attachedToTaskId === targetNode.id
    );
    for (const boundaryNode of attachedBoundaryTimers) {
      await scheduleBoundaryTimer(client, instRows[0], boundaryNode);
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

/**
 * Relance l'instance PARENTE d'une instance enfant (sous-processus) qui
 * vient d'atteindre son propre événement de fin. Un enfant COMPLETED fait
 * reprendre le parent à la suite de son nœud callActivity ; un enfant
 * CANCELLED (erreur) propage l'annulation au parent — même sémantique qu'une
 * erreur locale — et remonte récursivement la chaîne parent_instance_id si
 * ce parent est lui-même une instance enfant. No-op silencieux si le parent
 * n'est plus RUNNING (déjà finalisé par un autre chemin) : cas normal, pas
 * une anomalie à remonter.
 */
async function resumeParentAfterChildCompletion(
  client: PoolClient,
  childInstance: ProcessInstanceRow,
  childFinalStatus: 'COMPLETED' | 'CANCELLED'
): Promise<void> {
  if (!childInstance.parent_instance_id || !childInstance.parent_element_id) return;

  const { rows: parentRows } = await client.query<ProcessInstanceRow>(
    `SELECT * FROM process_instances WHERE id = $1 FOR UPDATE`,
    [childInstance.parent_instance_id]
  );
  const parent = parentRows[0];
  if (!parent || parent.status !== 'RUNNING') return;

  const { rows: parentProcRows } = await client.query<ProcessRow>('SELECT * FROM processes WHERE id = $1', [
    parent.process_id,
  ]);
  const parentProcess = parentProcRows[0];
  if (!parentProcess) return;

  await writeAuditLogTx(client, {
    userId: null,
    action: childFinalStatus === 'COMPLETED' ? 'SUBPROCESS_COMPLETED' : 'SUBPROCESS_CANCELLED',
    entityType: 'process_instance',
    entityId: parent.id,
    details: { childInstanceId: childInstance.id, elementId: childInstance.parent_element_id },
  });

  if (childFinalStatus === 'CANCELLED') {
    const { rows } = await client.query<ProcessInstanceRow>(
      `UPDATE process_instances SET status = 'CANCELLED', completed_at = now() WHERE id = $1 RETURNING *`,
      [parent.id]
    );
    const cancelledParent = rows[0];
    await client.query(`UPDATE tasks SET status = 'CANCELLED' WHERE instance_id = $1 AND status = 'PENDING'`, [
      parent.id,
    ]);
    await client.query(`DELETE FROM scheduled_timers WHERE instance_id = $1`, [parent.id]);

    await writeAuditLogTx(client, {
      userId: null,
      action: 'PROCESS_CANCELLED',
      entityType: 'process_instance',
      entityId: parent.id,
      details: { reason: 'sous-processus en erreur', childInstanceId: childInstance.id },
    });

    if (!parent.parent_instance_id) {
      const starter = await findUserById(client, parent.started_by);
      if (starter) {
        await notifyProcessCancelled(client, {
          userId: starter.id,
          email: starter.email,
          fullName: starter.fullName,
          processName: parentProcess.name,
          outcome: cancelledParent.current_step_name ?? parentProcess.name,
          instanceId: parent.id,
        });
      }
    }

    await resumeParentAfterChildCompletion(client, cancelledParent, 'CANCELLED');
    return;
  }

  const parentGraph = parseBpmnXml(parentProcess.bpmn_xml);
  await advance(client, parentGraph, parentProcess, parent, childInstance.parent_element_id);
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

  await cancelBoundaryTimers(client, graph, task.element_id, instance.id);

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

/**
 * Relance une instance depuis le minuteur (`elementId`) dont le délai est
 * écoulé, en dehors de toute requête HTTP : appelée par le poller
 * (timerPoller.ts) une fois par minuteur dû, chacune dans sa propre
 * transaction. Verrouille l'instance comme `completeTaskAndAdvance`, pour
 * rester cohérente avec une complétion de tâche concurrente sur une autre
 * branche de la même instance. Vérifie elle-même que le délai est
 * effectivement écoulé (indépendamment du filtre du poller), pour rester
 * sûre même appelée directement. Retourne `null` (sans erreur) si
 * l'instance n'est plus RUNNING, si le minuteur n'est pas encore dû, ou
 * s'il a déjà été traité — cas normal en cas de concurrence entre deux
 * exécutions du poller, pas une anomalie à remonter.
 *
 * Deux natures de minuteur, distinguées ici par le type du nœud rechargé
 * depuis le XML (pas par une colonne dédiée) : un minuteur "normal"
 * (timerCatchEvent) EST l'étape courante du flux et relance directement
 * `advance` depuis lui ; un minuteur d'échéance (boundaryTimerEvent, attaché
 * à une userTask) annule la tâche encore PENDING puis relance `advance`
 * depuis le minuteur lui-même, qui a sa propre transition sortante.
 */
export async function fireDueTimer(
  client: PoolClient,
  params: { instanceId: string; elementId: string }
): Promise<ProcessInstanceRow | null> {
  const { rows: lockedRows } = await client.query<ProcessInstanceRow>(
    `SELECT * FROM process_instances WHERE id = $1 FOR UPDATE`,
    [params.instanceId]
  );
  const instance = lockedRows[0];
  if (!instance || instance.status !== 'RUNNING') return null;

  const { rowCount } = await client.query(
    `DELETE FROM scheduled_timers WHERE instance_id = $1 AND element_id = $2 AND fire_at <= now()`,
    [params.instanceId, params.elementId]
  );
  if (rowCount === 0) return null;

  const { rows: procRows } = await client.query<ProcessRow>('SELECT * FROM processes WHERE id = $1', [
    instance.process_id,
  ]);
  const process = procRows[0];
  if (!process) return null;

  const graph = parseBpmnXml(process.bpmn_xml);
  const targetNode = findNode(graph, params.elementId);

  if (targetNode.type === 'boundaryTimerEvent') {
    const { rows: taskRows } = await client.query<TaskRow>(
      `SELECT * FROM tasks WHERE instance_id = $1 AND element_id = $2 AND status = 'PENDING'`,
      [instance.id, targetNode.attachedToTaskId]
    );
    const task = taskRows[0];
    // Déjà complétée (ou annulée par un autre minuteur d'échéance sur la
    // même tâche) entre la programmation et ce déclenchement : plus rien à
    // interrompre, cas normal de concurrence, pas une anomalie.
    if (!task) return null;

    await client.query(`UPDATE tasks SET status = 'CANCELLED' WHERE id = $1`, [task.id]);
    await cancelBoundaryTimers(client, graph, targetNode.attachedToTaskId!, instance.id);

    await writeAuditLogTx(client, {
      userId: null,
      action: 'TASK_TIMEOUT',
      entityType: 'task',
      entityId: task.id,
      details: { elementId: targetNode.id, stepName: task.step_name },
    });

    return advance(client, graph, process, instance, targetNode.id);
  }

  await writeAuditLogTx(client, {
    userId: null,
    action: 'TIMER_FIRED',
    entityType: 'process_instance',
    entityId: instance.id,
    details: { elementId: params.elementId },
  });

  return advance(client, graph, process, instance, params.elementId);
}

export function parseGraph(bpmnXml: string): BpmnGraph {
  return parseBpmnXml(bpmnXml);
}
