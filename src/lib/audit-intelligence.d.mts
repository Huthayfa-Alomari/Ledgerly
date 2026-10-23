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
  closingDifference: number;
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
  reason: 'missing-reference' | 'unknown-reference' | 'linked';
}
export interface EvidenceLineage {
  workpaperCount: number;
  evidenceCount: number;
  linkedEvidenceCount: number;
  unlinkedEvidenceCount: number;
  workpapersWithoutEvidence: number;
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
export function runDataTrustChecks(rows: any[]): TrialBalanceCheck;
export function analyzeJournalEntries(rows: JournalRow[]): JournalAnalysis;
export function buildEvidenceLineage(workpapers: any[], evidence: any[]): EvidenceLineage;
export function buildQualityShield(input: {
  workpapers?: any[];
  evidence?: any[];
  findings?: any[];
  risks?: any[];
  trialBalance?: any[];
}): QualityShield;
export function buildPartnerDashboard(engagements: any[], clients: any[], database: Record<string, any>): PartnerDashboardRow[];
export function summarizeFindingsForAssistant(items: any[]): Array<string | AssistantSuggestion>;
