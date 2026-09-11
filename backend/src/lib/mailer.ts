import nodemailer, { Transporter } from 'nodemailer';
import { pool } from '../db/pool';
import { env } from '../config/env';
import { logger } from './logger';
import { NotificationTemplateRow, SmtpSettingsRow } from '../types';

interface EffectiveSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

async function getEffectiveSmtpConfig(): Promise<EffectiveSmtpConfig> {
  let row: SmtpSettingsRow | undefined;
  try {
    const { rows } = await pool.query<SmtpSettingsRow>('SELECT * FROM smtp_settings WHERE id = 1');
    row = rows[0];
  } catch (err) {
    logger.error('Failed to read smtp_settings, falling back to .env', { error: (err as Error).message });
  }

  const useDb = Boolean(row?.host);
  return {
    host: useDb ? row!.host! : env.SMTP_HOST,
    port: useDb ? row!.port : env.SMTP_PORT,
    secure: useDb ? row!.secure : env.SMTP_SECURE,
    user: (useDb ? row!.username : env.SMTP_USER) ?? '',
    password: (useDb ? row!.password : env.SMTP_PASSWORD) ?? '',
    from: (useDb ? row!.from_address : null) || env.SMTP_FROM,
  };
}

async function getTransporter(): Promise<{ transporter: Transporter; from: string }> {
  const cfg = await getEffectiveSmtpConfig();
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    connectionTimeout: 5000,
  });
  return { transporter, from: cfg.from };
}

function layout(heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e1e5ea;">
            <tr>
              <td style="background:#1d4ed8;padding:16px 24px;">
                <span style="color:#ffffff;font-size:16px;font-weight:bold;">BPM Platform</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;color:#1c2530;font-size:14px;line-height:1.6;">
                <h2 style="margin:0 0 12px;font-size:18px;">${heading}</h2>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;background:#f4f6f9;color:#667085;font-size:12px;">
                Notification automatique — ne pas répondre à cet email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => (key in vars ? escapeHtml(vars[key]) : ''));
}

export interface RenderedTemplateStrings {
  heading: string;
  subject: string;
  bodyHtml: string;
}

/** Rendu pur (sans accès DB), utilisé aussi bien pour l'envoi que pour l'aperçu admin. */
export function renderTemplateStrings(tpl: RenderedTemplateStrings, vars: Record<string, string>): { subject: string; html: string } {
  return {
    subject: substitute(tpl.subject, vars),
    html: layout(substitute(tpl.heading, vars), substitute(tpl.bodyHtml, vars)),
  };
}

async function renderTemplate(key: string, vars: Record<string, string>): Promise<{ subject: string; html: string } | null> {
  const { rows } = await pool.query<NotificationTemplateRow>('SELECT * FROM notification_templates WHERE key = $1', [key]);
  const tpl = rows[0];
  if (!tpl) {
    logger.error('Notification template missing', { key });
    return null;
  }
  return renderTemplateStrings({ heading: tpl.heading, subject: tpl.subject, bodyHtml: tpl.body_html }, vars);
}

async function send(to: string, subject: string, html: string): Promise<void> {
  try {
    const { transporter, from } = await getTransporter();
    await transporter.sendMail({ from, to, subject, html });
  } catch (err) {
    logger.error('Failed to send email', { to, subject, error: (err as Error).message });
  }
}

export async function sendTestEmail(to: string, recipientName: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { transporter, from } = await getTransporter();
    await transporter.sendMail({
      from,
      to,
      subject: '[BPM] Email de test',
      html: layout(
        'Email de test',
        `<p>Bonjour ${escapeHtml(recipientName)},</p>
         <p>Ceci est un email de test envoyé depuis les paramètres SMTP de BPM Platform.</p>
         <p>Si vous le recevez, la configuration fonctionne correctement.</p>`
      ),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function sendTaskAssignedEmail(params: {
  to: string;
  recipientName: string;
  taskName: string;
  processName: string;
  isDelegated: boolean;
  originalAssigneeName?: string;
}): Promise<void> {
  const rendered = await renderTemplate(params.isDelegated ? 'TASK_DELEGATED' : 'TASK_ASSIGNED', {
    recipientName: params.recipientName,
    taskName: params.taskName,
    processName: params.processName,
    originalAssigneeName: params.originalAssigneeName ?? "l'assigné initial",
    tasksUrl: `${env.APP_BASE_URL}/tasks`,
  });
  if (!rendered) return;
  await send(params.to, rendered.subject, rendered.html);
}

export async function sendAccountDeactivatedEmail(params: {
  to: string;
  recipientName: string;
  reassignedCount: number;
}): Promise<void> {
  const rendered = await renderTemplate('ACCOUNT_DEACTIVATED', {
    recipientName: params.recipientName,
    reassignedCount: String(params.reassignedCount),
  });
  if (!rendered) return;
  await send(params.to, rendered.subject, rendered.html);
}

export async function sendWelcomeEmail(params: {
  to: string;
  recipientName: string;
  email: string;
  temporaryPassword: string;
}): Promise<void> {
  const rendered = await renderTemplate('WELCOME', {
    recipientName: params.recipientName,
    email: params.email,
    temporaryPassword: params.temporaryPassword,
    loginUrl: `${env.APP_BASE_URL}/login`,
  });
  if (!rendered) return;
  await send(params.to, rendered.subject, rendered.html);
}

export async function sendPasswordChangedEmail(params: {
  to: string;
  recipientName: string;
  changedByAdmin: boolean;
}): Promise<void> {
  const rendered = await renderTemplate(params.changedByAdmin ? 'PASSWORD_CHANGED_BY_ADMIN' : 'PASSWORD_CHANGED_SELF', {
    recipientName: params.recipientName,
  });
  if (!rendered) return;
  await send(params.to, rendered.subject, rendered.html);
}

export async function sendPasswordResetEmail(params: {
  to: string;
  recipientName: string;
  resetUrl: string;
  expiresInMinutes: number;
}): Promise<void> {
  const rendered = await renderTemplate('PASSWORD_RESET_REQUESTED', {
    recipientName: params.recipientName,
    resetUrl: params.resetUrl,
    expiresInMinutes: String(params.expiresInMinutes),
  });
  if (!rendered) return;
  await send(params.to, rendered.subject, rendered.html);
}

export async function sendProcessCompletedEmail(params: {
  to: string;
  recipientName: string;
  processName: string;
  outcome: string;
}): Promise<void> {
  const rendered = await renderTemplate('PROCESS_COMPLETED', {
    recipientName: params.recipientName,
    processName: params.processName,
    outcome: params.outcome,
  });
  if (!rendered) return;
  await send(params.to, rendered.subject, rendered.html);
}
