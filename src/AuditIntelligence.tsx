import { useMemo, useState } from 'react';
import AuditOperationsPanels from './AuditOperationsPanels';
import { buildWhatsappReminder } from './lib/audit-operations-engine.mjs';
import * as XLSX from 'xlsx';
import {
  analyzeJournalEntries,
  buildEvidenceLineage,
  buildPartnerDashboard,
  buildQualityShield,
  normalizeJournalRows,
  runDataTrustChecks,
  fingerprintTrialBalanceRows,
  summarizeFindingsForAssistant,
} from './lib/audit-intelligence.mjs';
import './AuditIntelligence.css';

type Engagement = { id: string; clientId: string; year: string; type: string; status: string; partner?: string; framework?: string };
type Client = { id: string; name: string };
type TBRow = { id: string; engagementId: string; code: string; name: string; openingDebit: number; openingCredit: number; debit: number; credit: number; closingDebit: number; closingCredit: number; source?: string; sourceFinancialFields?: string[] };
type Workpaper = { id: string; engagementId: string; ref: string; title: string; status: string; procedure?: string; conclusion: string; reviewNotes?: string; updatedAt?: string; preparer?: string; reviewer?: string; sourceFingerprint?: string };
type Evidence = { id: string; engagementId: string; title: string; type: string; reference: string; workpaperRef: string; notes?: string; addedAt?: string; fileName?: string };
type Finding = { id: string; engagementId: string; title: string; criteria: string; condition: string; effect: string; recommendation: string; severity: string; status: string; workpaperRef?: string; evidenceIds?: string[] };
type Risk = { id: string; engagementId: string; title: string; area?: string; likelihood: string; impact: string; response: string; status: string };
type DBShape = { workpapers: Workpaper[]; evidence: Evidence[]; findings: Finding[]; risks: Risk[]; trialBalance: TBRow[] };
type RequestItem = { id: string; title: string; dueDate: string; done: boolean; requiredForClosure?: boolean; engagementId?: string; clientName?: string; phone?: string };
type AuditOperationsState = { clientRequests: Array<Record<string, any>>; samplingRuns: Array<Record<string, any>>; accountMappings: Record<string, Record<string, any>>; bankProfiles: Array<Record<string, any>>; timeEntries: Array<Record<string, any>>; officeInvoices: Array<Record<string, any>>; fieldworkRecords: Array<Record<string, any>>; externalConfirmations: Array<Record<string, any>>; reportDrafts: Array<Record<string, any>> };
type Props = {
  engagementId?: string;
  engagements: Engagement[];
  clients: Client[];
  trialBalance: TBRow[];
  workpapers: Workpaper[];
  evidence: Evidence[];
  findings: Finding[];
  risks: Risk[];
  operations: AuditOperationsState;
  vaultPassphrase: string;
  onOperationsChange: (operations: AuditOperationsState) => void;
  onAddEvidence: (evidence: Evidence) => void;
  onOpenCopilot: () => void;
  onOpenReconciliation: () => void;
};
type ImportedJournal = { filename: string; sheetName: string; sheetNames: string[]; rows: ReturnType<typeof normalizeJournalRows>['rows']; warnings: string[]; fieldsDetected: string[] };

const REQUEST_STARTERS = [
  'ميزان المراجعة النهائي للفترة',
  'دفتر الأستاذ العام للفترة',
  'كشوف الحسابات البنكية والتسويات',
  'أعمار الذمم المدينة ومخصص الخسائر',
  'أعمار الذمم الدائنة وكشوف الموردين',
  'عينة فواتير المبيعات والمشتريات',
  'حركة الأصول الثابتة والإضافات والاستبعادات',
  'محاضر الإدارة والقرارات ذات الصلة بنطاق المهمة',
];

