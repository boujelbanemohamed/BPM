-- La bibliothèque de documents (menu « Documents », dossiers + fichiers
-- indépendants des instances) n'était jusqu'ici protégée que par
-- l'authentification, sans passer par la matrice de droits par page.
-- On l'ajoute au catalogue ('DOCUMENTS') pour qu'elle soit désormais
-- configurable par rôle comme les autres pages (Processus, Utilisateurs...).

-- Préserve le comportement actuel (tout utilisateur connecté peut consulter
-- ET gérer les documents) : sans cette ligne, l'ajout du contrôle d'accès
-- retirerait silencieusement cet accès aux rôles non-admin.
INSERT INTO role_page_permissions (role_id, page_key, access_level)
  SELECT id, 'DOCUMENTS', 'FULL' FROM roles WHERE name <> 'ADMIN'
ON CONFLICT (role_id, page_key) DO NOTHING;
