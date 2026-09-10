-- Migration incrémentale pour une base déjà initialisée avec une version
-- antérieure de db/init.sql. audit_logs.entity_id était typé UUID, mais
-- plusieurs actions journalisées portent sur des entités à identifiant non
-- UUID (rôles : id entier, modèles d'emails : clé texte, paramètres SMTP :
-- ligne singleton '1') — ces écritures d'audit échouaient silencieusement
-- (l'erreur est interceptée et seulement loguée, jamais remontée à
-- l'utilisateur). Sans effet si déjà appliquée.

ALTER TABLE audit_logs ALTER COLUMN entity_id TYPE VARCHAR(255) USING entity_id::text;
