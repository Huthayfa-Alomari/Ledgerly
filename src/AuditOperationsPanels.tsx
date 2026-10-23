import { useMemo, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  runAdvancedJournalTests, selectAuditSample, financialStatementLines,
  buildDraftFinancialStatements, parseUblInvoiceXml, calculateOfficeMetrics, inferBankColumns,
} from './lib/audit-operations-engine.mjs';
import { buildDocxBytes } from './lib/docx-export.mjs';
import { saveLocalEvidenceFile } from './lib/local-evidence-files';
import { fingerprintTrialBalanceRows } from './lib/audit-intelligence.mjs';

type Row = Record<string, any>;
type Operations = {
  clientRequests: Row[]; samplingRuns: Row[]; accountMappings: Record<string, Row>;
  bankProfiles: Row[]; timeEntries: Row[]; officeInvoices: Row[];
  fieldworkRecords: Row[]; externalConfirmations: Row[]; reportDrafts: Row[];
};
type Engagement = { id: string; clientId: string; year: string; type: string; framework?: string; feeJod?: string; partner?: string };
type Client = { id: string; name: string; contact?: string };
type TBRow = { id: string; engagementId: string; code: string; name: string; openingDebit: number; openingCredit: number; debit: number; credit: number; closingDebit: number; closingCredit: number; source?: string };
type Evidence = { id: string; engagementId: string; title: string; type: string; reference: string; workpaperRef: string; notes: string; addedAt: string; attachmentId?: string; fileName?: string; fileType?: string; fileSize?: number };
type JournalRow = { rowNumber: number; date: string; dateRaw: string; description: string; accountCode: string; reference: string; debit: number | null; credit: number | null; amount: number | null; classification: string; raw: Record<string, unknown> };
type Props = {
  engagementId?: string; engagement?: Engagement; client?: Client; trialBalance: TBRow[];
  journalRows?: JournalRow[]; journalFileName?: string; operations: Operations; vaultPassphrase: string;
  onOperationsChange: (value: Operations) => void; onAddEvidence: (row: Evidence) => void; onOpenReconciliation: () => void;
};

