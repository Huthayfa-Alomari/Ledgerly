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
/**
 * Strict shared JOD parser.
 * Accepts unambiguous dot-decimal numbers and correctly grouped comma thousands,
 * plus a small allow-list of currency prefixes. Ambiguous/unknown strings return
 * null and optionally call onWarning({ rawValue, reason }). Blank handling is explicit.
 */
export function parseJodAmount(value, options = {}) {
  const blankAsZero = options.blankAsZero !== false;
  const onWarning = typeof options.onWarning === 'function' ? options.onWarning : null;
  const invalid = (reason) => {
    try { onWarning?.({ rawValue: value, reason }); } catch { /* diagnostics must not break import */ }
    return null;
  };

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return invalid('non-finite-number');
    try { return roundJod(value); } catch { return invalid('amount-out-of-range'); }
  }

  let text = String(value ?? '')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    .trim();

  if (!text) return blankAsZero ? 0 : null;

  let parenthesized = false;
  if (text.startsWith('(') || text.endsWith(')')) {
    if (!/^\(.*\)$/.test(text)) return invalid('unbalanced-parentheses');
    parenthesized = true;
    text = text.slice(1, -1).trim();
  }

  // Only known currency prefixes are allowed. Unknown suffixes such as "CR"
  // are rejected rather than stripped to a plausible-looking number.
  text = text.replace(/^(?:JOD|JD|USD|EUR|د\.أ|د\.ا|ر\.د|[$€£])\s*/iu, '').trim();
  if (!text) return invalid('missing-numeric-value');

  const plainDecimal = /^[+-]?(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/;
  const groupedInteger = /^[+-]?[1-9]\d{0,2}(?:,\d{3}){2,}$/;
  const groupedDecimal = /^[+-]?[1-9]\d{0,2}(?:,\d{3})+\.\d{1,3}$/;
  const canonical = plainDecimal.test(text) || groupedInteger.test(text) || groupedDecimal.test(text);
  if (!canonical) return invalid('ambiguous-or-malformed-number');

  const numericText = text.replace(/,/g, '');
  const amount = Number(numericText);
  if (!Number.isFinite(amount)) return invalid('non-finite-number');

  try {
    return roundJod(parenthesized ? -Math.abs(amount) : amount);
  } catch {
    return invalid('amount-out-of-range');
  }
}
