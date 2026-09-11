declare module 'bpmn-js/lib/Modeler' {
  const Modeler: any;
  export default Modeler;
}

declare module 'bpmn-js/lib/NavigatedViewer' {
  const NavigatedViewer: any;
  export default NavigatedViewer;
}

declare module 'bpmn-moddle' {
  export class BpmnModdle {
    constructor(extensions?: Record<string, unknown>);
    fromXML(xml: string): Promise<{ rootElement: any; references: any[]; warnings: any[] }>;
  }
}