const BANK_FIELDS = [
  ['date', 'التاريخ'], ['description', 'البيان'], ['debit', 'مدين'], ['credit', 'دائن'],
  ['amount', 'مبلغ واحد'], ['balance', 'الرصيد'], ['reference', 'المرجع'],
];
function id(prefix: string) {
  return prefix + '-' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 9));
}
function money(value: unknown) {
  const amount = Number(value);
  return new Intl.NumberFormat('ar-JO', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(Number.isFinite(amount) ? amount : 0) + ' د.أ';
}
function downloadBlob(name: string, data: BlobPart | Uint8Array, type: string) {
  const safeData: BlobPart = data instanceof Uint8Array
    ? (() => { const buffer = new ArrayBuffer(data.byteLength); new Uint8Array(buffer).set(data); return buffer; })()
    : data;
  const blob = new Blob([safeData], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}
function csvValue(value: unknown) {
  let item = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(item)) item = "'" + item;
  return '"' + item.replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
}
function downloadCSV(name: string, rows: unknown[][]) {
  downloadBlob(name, '\uFEFF' + rows.map(row => row.map(csvValue).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
function SignaturePad({ value, onChange }: { value: string; onChange: (data: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * canvas.width / bounds.width, y: (event.clientY - bounds.top) * canvas.height / bounds.height };
  }
  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current, ctx = canvas?.getContext('2d'), p = point(event);
    if (!canvas || !ctx || !p) return;
    canvas.setPointerCapture(event.pointerId); drawing.current = true;
    ctx.strokeStyle = '#17324d'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
  }
  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d'), p = point(event);
    if (ctx && p) { ctx.lineTo(p.x, p.y); ctx.stroke(); }
  }
  function finish() {
    if (!drawing.current) return;
    drawing.current = false;
    if (canvasRef.current) onChange(canvasRef.current.toDataURL('image/png'));
  }
  function clear() {
    const canvas = canvasRef.current, ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange('');
  }
  return <div className="audit-ops-signature">
    <canvas ref={canvasRef} width={720} height={180} onPointerDown={start} onPointerMove={draw} onPointerUp={finish} onPointerCancel={finish} aria-label="مساحة التوقيع" />
    <div><span>{value ? 'تم التقاط توقيع مرسوم في هذه الجلسة' : 'ارسم التوقيع بعد موافقة صاحب العلاقة'}</span><button type="button" className="audit-text-button" onClick={clear}>مسح التوقيع</button></div>
  </div>;
}

export default function AuditOperationsPanels(props: Props) {
  const { engagementId, engagement, client, trialBalance, journalRows = [], journalFileName = '', operations, vaultPassphrase, onOperationsChange, onAddEvidence, onOpenReconciliation } = props;
  const [sampleMethod, setSampleMethod] = useState<'random' | 'systematic' | 'mus'>('random');
  const [sampleSize, setSampleSize] = useState('25');
  const [sampleSeed, setSampleSeed] = useState('20261023');
  const [sampleMessage, setSampleMessage] = useState('');
  const [sampleError, setSampleError] = useState('');
  const [bankHeaders, setBankHeaders] = useState<string[]>([]);
  const [bankFileName, setBankFileName] = useState('');
  const [bankProfileName, setBankProfileName] = useState('');
  const [bankMapping, setBankMapping] = useState<Record<string, string>>({});
  const [bankNotice, setBankNotice] = useState('');
  const [ublInvoice, setUblInvoice] = useState<Row | null>(null);
  const [ublError, setUblError] = useState('');
  const [hours, setHours] = useState('1');
  const [hourlyRate, setHourlyRate] = useState('15.000');
  const [timeDescription, setTimeDescription] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceTotal, setInvoiceTotal] = useState('');
  const [invoiceDueDate, setInvoiceDueDate] = useState('');
  const [officeMessage, setOfficeMessage] = useState('');
  const [confirmKind, setConfirmKind] = useState('بنك');
  const [confirmParty, setConfirmParty] = useState('');
  const [confirmContact, setConfirmContact] = useState('');
  const [confirmDueDate, setConfirmDueDate] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [fieldNote, setFieldNote] = useState('');
  const [fieldLocation, setFieldLocation] = useState('');
  const [geoBusy, setGeoBusy] = useState(false);
  const [fieldSignature, setFieldSignature] = useState('');
  const [fieldPhoto, setFieldPhoto] = useState<File | null>(null);
  const [fieldMessage, setFieldMessage] = useState('');
  const [reportOpinion, setReportOpinion] = useState('غير محدد / To be determined');
  const [reportFirm, setReportFirm] = useState('مكتب التدقيق / Audit Firm');
  const [reportAuditor, setReportAuditor] = useState('');
  const [reportPeriodEnd, setReportPeriodEnd] = useState(engagement?.year ? engagement.year + '-12-31' : '');

  const update = (patch: Partial<Operations>) => onOperationsChange({ ...operations, ...patch });
  const currentTime = (operations.timeEntries || []).filter(row => row.engagementId === engagementId);
  const currentInvoices = (operations.officeInvoices || []).filter(row => row.engagementId === engagementId);
  const currentConfirmations = (operations.externalConfirmations || []).filter(row => row.engagementId === engagementId);
  const currentFieldRecords = (operations.fieldworkRecords || []).filter((row: Row) => row.engagementId === engagementId).slice(0, 12);
  const sampleHistory = (operations.samplingRuns || []).filter(row => row.engagementId === engagementId).slice(0, 8);
  const journalTests = useMemo(() => journalRows.length ? runAdvancedJournalTests(journalRows) : null, [journalRows]);
  const statement = useMemo(() => buildDraftFinancialStatements(trialBalance, operations.accountMappings || {}), [trialBalance, operations.accountMappings]);
  const metrics = calculateOfficeMetrics(engagement ? [engagement] : [], currentTime, currentInvoices);
  const reportDraft = (operations.reportDrafts || []).find(row => row.engagementId === engagementId) || {};
  const reportFirmName = String(reportDraft.firmName ?? reportFirm);
  const reportAuditorName = String(reportDraft.auditorName ?? reportAuditor);
  const reportEnd = String(reportDraft.periodEnd ?? reportPeriodEnd);
  const reportOpinionValue = String(reportDraft.opinion ?? reportOpinion);
  const statementRows: unknown[][] = [
    ['البند / Statement line', 'Current / الفترة الحالية (JOD)', 'Comparative / المقارن (JOD)'],
    ...statement.lines.map((item: Row) => [item.line.ar + ' / ' + item.line.en, Number(item.current).toFixed(3), Number(item.comparative).toFixed(3)]),
  ];
  const summaryRows = [
    ['ملخص / Summary', 'Current (JOD)', 'Comparative (JOD)'],
    ['الأصول / Assets', Number(statement.current.assets).toFixed(3), Number(statement.comparative.assets).toFixed(3)],
    ['الالتزامات / Liabilities', Number(statement.current.liabilities).toFixed(3), Number(statement.comparative.liabilities).toFixed(3)],
    ['حقوق الملكية / Equity', Number(statement.current.equity).toFixed(3), Number(statement.comparative.equity).toFixed(3)],
    ['الربح أو الخسارة / Profit or loss', Number(statement.current.profit).toFixed(3), Number(statement.comparative.profit).toFixed(3)],
    ['فرق المعادلة / Balance difference', Number(statement.current.balanceDifference).toFixed(3), Number(statement.comparative.balanceDifference).toFixed(3)],
  ];

  function updateReport(field: string, value: string) {
    const next = { ...reportDraft, engagementId, [field]: value, updatedAt: new Date().toISOString() };
    update({ reportDrafts: [...(operations.reportDrafts || []).filter(row => row.engagementId !== engagementId), next] });
    if (field === 'firmName') setReportFirm(value);
    if (field === 'auditorName') setReportAuditor(value);
    if (field === 'periodEnd') setReportPeriodEnd(value);
    if (field === 'opinion') setReportOpinion(value);
  }

  function exportWord(title: string, paragraphs: string[], tables: unknown[][][]) {
    const bytes = buildDocxBytes({ title, paragraphs, tables, language: 'ar-JO', rtl: true });
    downloadBlob('ledgerly-' + (title.includes('تقرير') ? 'draft-auditor-report' : 'draft-financial-statements') + '.docx',
      bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }

  function createReportExportSnapshot(kind: 'financial-statements' | 'auditor-report') {
    const generatedAt = new Date().toISOString();
    return {
      kind,
      generatedAt,
      sourceFingerprint: fingerprintTrialBalanceRows(trialBalance),
      sourceRowCount: trialBalance.length,
      statementSnapshot: {
        current: { ...statement.current },
        comparative: { ...statement.comparative },
        lines: statement.lines.map((item: Row) => ({
          key: String(item.line.key ?? item.line.en ?? item.line.ar ?? ''),
          current: Number(item.current) || 0,
          comparative: Number(item.comparative) || 0,
        })),
        unmappedAccountCount: statement.unmapped.length,
      },
    };
  }

  function saveReportExportSnapshot(snapshot: Row) {
    const next = { ...reportDraft, engagementId, lastExportSnapshot: snapshot, updatedAt: snapshot.generatedAt };
    update({ reportDrafts: [...(operations.reportDrafts || []).filter(row => row.engagementId !== engagementId), next] });
  }

  function exportStatements() {
    const snapshot = createReportExportSnapshot('financial-statements');
    exportWord('مسودة قوائم مالية / Draft Financial Statements', [
      'العميل / Client: ' + (client?.name || 'غير محدد / Not specified'),
      'السنة المالية / Financial year: ' + (engagement?.year || ''),
      'الإطار المحدد للمهمة / Framework: ' + (engagement?.framework || 'يحدد يدويًا / Set manually'),
      'مسودة مبنية على ربط يدوي للحسابات. يجب مراجعة التصنيف والعرض والإفصاحات والسياسات المحاسبية قبل الاعتماد.',
      'Draft based on manual account mappings. Classification, presentation, disclosures, and accounting policies require professional review.',
      'حسابات غير مربوطة / Unmapped accounts: ' + statement.unmapped.length,
      'بصمة بيانات المصدر / Source data fingerprint: ' + (snapshot.sourceFingerprint || 'غير متاحة — تحقق من بيانات المصدر'),
      'تاريخ التصدير / Export timestamp: ' + snapshot.generatedAt,
      'هذه البصمة وسيلة لتحديد تغير المصدر وليست ختمًا تشفيريًا أو اعتمادًا مهنيًا.',
    ], [statementRows as unknown[][], summaryRows as unknown[][]]);
    saveReportExportSnapshot(snapshot);
  }

  function exportAuditorReport() {
    const snapshot = createReportExportSnapshot('auditor-report');
    exportWord('مسودة تقرير مدقق الحسابات / Draft Independent Auditor Report', [
      'مسودة غير صالحة للإصدار أو التوقيع — يلزم استكمالها ومراجعتها من الشريك المسؤول.',
      'DRAFT — NOT FOR ISSUE OR SIGNATURE. Complete and review with the engagement partner.',
      'العميل / Entity: ' + (client?.name || '[اسم المنشأة / Entity name]'),
      'الفترة / Reporting period: ' + (reportEnd || '[تاريخ نهاية الفترة / Period end]'),
      'مكتب التدقيق / Audit firm: ' + reportFirmName,
      'اسم المدقق / Auditor name: ' + (reportAuditorName || '[يستكمل يدويًا / Complete manually]'),
      'الرأي المختار مبدئيًا / Draft opinion selection: ' + reportOpinionValue,
      'بصمة بيانات المصدر / Source data fingerprint: ' + (snapshot.sourceFingerprint || 'غير متاحة — تحقق من بيانات المصدر'),
      'تاريخ التصدير / Export timestamp: ' + snapshot.generatedAt,
      'أساس الرأي / Basis for Opinion: يستكمل الشريك أساس الرأي بعد تقييم الأدلة والإفصاحات والمتطلبات النظامية.',
      'Responsibilities / المسؤوليات: يستكمل النص بحسب المعيار المنطبق والتشريعات الحالية وعقد المهمة.',
      'هذا قالب بنيوي ثنائي اللغة للتجهيز فقط؛ لا يقرر ملاءمة الرأي ولا يضمن الامتثال الكامل لـ ISA 700.',
      'This bilingual structural template is for preparation only; it does not select the appropriate opinion or guarantee full ISA 700 compliance.',
    ], [[
      ['Section / القسم', 'Draft guidance / إرشاد للمسودة'],
      ['Opinion / الرأي', reportOpinionValue],
      ['Basis for opinion / أساس الرأي', 'To be completed and reviewed by the engagement partner.'],
      ['Management responsibilities / مسؤوليات الإدارة', 'Complete with the applicable financial reporting framework.'],
      ['Auditor responsibilities / مسؤوليات المدقق', 'Complete and compare against current applicable ISA wording.'],
      ['Date, signature, address / التاريخ والتوقيع والعنوان', 'Manual completion required.'],
    ]]);
    saveReportExportSnapshot(snapshot);
  }

  async function runSample() {
    setSampleError(''); setSampleMessage('');
    try {
      if (!engagementId) throw new Error('اختر ملف تدقيق أولًا.');
      const useJournal = journalRows.length > 0;
      const population = useJournal ? journalRows : trialBalance;
      const result = selectAuditSample(population, {
        method: sampleMethod,
        sampleSize: Number(sampleSize),
        seed: Number(sampleSeed),
        amountOf: (row: Row) => useJournal
          ? Math.max(Math.abs(Number(row.debit) || 0), Math.abs(Number(row.credit) || 0), Math.abs(Number(row.amount) || 0))
          : Math.abs((Number(row.closingDebit) || 0) - (Number(row.closingCredit) || 0)),
      });
      const record = {
        id: id('sample'), engagementId, clientName: client?.name || '', source: useJournal ? journalFileName : 'ميزان المراجعة',
        method: result.method, seed: result.seed, requestedSampleSize: result.requestedSampleSize,
        populationSize: result.populationSize, selectedItemCount: result.selectedItemCount,
        populationTotal: result.populationTotal, interval: result.interval, randomStart: result.randomStart,
        createdAt: new Date().toISOString(), note: result.note,
        selections: result.selections.map((item: Row) => ({
          index: item.index, rowNumber: item.row?.rowNumber ?? item.index,
          code: item.row?.accountCode ?? item.row?.code ?? '', description: item.row?.description ?? item.row?.name ?? '',
          amount: Number(item.row?.amount ?? item.row?.debit ?? item.row?.closingDebit ?? 0),
          hits: item.hits || [],
        })),
      };
      update({ samplingRuns: [record, ...(operations.samplingRuns || [])] });
      setSampleMessage('تم حفظ سجل الاختيار في مساحة العمل المشفّرة. راجع تعريف المجتمع وطريقة الاختيار قبل استخدام العينة مهنيًا.');
    } catch (error) { setSampleError(error instanceof Error ? error.message : 'تعذر إنشاء العينة.'); }
  }


  async function importBankHeaders(file?: File) {
    setBankNotice('');
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) { setBankNotice('ملف كشف البنك يتجاوز 30 ميغابايت.'); return; }
    try {
      const ext = file.name.split('.').pop()?.toLowerCase();
      let headers: string[] = [];
      if (ext === 'csv') {
        const raw = (await file.text()).replace(/^\uFEFF/, '');
        headers = (raw.split(/\r?\n/, 1)[0] || '').split(',').map(item => item.trim().replace(/^"|"$/g, '')).filter(Boolean);
      } else if (ext === 'xlsx' || ext === 'xls') {
        const book = XLSX.read(await file.arrayBuffer(), { type: 'array', sheetRows: 2 });
        const sheet = book.Sheets[book.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
        headers = (rows[0] || []).map(item => String(item ?? '').trim()).filter(Boolean);
      } else { throw new Error('اختر ملف CSV أو Excel.'); }
      if (!headers.length) throw new Error('لم يتم العثور على صف عناوين واضح.');
      const inferred = inferBankColumns(headers, operations.bankProfiles || []);
      const foundProfile = (operations.bankProfiles || []).find(profile => profile.name === inferred.matchedSavedProfile);
      setBankHeaders(headers); setBankFileName(file.name); setBankProfileName(foundProfile?.name || file.name.replace(/\.[^.]+$/, ''));
      setBankMapping({ ...inferred.mapping });
      setBankNotice(inferred.matchedSavedProfile ? 'تم تحميل تعيين محفوظ سابقًا: ' + inferred.matchedSavedProfile : 'تم اقتراح تعيين أولي؛ راجع كل عمود قبل استخدامه.');
    } catch (error) { setBankNotice(error instanceof Error ? error.message : 'تعذر قراءة عناوين كشف البنك.'); }
  }

  function saveBankProfile() {
    if (!bankHeaders.length) { setBankNotice('ارفع ملفًا لاستخراج العناوين أولًا.'); return; }
    const signature = bankHeaders.map(header => String(header).toLowerCase().replace(/[\s_\-./،,:]/g, '')).join('|');
    const profile = { id: id('bank-profile'), name: bankProfileName.trim() || 'قالب بنك', headers: bankHeaders, mapping: bankMapping, headerSignature: signature, updatedAt: new Date().toISOString() };
    const profiles = (operations.bankProfiles || []).filter(row => row.headerSignature !== signature);
    update({ bankProfiles: [profile, ...profiles] });
    setBankNotice('تم حفظ تعيين الأعمدة داخل المخزن المشفّر محليًا. راجعه إذا تغير تنسيق البنك أو كشف الحساب.');
  }

  async function importUbl(file?: File) {
    setUblInvoice(null); setUblError('');
    if (!file) return;
    try {
      const parsed = parseUblInvoiceXml(await file.text());
      setUblInvoice({ ...parsed, sourceName: file.name });
    } catch (error) { setUblError(error instanceof Error ? error.message : 'تعذر تحليل ملف XML.'); }
  }

  function addUblAsEvidence() {
    if (!ublInvoice || !engagementId) return;
    const entry: Evidence = {
      id: id('evidence-ubl'), engagementId, title: 'ملخص فاتورة UBL: ' + (ublInvoice.invoiceId || ublInvoice.sourceName),
      type: 'بيانات مستخرجة', reference: String(ublInvoice.invoiceId || ublInvoice.sourceName || ''),
      workpaperRef: '', notes: JSON.stringify(ublInvoice, null, 2), addedAt: new Date().toISOString(),
    };
    onAddEvidence(entry);
    setUblError('أضيف ملخص حقول XML كدليل مفهرس. يجب إرفاق المستند الأصلي والتحقق من سلامته يدويًا أيضًا.');
  }

  function addTimeEntry() {
    const h = Number(hours), rate = Number(hourlyRate);
    if (!engagementId || !Number.isFinite(h) || h <= 0 || !Number.isFinite(rate) || rate < 0) { setOfficeMessage('أدخل ساعات موجبة ومعدلًا بالساعة غير سالب.'); return; }
    const entry = { id: id('time'), engagementId, date: new Date().toISOString().slice(0, 10), staff: reportAuditorName || 'مستخدم محلي', description: timeDescription.trim() || 'عمل تدقيق', hours: h, hourlyRateJod: rate.toFixed(3), amountJod: (h * rate).toFixed(3) };
    update({ timeEntries: [entry, ...(operations.timeEntries || [])] });
    setOfficeMessage('تم حفظ ساعات العمل في المخزن المشفّر.'); setTimeDescription('');
  }

  function addInvoice() {
    const total = Number(invoiceTotal);
    if (!engagementId || !Number.isFinite(total) || total <= 0 || !invoiceNo.trim()) { setOfficeMessage('أدخل رقم فاتورة ومبلغًا موجبًا.'); return; }
    const invoice = { id: id('office-invoice'), engagementId, invoiceNo: invoiceNo.trim(), clientName: client?.name || '', totalJod: total.toFixed(3), dueDate: invoiceDueDate, status: 'غير مدفوعة', createdAt: new Date().toISOString() };
    update({ officeInvoices: [invoice, ...(operations.officeInvoices || [])] });
    setOfficeMessage('تم حفظ سجل الفاتورة محليًا؛ لم يتم إصدار فاتورة ضريبية أو إرسالها إلكترونيًا.');
    setInvoiceNo(''); setInvoiceTotal(''); setInvoiceDueDate('');
  }

  function addConfirmation() {
    if (!engagementId || !confirmParty.trim()) { setConfirmMessage('أدخل اسم البنك أو المدين أو الدائن.'); return; }
    const row = { id: id('confirmation'), engagementId, kind: confirmKind, party: confirmParty.trim(), contact: confirmContact.trim(), dueDate: confirmDueDate, status: 'لم ترسل', createdAt: new Date().toISOString() };
    update({ externalConfirmations: [row, ...(operations.externalConfirmations || [])] });
    setConfirmMessage('تم تسجيل طلب المصادقة للمتابعة المحلية. لم يتم إرسال أي طلب تلقائيًا.');
    setConfirmParty(''); setConfirmContact(''); setConfirmDueDate('');
  }

  function requestLocation() {
    setFieldMessage('');
    if (!('geolocation' in navigator)) { setFieldMessage('المتصفح لا يوفّر خدمة الموقع. يمكن حفظ ملاحظة دون موقع.'); return; }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(position => {
      setFieldLocation(position.coords.latitude.toFixed(6) + ', ' + position.coords.longitude.toFixed(6));
      setGeoBusy(false);
    }, error => { setFieldMessage('لم يتم الحصول على الموقع: ' + error.message); setGeoBusy(false); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }

  async function saveFieldworkRecord() {
    if (!engagementId) return;
    try {
      let evidenceId = '';
      if (fieldPhoto) {
        const metadata = await saveLocalEvidenceFile(fieldPhoto, vaultPassphrase);
        evidenceId = metadata.id;
        onAddEvidence({
          id: id('field-evidence'), engagementId, title: 'صورة ملاحظة ميدانية', type: 'ملاحظة ميدانية',
          reference: metadata.fileName, workpaperRef: '', notes: 'صورة مرفقة من نشاط ميداني، تحتاج ربطًا بورقة عمل ومراجعة.',
          addedAt: new Date().toISOString(), attachmentId: metadata.id, fileName: metadata.fileName, fileType: metadata.fileType, fileSize: metadata.fileSize,
        });
      }
      const record = { id: id('fieldwork'), engagementId, clientName: client?.name || '', createdAt: new Date().toISOString(), note: fieldNote.trim(), location: fieldLocation, signatureDataUrl: fieldSignature, photoEvidenceId: evidenceId, syncStatus: 'محفوظ محليًا — غير متزامن' };
      update({ fieldworkRecords: [record, ...(operations.fieldworkRecords || [])] });
      setFieldNote(''); setFieldLocation(''); setFieldSignature(''); setFieldPhoto(null);
      setFieldMessage('تم حفظ السجل الميداني داخل مساحة العمل المشفّرة. لم تتم مزامنته أو إرساله إلى خادم.');
    } catch (error) { setFieldMessage(error instanceof Error ? error.message : 'تعذر حفظ السجل الميداني.'); }
  }

  function exportSampleRecord(record: Row) {
    downloadBlob('ledgerly-sample-' + record.id + '.json', JSON.stringify(record, null, 2), 'application/json;charset=utf-8');
  }

  return <div className="audit-operations-panels">
    <section className="audit-card audit-operations-section">
      <div className="audit-card-head"><div><h3>8. تحليلات القيود المتقدمة وBenford</h3><p className="muted-copy">يجري الفحص على كامل مجتمع القيود المستورد في هذه الشاشة. تشمل الإشارات نهاية الأسبوع الأردنية، وقت القيد عند توفره، المبالغ المدوّرة، الصفوف المتطابقة، وتوزيع أول رقم. هذه إشارات للتحقق وليست نتائج احتيال.</p></div><span className="soft-tag">Full population</span></div>
      {journalTests ? <>
        <div className="audit-intel-kpis audit-intel-kpis-small">
          <div className="audit-intel-kpi"><span>مجتمع القيود</span><strong>{journalTests.scannedCount.toLocaleString('ar-JO')}</strong><small>{journalFileName || 'الملف الحالي'}</small></div>
          <div className="audit-intel-kpi"><span>قواعد أطلقت إشارات</span><strong>{journalTests.issues.length}</strong><small>لا تعني مخالفات مؤكدة</small></div>
          <div className="audit-intel-kpi"><span>قيم Benford</span><strong>{journalTests.benford.populationSize}</strong><small>{journalTests.benford.interpretable ? 'حجم عينة وصفي كافٍ مبدئيًا' : 'أقل من 50 قيمة'}</small></div>
          <div className="audit-intel-kpi"><span>مؤشرات الشهر الأخير</span><strong>{journalRows.filter(row => row.date && Number(row.date.slice(8,10)) >= 28).length}</strong><small>إشارة وقتية فقط</small></div>
        </div>
        {journalTests.issues.length ? <div className="audit-intel-issue-list">{journalTests.issues.map((item: Row) => <article key={item.id} className="audit-intel-issue">
          <div className="audit-intel-issue-top"><strong>{item.title}</strong><span className={'audit-pill ' + (item.severity === 'high' ? 'intel-severity-high' : item.severity === 'medium' ? 'intel-severity-medium' : 'intel-severity-low')}>{item.count} صف</span></div>
          <p>{item.detail}</p><small><b>خطوة مقترحة:</b> {item.action}</small>
          {item.rowNumbers.length > 0 && <small>صفوف أمثلة: {item.rowNumbers.slice(0, 15).join('، ')}</small>}
        </article>)}</div> : <div className="audit-intel-clear">لا توجد إشارات وفق هذه القواعد؛ هذا لا يثبت خلو القيود من الأخطاء.</div>}
        <p className="audit-intel-footnote">{journalTests.benford.note}</p>
        <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>الرقم الأول</th><th>عدد القيم</th><th>النسبة المرصودة</th><th>النسبة المتوقعة</th></tr></thead><tbody>{journalTests.benford.observed.map((row: Row) => <tr key={row.digit}><td>{row.digit}</td><td>{row.count}</td><td>{(row.proportion * 100).toFixed(2)}%</td><td>{(row.expectedProportion * 100).toFixed(2)}%</td></tr>)}</tbody></table></div>
      </> : <p className="muted-copy">ارفع دفتر الأستاذ من قسم محرك القيود أعلاه لعرض اختبار نهاية الأسبوع وBenford وغيرها. لم يتم إجراء فحص لعدم وجود مجتمع قيود.</p>}
      <button className="audit-secondary" onClick={onOpenReconciliation}>فتح وحدة المطابقة البنكية وOCR المحلي</button>
    </section>

    <section className="audit-card audit-operations-section">
      <div className="audit-card-head"><div><h3>9. العينات الإحصائية — Random / Systematic / MUS</h3><p className="muted-copy">يحفظ Ledgerly المجتمع وحجم العينة والبذرة وفاصل MUS والعناصر المختارة لإعادة الإنتاج. المدقق يقرر حجم المجتمع والعينة والاختبار والاستنتاج.</p></div><span className="soft-tag">ISA 530 support</span></div>
      <div className="audit-intel-tools">
        <label className="audit-field"><span>طريقة الاختيار</span><select value={sampleMethod} onChange={event => setSampleMethod(event.target.value as 'random'|'systematic'|'mus')}><option value="random">عشوائية / Random</option><option value="systematic">نظامية / Systematic</option><option value="mus">وحدات نقدية / MUS</option></select></label>
        <label className="audit-field"><span>حجم العينة أو وحدات MUS</span><input type="number" min="1" max="250000" value={sampleSize} onChange={event => setSampleSize(event.target.value)} /></label>
        <label className="audit-field"><span>بذرة قابلة لإعادة الإنتاج</span><input type="number" value={sampleSeed} onChange={event => setSampleSeed(event.target.value)} /></label>
      </div>
      <p className="muted-copy">المجتمع الحالي: {journalRows.length ? 'القيود المستوردة ' + journalRows.length : 'حسابات ميزان المراجعة ' + trialBalance.length}.</p>
      <div className="stack-actions"><button className="audit-primary" onClick={() => void runSample()}>إنشاء وحفظ سجل العينة</button><button className="audit-secondary" onClick={() => downloadCSV('ledgerly-sampling-history.csv', [['run_id','method','seed','sample_size','population','selected','created_at'], ...sampleHistory.map(row => [row.id,row.method,row.seed,row.requestedSampleSize,row.populationSize,row.selectedItemCount,row.createdAt])])}>تصدير سجل العينات CSV</button></div>
      {sampleError && <p className="audit-warning" role="alert">{sampleError}</p>}
      {sampleMessage && <p className="muted-copy" role="status">{sampleMessage}</p>}
      {sampleHistory.length > 0 && <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>التاريخ</th><th>المنهج</th><th>المصدر</th><th>المجتمع</th><th>الحجم المطلوب</th><th>المختارون</th><th></th></tr></thead><tbody>{sampleHistory.map(row => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleString('ar-JO')}</td><td>{row.method}</td><td>{row.source}</td><td>{row.populationSize}</td><td>{row.requestedSampleSize}</td><td>{row.selectedItemCount}</td><td><button className="audit-text-button" onClick={() => exportSampleRecord(row)}>تنزيل السجل</button></td></tr>)}</tbody></table></div>}
    </section>

    <section className="audit-card audit-operations-section">
      <div className="audit-card-head"><div><h3>10. ربط الحسابات بالقوائم المالية</h3><p className="muted-copy">اربط كل حساب يدويًا ببند عرض، ثم أدخل المقارنات. الحساب غير المربوط يظهر كاستثناء ولا يُصنّف تلقائيًا.</p></div><span className="soft-tag">Arabic / English</span></div>
      {!trialBalance.length ? <p className="muted-copy">استورد ميزان المراجعة في ملف التدقيق أولًا.</p> : <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>رمز الحساب</th><th>اسم الحساب</th><th>مدين ختامي</th><th>دائن ختامي</th><th>بند القوائم</th><th>مقارن (د.أ)</th></tr></thead><tbody>
        {trialBalance.slice(0, 3000).map(row => {
          const key = String(engagementId) + '::' + row.code;
          const mapping = operations.accountMappings?.[key] || {};
          return <tr key={row.id}><td>{row.code}</td><td>{row.name}</td><td>{money(row.closingDebit)}</td><td>{money(row.closingCredit)}</td><td><select value={String(mapping.lineKey || '')} onChange={event => {
            const current = operations.accountMappings?.[key] || {};
            update({ accountMappings: { ...(operations.accountMappings || {}), [key]: { ...current, lineKey: event.target.value, editedAt: new Date().toISOString() } } });
          }}><option value="">غير مصنف / Unmapped</option>{financialStatementLines().map(line => <option key={line.key} value={line.key}>{line.ar} / {line.en}</option>)}</select></td>
          <td><input aria-label={'مقارن ' + row.code} type="number" step="0.001" value={String(mapping.comparativeJod ?? '')} onChange={event => {
            const current = operations.accountMappings?.[key] || {};
            update({ accountMappings: { ...(operations.accountMappings || {}), [key]: { ...current, comparativeJod: event.target.value, editedAt: new Date().toISOString() } } });
          }} /></td></tr>;
        })}
      </tbody></table></div>}
      <div className="audit-intel-kpis audit-intel-kpis-small">
        <div className="audit-intel-kpi"><span>الأصول / Assets</span><strong>{money(statement.current.assets)}</strong><small>مقارن: {money(statement.comparative.assets)}</small></div>
        <div className="audit-intel-kpi"><span>الالتزامات / Liabilities</span><strong>{money(statement.current.liabilities)}</strong><small>مقارن: {money(statement.comparative.liabilities)}</small></div>
        <div className="audit-intel-kpi"><span>حقوق الملكية / Equity</span><strong>{money(statement.current.equity)}</strong><small>مقارن: {money(statement.comparative.equity)}</small></div>
        <div className="audit-intel-kpi"><span>ربح أو خسارة / Profit or loss</span><strong>{money(statement.current.profit)}</strong><small>المقارن: {money(statement.comparative.profit)}</small></div>
      </div>
      <p className="audit-intel-banner">عدد الحسابات غير المربوطة: {statement.unmapped.length}. هذه مسودة عرض مبنية على ربط يدوي وليست قوائم IFRS مكتملة. يجب مراعاة السياسات والإفصاحات والتجميعات والمقارنات ومراجعة الشريك.</p>
      <div className="stack-actions"><button className="audit-primary" onClick={exportStatements}>تصدير مسودة القوائم إلى Word (.docx)</button><button className="audit-secondary" onClick={() => window.print()}>طباعة / حفظ PDF</button></div>
    </section>

    <section className="audit-card audit-operations-section">
      <div className="audit-card-head"><div><h3>11. مسودة تقرير المدقق — Arabic / English</h3><p className="muted-copy">قالب مبدئي لاختيار بعض الحقول وتوليد مستند قابل للتحرير. لا يُصدر رأيًا تلقائيًا، ولا يمثل صيغة نهائية معتمدة لـ ISA 700.</p></div><span className="audit-pill risk-pill">مسودة فقط</span></div>
      <div className="audit-intel-tools">
        <label className="audit-field"><span>اسم المكتب / Firm name</span><input value={reportFirmName} onChange={event => updateReport('firmName', event.target.value)} /></label>
        <label className="audit-field"><span>اسم المدقق / Auditor name</span><input value={reportAuditorName} onChange={event => updateReport('auditorName', event.target.value)} placeholder="يستكمل يدويًا" /></label>
        <label className="audit-field"><span>نهاية الفترة / Period end</span><input type="date" value={reportEnd} onChange={event => updateReport('periodEnd', event.target.value)} /></label>
        <label className="audit-field"><span>الرأي المختار مبدئيًا / Draft opinion</span><select value={reportOpinionValue} onChange={event => updateReport('opinion', event.target.value)}>{['غير محدد / To be determined','غير معدل / Unmodified','متحفظ / Qualified','معاكس / Adverse','امتناع عن إبداء الرأي / Disclaimer of opinion'].map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      <p className="audit-intel-banner">المدقق والشريك مسؤولان عن تحديد الرأي وصياغة الأساس والمسؤوليات والإفصاحات والتأكد من الإصدار وفق المعيار الحالي والتشريعات والعقد. المستند يحمل تحذير DRAFT دائمًا.</p>
      <div className="stack-actions"><button className="audit-primary" onClick={exportAuditorReport}>تنزيل تقرير Word قابل للتحرير</button><button className="audit-secondary" onClick={() => window.print()}>طباعة / حفظ PDF</button></div>
    </section>

    <section className="audit-card audit-operations-section">
      <div className="audit-card-head"><div><h3>12. حفظ قوالب استيراد كشوف البنوك</h3><p className="muted-copy">ارفع عناوين كشف فقط ليقترح Ledgerly التعيين؛ راجع الاختيارات ثم احفظ ملف بنك لإعادة استخدامها عند تطابق العناوين. الملف الكامل لا يُحفظ في هذا المكوّن.</p></div><span className="soft-tag">Local bank profiles</span></div>
      <label className="audit-secondary audit-intel-file">اختيار كشف لاستخراج عناوين الأعمدة<input type="file" accept=".csv,.xlsx,.xls" onChange={event => { void importBankHeaders(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>
      {bankFileName && <p className="muted-copy">{bankFileName} · {bankHeaders.length} عناوين</p>}
      {bankHeaders.length > 0 && <>
        <label className="audit-field"><span>اسم البنك أو القالب</span><input value={bankProfileName} onChange={event => setBankProfileName(event.target.value)} /></label>
        <div className="audit-intel-tools">{BANK_FIELDS.map(([field, label]) => <label key={field} className="audit-field"><span>{label}</span><select value={bankMapping[field] || ''} onChange={event => setBankMapping(previous => ({ ...previous, [field]: event.target.value }))}><option value="">غير محدد</option>{bankHeaders.map(header => <option key={header} value={header}>{header}</option>)}</select></label>)}</div>
        <button className="audit-primary" onClick={saveBankProfile}>حفظ تعيين الأعمدة المشفّر</button>
      </>}
      {bankNotice && <p className="muted-copy" role="status">{bankNotice}</p>}
      {(operations.bankProfiles || []).length > 0 && <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>القالب</th><th>عدد العناوين</th><th>تاريخ التحديث</th><th></th></tr></thead><tbody>{operations.bankProfiles.map(profile => <tr key={profile.id}><td>{profile.name}</td><td>{profile.headers?.length || 0}</td><td>{profile.updatedAt ? new Date(profile.updatedAt).toLocaleDateString('ar-JO') : '—'}</td><td><button className="audit-text-button danger-text" onClick={() => update({ bankProfiles: operations.bankProfiles.filter(item => item.id !== profile.id) })}>حذف القالب</button></td></tr>)}</tbody></table></div>}
      <p className="audit-intel-footnote">هذا التعلّم يعتمد على تعيين المستخدم وبصمة العناوين، ولا يفترض أن كل كشوف البنك تستخدم اصطلاحات المدين/الدائن نفسها. يلزم اختبار كل بنك مع عينة مؤكدة.</p>
    </section>

    <section className="audit-card audit-operations-section">
      <div className="audit-card-head"><div><h3>13. سجل المصادقات الخارجية</h3><p className="muted-copy">قائمة متابعة للمصادقات البنكية ومصادقات المدينين والدائنين. لا يرسل Ledgerly المصادقات تلقائيًا؛ يجب أن يتحكم المدقق بقناة الإرسال والردود المباشرة.</p></div><span className="soft-tag">Confirmations tracker</span></div>
      <div className="audit-intel-tools">
        <label className="audit-field"><span>نوع المصادقة</span><select value={confirmKind} onChange={event => setConfirmKind(event.target.value)}><option>بنك</option><option>مدين</option><option>دائن / مورد</option><option>قرض أو تسهيل</option></select></label>
        <label className="audit-field"><span>الجهة المطلوب مصادقتها</span><input value={confirmParty} onChange={event => setConfirmParty(event.target.value)} placeholder="اسم البنك أو الطرف" /></label>
        <label className="audit-field"><span>بريد/رقم تواصل</span><input value={confirmContact} onChange={event => setConfirmContact(event.target.value)} placeholder="قناة التواصل المعتمدة" /></label>
        <label className="audit-field"><span>الموعد المطلوب</span><input type="date" value={confirmDueDate} onChange={event => setConfirmDueDate(event.target.value)} /></label>
      </div>
      <button className="audit-primary" onClick={addConfirmation}>إضافة طلب مصادقة</button>
      {confirmMessage && <p className="muted-copy" role="status">{confirmMessage}</p>}
      {currentConfirmations.length > 0 && <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>النوع والجهة</th><th>التواصل</th><th>الموعد</th><th>الحالة</th><th></th></tr></thead><tbody>{currentConfirmations.map(row => <tr key={row.id}><td>{row.kind} · {row.party}</td><td>{row.contact || '—'}</td><td>{row.dueDate || '—'}</td><td><select value={row.status} onChange={event => update({ externalConfirmations: operations.externalConfirmations.map(item => item.id === row.id ? { ...item, status: event.target.value, updatedAt: new Date().toISOString() } : item) })}>{['لم ترسل','أرسلت عبر المكتب','وصل رد','متابعة ثانية','فرق يحتاج تسوية'].map(value => <option key={value}>{value}</option>)}</select></td><td><button className="audit-text-button" onClick={() => downloadCSV('ledgerly-confirmation-' + row.id + '.csv', [['kind','party','contact','due_date','status'], [row.kind,row.party,row.contact,row.dueDate,row.status]])}>تصدير</button></td></tr>)}</tbody></table></div>}
      <button className="audit-secondary" onClick={() => downloadCSV('ledgerly-confirmations.csv', [['kind','party','contact','due_date','status'], ...currentConfirmations.map(row => [row.kind,row.party,row.contact,row.dueDate,row.status])])}>تصدير سجل المصادقات CSV</button>
    </section>

    <section className="audit-card audit-operations-section">
      <div className="audit-card-head"><div><h3>14. إدارة الوقت والأتعاب وفواتير المكتب</h3><p className="muted-copy">تتبع ساعات الفريق والمعدل، ومقارنة الكلفة الفعلية بالأتعاب المسجلة. سجل الفواتير داخلي ولا يمثل فاتورة ضريبية رسمية.</p></div><span className="soft-tag">Practice management</span></div>
      <div className="audit-intel-kpis audit-intel-kpis-small">
        <div className="audit-intel-kpi"><span>الساعات المسجلة</span><strong>{metrics.totalHours.toFixed(2)}</strong><small>لهذا الارتباط</small></div>
        <div className="audit-intel-kpi"><span>كلفة الوقت المقدّرة</span><strong>{money(metrics.actualCost)}</strong><small>حسب المعدلات المدخلة</small></div>
        <div className="audit-intel-kpi"><span>الأتعاب المتعاقد عليها</span><strong>{money(metrics.contractedFees)}</strong><small>من بيانات ملف التدقيق</small></div>
        <div className="audit-intel-kpi"><span>فواتير غير مسددة</span><strong>{money(metrics.outstanding)}</strong><small>من السجل الداخلي</small></div>
      </div>
      <h4>تسجيل وقت</h4>
      <div className="audit-intel-tools">
        <label className="audit-field"><span>الساعات</span><input type="number" min="0.1" step="0.1" value={hours} onChange={event => setHours(event.target.value)} /></label>
        <label className="audit-field"><span>المعدل بالساعة (د.أ)</span><input type="number" min="0" step="0.001" value={hourlyRate} onChange={event => setHourlyRate(event.target.value)} /></label>
        <label className="audit-field"><span>وصف العمل</span><input value={timeDescription} onChange={event => setTimeDescription(event.target.value)} placeholder="تخطيط، عينة، مراجعة..." /></label>
      </div>
      <button className="audit-primary" onClick={addTimeEntry}>تسجيل الوقت</button>
      <h4>سجل فاتورة داخلية</h4>
      <div className="audit-intel-tools">
        <label className="audit-field"><span>رقم الفاتورة الداخلي</span><input value={invoiceNo} onChange={event => setInvoiceNo(event.target.value)} /></label>
        <label className="audit-field"><span>الإجمالي (د.أ)</span><input type="number" min="0.001" step="0.001" value={invoiceTotal} onChange={event => setInvoiceTotal(event.target.value)} /></label>
        <label className="audit-field"><span>تاريخ الاستحقاق</span><input type="date" value={invoiceDueDate} onChange={event => setInvoiceDueDate(event.target.value)} /></label>
      </div>
      <button className="audit-secondary" onClick={addInvoice}>تسجيل فاتورة داخلية</button>
      {officeMessage && <p className="muted-copy" role="status">{officeMessage}</p>}
      {currentTime.length > 0 && <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>التاريخ</th><th>العمل</th><th>الساعات</th><th>المعدل</th><th>الكلفة</th></tr></thead><tbody>{currentTime.slice(0, 50).map(row => <tr key={row.id}><td>{row.date}</td><td>{row.description} <small className="table-sub">{row.staff}</small></td><td>{row.hours}</td><td>{money(row.hourlyRateJod)}</td><td>{money(row.amountJod)}</td></tr>)}</tbody></table></div>}
      {currentInvoices.length > 0 && <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>الرقم</th><th>القيمة</th><th>الاستحقاق</th><th>الحالة</th></tr></thead><tbody>{currentInvoices.map(row => <tr key={row.id}><td>{row.invoiceNo}</td><td>{money(row.totalJod)}</td><td>{row.dueDate || '—'}</td><td><select value={row.status} onChange={event => update({ officeInvoices: operations.officeInvoices.map(item => item.id === row.id ? { ...item, status: event.target.value } : item) })}><option>غير مدفوعة</option><option>مدفوعة</option><option>متنازع عليها</option><option>مستحقة</option></select></td></tr>)}</tbody></table></div>}
      <button className="audit-secondary" onClick={() => downloadCSV('ledgerly-office-time.csv', [['date','staff','description','hours','rate_jod','amount_jod'], ...currentTime.map(row => [row.date,row.staff,row.description,row.hours,row.hourlyRateJod,row.amountJod])])}>تصدير الوقت CSV</button>
      <button className="audit-secondary" onClick={() => downloadCSV('ledgerly-office-invoices.csv', [['invoice_no','client','total_jod','due_date','status'], ...currentInvoices.map(row => [row.invoiceNo,row.clientName,row.totalJod,row.dueDate,row.status])])}>تصدير الفواتير CSV</button>
    </section>

    <section className="audit-card audit-operations-section">
      <div className="audit-card-head"><div><h3>15. العمل الميداني دون اتصال دائم</h3><p className="muted-copy">احفظ ملاحظة الجرد محليًا داخل المخزن المشفّر، والتقط الموقع فقط بعد الضغط والموافقة، وأرفق صورة مخزنة بتشفير الملف. لا تتم مزامنة هذه السجلات سحابيًا في هذه النسخة.</p></div><span className="soft-tag">Offline-first</span></div>
      <label className="audit-field"><span>ملاحظة الجرد أو الزيارة</span><textarea rows={3} value={fieldNote} onChange={event => setFieldNote(event.target.value)} placeholder="الموقع، الصنف، الكمية، الملاحظة، اسم المسؤول..." /></label>
      <div className="audit-intel-tools">
        <button className="audit-secondary" disabled={geoBusy} onClick={requestLocation}>{geoBusy ? 'جارٍ طلب الموقع...' : 'طلب الموقع بموافقتي'}</button>
        <div className="audit-field"><span>الموقع المسجل بعد الموافقة</span><input readOnly value={fieldLocation} placeholder="لم يتم طلب الموقع" /></div>
        <label className="audit-field"><span>صورة جرد (اختياري)</span><input type="file" accept="image/*" capture="environment" onChange={event => setFieldPhoto(event.target.files?.[0] || null)} /></label>
      </div>
      <div><strong>توقيع ميداني (اختياري)</strong><p className="muted-copy">لا يمثل هذا الرسم هوية رقمية معتمدة أو توقيعًا موثقًا قانونيًا.</p><SignaturePad value={fieldSignature} onChange={setFieldSignature} /></div>
      <button className="audit-primary" onClick={() => void saveFieldworkRecord()}>حفظ الملاحظة الميدانية المشفّرة</button>
      {fieldMessage && <p className="muted-copy" role="status">{fieldMessage}</p>}
      {currentFieldRecords.length > 0 && <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>التاريخ</th><th>الملاحظة</th><th>الموقع</th><th>الصورة</th><th>المزامنة</th></tr></thead><tbody>{currentFieldRecords.map((row: Row) => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleString('ar-JO')}</td><td>{row.note}</td><td>{row.location || '—'}</td><td>{row.photoEvidenceId ? 'أضيفت للأدلة' : '—'}</td><td>{row.syncStatus}</td></tr>)}</tbody></table></div>}
    </section>

    <section className="audit-card audit-operations-section">
      <div className="audit-card-head"><div><h3>16. فحص فاتورة XML بصيغة UBL 2.1</h3><p className="muted-copy">قراءة محلية لحقول الفاتورة وملخص المبلغ والضريبة. لا يوجد اتصال بنظام الفوترة الوطني ولا إرسال لبيانات JoFotara.</p></div><span className="soft-tag">UBL XML · Local only</span></div>
      <label className="audit-secondary audit-intel-file">اختيار XML لفحص الحقول<input type="file" accept=".xml,text/xml,application/xml" onChange={event => { void importUbl(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>
      {ublError && <p className="muted-copy" role="status">{ublError}</p>}
      {ublInvoice && <><div className="summary-lines">
        <div className="summary-line"><span>رقم الفاتورة</span><strong>{ublInvoice.invoiceId || 'غير موجود'}</strong></div>
        <div className="summary-line"><span>تاريخ الإصدار</span><strong>{ublInvoice.issueDate || 'غير موجود'}</strong></div>
        <div className="summary-line"><span>المورد / Supplier</span><strong>{ublInvoice.supplierName || 'غير محدد'}</strong></div>
        <div className="summary-line"><span>الرقم الضريبي</span><strong>{ublInvoice.supplierTaxId || 'غير موجود'}</strong></div>
        <div className="summary-line"><span>الإجمالي المستحق</span><strong>{money(ublInvoice.payableAmount)}</strong></div>
        <div className="summary-line"><span>ضريبة</span><strong>{money(ublInvoice.taxAmount)}</strong></div>
      </div><p className="audit-intel-banner">{ublInvoice.note} {ublInvoice.validation?.readyForHumanReview ? 'الحقول الأولية موجودة للمراجعة.' : 'توجد حقول أساسية ناقصة.'}</p><button className="audit-primary" onClick={addUblAsEvidence}>إضافة ملخص XML إلى الأدلة</button></>}
    </section>

    <section className="audit-card audit-operations-section">
      <div className="audit-card-head"><div><h3>17. OCR والمساعد الموثّق</h3><p className="muted-copy">المشروع الحالي يحتوي OCR محليًا ضمن وحدة المطابقة/استيراد PDF. استخدمه لاستخراج النص ثم راجع السطر/الصورة قبل تسجيل أي قيمة. مساعد الذكاء الاصطناعي الحالي يرسل سياقًا مخففًا بموافقة صريحة، وليس كامل الملفات تلقائيًا.</p></div><span className="soft-tag">Human review required</span></div>
      <div className="stack-actions"><button className="audit-primary" onClick={onOpenReconciliation}>فتح OCR المحلي لملفات PDF</button><button className="audit-secondary" onClick={() => downloadCSV('ledgerly-current-workpaper-index.csv', [['reference','title','status','procedure','conclusion'], ...trialBalance.map(row => [row.code,row.name,'رصيد ميزان مراجعة','',String(row.closingDebit - row.closingCredit)])])}>تصدير فهرس أرصدة CSV</button></div>
      <p className="audit-intel-footnote">لا يوقع المساعد مستندًا ولا يعتمد ورقة عمل أو نتيجة؛ المصدر، رقم الصف/الصفحة عند توفره، وحكم المدقق تبقى عناصر أساسية.</p>
    </section>

    <section className="audit-card audit-operations-section">
      <div className="audit-card-head"><div><h3>18. حالة جاهزية PWA</h3><p className="muted-copy">يمكن تثبيت تطبيق الويب على الهاتف عند استضافته عبر HTTPS بعد تفعيل manifest وservice worker. سجلات الميدان تُحفظ مشفّرة محليًا، لكن المزامنة المشفّرة بين الأجهزة لم تُفعّل بعد.</p></div><span className="soft-tag">Offline shell</span></div>
      <p className="muted-copy">قبل استخدام الجرد الفعلي، اختبر استرجاع النسخة المشفّرة على جهاز آخر مع كلمة المرور، والتأكد من سياسة الموقع والصور والتوقيع لدى مكتبك.</p>
    </section>

    <section className="ledgerly-printable-report" id="ledgerly-printable-report">
      <header><h1>مسودة تقرير مالي / Draft Financial Report</h1><p>DRAFT — NOT FOR ISSUE</p></header>
      <p>العميل / Client: {client?.name || 'غير محدد'} · السنة / Year: {engagement?.year || ''}</p>
      <p>مكتب التدقيق / Firm: {reportFirmName} · المدقق / Auditor: {reportAuditorName || '[يستكمل]'}</p>
      <p>الرأي المختار مبدئيًا / Draft opinion: {reportOpinionValue} · نهاية الفترة / Period end: {reportEnd || '[يستكمل]'}</p>
      <h2>قوائم مالية — مسودة / Draft financial statements</h2>
      <table><thead><tr>{(statementRows[0] || []).map((cell: unknown, i: number) => <th key={i}>{String(cell ?? '')}</th>)}</tr></thead><tbody>{statementRows.slice(1).map((row, index) => <tr key={index}>{row.map((cell: unknown, i: number) => <td key={i}>{String(cell ?? '')}</td>)}</tr>)}</tbody></table>
      <h2>تنبيه / Disclaimer</h2><p>مسودة غير صالحة للإصدار أو التوقيع. يجب استكمال مطابقة الأرصدة، والإفصاحات، والسياسات المحاسبية، ونص الرأي ومسؤوليّات الأطراف من الشريك المسؤول.</p>
      <p>This draft is not for issue or signature. The partner must complete account mapping, disclosures, accounting policies, opinion wording, and responsibilities sections.</p>
    </section>
  </div>;
}
