import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { pool, withTransaction } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { requirePageAccess } from '../middleware/pageAccess';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';
import { writeAuditLog, writeAuditLogTx } from '../lib/audit';
import { parseGraph } from '../services/workflowEngine';
import { PermissionMatrixRow, ProcessRow } from '../types';

export const processesRouter = Router();
processesRouter.use(requireAuth);

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const DEFAULT_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:bpm="http://bpm-platform.local/schema/1.0"
                   id="Definitions_1" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Début" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="152" y="82" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const PROCESS_IMPORT_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                   xmlns:bpm="http://bpm-platform.local/schema/1.0"
                   id="Definitions_Exemple" targetNamespace="http://bpm-platform.local/bpmn">

  <!--
    MODÈLE D'IMPORT DE PROCESSUS — couvre tous les cas de figure pris en charge :
      - bpmn:startEvent avec bpm:formFields (les 6 types de champ possibles :
        text, number, boolean, date, textarea, client)
      - bpmn:userTask assignée à un RÔLE via bpm:assigneeRole (nom de rôle existant :
        ADMIN, OPERATOR ou VALIDATOR)
      - Variante non utilisée ici : bpm:assigneeUserId="<uuid-utilisateur>" pour
        assigner une tâche à un utilisateur précis plutôt qu'à un rôle
      - bpmn:userTask avec ses propres bpm:formFields (ou sans, cf. Task_Rapide)
      - bpmn:exclusiveGateway avec une branche par défaut (attribut "default")
        et une branche conditionnelle (bpmn:conditionExpression sur le sequenceFlow)
      - Opérateurs de condition disponibles : ==, !=, >, >=, <, <=, contains
        Syntaxe : "nomDuChamp OPERATEUR valeur" (ex: "montant > 1000",
        "urgent == true", "motif contains \"remboursement\"")
      - Convergence de plusieurs branches vers un même bpmn:endEvent
    Un attribut bpm:formFields est une liste JSON de champs, chaque champ ayant
    key, label, type et required. Ce fichier peut être importé tel quel (il crée
    un processus fonctionnel en brouillon), ou servir de base à dupliquer/adapter.
  -->

  <bpmn:process id="Process_Exemple" name="Exemple - Demande avec validation conditionnelle" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Début"
      bpm:formFields="[{&quot;key&quot;:&quot;referenceDossier&quot;,&quot;label&quot;:&quot;Référence dossier&quot;,&quot;type&quot;:&quot;text&quot;,&quot;required&quot;:false},{&quot;key&quot;:&quot;montant&quot;,&quot;label&quot;:&quot;Montant demandé (€)&quot;,&quot;type&quot;:&quot;number&quot;,&quot;required&quot;:true},{&quot;key&quot;:&quot;dateSouhaitee&quot;,&quot;label&quot;:&quot;Date souhaitée&quot;,&quot;type&quot;:&quot;date&quot;,&quot;required&quot;:false},{&quot;key&quot;:&quot;urgent&quot;,&quot;label&quot;:&quot;Urgent&quot;,&quot;type&quot;:&quot;boolean&quot;,&quot;required&quot;:false},{&quot;key&quot;:&quot;motif&quot;,&quot;label&quot;:&quot;Motif de la demande&quot;,&quot;type&quot;:&quot;textarea&quot;,&quot;required&quot;:true},{&quot;key&quot;:&quot;clientConcerne&quot;,&quot;label&quot;:&quot;Client concerné&quot;,&quot;type&quot;:&quot;client&quot;,&quot;required&quot;:false}]" />

    <bpmn:userTask id="Task_Saisie" name="Saisie de la demande" bpm:assigneeRole="OPERATOR"
      bpm:formFields="[{&quot;key&quot;:&quot;commentaireOperateur&quot;,&quot;label&quot;:&quot;Commentaire opérateur&quot;,&quot;type&quot;:&quot;text&quot;,&quot;required&quot;:false}]" />

    <bpmn:exclusiveGateway id="Gateway_Montant" name="Montant &gt; 1000 ?" default="Flow_low" />

    <bpmn:userTask id="Task_Validation" name="Validation manager" bpm:assigneeRole="VALIDATOR"
      bpm:formFields="[{&quot;key&quot;:&quot;decision&quot;,&quot;label&quot;:&quot;Décision (Approuvé / Refusé)&quot;,&quot;type&quot;:&quot;text&quot;,&quot;required&quot;:true}]" />

    <bpmn:userTask id="Task_Rapide" name="Enregistrement rapide" bpm:assigneeRole="OPERATOR" />

    <bpmn:endEvent id="End_1" name="Fin" />

    <bpmn:sequenceFlow id="Flow_start" sourceRef="StartEvent_1" targetRef="Task_Saisie" />
    <bpmn:sequenceFlow id="Flow_toGateway" sourceRef="Task_Saisie" targetRef="Gateway_Montant" />
    <bpmn:sequenceFlow id="Flow_high" sourceRef="Gateway_Montant" targetRef="Task_Validation">
      <bpmn:conditionExpression>montant &gt; 1000</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_low" sourceRef="Gateway_Montant" targetRef="Task_Rapide" />
    <bpmn:sequenceFlow id="Flow_end1" sourceRef="Task_Validation" targetRef="End_1" />
    <bpmn:sequenceFlow id="Flow_end2" sourceRef="Task_Rapide" targetRef="End_1" />
  </bpmn:process>

  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_Exemple">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="150" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Saisie_di" bpmnElement="Task_Saisie">
        <dc:Bounds x="240" y="178" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_Montant_di" bpmnElement="Gateway_Montant">
        <dc:Bounds x="400" y="193" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Validation_di" bpmnElement="Task_Validation">
        <dc:Bounds x="510" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Rapide_di" bpmnElement="Task_Rapide">
        <dc:Bounds x="510" y="300" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="680" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_start_di" bpmnElement="Flow_start">
        <di:waypoint x="186" y="218" />
        <di:waypoint x="240" y="218" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_toGateway_di" bpmnElement="Flow_toGateway">
        <di:waypoint x="340" y="218" />
        <di:waypoint x="400" y="218" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_high_di" bpmnElement="Flow_high">
        <di:waypoint x="425" y="193" />
        <di:waypoint x="425" y="120" />
        <di:waypoint x="510" y="120" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_low_di" bpmnElement="Flow_low">
        <di:waypoint x="425" y="243" />
        <di:waypoint x="425" y="340" />
        <di:waypoint x="510" y="340" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_end1_di" bpmnElement="Flow_end1">
        <di:waypoint x="610" y="120" />
        <di:waypoint x="650" y="120" />
        <di:waypoint x="650" y="218" />
        <di:waypoint x="680" y="218" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_end2_di" bpmnElement="Flow_end2">
        <di:waypoint x="610" y="340" />
        <di:waypoint x="650" y="340" />
        <di:waypoint x="650" y="218" />
        <di:waypoint x="680" y="218" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

processesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<ProcessRow & { created_by_name: string }>(
      `SELECT p.*, u.full_name AS created_by_name
       FROM processes p JOIN users u ON u.id = p.created_by
       ORDER BY p.name ASC, p.version DESC`
    );
    res.json({ processes: rows });
  })
);

// Enregistrée avant GET /:id pour ne pas être interceptée par ce paramètre de route.
processesRouter.get(
  '/import-template',
  requirePageAccess('PROCESSES_DESIGN', 'FULL'),
  asyncHandler(async (_req, res) => {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="modele_import_processus.xml"');
    res.send(PROCESS_IMPORT_TEMPLATE);
  })
);

processesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<ProcessRow>('SELECT * FROM processes WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw new HttpError(404, 'Processus introuvable');
    res.json({ process: rows[0] });
  })
);

const createProcessSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  bpmnXml: z.string().optional(),
});

processesRouter.post(
  '/',
  requirePageAccess('PROCESSES_DESIGN', 'FULL'),
  asyncHandler(async (req, res) => {
    const body = createProcessSchema.parse(req.body);
    const bpmnXml = body.bpmnXml ?? DEFAULT_BPMN;
    parseGraph(bpmnXml); // valide la structure avant sauvegarde

    try {
      const { rows } = await pool.query<ProcessRow>(
        `INSERT INTO processes (process_key, name, description, bpmn_xml, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [slugify(body.name), body.name, body.description ?? null, bpmnXml, req.user!.id]
      );

      await writeAuditLog({
        userId: req.user!.id,
        action: 'PROCESS_CREATED',
        entityType: 'process',
        entityId: rows[0].id,
        details: { name: body.name },
        ipAddress: req.ip,
      });

      res.status(201).json({ process: rows[0] });
    } catch (err: any) {
      if (err.code === '23505') throw new HttpError(409, 'Un processus avec ce nom existe déjà');
      throw err;
    }
  })
);

function extractProcessName(xml: string): string | null {
  const match = xml.match(/<(?:[a-zA-Z0-9]+:)?process\b[^>]*\bname=["']([^"']*)["']/);
  return match ? match[1].trim() || null : null;
}

function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.(bpmn|xml)$/i, '');
  const spaced = base.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const xmlUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 30 },
});

interface ImportProcessResult {
  file: string;
  processId: string;
  name: string;
}
interface ImportProcessError {
  file: string;
  message: string;
}

processesRouter.post(
  '/import',
  requirePageAccess('PROCESSES_DESIGN', 'FULL'),
  xmlUpload.array('files', 30),
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) throw new HttpError(400, 'Aucun fichier XML fourni');

    const results: ImportProcessResult[] = [];
    const errors: ImportProcessError[] = [];

    for (const file of files) {
      const xml = file.buffer.toString('utf-8');
      try {
        parseGraph(xml); // valide la structure avant sauvegarde

        const name = extractProcessName(xml) || nameFromFilename(file.originalname);
        if (!name || name.length < 2) {
          throw new Error("Impossible de déterminer un nom de processus (attribut name du <process> ou nom de fichier)");
        }

        const { rows } = await pool.query<ProcessRow>(
          `INSERT INTO processes (process_key, name, description, bpmn_xml, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [slugify(name), name, null, xml, req.user!.id]
        );
        const created = rows[0];

        await writeAuditLog({
          userId: req.user!.id,
          action: 'PROCESS_CREATED',
          entityType: 'process',
          entityId: created.id,
          details: { name, source: 'xml_import', file: file.originalname },
          ipAddress: req.ip,
        });

        results.push({ file: file.originalname, processId: created.id, name });
      } catch (err: any) {
        const message = err.code === '23505' ? 'Un processus avec ce nom existe déjà' : (err as Error).message;
        errors.push({ file: file.originalname, message });
      }
    }

    await writeAuditLog({
      userId: req.user!.id,
      action: 'PROCESSES_BULK_IMPORTED',
      entityType: 'process',
      details: { totalFiles: files.length, created: results.length, errorCount: errors.length },
      ipAddress: req.ip,
    });

    res.json({ created: results.length, results, errors });
  })
);

const updateProcessSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
  bpmnXml: z.string().optional(),
});

processesRouter.put(
  '/:id',
  requirePageAccess('PROCESSES_DESIGN', 'FULL'),
  asyncHandler(async (req, res) => {
    const body = updateProcessSchema.parse(req.body);
    const { rows: existingRows } = await pool.query<ProcessRow>('SELECT * FROM processes WHERE id = $1', [
      req.params.id,
    ]);
    const existing = existingRows[0];
    if (!existing) throw new HttpError(404, 'Processus introuvable');
    if (existing.status !== 'DRAFT') throw new HttpError(409, 'Seul un processus en brouillon peut être modifié');

    if (body.bpmnXml) parseGraph(body.bpmnXml);

    const { rows } = await pool.query<ProcessRow>(
      `UPDATE processes SET name = $1, description = $2, bpmn_xml = $3, process_key = $4
       WHERE id = $5 RETURNING *`,
      [
        body.name ?? existing.name,
        body.description ?? existing.description,
        body.bpmnXml ?? existing.bpmn_xml,
        body.name ? slugify(body.name) : existing.process_key,
        existing.id,
      ]
    );

    await writeAuditLog({
      userId: req.user!.id,
      action: 'PROCESS_UPDATED',
      entityType: 'process',
      entityId: existing.id,
      ipAddress: req.ip,
    });

    res.json({ process: rows[0] });
  })
);

