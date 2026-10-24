import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CloudSession } from './CloudAuthPanel';
import type { SupabaseConfigResult } from './lib/supabase-config';
import './styles.css';

type ClientRow = { id: string; firm_id: string; name: string; status: string };
type EngagementRow = { id: string; firm_id: string; client_id: string };
type RequestRow = { id: string; firm_id: string; engagement_id: string; request_ref: string; title: string; description?: string; due_date?: string | null; priority: string; status: string; created_at: string };
type SubmissionRow = {
  id: string; firm_id: string; request_id: string; submitted_by_name: string; submitted_by_portal_user_id?: string;
  object_key: string; file_name: string; mime_type: string; file_size: number; file_sha256: string;
  uploaded_at: string; scan_status: string; rejection_reason?: string | null;
  scan_provider?: string | null; scan_reference?: string | null; scan_completed_at?: string | null; scan_completed_by?: string | null;
};
const BUCKET = 'ledgerly-client-submissions';
const PORTAL_ENABLED = import.meta.env.VITE_LEDGERLY_ENABLE_CLIENT_PORTAL === 'true';

function readError(body: any, fallback: string) {
  if (typeof body?.message === 'string') return body.message;
  if (typeof body?.error === 'string') return body.error;
  if (typeof body?.details === 'string') return body.details;
  return fallback;
}
function moneyBytes(value: number) {
  return new Intl.NumberFormat('ar-JO', { maximumFractionDigits: 0 }).format(value);
}
function scanLabel(value: string) {
  const labels: Record<string, string> = { pending: 'بانتظار الفحص', clean: 'تم تسجيل فحص نظافة', quarantined: 'محجور', failed: 'تعذر الفحص' };
  return labels[value] || value;
}

