-- Migration incrémentale pour une base déjà initialisée avec une version
-- antérieure de db/init.sql (avant l'ajout du profil utilisateur détaillé :
-- prénom/nom séparés, téléphone, avatar). Sans effet si déjà appliquée.

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);

-- Rétro-remplissage à partir de full_name pour les comptes existants,
-- uniquement si les nouveaux champs n'ont pas déjà une valeur.
UPDATE users
SET first_name = COALESCE(first_name,
      CASE WHEN position(' ' IN full_name) > 0 THEN split_part(full_name, ' ', 1) ELSE full_name END),
    last_name = COALESCE(last_name,
      CASE WHEN position(' ' IN full_name) > 0 THEN trim(substring(full_name FROM position(' ' IN full_name) + 1)) ELSE NULL END)
WHERE first_name IS NULL AND last_name IS NULL;
