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
