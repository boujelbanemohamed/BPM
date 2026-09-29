import { Api } from './fixtures';

/**
 * Processus BPMN dédié aux tests : formulaire de démarrage (référence),
 * saisie par OPERATOR, validation par VALIDATOR, passerelle approuvé/rejeté.
 * Chaque exécution crée le sien pour ne pas dépendre des données de démo.
 */
export function workflowXml(name: string, opts: { clientField?: boolean } = {}): string {
  const startFields = [
    { key: 'ref', label: 'Référence dossier', type: 'text', required: true },
    ...(opts.clientField ? [{ key: 'client', label: 'Client', type: 'client', required: true }] : []),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:bpm="http://bpm-platform.local/schema/1.0"
  id="Definitions_e2e" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_e2e" name="${name}" isExecutable="true">
    <bpmn:startEvent id="Start" name="Début"
      bpm:formFields='${JSON.stringify(startFields)}'>
      <bpmn:outgoing>F1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Task_Submit" name="Saisie E2E" bpm:assigneeRole="OPERATOR"
      bpm:formFields='[{"key":"amount","label":"Montant","type":"number","required":true},{"key":"note","label":"Note","type":"textarea","required":false}]'>
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:userTask id="Task_Approve" name="Validation E2E" bpm:assigneeRole="VALIDATOR"
      bpm:formFields='[{"key":"approved","label":"Approuvé ?","type":"boolean","required":true}]'>
      <bpmn:incoming>F2</bpmn:incoming>
      <bpmn:outgoing>F3</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="Gw" name="Décision" default="F_no">
      <bpmn:incoming>F3</bpmn:incoming>
      <bpmn:outgoing>F_yes</bpmn:outgoing>
      <bpmn:outgoing>F_no</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:endEvent id="End_Ok" name="Approuvé"><bpmn:incoming>F_yes</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="End_Ko" name="Rejeté"><bpmn:incoming>F_no</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Task_Submit" />
    <bpmn:sequenceFlow id="F2" sourceRef="Task_Submit" targetRef="Task_Approve" />
    <bpmn:sequenceFlow id="F3" sourceRef="Task_Approve" targetRef="Gw" />
    <bpmn:sequenceFlow id="F_yes" sourceRef="Gw" targetRef="End_Ok">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">approved == true</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="F_no" sourceRef="Gw" targetRef="End_Ko" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D1">
    <bpmndi:BPMNPlane id="P1" bpmnElement="Process_e2e">
      <bpmndi:BPMNShape id="Start_di" bpmnElement="Start"><dc:Bounds x="152" y="182" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Submit_di" bpmnElement="Task_Submit"><dc:Bounds x="240" y="160" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Approve_di" bpmnElement="Task_Approve"><dc:Bounds x="400" y="160" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gw_di" bpmnElement="Gw" isMarkerVisible="true"><dc:Bounds x="560" y="175" width="50" height="50" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Ok_di" bpmnElement="End_Ok"><dc:Bounds x="672" y="102" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Ko_di" bpmnElement="End_Ko"><dc:Bounds x="672" y="242" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="F1_di" bpmnElement="F1"><di:waypoint x="188" y="200" /><di:waypoint x="240" y="200" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="F2_di" bpmnElement="F2"><di:waypoint x="340" y="200" /><di:waypoint x="400" y="200" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="F3_di" bpmnElement="F3"><di:waypoint x="500" y="200" /><di:waypoint x="560" y="200" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="F_yes_di" bpmnElement="F_yes"><di:waypoint x="585" y="175" /><di:waypoint x="585" y="120" /><di:waypoint x="672" y="120" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="F_no_di" bpmnElement="F_no"><di:waypoint x="585" y="225" /><di:waypoint x="585" y="260" /><di:waypoint x="672" y="260" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

export interface CreatedProcess {
  id: string;
  name: string;
  reference: string;
}

export async function createProcess(
  api: Api,
  name: string,
  publish = true,
  opts: { clientField?: boolean } = {}
): Promise<CreatedProcess> {
  const { process } = await api.call('admin', 'POST', '/processes', { name, bpmnXml: workflowXml(name, opts) });
  if (publish) await api.call('admin', 'POST', `/processes/${process.id}/publish`);
  return { id: process.id, name: process.name, reference: process.reference };
}

/** Démarre une instance via l'API et renvoie son id. */
export async function startInstance(
  api: Api,
  processId: string,
  ref: string,
  role: 'admin' | 'operator' = 'operator',
  extra: Record<string, unknown> = {}
) {
  const { instance } = await api.call(role, 'POST', `/instances/processes/${processId}/start`, { formData: { ref, ...extra } });
  return instance.id as string;
}

/** Renvoie la tâche en attente d'une instance pour le rôle donné (via "mes tâches"). */
export async function pendingTaskOf(api: Api, role: 'operator' | 'validator' | 'admin', instanceId: string) {
  const { tasks } = await api.call(role, 'GET', '/tasks/my-tasks');
  return (tasks as any[]).find((t) => t.instance_id === instanceId);
}
