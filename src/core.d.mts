export const FIELD_ALIASES: Record<string, string[]>;
export function normalizeDigits(value: unknown): string;
export function normalizeHeader(value: unknown): string;
export function detectColumns(headers: string[]): Record<string, number>;
export function parseAmount(input: unknown, options?: { onWarning?: (warning: { rawValue: unknown; reason: string }) => void }): number | null;
export function parseDate(input: unknown): string | null;
export function normalizeRows(rows: unknown[], mapping: Record<string, number>): Array<{
  sourceRow: number;
  date: string | null;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  isOpeningBalance: boolean;
  numericWarnings: Array<{ field: string; reason: string; rawValue: string }>;
  raw: unknown;
}>;
export function validateRows(rows: Array<{
  sourceRow?: number;
  date: string | null;
  description: string;
  debit: number | null;
  credit: number | null;
  balance?: number | null;
  numericWarnings?: Array<{ field: string; reason: string; rawValue: string }>;
}>): Array<{ row: number; field: string; message: string; reason?: string; rawValue?: string }>;
export function signedAmount(row: { debit: number | null; credit: number | null; numericWarnings?: Array<unknown>; invalidAmountFields?: Array<string> }): number | null;
export function matchTransactions(bankRows: Array<{ date: string | null; description?: string; debit: number | null; credit: number | null; isOpeningBalance?: boolean; numericWarnings?: Array<unknown>; invalidAmountFields?: Array<string> }>, ledgerRows: Array<{ date: string | null; description?: string; debit: number | null; credit: number | null; isOpeningBalance?: boolean; numericWarnings?: Array<unknown>; invalidAmountFields?: Array<string> }>, options?: { amountTolerance?: number; dateWindowDays?: number }): {
  matches: Array<{ bankIndex: number; ledgerIndex: number; confidence: 'exact' | 'amount_date'; amountDifference: number; dateDifferenceDays: number | null }>;
  ambiguous: Array<{ bankIndex: number; ledgerIndices: number[]; ledgerIndicesTruncated?: boolean; reason: string }>;
  unmatchedBank: number[];
  unmatchedLedger: number[];
  summary: { bankCount: number; ledgerCount: number; matchedCount: number; ambiguousCount: number; unmatchedBankCount: number; unmatchedLedgerCount: number };
};
