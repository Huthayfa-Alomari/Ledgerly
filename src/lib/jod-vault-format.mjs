import { fromFils, parseJodAmount, toFils } from './jod-money.mjs';

const FORMAT = 'ledgerly-workspace-fils-v1';
const TRIAL_BALANCE_FIELDS = [
  'openingDebit', 'openingCredit', 'debit', 'credit', 'closingDebit', 'closingCredit',
];
const ENGAGEMENT_FIELDS = [
  ['materiality', 'materialityFils'],
  ['feeJod', 'feeFils'],
];
const INVOICE_FIELDS = [
  ['amountJod', 'amountFils'],
  ['taxAmountJod', 'taxAmountFils'],
  ['totalJod', 'totalFils'],
  ['rateJod', 'rateFils'],
  ['comparativeJod', 'comparativeFils'],
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}
function numberToFils(value) {
  const parsed = parseJodAmount(value);
  if (parsed === null) return null;
  try { return toFils(parsed); } catch { return null; }
}
function encodeFields(row, fields) {
  const output = { ...row };
  for (const [source, stored] of fields) {
    if (!hasValue(output[source])) continue;
    const fils = numberToFils(output[source]);
    if (fils === null) continue;
    output[stored] = fils;
    output['__kind_' + stored] = typeof output[source] === 'string' ? 'string' : 'number';
    delete output[source];
  }
  return output;
}
function decodeFields(row, fields) {
  const output = { ...row };
  for (const [source, stored] of fields) {
    if (!Number.isSafeInteger(output[stored])) continue;
    const value = fromFils(output[stored]);
    output[source] = output['__kind_' + stored] === 'string' ? value.toFixed(3) : value;
    delete output[stored];
    delete output['__kind_' + stored];
  }
  return output;
}

/**
 * Transform selected monetary fields into integer fils in the encrypted persistence
 * format, while keeping the runtime/UI schema in JOD values.
 */
export function serializeJodVaultPayload(value) {
  const payload = clone(value);
  if (Array.isArray(payload?.trialBalance)) {
    payload.trialBalance = payload.trialBalance.map(row => {
      const output = { ...row };
      for (const field of TRIAL_BALANCE_FIELDS) {
        if (!hasValue(output[field])) continue;
        const fils = numberToFils(output[field]);
        if (fils === null) continue;
        output[field + 'Fils'] = fils;
        delete output[field];
      }
      return output;
    });
  }
  if (Array.isArray(payload?.engagements)) {
    payload.engagements = payload.engagements.map(row => encodeFields(row, ENGAGEMENT_FIELDS));
  }
  if (payload?.operations && Array.isArray(payload.operations.officeInvoices)) {
    payload.operations.officeInvoices = payload.operations.officeInvoices.map(row => encodeFields(row, INVOICE_FIELDS));
  }
  if (payload?.operations && Array.isArray(payload.operations.timeEntries)) {
    payload.operations.timeEntries = payload.operations.timeEntries.map(row => encodeFields(row, [['hourlyRateJod', 'hourlyRateFils'], ['amountJod', 'amountFils']]));
  }
  if (payload?.operations && payload.operations.accountMappings && typeof payload.operations.accountMappings === 'object') {
    const mappings = {};
    for (const [key, mapping] of Object.entries(payload.operations.accountMappings)) {
      mappings[key] = encodeFields(mapping || {}, [['comparativeJod', 'comparativeFils']]);
    }
    payload.operations.accountMappings = mappings;
  }
  return { __ledgerlyVaultFormat: FORMAT, payload };
}

export function deserializeJodVaultPayload(value) {
  if (!value || typeof value !== 'object' || value.__ledgerlyVaultFormat !== FORMAT || !value.payload) return value;
  const payload = clone(value.payload);
  if (Array.isArray(payload.trialBalance)) {
    payload.trialBalance = payload.trialBalance.map(row => {
      const output = { ...row };
      for (const field of TRIAL_BALANCE_FIELDS) {
        const stored = field + 'Fils';
        if (!Number.isSafeInteger(output[stored])) continue;
        output[field] = fromFils(output[stored]);
        delete output[stored];
      }
      return output;
    });
  }
  if (Array.isArray(payload.engagements)) {
    payload.engagements = payload.engagements.map(row => decodeFields(row, ENGAGEMENT_FIELDS));
  }
  if (payload.operations && Array.isArray(payload.operations.officeInvoices)) {
    payload.operations.officeInvoices = payload.operations.officeInvoices.map(row => decodeFields(row, INVOICE_FIELDS));
  }
  if (payload.operations && Array.isArray(payload.operations.timeEntries)) {
    payload.operations.timeEntries = payload.operations.timeEntries.map(row => decodeFields(row, [['hourlyRateJod', 'hourlyRateFils'], ['amountJod', 'amountFils']]));
  }
  if (payload.operations && payload.operations.accountMappings && typeof payload.operations.accountMappings === 'object') {
    const mappings = {};
    for (const [key, mapping] of Object.entries(payload.operations.accountMappings)) {
      mappings[key] = decodeFields(mapping || {}, [['comparativeJod', 'comparativeFils']]);
    }
    payload.operations.accountMappings = mappings;
  }
  return payload;
}

export function usesIntegerFilsVaultFormat(value) {
  return Boolean(value && typeof value === 'object' && value.__ledgerlyVaultFormat === FORMAT);
}
