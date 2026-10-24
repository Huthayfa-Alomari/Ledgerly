export function runAdvancedJournalTests(rows: any[], options?: { largeRoundedThreshold?: number; openingHour?: number; closingHour?: number }): any;
export function selectAuditSample(rows: any[], options?: { method?: 'random'|'systematic'|'mus'; sampleSize?: number; seed?: number; amountOf?: (row:any)=>number }): any;
export function financialStatementLines(): Array<{key:string;ar:string;en:string;statement:string;normal:string;group:string}>;
export function buildDraftFinancialStatements(trialBalance: any[], mappings?: Record<string, any>): any;
export function parseUblInvoiceXml(xml: string): any;
export function buildWhatsappReminder(input?: {phone?:string;firmName?:string;clientName?:string;requestTitle?:string;dueDate?:string}): {message:string;url:string};
export function calculateOfficeMetrics(engagements?: any[], timeEntries?: any[], invoices?: any[]): {totalHours:number;actualCost:number;contractedFees:number;billed:number;outstanding:number;unbilledContractedFees:number};
export function validateLocalWorkpaperTransition(workpaper: any, nextStatus: string, reviewerIdentity?: string): {valid:boolean;reason:string;requiresReview:boolean};
export function rollForwardWorkpapers(previousPapers: any[], newEngagementId: string, createId?: () => string): any[];
export function inferBankColumns(headers: string[], savedProfiles?: any[]): any;

export function suggestRiskPbcRequestsFromRisks(risks: any[]): Array<{ title: string; sourceRiskId: string; riskTitle: string; area: string }>;


export interface NormalizedInvoiceRecord {
  invoiceId: string;
  issueDate: string;
  issueDateRaw: string;
  supplierName: string;
  supplierTaxId: string;
  currency: string;
  payableAmount: number | null;
  taxAmount: number | null;
  sourceRowNumber: number;
  sourceFields: { invoice: string; date: string; supplier: string; amount: string; currency: string };
  invalidAmount: boolean;
}
export interface InvoiceRegisterResult {
  rows: NormalizedInvoiceRecord[];
  sourceCount: number;
  fieldsDetected: string[];
  warnings: string[];
}
export interface InvoiceMatchCandidate {
  method: string;
  rowNumbers: number[];
  journalReference: string;
  transactionDate: string;
  accountCodes: string[];
  descriptions: string[];
  counterpartyNames: string[];
  debitTotalJod: number;
  creditTotalJod: number;
  comparisonAmountJod: number;
  amountDifferenceJod: number;
  dateDifferenceDays: number | null;
  partyMatch: boolean;
  amountOk: boolean;
  dateOk: boolean;
  score: number;
}
export interface InvoiceMatchResult {
  status: string;
  statusLabel: string;
  message: string;
  invoiceId: string;
  invoiceDate: string;
  invoiceAmountJod: number | null;
  currency: string;
  currencyConfirmed: boolean;
  toleranceJod: number;
  dateWindowDays: number;
  candidates: InvoiceMatchCandidate[];
  exactReferenceRows?: number;
}
export function normalizeInvoiceRegisterRows(records: Array<Record<string, unknown>>): InvoiceRegisterResult;
export function matchInvoiceToJournal(invoice: Record<string, unknown>, journalRows?: any[], options?: { toleranceJod?: number; dateWindowDays?: number }): InvoiceMatchResult;
