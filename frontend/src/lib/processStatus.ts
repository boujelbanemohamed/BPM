export const PROCESS_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  PUBLISHED: 'Publié',
  ARCHIVED: 'Archivé',
};

export function processStatusLabel(status: string): string {
  return PROCESS_STATUS_LABELS[status] ?? status;
}
