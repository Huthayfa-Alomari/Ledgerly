import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  analyzeJournalEntries,
  buildEvidenceLineage,
  buildPartnerDashboard,
  buildQualityShield,
  normalizeJournalRows,
  runDataTrustChecks,
  summarizeFindingsForAssistant,
} from './lib/audit-intelligence.mjs';
import './AuditIntelligence.css';

type Engagement = { id: string; clientId: string; year: string; type: string; status: string; partner?: string; framework?: string };
type Client = { id: string; name: string };
type TBRow = { id: string; engagementId: string; code: string; name: string; openingDebit: number; openingCredit: number; debit: number; credit: number; closingDebit: number; closingCredit: number; source?: string };
type Workpaper = { id: string; engagementId: string; ref: string; title: string; status: string; procedure?: string; conclusion: string; reviewNotes?: string; updatedAt?: string; preparer?: string; reviewer?: string };
type Evidence = { id: string; engagementId: string; title: string; type: string; reference: string; workpaperRef: string; notes?: string; addedAt?: string; fileName?: string };
type Finding = { id: string; engagementId: string; title: string; criteria: string; condition: string; effect: string; recommendation: string; severity: string; status: string };
type Risk = { id: string; engagementId: string; title: string; area?: string; likelihood: string; impact: string; response: string; status: string };
type DBShape = { workpapers: Workpaper[]; evidence: Evidence[]; findings: Finding[]; risks: Risk[]; trialBalance: TBRow[] };
type RequestItem = { id: string; title: string; dueDate: string; done: boolean };
type Props = {
  engagementId?: string;
  engagements: Engagement[];
  clients: Client[];
  trialBalance: TBRow[];
  workpapers: Workpaper[];
  evidence: Evidence[];
  findings: Finding[];
  risks: Risk[];
  onOpenCopilot: () => void;
};
type ImportedJournal = { filename: string; rows: ReturnType<typeof normalizeJournalRows>['rows']; warnings: string[]; fieldsDetected: string[] };

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
  return new Intl.NumberFormat('ar-JO', { style: 'currency', currency: 'JOD', maximumFractionDigits: 2 }).format(value || 0);
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
function Kpi({ label, value, note }: { label: string; value: string | number; note: string }) {
  return <div className="audit-intel-kpi"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

export default function AuditIntelligence(props: Props) {
  const { engagementId, engagements, clients, trialBalance, workpapers, evidence, findings, risks, onOpenCopilot } = props;
  const [importedJournal, setImportedJournal] = useState<ImportedJournal | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState('');
  const [customRequest, setCustomRequest] = useState('');
  const [customDueDate, setCustomDueDate] = useState('');
  const [requests, setRequests] = useState<RequestItem[]>(() => REQUEST_STARTERS.map((title, i) => ({ id: 'request-' + i, title, dueDate: '', done: false })));
  const [requestNotice, setRequestNotice] = useState('');
  const engagement = engagements.find(row => row.id === engagementId);
  const client = clients.find(row => row.id === engagement?.clientId);
  const scoped = <T extends { engagementId: string }>(rows: T[]) => engagementId ? rows.filter(row => row.engagementId === engagementId) : [];
  const currentTB = scoped(trialBalance);
  const currentWorkpapers = scoped(workpapers);
  const currentEvidence = scoped(evidence);
  const currentFindings = scoped(findings);
  const currentRisks = scoped(risks);
  const dataTrust = useMemo(() => runDataTrustChecks(currentTB), [currentTB]);
  const lineage = useMemo(() => buildEvidenceLineage(currentWorkpapers, currentEvidence), [currentWorkpapers, currentEvidence]);
  const quality = useMemo(() => buildQualityShield({
    workpapers: currentWorkpapers,
    evidence: currentEvidence,
    findings: currentFindings,
    risks: currentRisks,
    trialBalance: currentTB,
  }), [currentWorkpapers, currentEvidence, currentFindings, currentRisks, currentTB]);
  const journalAnalysis = useMemo(() => importedJournal ? analyzeJournalEntries(importedJournal.rows) : null, [importedJournal]);
  const portfolio = useMemo(() => buildPartnerDashboard(engagements, clients, {
    workpapers, evidence, findings, risks, trialBalance,
  } as DBShape), [engagements, clients, workpapers, evidence, findings, risks, trialBalance]);
  const assistantItems = useMemo(() => {
    const checks = quality.checks.filter(row => row.count > 0);
    const journalChecks = (journalAnalysis?.issues || []).map(row => ({ ...row, severity: row.severity, count: row.count }));
    return summarizeFindingsForAssistant([...checks, ...journalChecks]);
  }, [quality, journalAnalysis]);
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
      const firstSheetName = workbook.SheetNames.find(name => {
        const sheet = workbook.Sheets[name];
        return sheet && XLSX.utils.sheet_to_json(sheet, { defval: '' }).length > 0;
      });
      if (!firstSheetName) throw new Error('لم يعثر على ورقة تحتوي بيانات.');
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheetName], { defval: '', raw: false });
      if (rawRows.length > 250000) throw new Error('الملف يتجاوز 250,000 صف. قسّم الملف لتفادي استهلاك الذاكرة.');
      const normalized = normalizeJournalRows(rawRows);
      if (!normalized.sourceCount) throw new Error('لا توجد صفوف قابلة للقراءة بعد صف العناوين.');
      setImportedJournal({ filename: file.name, rows: normalized.rows, warnings: normalized.warnings, fieldsDetected: normalized.fieldsDetected });
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'تعذر قراءة الملف. تحقق من سلامته ومن تنسيق الأعمدة.');
    } finally {
      setFileBusy(false);
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
    setRequests(previous => [...previous, { id: 'custom-' + Date.now(), title, dueDate: customDueDate, done: false }]);
    setCustomRequest('');
    setCustomDueDate('');
    setRequestNotice('أُضيف الطلب إلى القائمة المحلية. صدّر القائمة للاحتفاظ بها خارج هذه الجلسة.');
  }

  function exportRequests() {
    downloadCsv('ledgerly-client-document-requests.csv', [
      ['request_id', 'اسم المستند المطلوب', 'تاريخ الاستحقاق', 'الحالة'],
      ...requests.map(row => [row.id, row.title, row.dueDate, row.done ? 'مستلم للمراجعة' : 'بانتظار المستند']),
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
    </section>

    <section className="audit-card audit-intel-panel">
      <div className="audit-card-head">
        <div><h3>لوحة الشريك — مراقبة محفظة الملفات</h3><p className="muted-copy">ترتيب الملفات حسب عدد عناصر الجودة التي تحتاج مراجعة، ثم الملاحظات المفتوحة. لا يشكّل ترتيبًا لجودة رأي التدقيق.</p></div>
        <span className="soft-tag">Portfolio Monitor</span>
      </div>
      {portfolio.length ? <div className="audit-table-wrap"><table className="audit-table">
        <thead><tr><th>العميل / السنة</th><th>حالة الملف</th><th>أوراق غير معتمدة</th><th>أدلة بلا ربط</th><th>ملاحظات مفتوحة</th><th>مخاطر عالية</th><th>فحوص تحتاج مراجعة</th></tr></thead>
        <tbody>{portfolio.map(row => <tr key={row.engagement.id}>
          <td className="cell-strong">{row.client?.name || 'عميل غير محدد'}<small className="table-sub">{row.engagement.year} · {row.engagement.type}</small></td>
          <td>{row.state || 'غير محدد'}</td><td>{row.pendingWorkpapers}</td><td>{row.unlinkedEvidence}</td><td>{row.openFindings}</td><td>{row.highRisks}</td>
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
          <Kpi label="إجمالي المدين الختامي" value={formatMoney(dataTrust.totals.closingDebit)} note="من البيانات المحلية" />
          <Kpi label="إجمالي الدائن الختامي" value={formatMoney(dataTrust.totals.closingCredit)} note="من البيانات المحلية" />
          <Kpi label="فرق المدين والدائن" value={formatMoney(dataTrust.closingDifference)} note="المتوقع أن يقترب من الصفر" />
        </div>
        {dataTrust.issues.length ? <div className="audit-intel-issue-list">{dataTrust.issues.map(item => <article className="audit-intel-issue" key={item.id}>
          <div className="audit-intel-issue-top"><strong>{item.title}</strong><span className={'audit-pill ' + severityClass(item.severity)}>{severityName(item.severity)} · {item.count}</span></div>
          <p>{item.detail}</p><small><b>الخطوة المقترحة:</b> {item.action}</small>
        </article>)}</div> : <div className="audit-intel-clear">✓ لم تُطلق الفحوص الأساسية الحالية تنبيهات على ميزان المراجعة. هذا لا يثبت صحته بالكامل.</div>}
        <p className="audit-intel-footnote">تشمل القواعد اتزان إجمالي الأرصدة الختامية، تعريف الحسابات، الرموز المكررة، الحقول السالبة، والاختلاف بين الحركة والرصيد الختامي. يجب تفسير التنبيهات بحسب اصطلاحات ملف المصدر.</p>
      </section>

      <section className="audit-card audit-intel-panel">
        <div className="audit-card-head">
          <div><h3>2. محرك فحص شامل للقيود — Full-population Screening</h3><p className="muted-copy">استورد نسخة من دفتر الأستاذ أو سجل القيود. سيُفحص كل صف مقروء في المتصفح، دون رفع الملف أو حفظه في قاعدة بيانات Ledgerly.</p></div>
          <span className="soft-tag">CSV / XLSX / XLS</span>
        </div>
        <div className="audit-intel-import">
          <label className="audit-secondary audit-intel-file">اختيار ملف القيود<input type="file" accept=".csv,.xlsx,.xls" onChange={event => { void importJournal(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>
          {fileBusy && <span className="muted-copy">جارٍ قراءة الملف وفحصه محليًا…</span>}
          {importedJournal && <><span className="audit-intel-file-name">{importedJournal.filename} · {importedJournal.rows.length.toLocaleString('ar-JO')} صف</span><button className="audit-text-button danger-text" onClick={() => { setImportedJournal(null); setFileError(''); }}>إزالة نتائج الملف من الشاشة</button></>}
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
          </article>)}</div> : <div className="audit-intel-clear">✓ لم تظهر مؤشرات وفق القواعد الحالية. راجع صلاحية الاختبارات وملاءمتها للمهمة.</div>}
          <div className="stack-actions">
            <button className="audit-primary" onClick={() => downloadFile('ledgerly-journal-screening.json', JSON.stringify({ filename: importedJournal.filename, warnings: importedJournal.warnings, scannedCount: journalAnalysis.scannedCount, results: journalAnalysis }, null, 2), 'application/json;charset=utf-8')}>تصدير نتائج الفحص</button>
            <button className="audit-secondary" onClick={() => downloadCsv('ledgerly-journal-exceptions.csv', [
              ['rule_id', 'title', 'severity', 'count', 'row_numbers', 'detail', 'recommended_action'],
              ...journalAnalysis.issues.map(row => [row.id, row.title, severityName(row.severity), row.count, (row.rowNumbers ?? []).join(';'), row.detail, row.action]),
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
        </div>
        {lineage.workpapers.length ? <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>مرجع الورقة</th><th>ورقة العمل</th><th>الحالة</th><th>عدد الأدلة</th><th>أسماء الأدلة</th></tr></thead><tbody>{lineage.workpapers.map(row => <tr key={row.workpaper.id}>
          <td>{row.workpaper.ref || '—'}</td><td className="cell-strong">{row.workpaper.title}</td><td>{row.workpaper.status}</td><td>{row.evidenceCount}</td><td>{row.evidence.map(item => item.title).join('، ') || 'لا يوجد دليل مفهرس'}</td>
        </tr>)}</tbody></table></div> : <p className="muted-copy">لا توجد أوراق عمل في هذا الملف بعد.</p>}
        {lineage.unlinkedEvidenceCount > 0 && <div className="audit-intel-issue-list">{lineage.links.filter(row => !row.linked).map(row => <article key={row.evidence.id} className="audit-intel-issue">
          <strong>{row.evidence.title || row.evidence.fileName || 'دليل بلا عنوان'}</strong>
          <p>{row.reason === 'missing-reference' ? 'لم يُسجل مرجع ورقة عمل لهذا الدليل.' : 'مرجع ورقة العمل لا يطابق ورقة موجودة في الملف الحالي: ' + row.evidence.workpaperRef}</p>
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
          <button className="audit-primary" onClick={addRequest}>إضافة إلى القائمة</button>
        </div>
        {requestNotice && <p className="muted-copy" role="status">{requestNotice}</p>}
        <div className="audit-intel-request-list">{requests.map(row => <label key={row.id} className={row.done ? 'is-done' : ''}>
          <input type="checkbox" checked={row.done} onChange={event => setRequests(previous => previous.map(item => item.id === row.id ? { ...item, done: event.target.checked } : item))} />
          <span>{row.title}<small>{row.dueDate ? 'الاستحقاق: ' + row.dueDate : 'لم يُحدد تاريخ استحقاق'}</small></span>
          <b>{row.done ? 'مستلم للمراجعة' : 'بانتظار المستند'}</b>
        </label>)}</div>
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
    <p className="audit-intel-disclaimer">حالة التطوير: مركز محلي أولي قابل للاختبار. لا تستخدم بيانات عملاء حقيقية حتى اكتمال مراجعة التشفير، وصلاحيات المستخدمين، وعزل المكاتب، والنسخ الاحتياطي والاستعادة، والتحقق المهني من القواعد.</p>
  </div>;
}
