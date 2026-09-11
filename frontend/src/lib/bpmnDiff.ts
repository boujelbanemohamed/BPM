import { BpmnModdle } from 'bpmn-moddle';
// @ts-expect-error — bpmn-js-differ n'a pas de types TypeScript publiés.
import { diff } from 'bpmn-js-differ';
import bpmPlatformModdle from '../bpmn/bpmPlatformModdle.json';

export interface BpmnDiffSummary {
  addedIds: string[];
  removedIds: string[];
  changedIds: string[];
}

async function parseDefinitions(xml: string) {
  const moddle = new BpmnModdle({ bpm: bpmPlatformModdle });
  const { rootElement } = await moddle.fromXML(xml);
  return rootElement;
}

/**
 * Calcule les différences entre deux versions d'un même diagramme BPMN via
 * bpmn-js-differ (écosystème bpmn.io) : éléments ajoutés dans `newXml`,
 * supprimés depuis `oldXml`, ou présents dans les deux mais modifiés.
 */
export async function computeBpmnDiff(oldXml: string, newXml: string): Promise<BpmnDiffSummary> {
  const [oldDefinitions, newDefinitions] = await Promise.all([parseDefinitions(oldXml), parseDefinitions(newXml)]);
  const result = diff(oldDefinitions, newDefinitions);

  return {
    addedIds: Object.keys(result._added ?? {}),
    removedIds: Object.keys(result._removed ?? {}),
    changedIds: Object.keys(result._changed ?? {}),
  };
}
