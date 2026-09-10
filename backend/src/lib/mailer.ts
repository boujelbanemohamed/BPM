import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from './logger';

export const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  connectionTimeout: 5000,
});

function layout(title: string, bodyHtml: string): string {
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
                <h2 style="margin:0 0 12px;font-size:18px;">${title}</h2>
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

async function send(to: string, subject: string, html: string): Promise<void> {
  try {
    await transporter.sendMail({ from: env.SMTP_FROM, to, subject, html });
  } catch (err) {
    logger.error('Failed to send email', { to, subject, error: (err as Error).message });
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
  const { to, recipientName, taskName, processName, isDelegated, originalAssigneeName } = params;
  const delegationNote = isDelegated
    ? `<p style="background:#fff8e8;border:1px solid #f0d999;border-radius:6px;padding:10px 12px;">
         Cette tâche vous est confiée <strong>en tant que suppléant</strong> de ${originalAssigneeName ?? 'l\'assigné initial'}.
       </p>`
    : '';
  const html = layout(
    'Nouvelle tâche à traiter',
    `<p>Bonjour ${recipientName},</p>
     <p>La tâche <strong>${taskName}</strong> du processus <strong>${processName}</strong> vous a été assignée et attend votre traitement.</p>
     ${delegationNote}
     <p><a href="${env.APP_BASE_URL}/tasks" style="color:#2f5ce0;">Ouvrir mes tâches</a></p>`
  );
  await send(to, `[BPM] Nouvelle tâche : ${taskName}`, html);
}

export async function sendAccountDeactivatedEmail(params: {
  to: string;
  recipientName: string;
  reassignedCount: number;
}): Promise<void> {
  const { to, recipientName, reassignedCount } = params;
  const html = layout(
    'Compte désactivé',
    `<p>Bonjour ${recipientName},</p>
     <p>Votre compte BPM Platform vient d'être désactivé par un administrateur.</p>
     <p>${reassignedCount} tâche(s) en attente ont été automatiquement réassignées à votre chaîne de suppléance.</p>`
  );
  await send(to, '[BPM] Votre compte a été désactivé', html);
}

export async function sendWelcomeEmail(params: {
  to: string;
  recipientName: string;
  email: string;
  temporaryPassword: string;
}): Promise<void> {
  const { to, recipientName, email, temporaryPassword } = params;
  const html = layout(
    'Bienvenue sur BPM Platform',
    `<p>Bonjour ${recipientName},</p>
     <p>Un compte vient d'être créé pour vous sur BPM Platform par un administrateur.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f4f6f9;border-radius:6px;margin:12px 0;">
       <tr><td style="padding:10px 12px;"><strong>Email :</strong> ${email}</td></tr>
       <tr><td style="padding:0 12px 10px;"><strong>Mot de passe temporaire :</strong> ${temporaryPassword}</td></tr>
     </table>
     <p>Nous vous recommandons de changer ce mot de passe dès votre première connexion, depuis la page "Mon profil".</p>
     <p><a href="${env.APP_BASE_URL}/login" style="color:#2f5ce0;">Me connecter</a></p>`
  );
  await send(to, '[BPM] Bienvenue — votre compte a été créé', html);
}

export async function sendPasswordChangedEmail(params: {
  to: string;
  recipientName: string;
  changedByAdmin: boolean;
}): Promise<void> {
  const { to, recipientName, changedByAdmin } = params;
  const html = layout(
    'Mot de passe modifié',
    `<p>Bonjour ${recipientName},</p>
     <p>${
       changedByAdmin
         ? 'Le mot de passe de votre compte BPM Platform vient d\'être réinitialisé par un administrateur.'
         : 'Le mot de passe de votre compte BPM Platform vient d\'être modifié.'
     }</p>
     <p style="background:#fff8e8;border:1px solid #f0d999;border-radius:6px;padding:10px 12px;">
       Si vous n'êtes pas à l'origine de cette action, contactez immédiatement un administrateur.
     </p>`
  );
  await send(to, '[BPM] Votre mot de passe a été modifié', html);
}

export async function sendProcessCompletedEmail(params: {
  to: string;
  recipientName: string;
  processName: string;
  outcome: string;
}): Promise<void> {
  const { to, recipientName, processName, outcome } = params;
  const html = layout(
    'Processus terminé',
    `<p>Bonjour ${recipientName},</p>
     <p>Le processus <strong>${processName}</strong> que vous avez démarré est terminé.</p>
     <p>Issue : <strong>${outcome}</strong></p>`
  );
  await send(to, `[BPM] Processus terminé : ${processName}`, html);
}
