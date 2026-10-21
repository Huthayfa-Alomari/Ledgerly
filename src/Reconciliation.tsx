import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker } from 'tesseract.js';
import { detectColumns, normalizeRows, validateRows, matchTransactions } from './core.mjs';

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
  const normalized = useMemo(() => file ? normalizeRows(file.rows, file.mapping) : [], [file]);
  const warnings = useMemo(() => validateRows(normalized), [normalized]);

  async function handleFile(selected?: File) {
    if (!selected) return;
    if (selected.size > 50 * 1024 * 1024) { setError(t('حجم الملف يتجاوز الحد الآمن (50 ميغابايت).', 'File exceeds the safety limit (50 MiB).')); return; }
    setError(''); setFile(null); setConfirmed(false); setMatchResult(null); setBusy(true); setOcr(false);
    let releasePdf: (() => Promise<void>) | null = null;
    try {
      const ext = selected.name.split('.').pop()?.toLowerCase();
      let rows: Row[] = []; let headers: string[] = []; let kind = ext ?? 'unknown'; let note = '';
      if (ext === 'csv' || ext === 'txt') {
        const text = await selected.text();
        const workbook = XLSX.read(text, { type: 'string', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
        headers = (matrix[0] ?? []).map(String);
        rows = matrix.slice(1).filter(r => r.some(v => String(v).trim() !== ''));
      } else if (ext === 'xlsx' || ext === 'xls') {
        const workbook = XLSX.read(await selected.arrayBuffer(), { type: 'array', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
        headers = (matrix[0] ?? []).map(String);
        rows = matrix.slice(1).filter(r => r.some(v => String(v).trim() !== ''));
      } else if (ext === 'pdf') {
        const pdfjs = pdfjsLib as unknown as { GlobalWorkerOptions: { workerSrc: string }; getDocument: (x: unknown) => { promise: Promise<any> } };
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const doc = await pdfjs.getDocument({ data: await selected.arrayBuffer(), enableScripting: false, isEvalSupported: false, enableXfa: false, stopAtErrors: true }).promise;
        releasePdf = () => doc.destroy();
        if (doc.numPages > 500) throw new Error(t('ملف PDF يتجاوز حد 500 صفحة.', 'PDF exceeds the 500-page safety limit.'));
        const pageLines: string[][] = [];
        for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
          const page = await doc.getPage(pageNo);
          const content = await page.getTextContent();
          const grouped = new Map<number, Array<{ x: number; text: string }>>();
          for (const item of content.items as any[]) {
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
            if (cells.length) pageLines.push(cells);
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
          setOcr(true);
          const worker = await createWorker('ara+eng');
          try {
            const ocrLines: string[] = [];
            for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
              const page = await doc.getPage(pageNo);
              const viewport = page.getViewport({ scale: 2 });
              const canvas = document.createElement('canvas');
              canvas.width = viewport.width; canvas.height = viewport.height;
              const ctx = canvas.getContext('2d');
              if (!ctx) throw new Error('Canvas unavailable');
              await page.render({ canvasContext: ctx, viewport }).promise;
              const result = await worker.recognize(canvas);
              ocrLines.push(...result.data.text.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean));
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
      {matchResult && <><div className="match-summary"><div><strong>{matchResult.summary.matchedCount}</strong><span>{t('مطابقة مقترحة', 'Suggested matches')}</span></div><div><strong>{matchResult.summary.unmatchedBankCount}</strong><span>{t('غير مطابق — البنك', 'Unmatched — bank')}</span></div><div><strong>{matchResult.summary.unmatchedLedgerCount}</strong><span>{t('غير مطابق — الأستاذ', 'Unmatched — ledger')}</span></div><div><strong>{matchResult.summary.ambiguousCount}</strong><span>{t('حالات ملتبسة', 'Ambiguous cases')}</span></div></div><div className="alert">{t('هذه اقتراحات آلية أولية وليست اعتماداً محاسبياً. تأكد من اتفاق اتجاه المدين/الدائن في الملفين، وراجع كل نتيجة قبل اعتمادها.', 'These are preliminary automated suggestions, not accounting approval. Confirm debit/credit sign conventions match across both files and review every result before acceptance.')}</div><h3 className="subheading">{t('المطابقات المقترحة', 'Suggested matches')}</h3><div className="table-wrap"><table><thead><tr><th>{t('صف البنك', 'Bank row')}</th><th>{t('صف الأستاذ', 'Ledger row')}</th><th>{t('درجة المطابقة', 'Match basis')}</th><th>{t('فرق التاريخ', 'Date difference')}</th></tr></thead><tbody>{matchResult.matches.map(m => <tr key={`${m.bankIndex}-${m.ledgerIndex}`}><td>{m.bankIndex + 2}</td><td>{m.ledgerIndex + 2}</td><td>{m.confidence === 'exact' ? t('مبلغ + تاريخ + بيان', 'Amount + date + description') : t('مبلغ + تاريخ فقط', 'Amount + date only')}</td><td>{m.dateDifferenceDays ?? '—'}</td></tr>)}{matchResult.matches.length === 0 && <tr><td colSpan={4}>{t('لا توجد مطابقات مقترحة. راجع إشارات المبالغ وتعيين الأعمدة.', 'No suggested matches. Check amount signs and column mapping.')}</td></tr>}</tbody></table></div>{matchResult.ambiguous.length > 0 && <><h3 className="subheading">{t('حالات تحتاج مراجعة', 'Cases needing review')}</h3><ul className="ambiguous-list">{matchResult.ambiguous.map((a, i) => <li key={`${a.bankIndex}-${i}`}>{t('صف البنك', 'Bank row')} {a.bankIndex + 2}: {t('يوجد أكثر من احتمال؛ لم تتم المطابقة تلقائياً.', 'multiple candidates exist; no automatic match was made.')}</li>)}</ul></>}</>}
    </section>
    <footer>{t('إصدار تجريبي 0.2 · مطابقة أولية للمراجعة', 'Prototype 0.2 · Preliminary matching for review')} <span>•</span> {t('لا تنفذ قيوداً محاسبية', 'Does not post journal entries')}</footer>
  </main>;
}