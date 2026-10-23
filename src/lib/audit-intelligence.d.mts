export type AuditSeverity = 'high' | 'medium' | 'low';

export interface AuditIssue {
  id: string;
  severity: AuditSeverity;
  title: string;
  count: number;
  detail: string;
  action: string;
  rowNumbers?: number[];
  examples?: any[];
  clusters?: Array<{ accountCode: string; partyOrDescription: string; totalAmount: number; rowNumbers: number[] }>;
  fields?: string[];
  state?: 'needs-attention' | 'clear';
}

export interface JournalRow {
  rowNumber: number;
  date: string;
  dateRaw: string;
  description: string;
  accountCode: string;
  reference: string;
  counterparty?: string;
  invalidAmountFields?: string[];
  debit: number | null;
  credit: number | null;
  amount: number | null;
  classification: string;
  raw: Record<string, unknown>;
}

export interface NormalizedJournal {
  rows: JournalRow[];
  sourceCount: number;
  fieldsDetected: string[];
  warnings: string[];
}

export interface TrialBalanceCheck {
  rowCount: number;
  totals: {
    openingDebit: number;
    openingCredit: number;
    debit: number;
    credit: number;
    closingDebit: number;
    closingCredit: number;
  };
  openingDifference: number;
  movementDifference: number;
  availableFields: string[];
  unmappedFields: string[];
  openingDifference: number | null;
  movementDifference: number | null;
  closingDifference: number | null;
  issues: AuditIssue[];
  pass: boolean;
}

export interface JournalAnalysis {
  scannedCount: number;
  issueCount: number;
  counts: Record<string, number>;
  issues: AuditIssue[];
  monthEndSignals: number;
  hasRows: boolean;
}

export interface EvidenceLink {
  evidence: any;
  workpaper?: any;
  linked: boolean;
  reason: 'missing-reference' | 'unknown-reference' | 'ambiguous-reference' | 'linked';
}
export interface EvidenceLineage {
  workpaperCount: number;
  evidenceCount: number;
  linkedEvidenceCount: number;
  unlinkedEvidenceCount: number;
  workpapersWithoutEvidence: number;
  duplicateWorkpaperReferences: Array<{ reference: string; count: number; workpaperIds: any[] }>;
  ambiguousReferenceCount: number;
  links: EvidenceLink[];
  workpapers: Array<{ workpaper: any; evidenceCount: number; evidence: any[] }>;
}

export interface QualityCheck extends AuditIssue {
  state: 'needs-attention' | 'clear';
}
export interface QualityShield {
  checks: QualityCheck[];
  blockers: number;
  attentionCount: number;
  passed: boolean;
  tb: TrialBalanceCheck;
  lineage: EvidenceLineage;
  summary: { workpapers: number; evidence: number; findings: number; risks: number };
}

export interface PartnerDashboardRow {
  engagement: any;
  client?: any;
  workpaperCount: number;
  pendingWorkpapers: number;
  unlinkedEvidence: number;
  openFindings: number;
  highRisks: number;
  qualityAttention: number;
  qualityBlockers: number;
  outstandingRequests: number;
  overdueRequests: number;
  loggedHours: number;
  budgetHours: number | null;
  hoursBudgetVariance: number | null;
  actualLaborCostJod: number;
  contractualFeeJod: number | null;
  feeLessRecordedLaborCostJod: number | null;
  invoiceValueJod: number;
  recordedInvoiceCount: number;
  state: string;
}

export interface AssistantSuggestion {
  id?: string;
  priority: string;
  title: string;
  action: string;
  source: string;
}

export function parseAuditAmount(input: unknown): number | null;
export function normalizeJournalRows(records: Array<Record<string, unknown>>): NormalizedJournal;
export interface DataTrustOptions {
  expectedRowCount?: number;
  sourceTotals?: Record<string, number>;
  unmappedAccountCodes?: string[];
}
export interface JournalAnalysisOptions {
  approvalThreshold?: number;
  splitWindowDays?: number;
}
export function runDataTrustChecks(rows: any[], options?: DataTrustOptions): TrialBalanceCheck;
export function analyzeJournalEntries(rows: JournalRow[], options?: JournalAnalysisOptions): JournalAnalysis;
export function fingerprintTrialBalanceRows(rows: any[]): string;
export function buildEvidenceLineage(workpapers: any[], evidence: any[]): EvidenceLineage;
export function buildQualityShield(input: {
  workpapers?: any[];
  evidence?: any[];
  findings?: any[];
  risks?: any[];
  trialBalance?: any[];
  dataTrustOptions?: DataTrustOptions;
  currentSourceFingerprint?: string;
}): QualityShield;
export function buildPartnerDashboard(engagements: any[], clients: any[], database: Record<string, any>, operations?: Record<string, any>, options?: { asOfDate?: string }): PartnerDashboardRow[];
export interface EngagementClosureBlocker { id: string; title: string; count: number; detail: string }
export interface EngagementClosureResult { allowed: boolean; blockers: EngagementClosureBlocker[]; warnings: EngagementClosureBlocker[]; quality: QualityShield }
export function evaluateEngagementClosure(input?: { engagementId?: string; workpapers?: any[]; evidence?: any[]; findings?: any[]; risks?: any[]; trialBalance?: any[]; operations?: Record<string, any>; currentSourceFingerprint?: string; asOfDate?: string; dataTrustOptions?: DataTrustOptions }, policy?: { requireTrialBalance?: boolean; blockCriticalDataIssues?: boolean; requireApprovedWorkpapers?: boolean; requireEvidenceLinked?: boolean; requireReviewNotesResolved?: boolean; requireFindingsResolved?: boolean; blockStaleWorkpapers?: boolean }): EngagementClosureResult;
export function summarizeFindingsForAssistant(items: any[]): Array<string | AssistantSuggestion>;
