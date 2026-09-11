import i18n from '../i18n';

export function processStatusLabel(status: string): string {
  return i18n.t(`processStatus.${status}`, { defaultValue: status });
}
