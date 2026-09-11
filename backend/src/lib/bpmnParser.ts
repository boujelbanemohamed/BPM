import { XMLParser } from 'fast-xml-parser';
import { FormField } from '../types';
import { HttpError } from '../middleware/errorHandler';
import { parseIsoDurationMs } from './isoDuration';

export type BpmnNodeType =
  | 'startEvent'
  | 'userTask'
  | 'exclusiveGateway'
  | 'parallelGateway'
  | 'inclusiveGateway'
  | 'endEvent'
  | 'timerCatchEvent';

export interface BpmnNode {
  id: string;
  type: BpmnNodeType;
  name: string;
  assigneeRole?: string;
  assigneeUserId?: string;
  formFields: FormField[];
  defaultFlowId?: string;
  /** Uniquement pour un endEvent portant un <bpmn:errorEventDefinition> : termine l'instance en erreur/annulation plutôt qu'en succès. */
  isError?: boolean;
  /** Uniquement pour un timerCatchEvent : délai en millisecondes avant relance automatique par le poller. */
  timerDurationMs?: number;
}

export interface BpmnFlow {
  id: string;
  source: string;
  target: string;
  conditionExpression?: string;
}

export interface BpmnGraph {
  processId: string;
  nodes: BpmnNode[];
  flows: BpmnFlow[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  parseAttributeValue: false,
  parseTagValue: false,
  // bpmn-js sérialise ses attributs avec des guillemets doubles et échappe donc
  // tout `"` interne (ex. dans le JSON de bpm:formFields) en entité XML `&#34;` /
  // `&quot;`. Sans décodage explicite des entités, fast-xml-parser laisse ces
  // entités telles quelles au lieu de restituer les guillemets d'origine.
  processEntities: true,
  htmlEntities: true,
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textContent(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === 'string') return node;
  if (typeof node === 'object' && '#text' in (node as Record<string, unknown>)) {
    return String((node as Record<string, unknown>)['#text']);
  }
  return undefined;
}

function parseFormFields(raw: unknown): FormField[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as FormField[];
  } catch {
    throw new HttpError(400, `Champ bpm:formFields invalide (JSON attendu) : ${raw}`);
  }
}

export function parseBpmnXml(xml: string): BpmnGraph {
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch (err) {
    throw new HttpError(400, `XML BPMN invalide : ${(err as Error).message}`);
  }

  const definitions = doc.definitions;
  if (!definitions) throw new HttpError(400, 'XML BPMN invalide : élément <definitions> manquant');

  const processes = asArray(definitions.process);
  const process = processes.find((p) => p?.['@_isExecutable'] !== 'false') ?? processes[0];
  if (!process) throw new HttpError(400, 'XML BPMN invalide : élément <process> manquant');

  const nodes: BpmnNode[] = [];

  for (const el of asArray(process.startEvent)) {
    nodes.push({
      id: el['@_id'],
      type: 'startEvent',
      name: el['@_name'] ?? 'Début',
      formFields: parseFormFields(el['@_formFields']),
    });
  }

  for (const el of asArray(process.userTask)) {
    nodes.push({
      id: el['@_id'],
      type: 'userTask',
      name: el['@_name'] ?? el['@_id'],
      assigneeRole: el['@_assigneeRole'] || undefined,
      assigneeUserId: el['@_assigneeUserId'] || undefined,
      formFields: parseFormFields(el['@_formFields']),
    });
  }

  for (const el of asArray(process.exclusiveGateway)) {
    nodes.push({
      id: el['@_id'],
      type: 'exclusiveGateway',
      name: el['@_name'] ?? el['@_id'],
      formFields: [],
      defaultFlowId: el['@_default'] || undefined,
    });
  }

  for (const el of asArray(process.parallelGateway)) {
    nodes.push({
      id: el['@_id'],
      type: 'parallelGateway',
      name: el['@_name'] ?? el['@_id'],
      formFields: [],
    });
  }

  for (const el of asArray(process.inclusiveGateway)) {
    nodes.push({
      id: el['@_id'],
      type: 'inclusiveGateway',
      name: el['@_name'] ?? el['@_id'],
      formFields: [],
      defaultFlowId: el['@_default'] || undefined,
    });
  }

  for (const el of asArray(process.endEvent)) {
    nodes.push({
      id: el['@_id'],
      type: 'endEvent',
      name: el['@_name'] ?? 'Fin',
      formFields: [],
      isError: 'errorEventDefinition' in el,
    });
  }

  for (const el of asArray(process.intermediateCatchEvent)) {
    if (!('timerEventDefinition' in el)) continue; // seul le minuteur est pris en charge pour l'instant
    const durationRaw = textContent(el.timerEventDefinition?.timeDuration);
    if (!durationRaw) {
      throw new HttpError(400, `Le minuteur "${el['@_id']}" doit avoir une durée (bpmn:timeDuration, ex. PT30M)`);
    }
    let timerDurationMs: number;
    try {
      timerDurationMs = parseIsoDurationMs(durationRaw);
    } catch (err) {
      throw new HttpError(400, `Minuteur "${el['@_id']}" : ${(err as Error).message}`);
    }
    nodes.push({
      id: el['@_id'],
      type: 'timerCatchEvent',
      name: el['@_name'] ?? 'Minuteur',
      formFields: [],
      timerDurationMs,
    });
  }

  if (!nodes.some((n) => n.type === 'startEvent')) {
    throw new HttpError(400, 'Le processus doit contenir exactement un événement de début');
  }

  const flows: BpmnFlow[] = asArray(process.sequenceFlow).map((el: any) => ({
    id: el['@_id'],
    source: el['@_sourceRef'],
    target: el['@_targetRef'],
    conditionExpression: textContent(el.conditionExpression),
  }));

  return { processId: process['@_id'], nodes, flows };
}

export function findNode(graph: BpmnGraph, id: string): BpmnNode {
  const node = graph.nodes.find((n) => n.id === id);
  if (!node) throw new HttpError(400, `Nœud BPMN introuvable dans le graphe : ${id}`);
  return node;
}

export function outgoingFlows(graph: BpmnGraph, nodeId: string): BpmnFlow[] {
  return graph.flows.filter((f) => f.source === nodeId);
}

export function incomingFlows(graph: BpmnGraph, nodeId: string): BpmnFlow[] {
  return graph.flows.filter((f) => f.target === nodeId);
}
