export const FILS_PER_JOD = 1000;

/** Convert Jordanian dinars to the nearest fils (1 JOD = 1,000 fils). */
export function toFils(value) {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return 0;
  const scaled = amount * FILS_PER_JOD;
  if (!Number.isFinite(scaled)) return 0;
  return Math.sign(scaled) * Math.round(Math.abs(scaled) + Number.EPSILON);
}

/** Convert an integer fils value back to JOD. */
export function fromFils(fils) {
  return Number.isFinite(fils) ? fils / FILS_PER_JOD : 0;
}

/** Normalize a JOD amount to three decimal places at the application boundary. */
export function roundJod(value) {
  return fromFils(toFils(value));
}

/** Display JOD with all three currency decimals so fils are never hidden. */
export function formatJod(value) {
  return roundJod(value).toLocaleString('en-US', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}
