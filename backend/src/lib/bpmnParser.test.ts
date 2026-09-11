import { describe, expect, it } from 'vitest';
import { findNode, incomingFlows, outgoingFlows, parseBpmnXml } from './bpmnParser';

const ERROR_TIMER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   id="Definitions_errtimer" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_errtimer" isExecutable="true">
    <bpmn:startEvent id="Start" name="Début" />
    <bpmn:intermediateCatchEvent id="Timer1" name="Attendre 30 min">
      <bpmn:timerEventDefinition>
        <bpmn:timeDuration>PT30M</bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="End_Error" name="Rejeté">
      <bpmn:errorEventDefinition />
    </bpmn:endEvent>
    <bpmn:endEvent id="End_Normal" name="Fin" />
    <bpmn:sequenceFlow id="Flow_start" sourceRef="Start" targetRef="Timer1" />
    <bpmn:sequenceFlow id="Flow_timer" sourceRef="Timer1" targetRef="End_Normal" />
  </bpmn:process>
</bpmn:definitions>`;

describe('parseBpmnXml — error end event', () => {
  it('marks an endEvent with a nested errorEventDefinition as isError', () => {
    const graph = parseBpmnXml(ERROR_TIMER_XML);
    expect(findNode(graph, 'End_Error').isError).toBe(true);
  });

  it('leaves a plain endEvent as isError: false', () => {
    const graph = parseBpmnXml(ERROR_TIMER_XML);
    expect(findNode(graph, 'End_Normal').isError).toBe(false);
  });
});

describe('parseBpmnXml — timer catch event', () => {
  it('parses an intermediateCatchEvent with a timerEventDefinition as type "timerCatchEvent"', () => {
    const graph = parseBpmnXml(ERROR_TIMER_XML);
    const timer = findNode(graph, 'Timer1');
    expect(timer.type).toBe('timerCatchEvent');
    expect(timer.name).toBe('Attendre 30 min');
  });

  it('converts the ISO-8601 timeDuration to milliseconds', () => {
    const graph = parseBpmnXml(ERROR_TIMER_XML);
    expect(findNode(graph, 'Timer1').timerDurationMs).toBe(30 * 60 * 1000);
  });

  it('rejects a timer with no timeDuration', () => {
    const xml = ERROR_TIMER_XML.replace(
      '<bpmn:timerEventDefinition>\n        <bpmn:timeDuration>PT30M</bpmn:timeDuration>\n      </bpmn:timerEventDefinition>',
      '<bpmn:timerEventDefinition />'
    );
    expect(() => parseBpmnXml(xml)).toThrow(/doit avoir une durée/);
  });

  it('rejects a timer with a malformed timeDuration', () => {
    const xml = ERROR_TIMER_XML.replace('PT30M', 'not-a-duration');
    expect(() => parseBpmnXml(xml)).toThrow(/Minuteur "Timer1"/);
  });
});

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
