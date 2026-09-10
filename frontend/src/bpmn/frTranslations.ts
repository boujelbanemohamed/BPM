// Traductions françaises des libellés/infobulles intégrés à bpmn-js (palette,
// context pad, menu de remplacement, outils d'alignement...). bpmn-js appelle
// systématiquement translate(chaîneAnglaise, remplacements) pour tout texte
// affiché à l'utilisateur ; on fournit ici un module "translate" qui
// substitue la traduction française quand elle existe, et retombe sur la
// chaîne d'origine sinon (voir customTranslateModule plus bas).
const FR_TRANSLATIONS: Record<string, string> = {
  'Activate create/remove space tool': "Activer l'outil créer/supprimer de l'espace",
  'Activate global connect tool': "Activer l'outil de connexion",
  'Activate hand tool': "Activer l'outil main (déplacer la vue)",
  'Activate lasso tool': "Activer l'outil lasso (sélection)",
  'Ad-hoc': 'Ad hoc',
  'Add lane above': 'Ajouter une voie au-dessus',
  'Add lane below': 'Ajouter une voie en dessous',
  'Add text annotation': 'Ajouter une annotation textuelle',
  'Align elements ': 'Aligner les éléments',
  'Align elements': 'Aligner les éléments',
  'Append compensation activity': 'Ajouter une activité de compensation',
  'Append conditional intermediate catch event': 'Ajouter un événement intermédiaire conditionnel',
  'Append end event': 'Ajouter un événement de fin',
  'Append gateway': 'Ajouter une passerelle',
  'Append intermediate/boundary event': 'Ajouter un événement intermédiaire/limite',
  'Append message intermediate catch event': 'Ajouter un événement intermédiaire de message',
  'Append receive task': 'Ajouter une tâche de réception',
  'Append signal intermediate catch event': 'Ajouter un événement intermédiaire de signal',
  'Append task': 'Ajouter une tâche',
  'Append timer intermediate catch event': 'Ajouter un événement intermédiaire de minuterie',
  'Change element': "Changer le type d'élément",
  Collection: 'Collection',
  'Connect to other element': 'Connecter à un autre élément',
  'Connect using association': 'Connecter avec une association',
  'Connect using data input association': 'Connecter avec une association de données',
  'Create data object reference': "Créer une référence d'objet de données",
  'Create data store reference': 'Créer une référence de magasin de données',
  'Create end event': 'Créer un événement de fin',
  'Create expanded sub-process': 'Créer un sous-processus développé',
  'Create gateway': 'Créer une passerelle',
  'Create group': 'Créer un groupe',
  'Create intermediate/boundary event': 'Créer un événement intermédiaire/limite',
  'Create pool/participant': 'Créer un pool/participant',
  'Create start event': 'Créer un événement de début',
  'Create task': 'Créer une tâche',
  Delete: 'Supprimer',
  'Distribute elements horizontally': 'Distribuer les éléments horizontalement',
  'Distribute elements vertically': 'Distribuer les éléments verticalement',
  'Divide into three lanes': 'Diviser en trois voies',
  'Divide into two lanes': 'Diviser en deux voies',
  Loop: 'Boucle',
  'Open {element}': 'Ouvrir {element}',
  'Parallel multi-instance': 'Multi-instance parallèle',
  'Participant multiplicity': 'Multiplicité du participant',
  'Search in diagram': 'Rechercher dans le diagramme',
  'Sequential multi-instance': 'Multi-instance séquentielle',
  'Toggle non-interrupting': 'Basculer en non interruptif',
};

function customTranslate(template: string, replacements?: Record<string, string>): string {
  const translated = FR_TRANSLATIONS[template] ?? template;
  const values = replacements ?? {};
  return translated.replace(/{([^}]+)}/g, (_match, key) => values[key] ?? `{${key}}`);
}

export const frTranslationsModule = {
  translate: ['value', customTranslate],
};
