// Sous-ensemble de ISO-8601 (durées) couvrant les cas BPMN usuels :
// PnYnMnWnDTnHnMnS (ex. PT30M, PT2H, P1D, P3DT12H). Années/mois sont des
// approximations calendaires (365j / 30j) : suffisant pour un délai de
// minuteur, pas pour un calcul de date exact.
const ISO_DURATION_RE =
  /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseIsoDurationMs(input: string): number {
  const trimmed = input.trim();
  const match = ISO_DURATION_RE.exec(trimmed);
  if (!match || trimmed === 'P' || trimmed === 'PT' || trimmed === '') {
    throw new Error(`Durée ISO-8601 invalide : "${input}" (ex. PT30M, PT2H, P1D, P3DT12H)`);
  }

  const [, years, months, weeks, days, hours, minutes, seconds] = match;
  let ms = 0;
  if (years) ms += Number(years) * 365 * DAY_MS;
  if (months) ms += Number(months) * 30 * DAY_MS;
  if (weeks) ms += Number(weeks) * 7 * DAY_MS;
  if (days) ms += Number(days) * DAY_MS;
  if (hours) ms += Number(hours) * 60 * 60 * 1000;
  if (minutes) ms += Number(minutes) * 60 * 1000;
  if (seconds) ms += Number(seconds) * 1000;

  if (ms <= 0) throw new Error(`La durée doit être supérieure à zéro : "${input}"`);
  return ms;
}
