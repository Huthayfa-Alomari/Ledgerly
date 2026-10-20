export type TrialBalanceAnalyticsRow = {
  id?: string;
  code?: string;
  name?: string;
  openingDebit: number;
  openingCredit: number;
  debit: number;
  credit: number;
  closingDebit: number;
  closingCredit: number;
  [key: string]: unknown;
};

export type TrialBalanceIssueSeverity = 'error' | 'warning' | 'info';

export type TrialBalanceIssue = {
  id: string;
  rowId: string | null;
  code: string;
  name: string;
  severity: TrialBalanceIssueSeverity;
  category: string;
  amount: number | null;
  title: string;
  detail: string;
};

export type TrialBalanceAnalyticsResult = {
  accountCount: number;
  totals: {
    openingDebit: number;
    openingCredit: number;
    movementDebit: number;
    movementCredit: number;
    closingDebit: number;
    closingCredit: number;
  };
  differences: { opening: number; movement: number; closing: number };
  balanced: boolean;
  tolerance: number;
  materiality: number;
  issues: TrialBalanceIssue[];
  counts: { error: number; warning: number; info: number; total: number };
};

export function analyzeTrialBalance(
  rows: TrialBalanceAnalyticsRow[],
  options?: { materiality?: number; tolerance?: number },
): TrialBalanceAnalyticsResult;
