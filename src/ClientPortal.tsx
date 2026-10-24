import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseConfigResult } from './lib/supabase-config';
import './styles.css';

type PortalUser = { id: string; email?: string; user_metadata?: { full_name?: string } };
type PortalSession = { access_token: string; refresh_token: string; expires_at?: number; expires_in?: number; user: PortalUser };
type PortalRequest = {
  id: string; firm_id: string; engagement_id: string; request_ref: string; title: string;
  description?: string | null; requested_from?: string | null; due_date?: string | null;
  priority: string; status: string; created_at: string;
};
type Submission = {
  id: string; request_id: string; submitted_by_name: string; file_name: string;
  mime_type: string; file_size: number; uploaded_at: string; scan_status: string; rejection_reason?: string | null;
};

const SESSION_KEY = 'ledgerly.auth.session.v1';
const BUCKET = 'ledgerly-client-submissions';
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const PORTAL_ENABLED = import.meta.env.VITE_LEDGERLY_ENABLE_CLIENT_PORTAL === 'true';

function configOf(config: SupabaseConfigResult) {
  return config.configured ? config.config : null;
}
function toMessage(body: any, fallback: string) {
  if (typeof body?.message === 'string') return body.message;
  if (typeof body?.error_description === 'string') return body.error_description;
  if (typeof body?.error === 'string') return body.error;
  return fallback;
}
function requestStatus(value: string) {
  const map: Record<string, string> = {
    requested: 'بانتظار المستند', partially_received: 'استلام جزئي', received: 'تم الاستلام',
    accepted: 'تم القبول', rejected: 'بحاجة إلى استكمال', overdue: 'متأخر', cancelled: 'ملغى',
  };
  return map[value] || value;
}
function fileStatus(value: string) {
  const map: Record<string, string> = {
    pending: 'بانتظار فحص المكتب', clean: 'اجتاز الفحص المسجل', quarantined: 'محجور للمراجعة', failed: 'تعذر فحصه',
  };
  return map[value] || value;
}
function safeFileName(value: string) {
  const trimmed = value.normalize('NFC').replace(/[\/\\\u0000-\u001f\u007f]/g, '-').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}._()-]/gu, '-');
  return (trimmed || 'client-document').slice(-140);
}
async function parseResponse(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(toMessage(data, fallback));
  return data;
}
function saveSession(session: PortalSession | null) {
  if (!session) sessionStorage.removeItem(SESSION_KEY);
  else sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
async function getUser(config: NonNullable<ReturnType<typeof configOf>>, accessToken: string) {
  const response = await fetch(config.url + '/auth/v1/user', {
    headers: { apikey: config.anonKey, Authorization: 'Bearer ' + accessToken },
  });
  return await parseResponse(response, 'تعذر تأكيد جلسة الدخول.') as PortalUser;
}
async function refreshSession(config: NonNullable<ReturnType<typeof configOf>>, session: PortalSession): Promise<PortalSession> {
  const response = await fetch(config.url + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  const body = await parseResponse(response, 'انتهت الجلسة؛ سجّل الدخول مرة أخرى.') as any;
  const next: PortalSession = {
    access_token: body.access_token,
    refresh_token: body.refresh_token || session.refresh_token,
    expires_in: body.expires_in,
    expires_at: Math.floor(Date.now() / 1000) + Number(body.expires_in || 3600),
    user: body.user || session.user,
  };
  if (!next.access_token || !next.user?.id) throw new Error('تعذر تجديد الجلسة.');
  return next;
}
async function sha256(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export default function ClientPortal({ config }: { config: SupabaseConfigResult }) {
  const supabase = configOf(config);
  const [session, setSession] = useState<PortalSession | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [requests, setRequests] = useState<PortalRequest[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [pageBusy, setPageBusy] = useState(false);
  const [uploadingRequest, setUploadingRequest] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const authorized = Boolean(session?.access_token && session.user?.id);
  const statusCounts = useMemo(() => ({
    open: requests.filter(item => ['requested', 'partially_received', 'rejected', 'overdue'].includes(item.status)).length,
    overdue: requests.filter(item => item.status === 'overdue').length,
    pending: submissions.filter(item => item.scan_status === 'pending').length,
  }), [requests, submissions]);

  const api = useCallback(async (path: string, options: RequestInit = {}, currentSession = session) => {
    if (!supabase || !currentSession?.access_token) throw new Error('سجّل الدخول أولًا.');
    const headers: Record<string, string> = {
      apikey: supabase.anonKey,
      Authorization: 'Bearer ' + currentSession.access_token,
    };
    if (!(options.body instanceof File)) headers['Content-Type'] = 'application/json';
    if (options.headers) {
      const extra = options.headers as Record<string, string>;
      Object.assign(headers, extra);
    }
    const response = await fetch(supabase.url + path, { ...options, headers });
    return await parseResponse(response, 'تعذر الاتصال بخدمة بوابة المستندات.');
  }, [supabase, session]);

  const loadPortalData = useCallback(async (currentSession: PortalSession) => {
    if (!supabase) return;
    setPageBusy(true);
    setError('');
    try {
      const active = await api('/rest/v1/rpc/ledgerly_accept_client_portal_invitation', {
        method: 'POST', body: JSON.stringify({}),
      }, currentSession);
      if (active !== true && active?.[0] !== true) {
        throw new Error('لا توجد دعوة صالحة لهذا الحساب، أو انتهت صلاحيتها. تواصل مع مكتب التدقيق.');
      }
      const [requestRows, ownSubmissions] = await Promise.all([
        api('/rest/v1/pbc_request?select=id,firm_id,engagement_id,request_ref,title,description,requested_from,due_date,priority,status,created_at&order=due_date.asc.nullslast', {}, currentSession),
        api('/rest/v1/pbc_submission?select=id,request_id,submitted_by_name,file_name,mime_type,file_size,uploaded_at,scan_status,rejection_reason&submitted_by_portal_user_id=eq.' + encodeURIComponent(currentSession.user.id) + '&order=uploaded_at.desc', {}, currentSession),
      ]);
      setRequests(Array.isArray(requestRows) ? requestRows : []);
      setSubmissions(Array.isArray(ownSubmissions) ? ownSubmissions : []);
    } catch (reason) {
      setRequests([]);
      setSubmissions([]);
      setError(reason instanceof Error ? reason.message : 'تعذر تحميل طلبات المستندات.');
    } finally { setPageBusy(false); }
  }, [supabase, api]);

  const establishSession = useCallback(async (next: PortalSession) => {
    if (!supabase) return;
    let usable = next;
    if (usable.expires_at && usable.expires_at <= Math.floor(Date.now() / 1000) + 30) {
      usable = await refreshSession(supabase, usable);
    }
    if (!usable.user?.id) usable.user = await getUser(supabase, usable.access_token);
    saveSession(usable);
    setSession(usable);
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !PORTAL_ENABLED) return;
    let cancelled = false;
    const initialize = async () => {
      try {
        const hash = new URLSearchParams(window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '');
        const accessToken = hash.get('access_token');
        const refreshToken = hash.get('refresh_token');
        if (accessToken && refreshToken) {
          const user = await getUser(supabase, accessToken);
          const expiresIn = Number(hash.get('expires_in') || 3600);
          const invitedSession: PortalSession = {
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: expiresIn,
            expires_at: Math.floor(Date.now() / 1000) + expiresIn,
            user,
          };
          history.replaceState(null, '', window.location.pathname + window.location.search);
          if (!cancelled) await establishSession(invitedSession);
          return;
        }
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as PortalSession;
        if (!saved?.access_token || !saved?.refresh_token) {
          saveSession(null);
          return;
        }
        if (!cancelled) await establishSession(saved);
      } catch (reason) {
        saveSession(null);
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'تعذر استعادة جلسة الدعوة.');
      }
    };
    void initialize();
    return () => { cancelled = true; };
  }, [supabase, establishSession]);

  useEffect(() => {
    if (session && PORTAL_ENABLED) void loadPortalData(session);
  }, [session, refreshKey, loadPortalData]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setError(''); setNotice(''); setPageBusy(true);
    try {
      const response = await fetch(supabase.url + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { apikey: supabase.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = await parseResponse(response, 'تعذر تسجيل الدخول. تحقق من البريد وكلمة المرور، أو افتح رابط الدعوة المرسل من المكتب.') as any;
      const next: PortalSession = {
        access_token: body.access_token, refresh_token: body.refresh_token,
        expires_in: body.expires_in, expires_at: Math.floor(Date.now() / 1000) + Number(body.expires_in || 3600),
        user: body.user,
      };
      if (!next.access_token || next.user?.aud === 'anonymous') throw new Error('هذه الجلسة ليست حساب عميل مسجّلًا.');
      await establishSession(next);
      setPassword('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر تسجيل الدخول.');
    } finally { setPageBusy(false); }
  }

  async function signOut() {
    if (supabase && session?.access_token) {
      await fetch(supabase.url + '/auth/v1/logout', {
        method: 'POST', headers: { apikey: supabase.anonKey, Authorization: 'Bearer ' + session.access_token },
      }).catch(() => undefined);
    }
    saveSession(null);
    setSession(null); setRequests([]); setSubmissions([]);
    setPassword(''); setNotice('تم تسجيل الخروج.');
  }

  async function uploadDocument(request: PortalRequest, file?: File) {
    if (!file || !supabase || !session) return;
    setError(''); setNotice('');
    if (file.size < 1 || file.size > MAX_FILE_BYTES) {
      setError('حجم الملف غير صالح. الحد الأقصى 25 ميغابايت لكل ملف.'); return;
    }
    if (!ALLOWED_MIME.has(file.type)) {
      setError('نوع الملف غير مسموح. استخدم PDF أو صورة أو CSV/Excel/Word مدعومًا.'); return;
    }
    if (!['requested', 'partially_received', 'rejected', 'overdue'].includes(request.status)) {
      setError('هذا الطلب غير مفتوح لاستلام ملفات جديدة.'); return;
    }
    const requestId = request.id;
    setUploadingRequest(requestId);
    try {
      const digest = await sha256(file);
      const objectName = crypto.randomUUID() + '-' + safeFileName(file.name);
      const objectKey = request.firm_id + '/' + request.engagement_id + '/' + request.id + '/' + objectName;
      const encodedPath = objectKey.split('/').map(part => encodeURIComponent(part)).join('/');
      const uploadResponse = await fetch(supabase.url + '/storage/v1/object/' + BUCKET + '/' + encodedPath, {
        method: 'POST',
        headers: {
          apikey: supabase.anonKey,
          Authorization: 'Bearer ' + session.access_token,
          'Content-Type': file.type,
          'x-upsert': 'false',
        },
        body: file,
      });
      await parseResponse(uploadResponse, 'تعذر رفع الملف إلى التخزين الخاص.');
      try {
        await api('/rest/v1/pbc_submission', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            firm_id: request.firm_id,
            request_id: request.id,
            submitted_by_name: session.user.email || 'Client contact',
            submitted_by_portal_user_id: session.user.id,
            object_key: objectKey,
            file_name: file.name.slice(0, 255),
            mime_type: file.type,
            file_size: file.size,
            file_sha256: digest,
            uploaded_at: new Date().toISOString(),
            scan_status: 'pending',
          }),
        }, session);
      } catch (metadataError) {
        const deleted = await fetch(supabase.url + '/storage/v1/object/' + BUCKET + '/' + encodedPath, {
          method: 'DELETE',
          headers: { apikey: supabase.anonKey, Authorization: 'Bearer ' + session.access_token },
        }).then(response => response.ok).catch(() => false);
        throw new Error(deleted
          ? 'لم يُسجَّل رفع الملف، لذلك أُزيل الملف غير المرتبط. ' + (metadataError instanceof Error ? metadataError.message : '')
          : 'لم يُسجَّل سجل الإيداع. تعذر تنظيف الملف المؤقت؛ أبلغ مكتب التدقيق. ' + (metadataError instanceof Error ? metadataError.message : ''));
      }
      setNotice('تم استلام «' + file.name + '» في مساحة خاصة. حالته الآن «بانتظار فحص المكتب» ولن يمكن تنزيله قبل تسجيل نتيجة فحص نظافة موثقة.');
      setRefreshKey(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر رفع المستند.');
    } finally { setUploadingRequest(''); }
  }

  const submissionsByRequest = useMemo(() => {
    const groups = new Map<string, Submission[]>();
    for (const submission of submissions) {
      const rows = groups.get(submission.request_id) || [];
      rows.push(submission);
      groups.set(submission.request_id, rows);
    }
    return groups;
  }, [submissions]);

  return <div className="audit-shell client-portal-shell" dir="rtl">
    <main className="audit-main client-portal-main">
      <header className="audit-topbar">
        <div><div className="audit-breadcrumb">Ledgerly / بوابة العميل</div><h1>بوابة مستندات العميل</h1></div>
        {authorized && <button className="audit-secondary" onClick={() => void signOut()}>تسجيل الخروج</button>}
      </header>

      {!PORTAL_ENABLED ? <section className="audit-card client-portal-gate"><h2>البوابة غير مفعّلة</h2><p>يجب أن يفعّل مسؤول الاستضافة VITE_LEDGERLY_ENABLE_CLIENT_PORTAL وأن يضبط مسؤول Supabase سياسة الدعوات ونطاقات HTTPS. لم تُفتح أي جلسة عميل في هذه النسخة.</p></section> :
        !supabase ? <section className="audit-card client-portal-gate"><h2>الاتصال غير مُهيّأ</h2><p>لا يوجد إعداد Supabase صالح. لا تُدخل مستندات قبل تهيئة عنوان المشروع ومفتاح المتصفح العام.</p></section> :
        !authorized ? <section className="audit-card client-portal-login">
          <span className="soft-tag">Client portal · invitation only</span>
          <h2>تسجيل الدخول إلى مستندات الارتباط</h2>
          <p className="muted-copy">البوابة لا تتيح تسجيلًا عامًا. استخدم الحساب الذي دُعيت إليه من مكتب التدقيق أو افتح رابط الدعوة المرسل إليك.</p>
          {error && <p className="audit-warning" role="alert">{error}</p>}
          <form onSubmit={signIn}>
            <label className="audit-field"><span>البريد الإلكتروني</span><input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
            <label className="audit-field"><span>كلمة المرور</span><input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
            <button className="audit-primary" type="submit" disabled={pageBusy}>{pageBusy ? 'جارٍ الدخول...' : 'تسجيل الدخول'}</button>
          </form>
        </section> : <>
          <section className="audit-card client-portal-welcome">
            <div><span className="soft-tag">وصول محدود بالارتباط</span><h2>مرحبًا بك</h2><p className="muted-copy">{session?.user.email} · اعرض الطلبات والملفات المرتبطة بدعوتك فقط.</p></div>
            <button className="audit-secondary" disabled={pageBusy} onClick={() => setRefreshKey(value => value + 1)}>تحديث الطلبات</button>
          </section>
          <section className="audit-intel-kpis">
            <div className="audit-intel-kpi"><span>طلبات المستندات</span><strong>{requests.length}</strong><small>ضمن الارتباطات المصرح بها</small></div>
            <div className="audit-intel-kpi"><span>طلبات مفتوحة</span><strong>{statusCounts.open}</strong><small>تقبل الإيداعات حاليًا</small></div>
            <div className="audit-intel-kpi"><span>طلبات متأخرة</span><strong>{statusCounts.overdue}</strong><small>تحتاج إلى متابعة</small></div>
            <div className="audit-intel-kpi"><span>ملفات بانتظار فحص المكتب</span><strong>{statusCounts.pending}</strong><small>لم تعتمد بعد</small></div>
          </section>
          {error && <p className="audit-warning" role="alert">{error}</p>}
          {notice && <p className="audit-intel-clear" role="status">{notice}</p>}
          {pageBusy && <section className="audit-card"><p>جارٍ تحميل الطلبات...</p></section>}
          {!pageBusy && !requests.length && <section className="audit-card"><h3>لا توجد طلبات ظاهرة</h3><p className="muted-copy">ستظهر هنا الطلبات المرتبطة بدعوتك بعد تسجيل الدخول بنجاح. لا يمكنك البحث في سجلات عملاء أو ارتباطات أخرى.</p></section>}
          <section className="client-portal-request-list">
            {requests.map(request => {
              const canUpload = ['requested', 'partially_received', 'rejected', 'overdue'].includes(request.status);
              const files = submissionsByRequest.get(request.id) || [];
              return <article className="audit-card client-portal-request" key={request.id}>
                <div className="audit-card-head"><div><span className="soft-tag">{request.request_ref}</span><h3>{request.title}</h3></div><span className={'audit-pill ' + (request.status === 'overdue' || request.status === 'rejected' ? 'risk-pill' : '')}>{requestStatus(request.status)}</span></div>
                {request.description && <p>{request.description}</p>}
                <div className="summary-lines client-portal-request-meta">
                  <div className="summary-line"><span>تاريخ الاستحقاق</span><strong>{request.due_date || 'غير محدد'}</strong></div>
                  <div className="summary-line"><span>الأولوية</span><strong>{request.priority}</strong></div>
                </div>
                {canUpload && <label className="audit-secondary client-portal-file-picker">{uploadingRequest === request.id ? 'جارٍ رفع الملف...' : 'اختيار مستند ورفعه بأمان'}<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.xls,.xlsx,.docx" disabled={Boolean(uploadingRequest) || pageBusy} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void uploadDocument(request, file); }} /></label>}
                {files.length > 0 && <div className="client-portal-submission-list"><strong>إيداعاتك السابقة</strong>{files.map(file => <div className="client-portal-submission" key={file.id}>
                  <span>{file.file_name}<small>{new Date(file.uploaded_at).toLocaleString('ar-JO')} · {jodOrBytes(file.file_size)} بايت</small></span>
                  <span className={'audit-pill ' + (file.scan_status === 'quarantined' || file.scan_status === 'failed' ? 'risk-pill' : '')}>{fileStatus(file.scan_status)}</span>
                  {file.rejection_reason && <small>{file.rejection_reason}</small>}
                </div>)}</div>}
                <p className="audit-intel-footnote">كل ملف يبقى خاصًا وبحالة انتظار الفحص. لن يُتاح رابط تنزيل للعميل قبل أن يسجل مكتب التدقيق نتيجة فحص خارجية موثقة. لا يعني الاستلام قبول المستند أو كفاية الدليل.</p>
              </article>;
            })}
          </section>
        </>}
      <footer className="audit-footer">Ledgerly · بوابة عميل منفصلة عن مخزن المكتب المحلي · وصول محدود بالارتباط</footer>
    </main>
  </div>;
}
