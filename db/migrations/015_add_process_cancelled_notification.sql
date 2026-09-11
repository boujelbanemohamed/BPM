-- Modèle d'email/notification pour l'événement de fin d'erreur/annulation
-- BPMN : quand un processus se termine sur cette voie, le demandeur est
-- notifié via ce modèle plutôt que "Processus terminé". Utilise le type
-- de notification GENERIC existant (comme les commentaires, la
-- bienvenue, le changement de mot de passe...) : pas besoin d'étendre
-- l'enum notification_type, la clé de modèle reste une simple chaîne.
-- Sans effet si déjà appliquée.

INSERT INTO notification_templates (key, heading, subject, body_html, variables)
SELECT 'PROCESS_CANCELLED', 'Processus annulé', '[BPM] Processus annulé : {{processName}}',
  '<p>Bonjour {{recipientName}},</p>
     <p>Le processus <strong>{{processName}}</strong> que vous avez démarré a été interrompu.</p>
     <p>Motif : <strong>{{outcome}}</strong></p>',
  ARRAY['recipientName', 'processName', 'outcome']
WHERE NOT EXISTS (SELECT 1 FROM notification_templates WHERE key = 'PROCESS_CANCELLED');

INSERT INTO notification_templates_defaults (key, heading, subject, body_html)
SELECT 'PROCESS_CANCELLED', 'Processus annulé', '[BPM] Processus annulé : {{processName}}',
  '<p>Bonjour {{recipientName}},</p>
     <p>Le processus <strong>{{processName}}</strong> que vous avez démarré a été interrompu.</p>
     <p>Motif : <strong>{{outcome}}</strong></p>'
WHERE NOT EXISTS (SELECT 1 FROM notification_templates_defaults WHERE key = 'PROCESS_CANCELLED');
