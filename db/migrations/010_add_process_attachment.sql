-- Permet de rattacher un dossier ou un document de la bibliothèque
-- Documents à un processus (choisi à la création). Sans effet si déjà
-- appliquée.

ALTER TABLE processes ADD COLUMN IF NOT EXISTS attached_folder_id UUID REFERENCES document_folders(id) ON DELETE SET NULL;
ALTER TABLE processes ADD COLUMN IF NOT EXISTS attached_document_id UUID REFERENCES library_documents(id) ON DELETE SET NULL;
