import { describe, expect, it } from 'vitest';
import { findNode, incomingFlows, outgoingFlows, parseBpmnXml } from './bpmnParser';

const FORK_JOIN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpm="http://bpm-platform.local/schema/1.0"
                   id="Definitions_test" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_test" isExecutable="true">
    <bpmn:startEvent id="Start" name="Début" />
    <bpmn:parallelGateway id="Fork" name="Fork" />
    <bpmn:userTask id="Task_A" name="Tâche A" bpm:assigneeRole="OPERATOR" />
    <bpmn:userTask id="Task_B" name="Tâche B" bpm:assigneeRole="VALIDATOR" />
    <bpmn:parallelGateway id="Join" name="Join" />
    <bpmn:endEvent id="End" name="Fin" />
    <bpmn:sequenceFlow id="Flow_start" sourceRef="Start" targetRef="Fork" />
    <bpmn:sequenceFlow id="Flow_A" sourceRef="Fork" targetRef="Task_A" />
    <bpmn:sequenceFlow id="Flow_B" sourceRef="Fork" targetRef="Task_B" />
    <bpmn:sequenceFlow id="Flow_A2" sourceRef="Task_A" targetRef="Join" />
    <bpmn:sequenceFlow id="Flow_B2" sourceRef="Task_B" targetRef="Join" />
    <bpmn:sequenceFlow id="Flow_end" sourceRef="Join" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

describe('parseBpmnXml — parallelGateway', () => {
  it('parses parallelGateway elements as nodes of type "parallelGateway"', () => {
    const graph = parseBpmnXml(FORK_JOIN_XML);
    const fork = findNode(graph, 'Fork');
    const join = findNode(graph, 'Join');
    expect(fork.type).toBe('parallelGateway');
    expect(fork.name).toBe('Fork');
    expect(join.type).toBe('parallelGateway');
  });

  it('still parses all pre-existing node types (no regression)', () => {
    const graph = parseBpmnXml(FORK_JOIN_XML);
    expect(findNode(graph, 'Start').type).toBe('startEvent');
    expect(findNode(graph, 'Task_A').type).toBe('userTask');
    expect(findNode(graph, 'Task_A').assigneeRole).toBe('OPERATOR');
    expect(findNode(graph, 'End').type).toBe('endEvent');
  });

  it('outgoingFlows returns both branches leaving the fork gateway', () => {
    const graph = parseBpmnXml(FORK_JOIN_XML);
    const flows = outgoingFlows(graph, 'Fork');
    expect(flows.map((f) => f.target).sort()).toEqual(['Task_A', 'Task_B']);
  });

  it('incomingFlows returns both branches arriving at the join gateway', () => {
    const graph = parseBpmnXml(FORK_JOIN_XML);
    const flows = incomingFlows(graph, 'Join');
    expect(flows.map((f) => f.source).sort()).toEqual(['Task_A', 'Task_B']);
  });

  it('incomingFlows/outgoingFlows return an empty array for a node with none', () => {
    const graph = parseBpmnXml(FORK_JOIN_XML);
    expect(incomingFlows(graph, 'Start')).toEqual([]);
    expect(outgoingFlows(graph, 'End')).toEqual([]);
  });
});

const INCLUSIVE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpm="http://bpm-platform.local/schema/1.0"
                   id="Definitions_inc" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_inc" isExecutable="true">
    <bpmn:startEvent id="Start" name="Début" />
    <bpmn:inclusiveGateway id="Gateway_Inc" name="Fork inclusif" default="Flow_default" />
    <bpmn:userTask id="Task_A" name="Tâche A" />
    <bpmn:userTask id="Task_Default" name="Défaut" />
    <bpmn:sequenceFlow id="Flow_start" sourceRef="Start" targetRef="Gateway_Inc" />
    <bpmn:sequenceFlow id="Flow_toA" sourceRef="Gateway_Inc" targetRef="Task_A">
      <bpmn:conditionExpression>montant &gt; 100</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_default" sourceRef="Gateway_Inc" targetRef="Task_Default" />
  </bpmn:process>
</bpmn:definitions>`;

describe('parseBpmnXml — inclusiveGateway', () => {
  it('parses inclusiveGateway elements as nodes of type "inclusiveGateway", with their default flow', () => {
    const graph = parseBpmnXml(INCLUSIVE_XML);
    const gateway = findNode(graph, 'Gateway_Inc');
    expect(gateway.type).toBe('inclusiveGateway');
    expect(gateway.name).toBe('Fork inclusif');
    expect(gateway.defaultFlowId).toBe('Flow_default');
  });

  it('outgoingFlows returns both the conditional and the default branch', () => {
    const graph = parseBpmnXml(INCLUSIVE_XML);
    const flows = outgoingFlows(graph, 'Gateway_Inc');
    expect(flows.map((f) => f.id).sort()).toEqual(['Flow_default', 'Flow_toA']);
  });
});
