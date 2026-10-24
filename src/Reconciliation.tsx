import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker } from 'tesseract.js';
import { detectColumns, normalizeRows, validateRows, matchTransactions } from './core.mjs';
import { MAX_IMPORT_FILE_BYTES, MAX_WORKSHEET_ROWS, MAX_WORKSHEET_COLUMNS, MAX_WORKSHEET_CELLS, fileSizeIssue, worksheetDimensionIssue, matrixDimensionIssue, pdfPageIssue, pdfTextItemIssue, ocrPageIssue, ocrPixelIssue } from './lib/import-safety.mjs';

type Field = 'date' | 'description' | 'debit' | 'credit' | 'amount' | 'balance';
type Row = unknown[] | Record<string, unknown>;
const FIELDS: Field[] = ['date', 'description', 'debit', 'credit', 'amount', 'balance'];
const LABELS: Record<Field, [string, string]> = {
  date: ['التاريخ', 'Date'], description: ['البيان', 'Description'],
  debit: ['مدين', 'Debit'], credit: ['دائن', 'Credit'],
  amount: ['المبلغ', 'Amount'], balance: ['الرصيد', 'Balance'],
};
type ImportedFile = { name: string; rows: Row[]; headers: string[]; mapping: Record<string, number>; kind: string; note?: string };