function formatMoney(value: number) {
  return new Intl.NumberFormat('ar-JO', { style: 'currency', currency: 'JOD', minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value || 0);
}
function downloadFile(name: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
}
function downloadCsv(name: string, rows: unknown[][]) {
  downloadFile(name, '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
function severityName(value: string) {
  return value === 'high' ? 'مرتفعة' : value === 'medium' ? 'متوسطة' : value === 'low' ? 'منخفضة' : value;
}
function severityClass(value: string) {
  return value === 'high' ? 'intel-severity-high' : value === 'medium' ? 'intel-severity-medium' : 'intel-severity-low';
}
function parseJournalWorksheet(workbook: XLSX.WorkBook, filename: string, sheetNames: string[], sheetName: string): ImportedJournal {
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet || !worksheet['!ref']) throw new Error('الورقة المحددة لا تحتوي نطاق بيانات قابلًا للقراءة.');
  const range = XLSX.utils.decode_range(worksheet['!ref']);
  const rowCount = range.e.r - range.s.r;
  if (rowCount > 250000) throw new Error('الورقة المحددة تتجاوز 250,000 صف بيانات. قسّم الملف لتفادي استهلاك الذاكرة.');
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '', raw: false, blankrows: true });
  rawRows.forEach((row, index) => Object.defineProperty(row, '__sourceRowNumber', { value: range.s.r + index + 2, enumerable: false }));
  const normalized = normalizeJournalRows(rawRows);
  if (!normalized.sourceCount) throw new Error('لا توجد صفوف قيود قابلة للقراءة بعد صف العناوين في الورقة المحددة.');
  return { filename, sheetName, sheetNames, rows: normalized.rows, warnings: normalized.warnings, fieldsDetected: normalized.fieldsDetected };
}
function Kpi({ label, value, note }: { label: string; value: string | number; note: string }) {
  return <div className="audit-intel-kpi"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

export default function AuditIntelligence(props: Props) {
  const { engagementId, engagements, clients, trialBalance, workpapers, evidence, findings, risks, operations, vaultPassphrase, onOperationsChange, onAddEvidence, onOpenCopilot, onOpenReconciliation } = props;
  const [importedJournal, setImportedJournal] = useState<ImportedJournal | null>(null);
  const [sourceWorkbook, setSourceWorkbook] = useState<{ filename: string; workbook: XLSX.WorkBook; sheetNames: string[] } | null>(null);
  const [approvalThreshold, setApprovalThreshold] = useState('');
  const [splitWindowDays, setSplitWindowDays] = useState('1');
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState('');
  const [customRequest, setCustomRequest] = useState('');
  const [customDueDate, setCustomDueDate] = useState('');
  const [customPhone, setCustomPhone] = useState('');
  const [customClientName, setCustomClientName] = useState('');
  const [requestNotice, setRequestNotice] = useState('');
  const engagement = engagements.find(row => row.id === engagementId);
  const client = clients.find(row => row.id === engagement?.clientId);
  const starterRequests: RequestItem[] = REQUEST_STARTERS.map((title, index) => ({ id: 'request-' + index, title, dueDate: '', done: false, engagementId, clientName: client?.name || '', phone: '' }));
  const storedRequests = (operations.clientRequests || []).filter(row => row.engagementId === engagementId) as RequestItem[];
  const requests: RequestItem[] = storedRequests.length ? storedRequests : starterRequests;
  const updateOperations = (patch: Partial<AuditOperationsState>) => onOperationsChange({ ...operations, ...patch });
  const saveRequests = (next: RequestItem[]) => {
    const otherRequests = (operations.clientRequests || []).filter(row => row.engagementId !== engagementId);
    updateOperations({ clientRequests: [...otherRequests, ...next] });
  };
  const scoped = <T extends { engagementId: string }>(rows: T[]) => engagementId ? rows.filter(row => row.engagementId === engagementId) : [];
  const currentTB = scoped(trialBalance);
  const currentWorkpapers = scoped(workpapers);
  const currentEvidence = scoped(evidence);
  const currentFindings = scoped(findings);
  const currentRisks = scoped(risks);
  const currentSourceFingerprint = useMemo(() => fingerprintTrialBalanceRows(currentTB), [currentTB]);
  const unmappedAccountCodes = useMemo(() => currentTB.filter(row => !String(operations.accountMappings?.[`${engagementId}::${row.code}`]?.lineKey ?? '').trim()).map(row => String(row.code ?? '').trim()).filter(Boolean), [currentTB, operations.accountMappings, engagementId]);
  const dataTrust = useMemo(() => runDataTrustChecks(currentTB, { unmappedAccountCodes }), [currentTB, unmappedAccountCodes]);
  const lineage = useMemo(() => buildEvidenceLineage(currentWorkpapers, currentEvidence, currentFindings), [currentWorkpapers, currentEvidence, currentFindings]);
  const currentReportDrafts = (operations.reportDrafts || []).filter(row => row.engagementId === engagementId);
  const quality = useMemo(() => buildQualityShield({
    workpapers: currentWorkpapers,
    evidence: currentEvidence,
    findings: currentFindings,
    risks: currentRisks,
    trialBalance: currentTB,
    reportDrafts: currentReportDrafts,
    accountMappings: operations.accountMappings,
    engagementId,
    currentSourceFingerprint,
  }), [currentWorkpapers, currentEvidence, currentFindings, currentRisks, currentTB, currentReportDrafts, operations.accountMappings, engagementId, currentSourceFingerprint]);
  const journalAnalysis = useMemo(() => importedJournal ? analyzeJournalEntries(importedJournal.rows, { approvalThreshold: Number(approvalThreshold), splitWindowDays: Number(splitWindowDays) }) : null, [importedJournal, approvalThreshold, splitWindowDays]);
  const portfolio = useMemo(() => buildPartnerDashboard(engagements, clients, {
    workpapers, evidence, findings, risks, trialBalance,
  } as DBShape, operations), [engagements, clients, workpapers, evidence, findings, risks, trialBalance, operations]);
  const assistantItems = useMemo(() => {
    const checks = quality.checks.filter(row => row.count > 0);
    const sourceTBChecks = quality.tb.issues.filter(row => row.count > 0).map(row => ({
      ...row,
      accountCode: (row.examples?.[0] as any)?.code || '',
      sourceFile: currentTB.find(tb => tb.source)?.source || '',
    }));
    const journalChecks = (journalAnalysis?.issues || []).map(row => ({
      ...row,
      severity: row.severity,
      count: row.count,
      sourceFile: importedJournal?.filename || '',
      sourceSheet: importedJournal?.sheetName || '',
    }));
    return summarizeFindingsForAssistant([...checks, ...sourceTBChecks, ...journalChecks]);
  }, [quality, journalAnalysis, importedJournal, currentTB]);
  const outstandingRequests = requests.filter(row => !row.done).length;

  async function importJournal(file?: File) {
    setFileError('');
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(extension || '')) {
      setFileError('اختر ملف CSV أو Excel بصيغة XLSX/XLS.');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setFileError('حجم الملف أكبر من 30 ميغابايت. قسّم الملف أو صدّره بحجم أصغر.');
      return;
    }
    setFileBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const sheetNames = workbook.SheetNames.filter(name => {
        const worksheet = workbook.Sheets[name];
        if (!worksheet || !worksheet['!ref']) return false;
        const range = XLSX.utils.decode_range(worksheet['!ref']);
        return range.e.r > range.s.r;
      });
      if (!sheetNames.length) throw new Error('لم يعثر على ورقة تحتوي صفوف بيانات بعد العناوين.');
      const preferred = sheetNames.find(name => /(journal|ledger|transactions|قيود|دفتر|حركات|الأستاذ|الاستاذ)/i.test(name)) || sheetNames[0];
      setSourceWorkbook({ filename: file.name, workbook, sheetNames });
      setImportedJournal(parseJournalWorksheet(workbook, file.name, sheetNames, preferred));
    } catch (error) {
      setSourceWorkbook(null);
      setImportedJournal(null);
      setFileError(error instanceof Error ? error.message : 'تعذر قراءة الملف. تحقق من سلامته ومن تنسيق الأعمدة.');
    } finally {
      setFileBusy(false);
    }
  }

  function selectJournalWorksheet(sheetName: string) {
    if (!sourceWorkbook || !sourceWorkbook.sheetNames.includes(sheetName)) return;
    setFileError('');
    try {
      setImportedJournal(parseJournalWorksheet(sourceWorkbook.workbook, sourceWorkbook.filename, sourceWorkbook.sheetNames, sheetName));
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'تعذر تحليل الورقة المحددة.');
    }
  }

  function exportReport() {
    const report = {
      product: 'Ledgerly Audit Intelligence',
      generatedAt: new Date().toISOString(),
      disclaimer: 'قائمة استثناءات وفحوص إدارية مساعدة؛ ليست رأيًا تدقيقيًا ولا إثباتًا للاحتيال ولا بديلًا عن الحكم المهني.',
      engagement: engagement ? { client: client?.name, year: engagement.year, type: engagement.type, framework: engagement.framework } : null,
      dataTrust,
      journalFile: importedJournal ? { filename: importedJournal.filename, scannedCount: importedJournal.rows.length, warnings: importedJournal.warnings, analysis: journalAnalysis } : null,
      evidenceLineage: lineage,
      qualityShield: quality,
      requests,
      portfolio,
    };
    downloadFile('ledgerly-audit-intelligence-report.json', JSON.stringify(report, null, 2), 'application/json;charset=utf-8');
  }

  function addRequest() {
    const title = customRequest.trim();
    if (!title) { setRequestNotice('اكتب اسم المستند المطلوب أولًا.'); return; }
    const next: RequestItem = {
      id: 'request-' + Date.now(), title, dueDate: customDueDate, done: false, requiredForClosure: false,
      engagementId, clientName: customClientName.trim() || client?.name || '', phone: customPhone.trim(),
    };
    saveRequests([...requests, next]);
    setCustomRequest(''); setCustomDueDate(''); setCustomPhone(''); setCustomClientName('');
    setRequestNotice('تم حفظ الطلب داخل المخزن المشفّر. تحقق من رقم المستلم قبل فتح تذكير واتساب.');
  }

  function exportRequests() {
    downloadCsv('ledgerly-client-document-requests.csv', [
      ['request_id', 'engagement_id', 'اسم العميل', 'اسم المستند المطلوب', 'تاريخ الاستحقاق', 'رقم التواصل', 'إلزامي للإقفال', 'الحالة'],
      ...requests.map(row => [row.id, row.engagementId || '', row.clientName || '', row.title, row.dueDate, row.phone || '', row.requiredForClosure ? 'نعم' : 'لا', row.done ? 'مستلم للمراجعة' : 'بانتظار المستند']),
    ]);
  }

  function exportJordanTemplate() {
    downloadCsv('ledgerly-jordan-audit-document-index-template.csv', [
      ['رقم المستند / Document ID', 'تاريخ المستند / Document Date', 'اسم الطرف / Counterparty', 'رقم الحساب / Account Code', 'مدين JOD / Debit JOD', 'دائن JOD / Credit JOD', 'العملة / Currency', 'مرجع ورقة العمل / Workpaper Ref', 'ملاحظة المدقق / Auditor Note'],
      ['DOC-001', '2026-01-31', 'اسم تجريبي', '1000', '125.00', '0.00', 'JOD', 'A-100', 'مثال تدريبي فقط'],
    ]);
  }

  const portfolioAttention = portfolio.reduce((sum, row) => sum + row.qualityAttention, 0);
  const portfolioOpenFindings = portfolio.reduce((sum, row) => sum + row.openFindings, 0);
  const portfolioPendingPapers = portfolio.reduce((sum, row) => sum + row.pendingWorkpapers, 0);
  const portfolioClosureBlockers = portfolio.reduce((sum, row) => sum + row.closureBlockerCount, 0);
  const portfolioOverdueRequests = portfolio.reduce((sum, row) => sum + row.overdueRequests, 0);
  const portfolioLoggedHours = portfolio.reduce((sum, row) => sum + row.loggedHours, 0);
  const jsonFriendlyLineage = lineage.workpapers.map(row => ({
    workpaperRef: row.workpaper.ref,
    workpaper: row.workpaper.title,
    status: row.workpaper.status,
    evidenceCount: row.evidenceCount,
    evidence: row.evidence.map(item => item.title).join(' | '),
  }));

  return <div className="audit-intel-layout">
    <section className="audit-intel-hero">
      <div>
        <span className="audit-kicker">LEDGERLY · AUDIT INTELLIGENCE</span>
        <h2>مركز ذكاء التدقيق وجودة الملف</h2>
        <p>بوابة جودة البيانات، فحص شامل للقيود المستوردة، تتبّع الأدلة، فحص جاهزية الإقفال، ولوحة متابعة للشريك في مساحة واحدة.</p>
        <p className="audit-intel-hero-note">الفحوص تكتشف مؤشرات تستحق المراجعة ولا تثبت الأخطاء أو الاحتيال. البيانات تبقى على جهازك ما لم تصدّرها أو تستخدم وظيفة سحابية بشكل صريح.</p>
      </div>
      <div className="audit-intel-hero-actions">
        <button className="audit-primary" onClick={exportReport}>تصدير تقرير المركز</button>
        <button className="audit-secondary" onClick={onOpenCopilot}>فتح مساعد التدقيق</button>
      </div>
    </section>

    <section className="audit-intel-kpis">
      <Kpi label="ملفات التدقيق" value={portfolio.length} note="كل الملفات المحلية المسجلة" />
      <Kpi label="أوراق تنتظر الاعتماد" value={portfolioPendingPapers} note="وفق حالة الاعتماد المسجلة" />
      <Kpi label="ملاحظات غير مغلقة" value={portfolioOpenFindings} note="حالة إدارية تحتاج متابعة" />
      <Kpi label="تنبيهات جودة بالمحفظة" value={portfolioAttention} note="أنواع الفحوص التي تحتاج مراجعة" />
      <Kpi label="عوائق إقفال الملفات" value={portfolioClosureBlockers} note="نواقص يجب معالجتها قبل الإغلاق الإداري" />
      <Kpi label="طلبات مستندات متأخرة" value={portfolioOverdueRequests} note="طلبات غير مستلمة تجاوزت تاريخ الاستحقاق" />
      <Kpi label="ساعات عمل مسجلة" value={portfolioLoggedHours.toLocaleString("ar-JO", { maximumFractionDigits: 1 })} note="مجموع الساعات المسجلة في الارتباطات" />
    </section>

    <section className="audit-card audit-intel-panel">
      <div className="audit-card-head">
        <div><h3>لوحة الشريك — مراقبة محفظة الملفات</h3><p className="muted-copy">ترتيب الملفات حسب عدد عناصر الجودة التي تحتاج مراجعة، ثم الملاحظات المفتوحة. لا يشكّل ترتيبًا لجودة رأي التدقيق.</p></div>
        <span className="soft-tag">Portfolio Monitor</span>
      </div>
      {portfolio.length ? <div className="audit-table-wrap"><table className="audit-table">
        <thead><tr><th>العميل / السنة</th><th>حالة الملف</th><th>أوراق غير معتمدة</th><th>أدلة بلا ربط</th><th>ملاحظات مفتوحة</th><th>مخاطر عالية</th><th>عوائق الإقفال</th><th>طلبات مفتوحة</th><th>طلبات متأخرة</th><th>ساعات مسجلة / مخططة</th><th>تكلفة الوقت (د.أ)</th><th>قيمة الفواتير المسجلة (د.أ)</th><th>فحوص تحتاج مراجعة</th></tr></thead>
        <tbody>{portfolio.map(row => <tr key={row.engagement.id}>
          <td className="cell-strong">{row.client?.name || 'عميل غير محدد'}<small className="table-sub">{row.engagement.year} · {row.engagement.type}</small></td>
          <td>{row.state || 'غير محدد'}</td><td>{row.pendingWorkpapers}</td><td>{row.unlinkedEvidence}</td><td>{row.openFindings}</td><td>{row.highRisks}</td>
          <td><span className={'audit-pill ' + (row.closureBlockerCount ? 'risk-pill' : '')}>{row.closureBlockerCount}</span>{row.closureBlockerCount > 0 && <small className="table-sub">{row.closureBlockers.slice(0, 2).map(item => item.title).join('، ')}</small>}</td>
          <td>{row.outstandingRequests}</td><td><span className={'audit-pill ' + (row.overdueRequests ? 'risk-pill' : '')}>{row.overdueRequests}</span></td>
          <td>{row.loggedHours.toLocaleString("ar-JO", { maximumFractionDigits: 1 })} / {row.budgetHours === null ? '—' : row.budgetHours.toLocaleString("ar-JO", { maximumFractionDigits: 1 })}</td>
          <td>{formatMoney(row.actualLaborCostJod)}</td><td>{row.recordedInvoiceCount ? formatMoney(row.invoiceValueJod) : '—'}</td>
          <td><span className={'audit-pill ' + (row.qualityAttention ? 'risk-pill' : '')}>{row.qualityAttention}</span></td>
        </tr>)}</tbody>
      </table></div> : <p className="muted-copy">لا توجد ملفات تدقيق بعد. أنشئ ملفًا من قسم «ملفات التدقيق» لبدء المتابعة.</p>}
    </section>

    {!engagementId ? <section className="audit-card audit-intel-empty"><h3>اختر ملف تدقيق لتشغيل الفحوص التفصيلية</h3><p>تظهر لوحة الشريك لكل الملفات أعلاه. اختر ملفًا من المحدد أعلى الشاشة حتى لا تختلط موازين مراجعة وملاحظات ارتباطات مختلفة.</p></section> : <>
      <section className="audit-card audit-intel-panel">
        <div className="audit-card-head">
          <div><h3>1. بوابة الثقة بالبيانات — Data Trust Gate</h3><p className="muted-copy">{client?.name || 'العميل'} · {engagement?.year || ''} · فحص ميزان المراجعة المسجل للمهمة الحالية.</p></div>
          <span className={'audit-pill ' + (dataTrust.issues.length ? 'risk-pill' : '')}>{dataTrust.issues.length ? 'تحتاج مراجعة' : 'لا تنبيهات حالية'}</span>
        </div>
        <div className="audit-intel-kpis audit-intel-kpis-small">
          <Kpi label="صفوف الميزان" value={dataTrust.rowCount} note="الحسابات المستوردة" />
          <Kpi label="إجمالي المدين الختامي" value={dataTrust.availableFields.includes("closingDebit") ? formatMoney(dataTrust.totals.closingDebit) : "—"} note={dataTrust.availableFields.includes("closingDebit") ? "من البيانات المحلية" : "غير متاح في ملف المصدر"} />
          <Kpi label="إجمالي الدائن الختامي" value={dataTrust.availableFields.includes("closingCredit") ? formatMoney(dataTrust.totals.closingCredit) : "—"} note={dataTrust.availableFields.includes("closingCredit") ? "من البيانات المحلية" : "غير متاح في ملف المصدر"} />
          <Kpi label="فرق الأرصدة الافتتاحية" value={dataTrust.openingDifference === null ? "—" : formatMoney(dataTrust.openingDifference)} note={dataTrust.openingDifference === null ? "غير متاح في ملف المصدر" : "صافي المدين ناقص الدائن أول المدة"} />
          <Kpi label="فرق حركة الفترة" value={dataTrust.movementDifference === null ? "—" : formatMoney(dataTrust.movementDifference)} note={dataTrust.movementDifference === null ? "غير متاح في ملف المصدر" : "صافي المدين ناقص الدائن للحركة"} />
          <Kpi label="فرق المدين والدائن" value={dataTrust.closingDifference === null ? "—" : formatMoney(dataTrust.closingDifference)} note={dataTrust.closingDifference === null ? "غير متاح في ملف المصدر" : "المتوقع أن يقترب من الصفر"} />
        </div>
        {dataTrust.issues.length ? <div className="audit-intel-issue-list">{dataTrust.issues.map(item => <article className="audit-intel-issue" key={item.id}>
          <div className="audit-intel-issue-top"><strong>{item.title}</strong><span className={'audit-pill ' + severityClass(item.severity)}>{severityName(item.severity)} · {item.count}</span></div>
          <p>{item.detail}</p><small><b>الخطوة المقترحة:</b> {item.action}</small>{(item.rowNumbers ?? []).length > 0 && <small className="audit-intel-rowlist">صفوف المصدر: {(item.rowNumbers ?? []).slice(0, 15).join('، ')}{(item.rowNumbers ?? []).length > 15 ? ' …' : ''}</small>}
        </article>)}</div> : <div className="audit-intel-clear">✓ لم تُطلق الفحوص الأساسية الحالية تنبيهات على ميزان المراجعة. هذا لا يثبت صحته بالكامل.</div>}
        <p className="audit-intel-footnote">تشمل القواعد اتزان الأرصدة الافتتاحية وحركة الفترة والختامية، الحقول الناقصة أو غير الرقمية، الصفوف المتطابقة، الرموز المكررة، وفحص حركة كل حساب. تُعرض المبالغ بالدينار الأردني إلى ثلاث منازل عشرية، ويجب تفسير التنبيهات بحسب اصطلاحات ملف المصدر.</p>
      </section>

      <section className="audit-card audit-intel-panel">
        <div className="audit-card-head">
          <div><h3>2. محرك فحص شامل للقيود — Full-population Screening</h3><p className="muted-copy">استورد دفتر الأستاذ أو سجل القيود، ثم اختر الورقة الصحيحة إذا تعددت الأوراق. يفحص Ledgerly جميع الصفوف المقروءة في الورقة المحددة محليًا، دون رفع ملف المصدر أو حفظه في قاعدة بيانات.</p></div>
          <span className="soft-tag">CSV / XLSX / XLS</span>
        </div>
        <div className="audit-intel-import">
          <label className="audit-secondary audit-intel-file">اختيار ملف القيود<input type="file" accept=".csv,.xlsx,.xls" onChange={event => { void importJournal(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>
          {fileBusy && <span className="muted-copy">جارٍ قراءة الملف وفحصه محليًا…</span>}
          {importedJournal && importedJournal.sheetNames.length > 1 && <label className="audit-field audit-intel-sheet-select"><span>ورقة البيانات التي سيتم فحصها بالكامل</span><select value={importedJournal.sheetName} onChange={event => selectJournalWorksheet(event.target.value)}>{importedJournal.sheetNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label>}
          {importedJournal && <><span className="audit-intel-file-name">{importedJournal.filename} · الورقة: {importedJournal.sheetName} · {importedJournal.rows.length.toLocaleString('ar-JO')} صف</span><button className="audit-text-button danger-text" onClick={() => { setImportedJournal(null); setSourceWorkbook(null); setFileError(''); }}>إزالة نتائج الملف من الشاشة</button></>}
        </div>
        <div className="audit-intel-screening-options">
          <label className="audit-field"><span>حد الموافقة للمبالغ المجمعة (د.أ.) — اختياري</span><input type="number" min="0" step="0.001" inputMode="decimal" value={approvalThreshold} onChange={event => setApprovalThreshold(event.target.value)} placeholder="اتركه فارغًا لتعطيل فحص التجزئة" /></label>
          <label className="audit-field"><span>نافذة تجميع المعاملات</span><select value={splitWindowDays} onChange={event => setSplitWindowDays(event.target.value)}><option value="0">نفس اليوم</option><option value="1">يوم واحد</option><option value="3">3 أيام</option><option value="7">7 أيام</option><option value="30">30 يومًا</option></select></label>
        </div>
        {fileError && <p className="audit-warning" role="alert">{fileError}</p>}
        {importedJournal && journalAnalysis && <>
          <div className="audit-intel-kpis audit-intel-kpis-small">
            <Kpi label="الصفوف المفحوصة" value={journalAnalysis.scannedCount.toLocaleString('ar-JO')} note="جميع الصفوف المقروءة" />
            <Kpi label="مجموع مؤشرات الفحص" value={journalAnalysis.issueCount.toLocaleString('ar-JO')} note="قد يتكرر الصف عبر أكثر من قاعدة" />
            <Kpi label="مؤشرات الشهر الأخير" value={journalAnalysis.monthEndSignals} note="إشارة للفحص لا مخالفة بحد ذاتها" />
            <Kpi label="الأعمدة المكتشفة" value={importedJournal.fieldsDetected.length} note="من الصف الأول" />
          </div>
          {importedJournal.warnings.length > 0 && <div className="audit-warning"><strong>ملاحظات الاستيراد</strong><ul>{importedJournal.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
          {journalAnalysis.issues.length ? <div className="audit-intel-issue-list">{journalAnalysis.issues.map(item => <article className="audit-intel-issue" key={item.id}>
            <div className="audit-intel-issue-top"><strong>{item.title}</strong><span className={'audit-pill ' + severityClass(item.severity)}>{severityName(item.severity)} · {item.count} صف</span></div>
            <p>{item.detail}</p><small><b>الخطوة المقترحة:</b> {item.action}</small>
            {(item.rowNumbers ?? []).length > 0 && <small className="audit-intel-rowlist">أمثلة الصفوف: {(item.rowNumbers ?? []).slice(0, 15).join('، ')}{(item.rowNumbers ?? []).length > 15 ? ' …' : ''}</small>}
            {item.clusters?.slice(0, 10).map((cluster, index) => <small className="audit-intel-rowlist" key={`${item.id}-cluster-${index}`}>مجموعة محتملة {index + 1}: الصفوف {cluster.rowNumbers.join('، ')} · الإجمالي {formatMoney(cluster.totalAmount)} · {cluster.partyOrDescription}</small>)}
          </article>)}</div> : <div className="audit-intel-clear">✓ لم تظهر مؤشرات وفق القواعد الحالية. راجع صلاحية الاختبارات وملاءمتها للمهمة.</div>}
          <div className="stack-actions">
            <button className="audit-primary" onClick={() => downloadFile('ledgerly-journal-screening.json', JSON.stringify({ filename: importedJournal.filename, sourceSheet: importedJournal.sheetName, warnings: importedJournal.warnings, screeningParameters: { approvalThreshold: Number(approvalThreshold) > 0 ? Number(approvalThreshold) : null, splitWindowDays: Number(splitWindowDays) }, scannedCount: journalAnalysis.scannedCount, results: journalAnalysis }, null, 2), 'application/json;charset=utf-8')}>تصدير نتائج الفحص</button>
            <button className="audit-secondary" onClick={() => downloadCsv('ledgerly-journal-exceptions.csv', [
              ['source_file', 'source_sheet', 'rule_id', 'title', 'severity', 'count', 'row_numbers', 'detail', 'recommended_action'],
              ...journalAnalysis.issues.map(row => [importedJournal.filename, importedJournal.sheetName, row.id, row.title, severityName(row.severity), row.count, (row.rowNumbers ?? []).join(';'), row.detail, row.action]),
            ])}>تنزيل مؤشرات الفحص CSV</button>
          </div>
        </>}
        <p className="audit-intel-footnote">حد الاستيراد 30 ميغابايت و250,000 صف. قواعد المبالغ الكبيرة نسبة إلى وسيط الملف، وليست بديلًا عن الأهمية النسبية التي يحددها المدقق. تطابق الصفوف أو توقيت نهاية الشهر لا يثبت تكرارًا غير مشروع أو احتيالًا.</p>
      </section>

      <section className="audit-card audit-intel-panel">
        <div className="audit-card-head">
          <div><h3>3. خريطة الأدلة — Evidence Lineage</h3><p className="muted-copy">ربط مرجعي بين الأدلة وأوراق العمل المسجلة في المهمة. الارتباط الإداري لا يثبت الكفاية أو الملاءمة.</p></div>
          <span className="soft-tag">{lineage.linkedEvidenceCount} / {lineage.evidenceCount} مرتبط</span>
        </div>
        <div className="audit-intel-kpis audit-intel-kpis-small">
          <Kpi label="أوراق العمل" value={lineage.workpaperCount} note="ضمن الملف الحالي" />
          <Kpi label="الأدلة المفهرسة" value={lineage.evidenceCount} note="السجلات التي أضيفت" />
          <Kpi label="أدلة بلا مرجع مطابق" value={lineage.unlinkedEvidenceCount} note="تحتاج مراجعة" />
          <Kpi label="أوراق بلا أدلة مفهرسة" value={lineage.workpapersWithoutEvidence} note="قد يكون ذلك مقبولًا بحسب الإجراء" />
          <Kpi label="ملاحظات بلا ورقة عمل" value={lineage.findingsWithoutWorkpaper} note="تحتاج ربطًا بإجراء تدقيق" />
          <Kpi label="ملاحظات بلا دليل" value={lineage.findingsWithoutEvidence} note="تحتاج مرجع دليل قابلًا للتتبع" />
        </div>
        {lineage.workpapers.length ? <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>مرجع الورقة</th><th>ورقة العمل</th><th>الحالة</th><th>عدد الأدلة</th><th>أسماء الأدلة</th></tr></thead><tbody>{lineage.workpapers.map(row => <tr key={row.workpaper.id}>
          <td>{row.workpaper.ref || '—'}</td><td className="cell-strong">{row.workpaper.title}</td><td>{row.workpaper.status}</td><td>{row.evidenceCount}</td><td>{row.evidence.map(item => item.title).join('، ') || 'لا يوجد دليل مفهرس'}</td>
        </tr>)}</tbody></table></div> : <p className="muted-copy">لا توجد أوراق عمل في هذا الملف بعد.</p>}
        {lineage.findingLinks?.length > 0 && <section className="audit-intel-finding-lineage"><div className="audit-card-head"><div><h4>سلسلة الملاحظات إلى ورقة العمل والدليل</h4><p className="muted-copy">يتم التحقق من وجود مرجع فريد لورقة العمل ودليل من الملف الحالي، ومن توافق مرجع الدليل مع ورقة العمل.</p></div><span className={'audit-pill ' + (lineage.findingLinks.some(row => !row.linked) ? 'risk-pill' : '')}>{lineage.fullyLinkedFindings} / {lineage.findingsCount} مرتبط بالكامل</span></div><div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>الملاحظة</th><th>ورقة العمل</th><th>الأدلة</th><th>حالة السلسلة</th></tr></thead><tbody>{lineage.findingLinks.map(row => <tr key={row.finding.id}><td className="cell-strong">{row.finding.title}</td><td>{row.finding.workpaperRef || '—'}<small className="table-sub">{row.workpaper?.title || (row.workpaperReason === 'ambiguous-workpaper-reference' ? 'مرجع ملتبس' : 'لا توجد ورقة عمل مطابقة')}</small></td><td>{row.linkedEvidence.map(item => item.title).join('، ') || '—'}{row.missingEvidenceIds.length > 0 && <small className="table-sub">مراجع غير موجودة: {row.missingEvidenceIds.join('، ')}</small>}</td><td><span className={'audit-pill ' + (row.linked ? '' : 'risk-pill')}>{row.linked ? 'مرتبط بالكامل' : [row.workpaperReason, row.evidenceReason].filter(value => value !== 'linked').join(' · ')}</span></td></tr>)}</tbody></table></div></section>}
        {lineage.unlinkedEvidenceCount > 0 && <div className="audit-intel-issue-list">{lineage.links.filter(row => !row.linked).map(row => <article key={row.evidence.id} className="audit-intel-issue">
          <strong>{row.evidence.title || row.evidence.fileName || 'دليل بلا عنوان'}</strong>
          <p>{row.reason === 'missing-reference' ? 'لم يُسجل مرجع ورقة عمل لهذا الدليل.' : row.reason === 'ambiguous-reference' ? 'مرجع ورقة العمل مستخدم لأكثر من ورقة؛ أوقف النظام الربط التلقائي كي لا يختار ورقة خطأ: ' + row.evidence.workpaperRef : 'مرجع ورقة العمل لا يطابق ورقة موجودة في الملف الحالي: ' + row.evidence.workpaperRef}</p>
        </article>)}</div>}
        <button className="audit-secondary" onClick={() => downloadCsv('ledgerly-evidence-lineage.csv', [
          ['evidence_title', 'evidence_type', 'reference', 'workpaper_reference', 'workpaper_title', 'workpaper_status', 'link_status'],
          ...lineage.links.map(row => [row.evidence.title, row.evidence.type, row.evidence.reference, row.evidence.workpaperRef, row.workpaper?.title || '', row.workpaper?.status || '', row.linked ? 'مرتبط' : row.reason]),
          ...jsonFriendlyLineage.filter(row => row.evidenceCount === 0).map(row => [row.workpaper, '', '', row.workpaperRef, row.workpaper, row.status, 'ورقة بلا دليل مفهرس']),
        ])}>تصدير مصفوفة تتبع الأدلة</button>
      </section>

      <section className="audit-card audit-intel-panel">
        <div className="audit-card-head">
          <div><h3>4. فاحص جودة ملف التدقيق — Quality Shield</h3><p className="muted-copy">فحص نواقص التوثيق والحالات الإدارية قبل الإقفال. لا يصدر حكمًا بأن الملف متوافق مع جميع المعايير.</p></div>
          <span className={'audit-pill ' + (quality.attentionCount ? 'risk-pill' : '')}>{quality.attentionCount ? quality.attentionCount + ' فحوص تحتاج مراجعة' : 'لا نواقص مرصودة'}</span>
        </div>
        <div className="audit-intel-issue-list">{quality.checks.map(item => <article className="audit-intel-issue" key={item.id}>
          <div className="audit-intel-issue-top"><strong>{item.title}</strong><span className={'audit-pill ' + (item.count ? severityClass(item.severity) : '')}>{item.count ? item.count + ' · ' + severityName(item.severity) : '✓ لا تنبيهات'}</span></div>
          <p>{item.detail}</p>{item.count > 0 && <small><b>الخطوة المقترحة:</b> {item.action}</small>}
        </article>)}</div>
        <div className="audit-intel-banner">تنبيه: هذا الفحص إداري ومساعد. إغلاق عناصره لا يثبت كفاية أدلة التدقيق أو الامتثال الكامل لمعايير التدقيق أو المتطلبات القانونية.</div>
      </section>

      <section className="audit-card audit-intel-panel">
        <div className="audit-card-head">
          <div><h3>5. أدوات مستندات السوق المحلي</h3><p className="muted-copy">قالب فهرسة عام لدعم الملفات العربية والإنجليزية والدينار الأردني، يمكن تهيئته وفق سياسة المكتب وبيانات العميل.</p></div>
          <span className="soft-tag">Arabic · English · JOD</span>
        </div>
        <div className="audit-intel-tools">
          <div><strong>قالب فهرسة مستندات ثنائي اللغة</strong><p>أعمدة لرقم المستند والتاريخ والطرف والحساب والمدين والدائن والعملة ومرجع ورقة العمل وملاحظة المدقق.</p><button className="audit-primary" onClick={exportJordanTemplate}>تنزيل قالب CSV</button></div>
          <div><strong>تطبيع التواريخ والأرقام العربية</strong><p>محرك استيراد القيود يتعامل مع الأرقام العربية الشائعة وصيغ المبالغ والفواصل والتواريخ المعروفة، ويعرض التحذيرات عندما تكون جهة المبلغ غير واضحة.</p></div>
        </div>
        <p className="audit-intel-footnote">القالب أداة عمل عامة وليس نموذج فاتورة رسميًا ولا قائمة نهائية بالمتطلبات القانونية أو الضريبية في الأردن. يجب تهيئته وفق الوثائق الرسمية ومهمة التدقيق.</p>
      </section>

      <section className="audit-card audit-intel-panel">
        <div className="audit-card-head">
          <div><h3>6. قائمة طلبات المستندات من العميل</h3><p className="muted-copy">إدارة محلية لقائمة المستندات المطلوبة وتواريخها. لا توجد بوابة عميل أو رفع ملفات مفعّل من هذه الشاشة؛ صدّر القائمة وأرسلها عبر قناة المكتب المعتمدة.</p></div>
          <span className={'audit-pill ' + (outstandingRequests ? 'risk-pill' : '')}>{outstandingRequests} طلبات بانتظار الاستلام</span>
        </div>
        <div className="audit-intel-request-add">
          <label className="audit-field"><span>المستند المطلوب</span><input value={customRequest} onChange={event => setCustomRequest(event.target.value)} placeholder="مثال: مطابقة رصيد الموردين بتاريخ الإقفال" /></label>
          <label className="audit-field"><span>تاريخ الاستحقاق</span><input type="date" value={customDueDate} onChange={event => setCustomDueDate(event.target.value)} /></label>
          <label className="audit-field"><span>اسم المستلم (اختياري)</span><input value={customClientName} onChange={event => setCustomClientName(event.target.value)} placeholder={client?.name || 'اسم جهة الاتصال'} /></label>
          <label className="audit-field"><span>رقم واتساب الدولي (اختياري)</span><input value={customPhone} onChange={event => setCustomPhone(event.target.value)} placeholder="+9627..." /></label>
          <button className="audit-primary" onClick={addRequest}>إضافة إلى القائمة</button>
        </div>
        {requestNotice && <p className="muted-copy" role="status">{requestNotice}</p>}
        <div className="audit-intel-request-list">{requests.map(row => {
          const reminder = buildWhatsappReminder({ phone: row.phone || '', firmName: 'مكتب التدقيق', clientName: row.clientName || client?.name || 'العميل', requestTitle: row.title, dueDate: row.dueDate });
          const requestToday = new Date();
          const requestTodayIso = `${requestToday.getFullYear()}-${String(requestToday.getMonth() + 1).padStart(2, '0')}-${String(requestToday.getDate()).padStart(2, '0')}`;
          const overdue = Boolean(!row.done && row.dueDate && row.dueDate < requestTodayIso);
          return <div key={row.id} className="audit-intel-request-item">
            <label className={row.done ? 'is-done' : ''}>
              <input type="checkbox" checked={row.done} onChange={event => saveRequests(requests.map(item => item.id === row.id ? { ...item, done: event.target.checked } : item))} />
              <span>{row.title}<small>{row.dueDate ? 'الاستحقاق: ' + row.dueDate : 'لم يُحدد تاريخ استحقاق'}{row.phone ? ' · ' + row.phone : ''}</small></span>
              <b>{row.done ? 'مستلم للمراجعة' : overdue ? 'متأخر' : 'بانتظار المستند'}</b>
            </label>
            <label className="audit-intel-required-request"><input type="checkbox" checked={Boolean(row.requiredForClosure)} onChange={event => saveRequests(requests.map(item => item.id === row.id ? { ...item, requiredForClosure: event.target.checked } : item))} /><span>مستند إلزامي لإقفال الملف</span></label>
            {row.phone && <a href={reminder.url} target="_blank" rel="noreferrer">فتح تذكير واتساب</a>}
          </div>;
        })}</div>
        <button className="audit-secondary" onClick={exportRequests}>تصدير قائمة الطلبات CSV</button>
      </section>

      <section className="audit-card audit-intel-panel">
        <div className="audit-card-head">
          <div><h3>7. مساعد الإجراءات المبني على الأدلة</h3><p className="muted-copy">يوصي بالخطوة التالية انطلاقًا من تنبيهات موجودة فعلًا في الملف. الاقتراحات آلية ومحددة القواعد، وليست استنتاجًا مهنيًا نهائيًا.</p></div>
          <span className="soft-tag">Source-grounded</span>
        </div>
        {Array.isArray(assistantItems) && assistantItems.length ? <div className="audit-intel-issue-list">{assistantItems.slice(0, 8).map((item, index) => {
          if (typeof item === 'string') return <article className="audit-intel-issue" key={index}><p>{item}</p></article>;
          return <article className="audit-intel-issue" key={item.id || index}>
            <div className="audit-intel-issue-top"><strong>{item.title}</strong><span className="soft-tag">{item.priority}</span></div>
            <p>{item.action}</p><small>النطاق: {item.source}</small>
          </article>;
        })}</div> : <p className="muted-copy">لا توجد اقتراحات متاحة قبل اختيار ملف.</p>}
        <div className="stack-actions"><button className="audit-primary" onClick={onOpenCopilot}>فتح مساعد التدقيق الحالي</button><button className="audit-secondary" onClick={() => downloadFile('ledgerly-next-audit-actions.json', JSON.stringify({ engagement: client?.name, year: engagement?.year, actions: assistantItems }, null, 2), 'application/json;charset=utf-8')}>تصدير خطوات المتابعة المقترحة</button></div>
      </section>
    </>}
    <AuditOperationsPanels
      engagementId={engagementId}
      engagement={engagement}
      client={client}
      trialBalance={currentTB}
      journalRows={importedJournal?.rows || []}
      journalFileName={importedJournal?.filename || ''}
      operations={operations}
      vaultPassphrase={vaultPassphrase}
      onOperationsChange={onOperationsChange}
      onAddEvidence={onAddEvidence}
      onOpenReconciliation={onOpenReconciliation}
    />
    <p className="audit-intel-disclaimer">حالة التطوير: مركز محلي أولي قابل للاختبار. لا تستخدم بيانات عملاء حقيقية حتى اكتمال مراجعة التشفير، وصلاحيات المستخدمين، وعزل المكاتب، والنسخ الاحتياطي والاستعادة، والتحقق المهني من القواعد.</p>
  </div>;
}
