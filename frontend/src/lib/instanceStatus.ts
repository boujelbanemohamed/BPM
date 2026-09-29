import i18n from '../i18n';

export function instanceStatusLabel(status: string): string {
  return i18n.t(`instanceStatus.${status}`, { defaultValue: status });
}

export function taskStatusLabel(status: string): string {
  return i18n.t(`taskStatus.${status}`, { defaultValue: status });
}
