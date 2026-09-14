/**
 * Extension physique utilisée pour stocker un fichier uploadé, dérivée
 * UNIQUEMENT du type MIME déjà validé par le fileFilter de multer — jamais
 * du nom de fichier fourni par le client.
 *
 * Pourquoi : lors du téléchargement, Express (res.download / express.static)
 * déduit le Content-Type de la réponse à partir de l'extension du fichier
 * stocké sur disque, pas du MIME validé à l'upload. Si cette extension
 * reprenait `path.extname(file.originalname)`, un client pourrait déclarer
 * un Content-Type autorisé (ex. "text/plain") tout en nommant son fichier
 * "x.html" : le fichier passerait le filtre mais serait ensuite servi en
 * "Content-Type: text/html" — une XSS stockée via upload de fichier.
 */
export function extensionForMimeType(mimeType: string, mimeToExtension: Record<string, string>): string {
  return mimeToExtension[mimeType] ?? '.bin';
}
