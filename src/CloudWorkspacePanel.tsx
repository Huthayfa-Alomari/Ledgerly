import { useEffect, useState } from 'react';
import type { SupabaseBrowserConfig } from './lib/supabase-config';
import type { CloudDB, CloudEvidence, CloudSession } from './lib/cloud-workspace';
import { downloadEvidence, getCurrentFirm, listCloudEvidence, pullWorkspace, pushWorkspace, uploadEvidence } from './lib/cloud-workspace';

type Props = { config: SupabaseBrowserConfig; session: CloudSession | null; db: CloudDB; onRestore: (db: CloudDB) => void };
export default function CloudWorkspacePanel({ config, session, db, onRestore }: Props) {
  const [firmId, setFirmId] = useState('');
  const [remoteVersion, setRemoteVersion] = useState<number | null>(null);
  const [rows, setRows] = useState<CloudEvidence[]>([]);
  const [engagementId, setEngagementId] = useState('');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [confirmedRestore, setConfirmedRestore] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!session) { setFirmId(''); setRemoteVersion(null); setRows([]); return; }
    void getCurrentFirm(config, session).then(async id => {
      const result = await pullWorkspace(config, session, id, false);
      const evidence = await listCloudEvidence(config, session, id).catch(() => []);
      if (alive) { setFirmId(id); setRemoteVersion(result.row?.version || 0); setRows(evidence); }
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'تعذر تحميل حالة المكتب.'); });
    return () => { alive = false; };
  }, [config.url, config.anonKey, session?.access_token]);

  const pull = async () => {
    if (!session || !firmId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await pullWorkspace(config, session, firmId);
      setRemoteVersion(result.row?.version || 0);
      if (!result.row) { localStorage.setItem(`ledgerly.cloud.baseline.v1.${firmId}`, '0'); setNotice('لا توجد نسخة سحابية لهذا المكتب بعد. يمكنك رفع بياناته المحلية بعد أخذ نسخة احتياطية.'); return; }
      const payload = result.row.payload as Partial<CloudDB> | null;
      const requiredArrays = ['clients','engagements','risks','workpapers','findings','evidence','trialBalance','auditLog'];
      if (!payload || !requiredArrays.every(key => Array.isArray((payload as Record<string, unknown>)[key])) || !payload.completionChecks || typeof payload.completionChecks !== 'object') {
        throw new Error('النسخة السحابية لا تطابق مخطط بيانات Ledgerly الحالي؛ لم يتم استبدال البيانات المحلية.');
      }
      if (!window.confirm('سيتم استبدال بيانات هذا الجهاز بالنسخة السحابية. صدّر نسخة احتياطية محلية أولًا. هل تريد المتابعة؟')) return;
      onRestore(result.row.payload as CloudDB);
      setNotice(`تم استرجاع النسخة السحابية رقم ${result.row.version}. راجع البيانات قبل متابعة العمل.`);
      const evidence = await listCloudEvidence(config, session, firmId);
      setRows(evidence);
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر سحب النسخة السحابية.'); }
    finally { setBusy(false); }
  };
  const push = async () => {
    if (!session || !firmId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const row = await pushWorkspace(config, session, firmId, db);
      setRemoteVersion(row.version);
      setNotice(`تمت مزامنة نسخة المكتب رقم ${row.version}. لا تزال المزامنة نسخة مكتب كاملة وليست دمجًا لكل سجل.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر رفع النسخة السحابية.'); }
    finally { setBusy(false); }
  };
  const upload = async () => {
    if (!session || !firmId || !file) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const row = await uploadEvidence(config, session, firmId, engagementId, title, file);
      setRows(old => [row, ...old]); setFile(null); setTitle('');
      setNotice(`تم رفع الدليل الخاص وحفظ بصمته SHA-256: ${row.file_sha256.slice(0, 12)}…`);
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر رفع الدليل.'); }
    finally { setBusy(false); }
  };
  const download = async (row: CloudEvidence) => {
    if (!session) return;
    setBusy(true); setError('');
    try { await downloadEvidence(config, session, row); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر تنزيل الدليل.'); }
    finally { setBusy(false); }
  };

  return <section className="audit-card cloud-workspace-panel">
    <div className="audit-card-head"><div><h3>المزامنة السحابية والأدلة</h3><p className="muted-copy">اختيارية — النسخة السحابية منفصلة عن التخزين المحلي، ولا يتم رفع شيء تلقائيًا.</p></div><span className={session && firmId ? 'audit-pill' : 'audit-pill risk-pill'}>{session && firmId ? 'جاهز للمزامنة' : 'يلزم ربط مكتب'}</span></div>
    {!session ? <p className="cloud-auth-note">سجّل الدخول أولًا لعرض أدوات المزامنة ورفع الأدلة.</p> : <>
      <div className="summary-lines"><div><strong>معرّف المكتب</strong><span>{firmId || 'جارٍ التحقق من العضوية…'}</span></div><div><strong>آخر إصدار سحابي</strong><span>{remoteVersion === null ? 'جارٍ الفحص…' : remoteVersion}</span></div><div><strong>سجلات محلية</strong><span>{db.clients.length} عميل · {db.engagements.length} مهمة · {db.workpapers.length} ورقة عمل</span></div></div>
      <div className="stack-actions"><button className="audit-secondary" disabled={busy || !firmId} onClick={() => void pull()}>{busy ? 'جارٍ التنفيذ…' : 'سحب النسخة السحابية'}</button><button className="audit-primary" disabled={busy || !firmId} onClick={() => void push()}>{busy ? 'جارٍ التنفيذ…' : 'رفع / مزامنة بيانات المكتب'}</button></div>
      <p className="cloud-auth-note">آلية التعارض: يجب سحب النسخة أولًا لتثبيت إصدارها. إذا عدّل جهاز آخر النسخة، يرفض النظام الرفع بدل الكتابة فوقها. المزامنة الحالية نسخة مكتب كاملة بحد 10 ميغابايت؛ ليست دمجًا متزامنًا لكل سجل.</p>
      <hr />
      <h4>رفع دليل تدقيق خاص</h4>
      <p className="cloud-auth-note">الحد 25 ميغابايت. الملفات خاصة ولا تستخدم روابط عامة. اختر المهمة الصحيحة؛ صلاحية الخادم هي التي تقرر الوصول.</p>
      <div className="cloud-auth-fields">
        <label className="audit-field"><span>ملف التدقيق</span><select value={engagementId} onChange={e => setEngagementId(e.target.value)}><option value="">اختر ملف التدقيق</option>{db.engagements.map(e => <option key={e.id} value={e.id}>{String(e.year || '')} — {String(e.type || '')} — {e.id}</option>)}</select></label>
        <label className="audit-field"><span>عنوان الدليل</span><input value={title} onChange={e => setTitle(e.target.value)} placeholder="مثال: كشف البنك المؤيد" /></label>
        <label className="audit-field"><span>الملف</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.xlsx,.xls,.docx" onChange={e => setFile(e.target.files?.[0] || null)} /></label>
      </div>
      <button className="audit-primary" disabled={busy || !file || !engagementId} onClick={() => void upload()}>{busy ? 'جارٍ التنفيذ…' : 'رفع الدليل إلى التخزين الخاص'}</button>
      <h4>الأدلة السحابية ({rows.length})</h4>
      {rows.length ? <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>العنوان</th><th>اسم الملف</th><th>الحجم</th><th>SHA-256</th><th></th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.title}</td><td>{row.file_name}</td><td>{(row.file_size / 1024).toFixed(1)} KB</td><td><code>{row.file_sha256.slice(0, 12)}…</code></td><td><button className="audit-text-button" disabled={busy} onClick={() => void download(row)}>تنزيل</button></td></tr>)}</tbody></table></div> : <p className="cloud-auth-note">لا توجد أدلة سحابية مسجلة لهذا المكتب أو لا تسمح صلاحياتك بعرضها.</p>}
    </>}
    {error && <p className="cloud-auth-error" role="alert">{error}</p>}
    {notice && <p className="cloud-auth-success" role="status">{notice}</p>}
  </section>;
}
