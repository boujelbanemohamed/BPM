import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { requirePageAccess } from '../middleware/pageAccess';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';
import { writeAuditLog } from '../lib/audit';
import { renderTemplateStrings, sendTestEmail } from '../lib/mailer';
import { NotificationTemplateRow, SmtpSettingsRow } from '../types';

export const adminSettingsRouter = Router();
adminSettingsRouter.use(requireAuth, requirePageAccess('NOTIFICATIONS_CONFIG', 'VIEW'));

/** Valeurs d'exemple pour l'aperçu, une par variable connue dans les modèles. */
const SAMPLE_VARS: Record<string, string> = {
  recipientName: 'Olivier Opérateur',
  email: 'olivier@exemple.local',
  temporaryPassword: 'MotDePasseTemp123!',
  loginUrl: 'https://bpm.exemple.local/login',
  taskName: 'Validation manager',
  processName: 'Demande de congés',
  originalAssigneeName: 'Valérie Validateur',
  tasksUrl: 'https://bpm.exemple.local/tasks',
  reassignedCount: '2',
  outcome: 'Approuvé',
};

// --- Paramètres SMTP -------------------------------------------------

adminSettingsRouter.get(
  '/smtp',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<SmtpSettingsRow>('SELECT * FROM smtp_settings WHERE id = 1');
    const row = rows[0];
    res.json({
      settings: {
        host: row?.host ?? '',
        port: row?.port ?? 587,
        secure: row?.secure ?? false,
        username: row?.username ?? '',
        hasPassword: Boolean(row?.password),
        fromAddress: row?.from_address ?? '',
        updatedAt: row?.updated_at ?? null,
      },
    });
  })
);

const smtpSchema = z.object({
  host: z.string().trim().max(255),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().max(255).optional(),
  password: z.string().max(255).optional(),
  fromAddress: z.string().trim().max(255).optional(),
});

adminSettingsRouter.put(
  '/smtp',
  requirePageAccess('NOTIFICATIONS_CONFIG', 'FULL'),
  asyncHandler(async (req, res) => {
    const body = smtpSchema.parse(req.body);

    await pool.query(
      `INSERT INTO smtp_settings (id, host, port, secure, username, password, from_address, updated_by)
       VALUES (1, $1, $2, $3, $4, COALESCE(NULLIF($5, ''), (SELECT password FROM smtp_settings WHERE id = 1)), $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         host = EXCLUDED.host, port = EXCLUDED.port, secure = EXCLUDED.secure,
         username = EXCLUDED.username, password = EXCLUDED.password,
         from_address = EXCLUDED.from_address, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [
        body.host || null,
        body.port,
        body.secure,
        body.username || null,
        body.password ?? '',
        body.fromAddress || null,
        req.user!.id,
      ]
    );

    await writeAuditLog({
      userId: req.user!.id,
      action: 'SMTP_SETTINGS_UPDATED',
      entityType: 'smtp_settings',
      entityId: '1',
      details: {
        host: body.host,
        port: body.port,
        secure: body.secure,
        username: body.username,
        passwordChanged: Boolean(body.password),
      },
      ipAddress: req.ip,
    });

    res.json({ ok: true });
  })
);

adminSettingsRouter.post(
  '/smtp/test',
  requirePageAccess('NOTIFICATIONS_CONFIG', 'FULL'),
  asyncHandler(async (req, res) => {
    const result = await sendTestEmail(req.user!.email, req.user!.fullName);
    if (!result.ok) throw new HttpError(502, `Échec de l'envoi : ${result.error}`);
    res.json({ ok: true });
  })
);

// --- Modèles d'emails --------------------------------------------------

adminSettingsRouter.get(
  '/notification-templates',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<NotificationTemplateRow>('SELECT * FROM notification_templates ORDER BY key ASC');
    res.json({ templates: rows });
  })
);

const templateSchema = z.object({
  heading: z.string().trim().min(1, 'Le titre est requis').max(255),
  subject: z.string().trim().min(1, "L'objet est requis").max(255),
  bodyHtml: z.string().trim().min(1, 'Le corps du message est requis'),
});

adminSettingsRouter.put(
  '/notification-templates/:key',
  requirePageAccess('NOTIFICATIONS_CONFIG', 'FULL'),
  asyncHandler(async (req, res) => {
    const body = templateSchema.parse(req.body);
    const { rows } = await pool.query<NotificationTemplateRow>(
      `UPDATE notification_templates SET heading = $1, subject = $2, body_html = $3, updated_by = $4, updated_at = now()
       WHERE key = $5 RETURNING *`,
      [body.heading, body.subject, body.bodyHtml, req.user!.id, req.params.key]
    );
    if (rows.length === 0) throw new HttpError(404, 'Modèle introuvable');

    await writeAuditLog({
      userId: req.user!.id,
      action: 'NOTIFICATION_TEMPLATE_UPDATED',
      entityType: 'notification_template',
      entityId: req.params.key,
      details: { subject: body.subject },
      ipAddress: req.ip,
    });

    res.json({ template: rows[0] });
  })
);

adminSettingsRouter.post(
  '/notification-templates/:key/reset',
  requirePageAccess('NOTIFICATIONS_CONFIG', 'FULL'),
  asyncHandler(async (req, res) => {
    const { rows: defaultRows } = await pool.query<{ heading: string; subject: string; body_html: string }>(
      `SELECT heading, subject, body_html FROM notification_templates_defaults WHERE key = $1`,
      [req.params.key]
    );
    const defaults = defaultRows[0];
    if (!defaults) throw new HttpError(404, 'Modèle introuvable');

    const { rows } = await pool.query<NotificationTemplateRow>(
      `UPDATE notification_templates SET heading = $1, subject = $2, body_html = $3, updated_by = $4, updated_at = now()
       WHERE key = $5 RETURNING *`,
      [defaults.heading, defaults.subject, defaults.body_html, req.user!.id, req.params.key]
    );
    if (rows.length === 0) throw new HttpError(404, 'Modèle introuvable');

    await writeAuditLog({
      userId: req.user!.id,
      action: 'NOTIFICATION_TEMPLATE_RESET',
      entityType: 'notification_template',
      entityId: req.params.key,
      ipAddress: req.ip,
    });

    res.json({ template: rows[0] });
  })
);

adminSettingsRouter.post(
  '/notification-templates/:key/preview',
  asyncHandler(async (req, res) => {
    const body = templateSchema.parse(req.body);
    const rendered = renderTemplateStrings(body, SAMPLE_VARS);
    res.json(rendered);
  })
);