export default function App() {
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const [file, setFile] = useState<ImportedFile | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ocr, setOcr] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [bankData, setBankData] = useState<ReturnType<typeof normalizeRows> | null>(null);
  const [ledgerData, setLedgerData] = useState<ReturnType<typeof normalizeRows> | null>(null);
  const [dateWindowDays, setDateWindowDays] = useState(0);
  const [matchResult, setMatchResult] = useState<ReturnType<typeof matchTransactions> | null>(null);
  const t = (ar: string, en: string) => lang === 'ar' ? ar : en;
  const formatMoney = (value: number | null | undefined) =>
    value == null || !Number.isFinite(value)
      ? '—'
      : Number(value).toLocaleString(lang === 'ar' ? 'ar-JO-u-nu-latn' : 'en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const formatMovement = (row: ReturnType<typeof normalizeRows>[number] | undefined) => {
    if (!row) return '—';
    const debit = row.debit;
    const credit = row.credit;
    if (debit != null && credit != null) {
      if (debit !== 0 && credit !== 0) return `${t('مدين', 'Debit')} ${formatMoney(debit)} / ${t('دائن', 'Credit')} ${formatMoney(credit)}`;
      if (debit !== 0) return `${t('مدين', 'Debit')} ${formatMoney(debit)}`;
      if (credit !== 0) return `${t('دائن', 'Credit')} ${formatMoney(credit)}`;
      return formatMoney(0);
    }
    if (debit != null) return `${t('مدين', 'Debit')} ${formatMoney(debit)}`;
    if (credit != null) return `${t('دائن', 'Credit')} ${formatMoney(credit)}`;
    return '—';
  };
  function exportReconciliationReport() {
    if (!bankData || !ledgerData || !matchResult) return;
    try {
      const now = new Date();
      const exportedAt = now.toLocaleString(lang === 'ar' ? 'ar-JO-u-nu-latn' : 'en-US');
      const signedMovement = (row: ReturnType<typeof normalizeRows>[number] | undefined): number | string =>
        !row || (row.debit == null && row.credit == null)
          ? ''
          : Number(((row.credit ?? 0) - (row.debit ?? 0)).toFixed(3));
      const makeSheet = (
        headers: string[],
        rows: Array<Array<string | number | null>>,
        widths: number[],
      ) => {
        const noDataRow: Array<string | number | null> = [t('لا توجد بيانات', 'No data'), ...Array(Math.max(0, headers.length - 1)).fill('')];
        const sheet = XLSX.utils.aoa_to_sheet([headers, ...(rows.length ? rows : [noDataRow])]);
        sheet['!cols'] = widths.map(wch => ({ wch }));
        sheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${Math.max(2, rows.length + 1)}` };
        return sheet;
      };

      const workbook = XLSX.utils.book_new();
      const summary = XLSX.utils.aoa_to_sheet([
        [t('تقرير المطابقة البنكية', 'Bank reconciliation report')],
        [t('تاريخ التصدير', 'Exported at'), exportedAt],
        [t('نافذة فرق التاريخ (أيام)', 'Date difference window (days)'), dateWindowDays],
        [t('صفوف كشف البنك المستوردة', 'Imported bank statement rows'), bankData.length],
        [t('صفوف دفتر الأستاذ المستوردة', 'Imported ledger rows'), ledgerData.length],
        [t('المطابقات المقترحة', 'Suggested matches'), matchResult.summary.matchedCount],
        [t('غير مطابق — البنك', 'Unmatched — bank'), matchResult.summary.unmatchedBankCount],
        [t('غير مطابق — الأستاذ', 'Unmatched — ledger'), matchResult.summary.unmatchedLedgerCount],
        [t('الحالات الملتبسة', 'Ambiguous cases'), matchResult.summary.ambiguousCount],
        [t('تنبيه', 'Important note'), t('النتائج اقتراحات آلية أولية وليست اعتماداً محاسبياً. راجع الحركات واتجاه المدين والدائن قبل اعتماد التسوية.', 'These are preliminary automated suggestions, not accounting approval. Review transactions and debit/credit conventions before approving the reconciliation.')],
      ]);
      summary['!cols'] = [{ wch: 34 }, { wch: 92 }];
      XLSX.utils.book_append_sheet(workbook, summary, t('الملخص', 'Summary'));

      const matchedRows = matchResult.matches.map(m => {
        const bankRow = bankData[m.bankIndex];
        const ledgerRow = ledgerData[m.ledgerIndex];
        return [
          m.bankIndex + 2, bankRow?.date ?? '', bankRow?.description ?? '',
          bankRow?.debit ?? '', bankRow?.credit ?? '', signedMovement(bankRow), bankRow?.balance ?? '',
          m.ledgerIndex + 2, ledgerRow?.date ?? '', ledgerRow?.description ?? '',
          ledgerRow?.debit ?? '', ledgerRow?.credit ?? '', signedMovement(ledgerRow), ledgerRow?.balance ?? '',
          m.confidence === 'exact' ? t('مبلغ + تاريخ + بيان', 'Amount + date + description') : t('مبلغ + تاريخ فقط', 'Amount + date only'),
          m.amountDifference, m.dateDifferenceDays ?? '',
        ] as Array<string | number | null>;
      });
      const matchedHeaders = [
        t('صف البنك', 'Bank row'), t('تاريخ البنك', 'Bank date'), t('بيان البنك', 'Bank description'),
        t('مدين البنك', 'Bank debit'), t('دائن البنك', 'Bank credit'), t('صافي حركة البنك', 'Signed bank movement'), t('رصيد البنك', 'Bank balance'),
        t('صف الأستاذ', 'Ledger row'), t('تاريخ الأستاذ', 'Ledger date'), t('بيان الأستاذ', 'Ledger description'),
        t('مدين الأستاذ', 'Ledger debit'), t('دائن الأستاذ', 'Ledger credit'), t('صافي حركة الأستاذ', 'Signed ledger movement'), t('رصيد الأستاذ', 'Ledger balance'),
        t('أساس المطابقة', 'Match basis'), t('فرق المبلغ', 'Amount difference'), t('فرق التاريخ (أيام)', 'Date difference (days)'),
      ];
      const matchedSheet = makeSheet(matchedHeaders, matchedRows, [10, 13, 28, 14, 14, 20, 16, 10, 13, 28, 14, 14, 20, 16, 28, 16, 16]);
      XLSX.utils.book_append_sheet(workbook, matchedSheet, t('المطابقات', 'Matched'));

      const unmatchedHeaders = [
        t('رقم الصف', 'Source row'), t('التاريخ', 'Date'), t('البيان', 'Description'),
        t('المدين', 'Debit'), t('الدائن', 'Credit'), t('صافي الحركة', 'Signed movement'), t('الرصيد', 'Balance'),
      ];
      const toUnmatchedRows = (indices: number[], source: ReturnType<typeof normalizeRows>) =>
        indices.map(index => {
          const row = source[index];
          return [row?.sourceRow ?? index + 2, row?.date ?? '', row?.description ?? '',
            row?.debit ?? '', row?.credit ?? '', signedMovement(row), row?.balance ?? ''] as Array<string | number | null>;
        });
      XLSX.utils.book_append_sheet(workbook, makeSheet(unmatchedHeaders, toUnmatchedRows(matchResult.unmatchedBank, bankData), [12, 14, 38, 14, 14, 18, 16]), t('غير مطابق - البنك', 'Unmatched bank'));
      XLSX.utils.book_append_sheet(workbook, makeSheet(unmatchedHeaders, toUnmatchedRows(matchResult.unmatchedLedger, ledgerData), [12, 14, 38, 14, 14, 18, 16]), t('غير مطابق - الأستاذ', 'Unmatched ledger'));

      const ambiguousRows = matchResult.ambiguous.map(item => {
        const row = bankData[item.bankIndex];
        const reason = item.reason === 'multiple_exact_candidates'
          ? t('أكثر من مرشح بنفس المبلغ والتاريخ والبيان', 'Multiple candidates with same amount, date and description')
          : item.reason === 'non_unique_amount_date'
            ? t('المبلغ والتاريخ لا ينتجان تطابقاً فريداً', 'Amount and date do not produce a unique match')
            : t('أكثر من مرشح للمبلغ والتاريخ', 'Multiple amount/date candidates');
        return [
          item.bankIndex + 2, row?.date ?? '', row?.description ?? '',
          row?.debit ?? '', row?.credit ?? '',
          item.ledgerIndices.map(index => index + 2).join(', '),
          item.ledgerIndicesTruncated ? t('نعم', 'Yes') : t('لا', 'No'),
          reason,
        ] as Array<string | number | null>;
      });
      const ambiguousHeaders = [
        t('صف البنك', 'Bank row'), t('التاريخ', 'Date'), t('البيان', 'Description'),
        t('المدين', 'Debit'), t('الدائن', 'Credit'), t('صفوف الأستاذ المرشحة', 'Candidate ledger rows'),
        t('قائمة المرشحين مختصرة', 'Candidates truncated'), t('سبب الالتباس', 'Ambiguity reason'),
      ];
      XLSX.utils.book_append_sheet(workbook, makeSheet(ambiguousHeaders, ambiguousRows, [12, 14, 32, 14, 14, 26, 20, 42]), t('حالات ملتبسة', 'Ambiguous'));

      const stamp = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
      XLSX.writeFile(workbook, `Ledgerly_Reconciliation_${stamp}.xlsx`);
    } catch {
      setError(t('تعذر إنشاء ملف Excel. أعد المحاولة، وإذا استمرت المشكلة راجع سجل التطبيق.', 'Could not create the Excel report. Try again; if the problem persists, review the application log.'));
    }
  }

  const normalized = useMemo(() => file ? normalizeRows(file.rows, file.mapping) : [], [file]);
  const warnings = useMemo(() => validateRows(normalized), [normalized]);

  async function handleFile(selected?: File) {
    if (!selected) return;
    if (fileSizeIssue(selected.size, MAX_IMPORT_FILE_BYTES)) { setError(t('حجم الملف يتجاوز الحد الآمن (50 ميغابايت).', 'File exceeds the safety limit (50 MiB).')); return; }
    setError(''); setFile(null); setConfirmed(false); setMatchResult(null); setBusy(true); setOcr(false);
    let releasePdf: (() => Promise<void>) | null = null;
    try {
      const ext = selected.name.split('.').pop()?.toLowerCase();
      let rows: Row[] = []; let headers: string[] = []; let kind = ext ?? 'unknown'; let note = '';
      const limitMessage = (issue: string) => {
        if (issue === 'too-many-rows') return t('الملف يتجاوز 250,000 صف بيانات؛ قسّمه إلى أجزاء أصغر.', 'The file exceeds 250,000 data rows; split it into smaller files.');
        if (issue === 'too-many-columns') return t('ورقة العمل تحتوي على أكثر من 256 عمودًا؛ احذف الأعمدة غير المستخدمة.', 'The worksheet exceeds 256 columns; remove unused columns.');
        if (issue === 'too-many-cells') return t('الملف يتجاوز الحد الآمن البالغ 2,000,000 خلية؛ قسّمه إلى أجزاء أصغر.', 'The file exceeds the 2,000,000-cell safety limit; split it into smaller files.');
        if (issue === 'too-many-pdf-pages') return t('ملف PDF يتجاوز حد 500 صفحة.', 'PDF exceeds the 500-page safety limit.');
        if (issue === 'too-many-pdf-text-items' || issue === 'too-many-pdf-text-items-total') return t('يحتوي PDF على حجم نصي غير اعتيادي. قسّم الملف أو صدّره مجددًا من مصدر موثوق.', 'PDF contains an unusually large amount of text data. Split it or re-export it from a trusted source.');
        if (issue === 'too-many-ocr-pages') return t('استخراج OCR محدود إلى 100 صفحة في الملف الواحد لتجنب استهلاك موارد الجهاز.', 'OCR is limited to 100 pages per file to avoid exhausting device resources.');
        if (issue === 'ocr-page-too-large') return t('إحدى صفحات PDF تتجاوز حد البكسلات الآمن لـ OCR.', 'A PDF page exceeds the safe OCR pixel limit.');
        if (issue === 'ocr-work-too-large') return t('إجمالي حجم صفحات OCR يتجاوز الحد الآمن؛ قسّم PDF إلى ملفات أصغر.', 'The total OCR pixel budget is exceeded; split the PDF into smaller files.');
        return t('تعذر التحقق من أبعاد الملف أو ورقة العمل.', 'Could not validate file or worksheet dimensions.');
      };
      const matrixFromSheet = (sheet: any): unknown[][] => {
        if (!sheet) throw new Error(t('لم يتم العثور على ورقة بيانات داخل الملف.', 'No worksheet was found in the file.'));
        const sourceRef = (sheet as { '!ref'?: string; '!fullref'?: string })['!fullref'] || sheet['!ref'];
        if (sourceRef) {
          const range = XLSX.utils.decode_range(sourceRef);
          const issue = worksheetDimensionIssue(range.e.r - range.s.r + 1, range.e.c - range.s.c + 1);
          if (issue) throw new Error(limitMessage(issue));
        }
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: false });
        const issue = matrixDimensionIssue(matrix);
        if (issue) throw new Error(limitMessage(issue));
        return matrix;
      };
      const parseOptions = { cellDates: true, sheetRows: MAX_WORKSHEET_ROWS + 2, cellHTML: false, cellStyles: false, bookVBA: false, cellFormula: false };
      if (ext === 'csv' || ext === 'txt') {
        const text = await selected.text();
        const workbook = XLSX.read(text, { ...parseOptions, type: 'string' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const matrix = matrixFromSheet(sheet);
        headers = (matrix[0] ?? []).map(String);
        rows = matrix.slice(1).filter(r => r.some(v => String(v).trim() !== ''));
      } else if (ext === 'xlsx' || ext === 'xls') {
        const workbook = XLSX.read(await selected.arrayBuffer(), { ...parseOptions, type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const matrix = matrixFromSheet(sheet);
        headers = (matrix[0] ?? []).map(String);
        rows = matrix.slice(1).filter(r => r.some(v => String(v).trim() !== ''));
      } else if (ext === 'pdf') {
        const pdfjs = pdfjsLib as unknown as { GlobalWorkerOptions: { workerSrc: string }; getDocument: (x: unknown) => { promise: Promise<any> } };
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const doc = await pdfjs.getDocument({ data: await selected.arrayBuffer(), enableScripting: false, isEvalSupported: false, enableXfa: false, stopAtErrors: true }).promise;
        releasePdf = () => doc.destroy();
        const pdfIssue = pdfPageIssue(doc.numPages); if (pdfIssue) throw new Error(limitMessage(pdfIssue));
        const pageLines: string[][] = [];
        let extractedCells = 0;
        let totalPdfTextItems = 0;
        for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
          const page = await doc.getPage(pageNo);
          const content = await page.getTextContent();
          const items = content.items as any[];
          const itemIssue = pdfTextItemIssue(items.length, totalPdfTextItems);
          if (itemIssue) throw new Error(limitMessage(itemIssue));
          totalPdfTextItems += items.length;
          const grouped = new Map<number, Array<{ x: number; text: string }>>();
          for (const item of items) {
            if (!item.str?.trim() || !item.transform) continue;
            const y = Math.round(item.transform[5] / 3) * 3;
            const group = grouped.get(y) ?? [];
            group.push({ x: item.transform[4], text: item.str.trim() });
            grouped.set(y, group);
          }
          const orderedLines = [...grouped.entries()].sort((a, b) => b[0] - a[0]);
          for (const [, items] of orderedLines) {
            items.sort((a, b) => a.x - b.x);
            const cells: string[] = [];
            let current = '';
            let previousX: number | null = null;
            for (const item of items) {
              const gap = previousX === null ? 0 : item.x - previousX;
              if (gap > 32 && current.trim()) { cells.push(current.trim()); current = item.text; }
              else current += `${current ? ' ' : ''}${item.text}`;
              previousX = item.x;
            }
            if (current.trim()) cells.push(current.trim());
            if (cells.length) {
              if (cells.length > MAX_WORKSHEET_COLUMNS) throw new Error(limitMessage('too-many-columns'));
              if (pageLines.length >= MAX_WORKSHEET_ROWS + 1) throw new Error(limitMessage('too-many-rows'));
              extractedCells += cells.length;
              if (extractedCells > MAX_WORKSHEET_CELLS) throw new Error(limitMessage('too-many-cells'));
              pageLines.push(cells);
            }
          }
        }
        const hasPdfText = pageLines.flat().join(' ').trim().length > 25;
        if (hasPdfText) {
          // Find the line most likely to be a header, rather than assuming the first PDF line is a table header.
          let headerIndex = 0; let bestScore = -1;
          pageLines.forEach((line, i) => {
            const score = Object.keys(detectColumns(line)).length;
            if (score > bestScore) { bestScore = score; headerIndex = i; }
          });
          if (bestScore >= 2 && pageLines[headerIndex].length >= 2) {
            headers = pageLines[headerIndex].map((h, i) => h || `Column ${i + 1}`);
            rows = pageLines.slice(headerIndex + 1).filter(line => line.some(v => v.trim())).map(line => Object.fromEntries(headers.map((h, i) => [h, line[i] ?? ''])));
            note = t('استُخرج النص من جميع صفحات PDF. راجع ترتيب الأعمدة والقيم؛ تخطيط PDF يختلف بين البنوك.', 'Text extracted from all PDF pages. Verify column order and values; PDF layouts vary by bank.');
          } else {
            headers = ['Extracted PDF text'];
            rows = pageLines.map((line, i) => ({ 'Extracted PDF text': line.join(' | '), 'Line': i + 1 }));
            note = t('استُخرج النص من جميع الصفحات، لكن لم يُكتشف صف عناوين موثوق. يلزم التحقق اليدوي؛ لم تُستنتج أعمدة مالية تلقائياً.', 'Text extracted from all pages, but no reliable header row was detected. Manual review is required; financial columns were not inferred.');
          }
        } else {
          const useOcr = window.confirm(t('يبدو أن PDF ممسوح ضوئياً. هل تريد تشغيل OCR محلياً على جميع الصفحات؟ قد تُنزّل بيانات اللغة عند أول استخدام.', 'This PDF appears scanned. Run OCR locally on all pages? Language data may download on first use.'));
          if (!useOcr) throw new Error(t('أُلغي OCR. لم يتم رفع الملف إلى أي خادم بواسطة التطبيق.', 'OCR cancelled. The app did not upload the file.'));
          const pageIssue = ocrPageIssue(doc.numPages); if (pageIssue) throw new Error(limitMessage(pageIssue));
          setOcr(true);
          const worker = await createWorker('ara+eng');
          try {
            const ocrLines: string[] = [];
            let totalOcrPixels = 0;
            for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
              const page = await doc.getPage(pageNo);
              const viewport = page.getViewport({ scale: 2 });
              const pixelIssue = ocrPixelIssue(viewport.width, viewport.height, totalOcrPixels);
              if (pixelIssue) throw new Error(limitMessage(pixelIssue));
              totalOcrPixels += Math.ceil(viewport.width) * Math.ceil(viewport.height);
              const canvas = document.createElement('canvas');
              try {
                canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error(t('تعذر إنشاء مساحة الرسم لـ OCR.', 'Could not allocate the OCR canvas.'));
                await page.render({ canvasContext: ctx, viewport }).promise;
                const result = await worker.recognize(canvas);
                ocrLines.push(...result.data.text.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean));
              } finally {
                canvas.width = 0; canvas.height = 0;
                page.cleanup();
              }
            }
            headers = ['OCR text'];
            rows = ocrLines.map((v, i) => ({ 'OCR text': v, 'Line': i + 1 }));
            note = t('اكتمل OCR لجميع الصفحات، لكن الناتج نصي غير منظّم وقد لا يحافظ على أعمدة الجدول. راجع كل سطر بصرياً. قد تُنزّل بيانات اللغة عند أول استخدام.', 'OCR processed all pages, but the output is unstructured text and may not preserve table columns. Visually verify each line. Language data may download on first use.');
          } finally { await worker.terminate(); }
        }
      } else {
        throw new Error(t('صيغة الملف غير مدعومة. استخدم XLSX أو XLS أو CSV أو PDF.', 'Unsupported file. Use XLSX, XLS, CSV, or PDF.'));
      }
      const mapping = detectColumns(headers);
      setFile({ name: selected.name, rows, headers, mapping, kind, note });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('تعذرت قراءة الملف.', 'Could not read file.'));
    } finally { if (releasePdf) { try { await releasePdf(); } catch { /* parser cleanup is best effort */ } } setBusy(false); }
  }

  function setMapping(field: Field, value: string) {
    if (!file) return;
    const next = { ...file.mapping };
    if (value === '') delete next[field]; else next[field] = Number(value);
    setFile({ ...file, mapping: next }); setConfirmed(false);
  }

  function redetectColumns() {
    if (!file) return;
    setFile({ ...file, mapping: detectColumns(file.headers) });
    setConfirmed(false);
    setMatchResult(null);
  }

  const preview = normalized.slice(0, 10);
  return <main className={lang === 'ar' ? 'app rtl' : 'app ltr'} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <header className="topbar">
      <div className="brand"><div className="brand-icon">BR</div><div><strong>Bank Reconciliation Pro</strong><span>{t('استيراد ومراجعة البيانات المحاسبية', 'Local statement import & review')}</span></div></div>
      <button className="language" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'English' : 'العربية'}</button>
    </header>
    <section className="hero">
      <div className="eyebrow">{t('المرحلة الأولى · استيراد البيانات', 'STAGE 1 · DATA IMPORT')}</div>
      <h1>{t('ابدأ من بيانات واضحة.', 'Start with clean data.')}</h1>
      <p>{t('استورد كشف البنك أو دفتر الأستاذ، راجع الأعمدة، وتحقق من البيانات قبل بدء المطابقة.', 'Import a bank statement or ledger, map columns, and validate the data before reconciliation.')}</p>
      <div className="privacy"><span className="shield">✓</span><span><b>{t('المعالجة على جهازك', 'Processed on your device')}</b><small>{t('لا يوجد خادم خلفي أو نقطة رفع للملفات. OCR قد يجلب بيانات اللغة عند أول تشغيل.', 'No backend or file-upload endpoint. OCR may fetch language data on first use.')}</small></span></div>
    </section>
    <section className="panel">
      <div className="section-title"><div><span className="step">01</span><h2>{t('استيراد ملف', 'Import a file')}</h2></div><span className="muted">{t('Excel · CSV · PDF', 'Excel · CSV · PDF')}</span></div>
      <label className="dropzone">
        <input type="file" accept=".xlsx,.xls,.csv,.txt,.pdf" onChange={e => handleFile(e.target.files?.[0])}/>
        <div className="upload-icon">↑</div><b>{t('اختر ملفاً من جهازك', 'Choose a file from your device')}</b><span>{t('لا يتم إرسال الملف إلى خادم', 'The file is not sent to a server')}</span>
      </label>
      {busy && <p className="status">{t('جارٍ تحليل الملف محلياً…', 'Parsing file locally…')}</p>}
      {ocr && <p className="status">{t('تشغيل OCR محلياً…', 'Running local OCR…')}</p>}
      {error && <div className="alert error">{error}</div>}
      {file && <>
        <div className="file-meta"><span className="file-badge">{file.kind.toUpperCase()}</span><div><b>{file.name}</b><small>{file.rows.length} {t('صفوف بيانات', 'data rows')}</small></div><span className="ok-pill">{t('تمت القراءة', 'Read')}</span></div>
        {file.note && <div className="alert">{file.note}</div>}
        <div className="section-title mapping-heading"><div><span className="step">02</span><h2>{t('راجع تعيين الأعمدة', 'Review column mapping')}</h2></div><button className="secondary compact" type="button" onClick={redetectColumns}>{t('إعادة اكتشاف الأعمدة', 'Re-detect columns')}</button></div>
        <p className="helper">{t('التعيين تلقائي مبدئياً. تأكد من صحة كل عمود قبل اعتماد الاستيراد.', 'Auto-detection is a starting point. Verify every field before accepting the import.')}</p>
        <div className="mapping-grid">{FIELDS.map(field => <label className="map-field" key={field}><span>{LABELS[field][lang === 'ar' ? 0 : 1]}</span><select value={file.mapping[field] === undefined ? '' : String(file.mapping[field])} onChange={e => setMapping(field, e.target.value)}><option value="">{t('غير معيّن', 'Not mapped')}</option>{file.headers.map((h, i) => <option key={`${h}-${i}`} value={i}>{h || `Column ${i + 1}`}</option>)}</select></label>)}</div>
        <div className="section-title preview-heading"><div><span className="step">03</span><h2>{t('معاينة البيانات', 'Data preview')}</h2></div><span className="muted">{t('أول 10 صفوف', 'First 10 rows')}</span></div>
        <div className="table-wrap"><table><thead><tr>{(['date', 'description', 'debit', 'credit', 'balance'] as Field[]).map(f => <th key={f}>{LABELS[f][lang === 'ar' ? 0 : 1]}</th>)}<th>{t('حالة التاريخ', 'Date status')}</th></tr></thead><tbody>{preview.map((r, i) => <tr key={i} className={r.isOpeningBalance ? 'opening-balance-row' : undefined}><td>{r.date ?? '—'}</td><td>{r.description || '—'}{r.isOpeningBalance && <small className="row-tag">{t('رصيد افتتاحي', 'Opening balance')}</small>}</td><td>{r.debit ?? '—'}</td><td>{r.credit ?? '—'}</td><td>{r.balance ?? '—'}</td><td>{r.isOpeningBalance ? t('رصيد وليس حركة', 'Balance, not transaction') : r.date ? t('مقروء', 'Parsed') : t('راجع التاريخ', 'Check date')}</td></tr>)}</tbody></table></div>
        <div className="validation">
          <div className="validation-title"><b>{t('التحقق من البيانات', 'Data validation')}</b><span className={warnings.length ? 'warning-pill' : 'ok-pill'}>{warnings.length} {t('ملاحظات', 'warnings')}</span></div>
          {warnings.length === 0 ? <p className="good">{t('لم تُكتشف مشكلات أساسية في الحقول المطلوبة.', 'No basic validation issues detected.')}</p> : <ul>{warnings.slice(0, 12).map((w, i) => <li key={i}>{t('الصف', 'Row')} {w.row}: {w.message}</li>)}</ul>}
          {warnings.length > 12 && <small>{t('وملاحظات إضافية', 'Additional warnings')} ({warnings.length - 12})</small>}
        </div>
        <div className="import-actions"><button className="primary" disabled={file.mapping.date === undefined || (file.mapping.amount === undefined && file.mapping.debit === undefined && file.mapping.credit === undefined)} onClick={() => { setBankData(normalized); setConfirmed(true); setMatchResult(null); }}>{t('اعتماد ككشف بنك', 'Use as bank statement')}</button><button className="secondary" disabled={file.mapping.date === undefined || (file.mapping.amount === undefined && file.mapping.debit === undefined && file.mapping.credit === undefined)} onClick={() => { setLedgerData(normalized); setConfirmed(true); setMatchResult(null); }}>{t('اعتماد كدفتر أستاذ', 'Use as ledger')}</button></div>
        {confirmed && <div className="alert success">{t(`تم حفظ ${normalized.length} صفاً في ذاكرة الصفحة. اختر الدور الصحيح للملف؛ يمكنك استيراد الملف الآخر الآن.`, `Saved ${normalized.length} rows in page memory. Assign the correct role; you can now import the other file.`)}</div>}
      </>}
    </section>
    <section className="panel reconciliation-panel">
      <div className="section-title"><div><span className="step">04</span><h2>{t('المطابقة البنكية', 'Bank reconciliation')}</h2></div><span className="muted">{t('مطابقة أولية محافظة', 'Conservative first-pass matching')}</span></div>
      <div className="source-status"><span className={bankData ? 'ok-pill' : 'warning-pill'}>{bankData ? t(`كشف البنك: ${bankData.length} صف`, `Bank: ${bankData.length} rows`) : t('كشف البنك غير محدد', 'Bank statement not assigned')}</span><span className={ledgerData ? 'ok-pill' : 'warning-pill'}>{ledgerData ? t(`دفتر الأستاذ: ${ledgerData.length} صف`, `Ledger: ${ledgerData.length} rows`) : t('دفتر الأستاذ غير محدد', 'Ledger not assigned')}</span></div>
      <div className="match-controls"><label>{t('نافذة فرق التاريخ (أيام)', 'Date window (days)')}<select value={dateWindowDays} onChange={e => setDateWindowDays(Number(e.target.value))}><option value={0}>0</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label><button className="primary" disabled={!bankData || !ledgerData} onClick={() => setMatchResult(matchTransactions(bankData!, ledgerData!, { dateWindowDays }))}>{t('تشغيل المطابقة', 'Run matching')}</button></div>
      {matchResult && <><div className="match-summary"><div><strong>{matchResult.summary.matchedCount}</strong><span>{t('مطابقة مقترحة', 'Suggested matches')}</span></div><div><strong>{matchResult.summary.unmatchedBankCount}</strong><span>{t('غير مطابق — البنك', 'Unmatched — bank')}</span></div><div><strong>{matchResult.summary.unmatchedLedgerCount}</strong><span>{t('غير مطابق — الأستاذ', 'Unmatched — ledger')}</span></div><div><strong>{matchResult.summary.ambiguousCount}</strong><span>{t('حالات ملتبسة', 'Ambiguous cases')}</span></div></div><div className="match-export-actions"><button className="secondary" type="button" onClick={exportReconciliationReport}>{t('تصدير التقرير إلى Excel', 'Export report to Excel')}</button><span className="muted">{t('يشمل الملخص والمطابقات وجميع الحركات غير المطابقة والحالات الملتبسة.', 'Includes summary, matched items, unmatched transactions, and ambiguous cases.')}</span></div><div className="alert">{t('هذه اقتراحات آلية أولية وليست اعتماداً محاسبياً. تأكد من اتفاق اتجاه المدين/الدائن في الملفين، وراجع كل نتيجة قبل اعتمادها.', 'These are preliminary automated suggestions, not accounting approval. Confirm debit/credit sign conventions match across both files and review every result before acceptance.')}</div><h3 className="subheading">{t('تفاصيل المطابقات المقترحة', 'Suggested match details')}</h3><p className="helper">{t('قارن التاريخ والبيان واتجاه المبلغ لكل طرف. فرق المبلغ محسوب بإشارة الدائن ناقص المدين وفق الأعمدة المستوردة.', 'Compare dates, descriptions and amount direction for both sources. Amount difference is calculated as credit minus debit using imported columns.')}</p><div className="table-wrap"><table><thead><tr><th>{t('صف البنك', 'Bank row')}</th><th>{t('تاريخ وبيان البنك', 'Bank date & description')}</th><th>{t('حركة البنك', 'Bank movement')}</th><th>{t('رصيد البنك', 'Bank balance')}</th><th>{t('صف الأستاذ', 'Ledger row')}</th><th>{t('تاريخ وبيان الأستاذ', 'Ledger date & description')}</th><th>{t('حركة الأستاذ', 'Ledger movement')}</th><th>{t('رصيد الأستاذ', 'Ledger balance')}</th><th>{t('أساس المطابقة', 'Match basis')}</th><th>{t('فرق المبلغ', 'Amount difference')}</th><th>{t('فرق التاريخ (أيام)', 'Date difference (days)')}</th></tr></thead><tbody>{matchResult.matches.map(m => { const bankRow = bankData?.[m.bankIndex]; const ledgerRow = ledgerData?.[m.ledgerIndex]; return <tr key={`${m.bankIndex}-${m.ledgerIndex}`}><td>{m.bankIndex + 2}</td><td><strong>{bankRow?.date || '—'}</strong><span className="table-sub">{bankRow?.description || t('لا يوجد بيان', 'No description')}</span></td><td>{formatMovement(bankRow)}</td><td>{bankRow?.balance == null ? '—' : formatMoney(bankRow.balance)}</td><td>{m.ledgerIndex + 2}</td><td><strong>{ledgerRow?.date || '—'}</strong><span className="table-sub">{ledgerRow?.description || t('لا يوجد بيان', 'No description')}</span></td><td>{formatMovement(ledgerRow)}</td><td>{ledgerRow?.balance == null ? '—' : formatMoney(ledgerRow.balance)}</td><td>{m.confidence === 'exact' ? t('مبلغ + تاريخ + بيان', 'Amount + date + description') : t('مبلغ + تاريخ فقط', 'Amount + date only')}</td><td>{formatMoney(m.amountDifference)}</td><td>{m.dateDifferenceDays ?? '—'}</td></tr>; })}{matchResult.matches.length === 0 && <tr><td colSpan={11}>{t('لا توجد مطابقات مقترحة. راجع إشارات المبالغ وتعيين الأعمدة.', 'No suggested matches. Check amount signs and column mapping.')}</td></tr>}</tbody></table></div>{matchResult.unmatchedBank.length > 0 && <><h3 className="subheading">{t('حركات غير مطابقة — كشف البنك', 'Unmatched transactions — bank statement')}</h3><div className="table-wrap"><table><thead><tr><th>{t('صف البنك', 'Bank row')}</th><th>{t('التاريخ', 'Date')}</th><th>{t('البيان', 'Description')}</th><th>{t('المدين', 'Debit')}</th><th>{t('الدائن', 'Credit')}</th><th>{t('الرصيد', 'Balance')}</th></tr></thead><tbody>{matchResult.unmatchedBank.map(index => { const row = bankData?.[index]; return <tr key={`bank-${index}`}><td>{index + 2}</td><td>{row?.date || '—'}</td><td>{row?.description || '—'}</td><td>{row?.debit == null ? '—' : formatMoney(row.debit)}</td><td>{row?.credit == null ? '—' : formatMoney(row.credit)}</td><td>{row?.balance == null ? '—' : formatMoney(row.balance)}</td></tr>; })}</tbody></table></div></>}{matchResult.unmatchedLedger.length > 0 && <><h3 className="subheading">{t('حركات غير مطابقة — دفتر الأستاذ', 'Unmatched transactions — ledger')}</h3><div className="table-wrap"><table><thead><tr><th>{t('صف الأستاذ', 'Ledger row')}</th><th>{t('التاريخ', 'Date')}</th><th>{t('البيان', 'Description')}</th><th>{t('المدين', 'Debit')}</th><th>{t('الدائن', 'Credit')}</th><th>{t('الرصيد', 'Balance')}</th></tr></thead><tbody>{matchResult.unmatchedLedger.map(index => { const row = ledgerData?.[index]; return <tr key={`ledger-${index}`}><td>{index + 2}</td><td>{row?.date || '—'}</td><td>{row?.description || '—'}</td><td>{row?.debit == null ? '—' : formatMoney(row.debit)}</td><td>{row?.credit == null ? '—' : formatMoney(row.credit)}</td><td>{row?.balance == null ? '—' : formatMoney(row.balance)}</td></tr>; })}</tbody></table></div></>}{matchResult.ambiguous.length > 0 && <><h3 className="subheading">{t('حالات تحتاج مراجعة', 'Cases needing review')}</h3><ul className="ambiguous-list">{matchResult.ambiguous.map((a, i) => <li key={`${a.bankIndex}-${i}`}>{t('صف البنك', 'Bank row')} {a.bankIndex + 2}: {t('يوجد أكثر من احتمال؛ لم تتم المطابقة تلقائياً.', 'multiple candidates exist; no automatic match was made.')}</li>)}</ul></>}</>}
    </section>
    <footer>{t('إصدار تجريبي 0.2 · مطابقة أولية للمراجعة', 'Prototype 0.2 · Preliminary matching for review')} <span>•</span> {t('لا تنفذ قيوداً محاسبية', 'Does not post journal entries')}</footer>
  </main>;
}