processesRouter.post(
  '/:id/publish',
  requirePageAccess('PROCESSES_DESIGN', 'FULL'),
  asyncHandler(async (req, res) => {
    const { rows: existingRows } = await pool.query<ProcessRow>('SELECT * FROM processes WHERE id = $1', [
      req.params.id,
    ]);
    const existing = existingRows[0];
    if (!existing) throw new HttpError(404, 'Processus introuvable');
    if (existing.status !== 'DRAFT') throw new HttpError(409, 'Ce processus est déjà publié');

    const graph = parseGraph(existing.bpmn_xml);
    if (!graph.nodes.some((n) => n.type === 'endEvent')) {
      throw new HttpError(400, 'Le processus doit contenir au moins un événement de fin avant publication');
    }

    const { rows } = await pool.query<ProcessRow>(
      `UPDATE processes SET status = 'PUBLISHED' WHERE id = $1 RETURNING *`,
      [existing.id]
    );

    await writeAuditLog({
      userId: req.user!.id,
      action: 'PROCESS_PUBLISHED',
      entityType: 'process',
      entityId: existing.id,
      ipAddress: req.ip,
    });

    res.json({ process: rows[0] });
  })
);

processesRouter.post(
  '/:id/archive',
  requirePageAccess('PROCESSES_DESIGN', 'FULL'),
  asyncHandler(async (req, res) => {
    const { rows: existingRows } = await pool.query<ProcessRow>('SELECT * FROM processes WHERE id = $1', [
      req.params.id,
    ]);
    const existing = existingRows[0];
    if (!existing) throw new HttpError(404, 'Processus introuvable');
    if (existing.status !== 'PUBLISHED') {
      throw new HttpError(409, 'Seul un processus publié peut être archivé');
    }

    const { rows } = await pool.query<ProcessRow>(
      `UPDATE processes SET status = 'ARCHIVED' WHERE id = $1 RETURNING *`,
      [existing.id]
    );

    await writeAuditLog({
      userId: req.user!.id,
      action: 'PROCESS_ARCHIVED',
      entityType: 'process',
      entityId: existing.id,
      ipAddress: req.ip,
    });

    res.json({ process: rows[0] });
  })
);

// ---------------------------------------------------------------------
// Matrice de visibilité / droits par processus + étape + rôle
// ---------------------------------------------------------------------

processesRouter.get(
  '/:id/permissions',
  requirePageAccess('PERMISSIONS_MATRIX', 'VIEW'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<PermissionMatrixRow>(
      'SELECT * FROM permissions_matrix WHERE process_id = $1 ORDER BY step_name ASC',
      [req.params.id]
    );
    res.json({ permissions: rows });
  })
);

const permissionRowSchema = z.object({
  stepName: z.string().min(1),
  roleId: z.number().int(),
  fieldPermissions: z.record(z.object({ read: z.boolean(), write: z.boolean() })),
  canViewDocuments: z.boolean(),
  canUploadDocuments: z.boolean(),
});

const putPermissionsSchema = z.object({ rows: z.array(permissionRowSchema) });

processesRouter.put(
  '/:id/permissions',
  requirePageAccess('PERMISSIONS_MATRIX', 'FULL'),
  asyncHandler(async (req, res) => {
    const body = putPermissionsSchema.parse(req.body);
    const processId = req.params.id;

    await withTransaction(async (client) => {
      const { rows: procRows } = await client.query('SELECT id FROM processes WHERE id = $1', [processId]);
      if (procRows.length === 0) throw new HttpError(404, 'Processus introuvable');

      await client.query('DELETE FROM permissions_matrix WHERE process_id = $1', [processId]);
      for (const row of body.rows) {
        await client.query(
          `INSERT INTO permissions_matrix (process_id, step_name, role_id, field_permissions, can_view_documents, can_upload_documents)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            processId,
            row.stepName,
            row.roleId,
            JSON.stringify(row.fieldPermissions),
            row.canViewDocuments,
            row.canUploadDocuments,
          ]
        );
      }

      await writeAuditLogTx(client, {
        userId: req.user!.id,
        action: 'PERMISSIONS_UPDATED',
        entityType: 'process',
        entityId: processId,
        details: { rowCount: body.rows.length },
        ipAddress: req.ip,
      });
    });

    const { rows } = await pool.query<PermissionMatrixRow>(
      'SELECT * FROM permissions_matrix WHERE process_id = $1 ORDER BY step_name ASC',
      [processId]
    );
    res.json({ permissions: rows });
  })
);
