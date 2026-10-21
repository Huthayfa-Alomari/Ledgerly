export const FILS_PER_JOD = 1000;

/** Convert Jordanian dinars to the nearest fils (1 JOD = 1,000 fils). */
export function toFils(value) {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return 0;
  const scaled = amount * FILS_PER_JOD;
  if (!Number.isFinite(scaled)) throw new RangeError('JOD amount exceeds the supported fils range');
  const fils = Math.round(Math.abs(scaled) + Number.EPSILON);
  if (!Number.isSafeInteger(fils)) throw new RangeError('JOD amount exceeds the supported fils range');
  return Math.sign(scaled) * fils;
}

/** Convert an integer fils value back to JOD. */
export function fromFils(fils) {
  if (!Number.isFinite(fils)) return 0;
  if (!Number.isSafeInteger(fils)) throw new RangeError('Fils value must be a safe integer');
  return fils / FILS_PER_JOD;
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


/**
 * Parse a user/import-supplied JOD amount without confusing decimal dots with
 * currency punctuation. Blank cells mean zero; malformed/non-finite values return null.
 */
export function parseJodAmount(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    try { return roundJod(value); } catch { return null; }
  }

  let text = String(value ?? '')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .trim();

  if (!text) return 0;

  text = text
    .replace(/(?:JOD|د\.ا|د\.أ|ر\.د)/gi, '')
    .replace(/[$€£]/g, '')
    .replace(/[٬,]/g, '')
    .replace(/[\s\u00a0]/g, '')
    .trim();

  if (!text) return 0;

  const parenthesized = /^\(.*\)$/.test(text);
  if (/[()]/.test(text) && !parenthesized) return null;
  if (parenthesized) text = text.slice(1, -1);

  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount)) return null;

  try {
    return roundJod(parenthesized ? -Math.abs(amount) : amount);
  } catch {
    return null;
  }
}