export default function ClientPortalAdminPanel({ config, session, enabled = PORTAL_ENABLED }: {
  config: SupabaseConfigResult;
  session: CloudSession | null;
  enabled?: boolean;
}) {
  const supabase = config.configured ? config.config : null;
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [engagements, setEngagements] = useState<EngagementRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [selectedEngagement, setSelectedEngagement] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [requestedFrom, setRequestedFrom] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('normal');
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [scanProviders, setScanProviders] = useState<Record<string, string>>({});
  const [scanReferences, setScanReferences] = useState<Record<string, string>>({});
  const [scanConfirmed, setScanConfirmed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);

  const engagementChoices = useMemo(() => engagements.filter(item => clients.some(client => client.id === item.client_id && client.firm_id === item.firm_id)), [engagements, clients]);
  const selected = engagementChoices.find(item => item.id === selectedEngagement);
  const selectedClient = selected ? clients.find(item => item.id === selected.client_id && item.firm_id === selected.firm_id) : undefined;
  const requestsById = useMemo(() => new Map(requests.map(request => [request.id, request])), [requests]);

  const api = useCallback(async (path: string, options: RequestInit = {}) => {
    if (!supabase || !session?.access_token) throw new Error('سجّل الدخول السحابي بمستخدم مكتب مخوّل أولًا.');
    const headers: Record<string, string> = {
      apikey: supabase.anonKey,
      Authorization: 'Bearer ' + session.access_token,
    };
    if (options.body && typeof options.body === 'string') headers['Content-Type'] = 'application/json';
    Object.assign(headers, (options.headers || {}) as Record<string, string>);
    const response = await fetch(supabase.url + path, { ...options, headers });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(readError(body, 'رفضت خدمة Ledgerly العملية. تحقق من صلاحيات المكتب وسياسات Supabase.'));
    return body;
  }, [supabase, session]);

  const reload = useCallback(async () => {
    if (!enabled || !supabase || !session?.access_token) return;
    setBusy(true); setError('');
    try {
      const [clientRows, engagementRows, requestRows, submissionRows] = await Promise.all([
        api('/rest/v1/client?select=id,firm_id,name,status&status=eq.active&order=name.asc'),
        api('/rest/v1/engagement?select=id,firm_id,client_id&deleted_at=is.null'),
        api('/rest/v1/pbc_request?select=id,firm_id,engagement_id,request_ref,title,description,due_date,priority,status,created_at&order=created_at.desc&limit=100'),
        api('/rest/v1/pbc_submission?select=id,firm_id,request_id,submitted_by_name,submitted_by_portal_user_id,object_key,file_name,mime_type,file_size,file_sha256,uploaded_at,scan_status,rejection_reason,scan_provider,scan_reference,scan_completed_at,scan_completed_by&order=uploaded_at.desc&limit=100'),
      ]);
      setClients(Array.isArray(clientRows) ? clientRows : []);
      setEngagements(Array.isArray(engagementRows) ? engagementRows : []);
      setRequests(Array.isArray(requestRows) ? requestRows : []);
      setSubmissions(Array.isArray(submissionRows) ? submissionRows : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر تحميل بيانات بوابة العميل.'); 
    } finally { setBusy(false); }
  }, [enabled, supabase, session, api]);

  useEffect(() => { void reload(); }, [reload, revision]);

  async function createRequest(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !selectedClient || !session) { setError('اختر ملف تدقيق صالحًا.'); return; }
    if (title.trim().length < 3 || title.trim().length > 200) { setError('عنوان الطلب مطلوب (3–200 حرف).'); return; }
    if (description.length > 2000) { setError('الوصف لا يتجاوز 2000 حرف.'); return; }
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) { setError('تاريخ الاستحقاق غير صالح.'); return; }
    setBusyAction('request'); setError(''); setNotice('');
    const reference = 'PBC-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + crypto.randomUUID().slice(0, 6).toUpperCase();
    try {
      await api('/rest/v1/pbc_request', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          firm_id: selected.firm_id,
          engagement_id: selected.id,
          request_ref: reference,
          title: title.trim(),
          description: description.trim() || null,
          requested_from: requestedFrom.trim() || selectedClient.name,
          due_date: dueDate || null,
          priority,
          status: 'requested',
          requested_by: session.user?.id || null,
          created_at: new Date().toISOString(),
        }),
      });
      setTitle(''); setDescription(''); setRequestedFrom(''); setDueDate(''); setPriority('normal');
      setNotice('تم إنشاء طلب المستند ' + reference + ' في السجلات السحابية لهذا الارتباط. هذه الطلبات مستقلة عن بيانات مساحة العمل المحلية؛ لا توجد مزامنة تلقائية بينهما.');
      setRevision(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر إنشاء طلب المستند.');
    } finally { setBusyAction(''); }
  }

  async function inviteContact(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) { setError('اختر ملف التدقيق الذي سيُقيَّد عليه وصول جهة الاتصال.'); return; }
    if (inviteName.trim().length < 2 || inviteName.trim().length > 120) { setError('اسم جهة الاتصال مطلوب.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())) { setError('البريد الإلكتروني غير صالح.'); return; }
    setBusyAction('invite'); setError(''); setNotice('');
    try {
      const result = await api('/functions/v1/ledgerly-invite-client-contact', {
        method: 'POST',
        body: JSON.stringify({ engagement_id: selected.id, email: inviteEmail.trim().toLowerCase(), display_name: inviteName.trim() }),
      });
      setNotice('أُرسلت الدعوة إلى ' + inviteEmail.trim() + '. الوصول يبدأ فقط بعد تأكيد البريد وقبول الدعوة. ' + (result?.message || ''));
      setInviteName(''); setInviteEmail('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر إرسال الدعوة. قد تكون الدعوات معطّلة على الخادم.');
    } finally { setBusyAction(''); }
  }

  async function downloadForScan(row: SubmissionRow) {
    if (!supabase || !session) return;
    if (!window.confirm('قد يكون الملف غير مفحوص وقد يحتوي محتوى ضارًا. نزّله فقط إلى بيئة فحص معتمدة، ولا تفتحه على جهاز العمل مباشرة. هل أكملت الاحتياطات؟')) return;
    setBusyAction('download:' + row.id); setError('');
    try {
      const objectPath = row.object_key.split('/').map(part => encodeURIComponent(part)).join('/');
      const response = await fetch(supabase.url + '/storage/v1/object/' + BUCKET + '/' + objectPath, {
        headers: { apikey: supabase.anonKey, Authorization: 'Bearer ' + session.access_token },
      });
      if (!response.ok) throw new Error('لم تسمح سياسة التخزين بتنزيل الملف أو انتهت الجلسة.');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl; link.download = row.file_name || 'client-submission'; link.rel = 'noopener';
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      setNotice('تم تنزيل نسخة للفحص الخارجي. لا تسجّل نتيجة نظافة قبل انتهاء الفحص الفعلي.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر تنزيل الملف إلى بيئة الفحص.');
    } finally { setBusyAction(''); }
  }

  async function recordScanResult(row: SubmissionRow, status: 'clean' | 'quarantined') {
    if (!session) return;
    const provider = (scanProviders[row.id] || '').trim();
    const reference = (scanReferences[row.id] || '').trim();
    if (provider.length < 2 || provider.length > 120 || reference.length < 2 || reference.length > 240) {
      setError('سجّل اسم أداة الفحص ومرجع تقرير الفحص أو نتيجة قابلة للتتبّع.'); return;
    }
    if (status === 'clean' && !scanConfirmed[row.id]) {
      setError('أكد أنك أجريت الفحص الخارجي فعليًا قبل فتح تنزيل الملف للعميل.'); return;
    }
    setBusyAction('scan:' + row.id); setError(''); setNotice('');
    try {
      const now = new Date().toISOString();
      await api('/rest/v1/pbc_submission?id=eq.' + encodeURIComponent(row.id), {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          scan_status: status,
          scan_provider: provider,
          scan_reference: reference,
          scan_completed_at: now,
          scan_completed_by: session.user?.id,
        }),
      });
      setNotice(status === 'clean'
        ? 'سُجلت نتيجة فحص خارجية قابلة للتتبّع. أصبح الملف متاحًا للتنزيل للجهة التي أودعته فقط، لكن لم يُعتمد المستند تدقيقيًا.'
        : 'تم حجر الملف. سيظل غير متاح للتنزيل لدى العميل.');
      setScanConfirmed(previous => ({ ...previous, [row.id]: false }));
      setRevision(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر تسجيل نتيجة الفحص. تحقق من دور المراجع وصلاحية التحديث.');
    } finally { setBusyAction(''); }
  }

  return <section className="audit-card client-portal-admin-panel">
    <div className="audit-card-head"><div><h3>بوابة طلبات ومستندات العملاء السحابية</h3><p className="muted-copy">هذه وحدة سحابية مستقلة عن مخزن Ledgerly المحلي؛ كل وصول يخضع لصلاحيات Supabase. الملفات تبقى معلّقة حتى تسجيل نتيجة فحص خارجية موثقة.</p></div><span className={'audit-pill ' + (enabled ? '' : 'risk-pill')}>{enabled ? 'مفعّلة في الواجهة' : 'معطّلة افتراضيًا'}</span></div>
    {!enabled ? <div className="audit-warning">فعّل VITE_LEDGERLY_ENABLE_CLIENT_PORTAL في بناء الواجهة بعد تهيئة الهجرة وسياسات Supabase، واضبط LEDGERLY_CLIENT_PORTAL_ENABLED=true وLEDGERLY_CLIENT_PORTAL_ALLOWED_ORIGINS وLEDGERLY_CLIENT_PORTAL_REDIRECT_URL على الخادم. هذه الإعدادات غير مفعّلة تلقائيًا.</div> :
      !supabase ? <p className="audit-warning">إعداد Supabase غير متاح.</p> :
      !session ? <p className="muted-copy">سجّل الدخول بحساب مكتب مخوّل في الأعلى لاستخدام الإدارة السحابية للطلبات والدعوات.</p> : <>
        {error && <p className="audit-warning" role="alert">{error}</p>}
        {notice && <p className="muted-copy" role="status">{notice}</p>}
        <div className="stack-actions"><button className="audit-secondary" disabled={busy} onClick={() => setRevision(value => value + 1)}>تحديث القوائم</button><span className="muted-copy">{clients.length} عميل سحابي · {engagementChoices.length} ارتباط متاح وفق صلاحيات الحساب</span></div>

        <section className="client-portal-admin-subsection">
          <h4>1. إنشاء طلب مستند على ارتباط سحابي</h4>
          <form onSubmit={createRequest}>
            <label className="audit-field"><span>ملف التدقيق / الارتباط *</span><select value={selectedEngagement} onChange={event => setSelectedEngagement(event.target.value)} required><option value="">— اختر ارتباطًا —</option>{engagementChoices.map(engagement => { const client = clients.find(item => item.id === engagement.client_id && item.firm_id === engagement.firm_id); return <option key={engagement.id} value={engagement.id}>{client?.name || 'عميل'} · {engagement.id}</option>; })}</select></label>
            <label className="audit-field"><span>عنوان المستند المطلوب *</span><input value={title} onChange={event => setTitle(event.target.value)} minLength={3} maxLength={200} required placeholder="مثال: كشف حساب البنك حتى تاريخ الإقفال" /></label>
            <label className="audit-field"><span>تفاصيل وتعليمات</span><textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} placeholder="حدد الفترة المطلوبة والصيغة أو النطاق" /></label>
            <label className="audit-field"><span>جهة الاتصال / القسم المطلوب منه</span><input value={requestedFrom} onChange={event => setRequestedFrom(event.target.value)} maxLength={160} placeholder={selectedClient?.name || 'اسم جهة الاتصال أو القسم'} /></label>
            <div className="audit-intel-screening-options">
              <label className="audit-field"><span>موعد التسليم</span><input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>
              <label className="audit-field"><span>الأولوية</span><select value={priority} onChange={event => setPriority(event.target.value)}><option value="low">منخفضة</option><option value="normal">عادية</option><option value="high">مرتفعة</option><option value="critical">حرجة</option></select></label>
            </div>
            <button className="audit-primary" type="submit" disabled={Boolean(busyAction) || busy || !selected}>{busyAction === 'request' ? 'جارٍ إنشاء الطلب...' : 'إنشاء طلب مستند'}</button>
          </form>
        </section>

        <section className="client-portal-admin-subsection">
          <h4>2. دعوة جهة اتصال من العميل</h4>
          <p className="muted-copy">تُقيّد الدعوة على الارتباط المختار فقط. تتطلب الدعوات إعدادات الخادم وقائمة HTTPS المسموح بها؛ لا يمكن للمستخدم تحديد firm_id أو client_id في الطلب.</p>
          <form onSubmit={inviteContact}>
            <label className="audit-field"><span>الارتباط الذي ستتاح طلباته لجهة الاتصال *</span><select value={selectedEngagement} onChange={event => setSelectedEngagement(event.target.value)} required><option value="">— اختر ارتباطًا —</option>{engagementChoices.map(engagement => { const client = clients.find(item => item.id === engagement.client_id && item.firm_id === engagement.firm_id); return <option key={engagement.id} value={engagement.id}>{client?.name || 'عميل'} · {engagement.id}</option>; })}</select></label>
            <label className="audit-field"><span>اسم جهة الاتصال *</span><input value={inviteName} onChange={event => setInviteName(event.target.value)} minLength={2} maxLength={120} required /></label>
            <label className="audit-field"><span>البريد الإلكتروني *</span><input type="email" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} maxLength={254} required /></label>
            <button className="audit-primary" type="submit" disabled={Boolean(busyAction) || busy || !selected}>{busyAction === 'invite' ? 'جارٍ إرسال الدعوة...' : 'إرسال دعوة آمنة'}</button>
          </form>
        </section>

        <section className="client-portal-admin-subsection">
          <h4>3. صندوق استلام ملفات العملاء</h4>
          <p className="audit-warning">الملفات بحالة pending غير موثوقة وقد تحتوي محتوى ضارًا. نزّلها فقط إلى بيئة فحص معتمدة. زر «تسجيل فحص نظافة» لا يشغّل برنامج مكافحة فيروسات؛ هو يسجّل نتيجة فحص خارجي أجراه المكتب بالفعل.</p>
          {!submissions.length ? <p className="muted-copy">لا توجد إيداعات ظاهرة ضمن صلاحيات هذا الحساب.</p> : <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>الطلب</th><th>اسم الملف</th><th>المُرسل</th><th>الحجم</th><th>الحالة</th><th>الفحص الخارجي</th></tr></thead><tbody>
            {submissions.map(row => {
              const request = requestsById.get(row.request_id);
              const scanning = busyAction === 'scan:' + row.id;
              const downloading = busyAction === 'download:' + row.id;
              return <tr key={row.id}>
                <td className="cell-strong">{request?.request_ref || row.request_id}<small className="table-sub">{request?.title || ''}</small></td>
                <td>{row.file_name}<small className="table-sub">{new Date(row.uploaded_at).toLocaleString('ar-JO')}</small></td>
                <td>{row.submitted_by_name || '—'}</td>
                <td>{moneyBytes(row.file_size)} بايت</td>
                <td><span className={'audit-pill ' + (row.scan_status === 'pending' || row.scan_status === 'quarantined' || row.scan_status === 'failed' ? 'risk-pill' : '')}>{scanLabel(row.scan_status)}</span>{row.scan_provider && <small className="table-sub">{row.scan_provider} · {row.scan_reference}</small>}</td>
                <td>
                  {row.scan_status !== 'clean' && row.scan_status !== 'quarantined' && <>
                    <button className="audit-secondary" disabled={Boolean(busyAction) || busy} onClick={() => void downloadForScan(row)}>{downloading ? 'جارٍ التنزيل...' : 'تنزيل لبيئة الفحص'}</button>
                    <label className="audit-field"><span>أداة/مزود الفحص</span><input value={scanProviders[row.id] || ''} maxLength={120} onChange={event => setScanProviders(previous => ({ ...previous, [row.id]: event.target.value }))} placeholder="اسم الأداة المستخدمة فعليًا" /></label>
                    <label className="audit-field"><span>مرجع نتيجة الفحص</span><input value={scanReferences[row.id] || ''} maxLength={240} onChange={event => setScanReferences(previous => ({ ...previous, [row.id]: event.target.value }))} placeholder="رقم التقرير أو البصمة" /></label>
                    <button className="audit-primary" disabled={Boolean(busyAction) || busy} onClick={() => void recordScanResult(row, 'quarantined')}>حجر الملف</button>
                    <label className="client-portal-scan-confirm"><input type="checkbox" checked={Boolean(scanConfirmed[row.id])} onChange={event => setScanConfirmed(previous => ({ ...previous, [row.id]: event.target.checked }))} /><span>أكدتُ أن فحصًا خارجيًا فعليًا اكتمل وأن المرجع أعلاه يعود إلى هذه النسخة.</span></label>
                    <button className="audit-primary" disabled={Boolean(busyAction) || busy || !scanConfirmed[row.id]} onClick={() => void recordScanResult(row, 'clean')}>{scanning ? 'جارٍ تسجيل النتيجة...' : 'تسجيل فحص نظافة خارجي'}</button>
                  </>}
                </td>
              </tr>;
            })}
          </tbody></table></div>}
        </section>
      </>}
  </section>;
}
