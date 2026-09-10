import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { parseGraph } from '../services/workflowEngine';
import { ProcessRow } from '../types';

export const adminMetaRouter = Router();
adminMetaRouter.use(requireAuth, requireRole('ADMIN'));

interface FieldRegistryRow {
  processId: string;
  processName: string;
  processStatus: string;
  stepId: string;
  stepName: string;
  stepType: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: string;
  required: boolean;
}

adminMetaRouter.get(
  '/fields',
  asyncHandler(async (req, res) => {
    const { rows: processes } = await pool.query<ProcessRow>(
      'SELECT * FROM processes ORDER BY name ASC, version DESC'
    );

    const fields: FieldRegistryRow[] = [];
    for (const process of processes) {
      let graph;
      try {
        graph = parseGraph(process.bpmn_xml);
      } catch {
        continue; // processus au XML invalide (ne devrait pas arriver) : on l'ignore plutôt que de faire échouer tout le registre
      }
      for (const node of graph.nodes) {
        for (const field of node.formFields) {
          fields.push({
            processId: process.id,
            processName: process.name,
            processStatus: process.status,
            stepId: node.id,
            stepName: node.name,
            stepType: node.type,
            fieldKey: field.key,
            fieldLabel: field.label,
            fieldType: field.type,
            required: field.required,
          });
        }
      }
    }

    res.json({ fields });
  })
);

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

adminMetaRouter.get(
  '/database-schema',
  asyncHandler(async (req, res) => {
    const { rows: columns } = await pool.query<ColumnRow>(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name ASC, ordinal_position ASC`
    );

    const { rows: counts } = await pool.query<{ table_name: string; row_count: string }>(
      `SELECT relname AS table_name, n_live_tup::text AS row_count
       FROM pg_stat_user_tables`
    );
    const countByTable = Object.fromEntries(counts.map((c) => [c.table_name, Number(c.row_count)]));

    const tableNames = [...new Set(columns.map((c) => c.table_name))];
    const tables = tableNames.map((name) => ({
      name,
      rowCount: countByTable[name] ?? 0,
      columns: columns
        .filter((c) => c.table_name === name)
        .map((c) => ({
          name: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable === 'YES',
          default: c.column_default,
        })),
    }));

    res.json({ tables });
  })
);
