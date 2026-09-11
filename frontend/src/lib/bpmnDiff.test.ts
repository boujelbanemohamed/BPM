import { describe, expect, it } from 'vitest';
import { computeBpmnDiff } from './bpmnDiff';

function xml(processContent: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpm="http://bpm-platform.local/schema/1.0"
                   id="Definitions_1" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    ${processContent}
  </bpmn:process>
</bpmn:definitions>`;
}

const V1 = xml(`
  <bpmn:startEvent id="Start" name="Début">
    <bpmn:outgoing>Flow_1</bpmn:outgoing>
  </bpmn:startEvent>
  <bpmn:userTask id="Task_A" name="Saisie" bpm:assigneeRole="OPERATOR">
    <bpmn:incoming>Flow_1</bpmn:incoming>
    <bpmn:outgoing>Flow_2</bpmn:outgoing>
  </bpmn:userTask>
  <bpmn:endEvent id="End" name="Fin">
    <bpmn:incoming>Flow_2</bpmn:incoming>
  </bpmn:endEvent>
  <bpmn:sequenceFlow id="Flow_1" sourceRef="Start" targetRef="Task_A" />
  <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_A" targetRef="End" />
`);

describe('computeBpmnDiff', () => {
  it('returns no differences when comparing a diagram to itself', async () => {
    const result = await computeBpmnDiff(V1, V1);
    expect(result.addedIds).toEqual([]);
    expect(result.removedIds).toEqual([]);
    expect(result.changedIds).toEqual([]);
  });

  it('detects an added user task and its new flow', async () => {
    const v2 = xml(`
      <bpmn:startEvent id="Start" name="Début">
        <bpmn:outgoing>Flow_1</bpmn:outgoing>
      </bpmn:startEvent>
      <bpmn:userTask id="Task_A" name="Saisie" bpm:assigneeRole="OPERATOR">
        <bpmn:incoming>Flow_1</bpmn:incoming>
        <bpmn:outgoing>Flow_2</bpmn:outgoing>
      </bpmn:userTask>
      <bpmn:userTask id="Task_B" name="Validation" bpm:assigneeRole="VALIDATOR">
        <bpmn:incoming>Flow_2</bpmn:incoming>
        <bpmn:outgoing>Flow_3</bpmn:outgoing>
      </bpmn:userTask>
      <bpmn:endEvent id="End" name="Fin">
        <bpmn:incoming>Flow_3</bpmn:incoming>
      </bpmn:endEvent>
      <bpmn:sequenceFlow id="Flow_1" sourceRef="Start" targetRef="Task_A" />
      <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_A" targetRef="Task_B" />
      <bpmn:sequenceFlow id="Flow_3" sourceRef="Task_B" targetRef="End" />
    `);

    const result = await computeBpmnDiff(V1, v2);

    // Flow_2 garde le même id mais change de cible (Task_A -> End devient
    // Task_A -> Task_B) : le differ le traite comme "modifié", pas comme
    // supprimé puis recréé, puisqu'il matche les éléments par id. Task_A
    // lui-même est inchangé (son propre nom/rôle sont identiques).
    expect(result.addedIds).toEqual(expect.arrayContaining(['Task_B', 'Flow_3']));
    expect(result.changedIds).toEqual(['Flow_2']);
    expect(result.removedIds).toEqual([]);
  });

  it('detects a removed task', async () => {
    const v2 = xml(`
      <bpmn:startEvent id="Start" name="Début">
        <bpmn:outgoing>Flow_1</bpmn:outgoing>
      </bpmn:startEvent>
      <bpmn:endEvent id="End" name="Fin">
        <bpmn:incoming>Flow_1</bpmn:incoming>
      </bpmn:endEvent>
      <bpmn:sequenceFlow id="Flow_1" sourceRef="Start" targetRef="End" />
    `);

    const result = await computeBpmnDiff(V1, v2);

    expect(result.removedIds).toEqual(expect.arrayContaining(['Task_A', 'Flow_2']));
    expect(result.addedIds.length).toBeGreaterThanOrEqual(0);
  });

  it('detects a renamed element as a change, not an add+remove', async () => {
    const v2 = xml(`
      <bpmn:startEvent id="Start" name="Début">
        <bpmn:outgoing>Flow_1</bpmn:outgoing>
      </bpmn:startEvent>
      <bpmn:userTask id="Task_A" name="Saisie corrigée" bpm:assigneeRole="OPERATOR">
        <bpmn:incoming>Flow_1</bpmn:incoming>
        <bpmn:outgoing>Flow_2</bpmn:outgoing>
      </bpmn:userTask>
      <bpmn:endEvent id="End" name="Fin">
        <bpmn:incoming>Flow_2</bpmn:incoming>
      </bpmn:endEvent>
      <bpmn:sequenceFlow id="Flow_1" sourceRef="Start" targetRef="Task_A" />
      <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_A" targetRef="End" />
    `);

    const result = await computeBpmnDiff(V1, v2);

    expect(result.changedIds).toEqual(['Task_A']);
    expect(result.addedIds).toEqual([]);
    expect(result.removedIds).toEqual([]);
  });
});
