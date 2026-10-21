import { useEffect, useState } from 'react';
import type { SupabaseConfigResult } from './lib/supabase-config';

type CloudUser = { id: string; email?: string };
export type CloudSession = { access_token: string; refresh_token: string; expires_at?: number; expires_in?: number; user?: CloudUser };
type Props = { config: SupabaseConfigResult; onSessionChange?: (session: CloudSession | null) => void };

const SESSION_KEY = 'ledgerly.auth.session.v1';

async function authRequest(config: Extract<SupabaseConfigResult, { configured: true }>['config'], path: string, body?: unknown, accessToken?: string) {
  const response = await fetch(`${config.url}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.msg || data.message || data.error_description || data.error || 'تعذر إكمال الطلب.');
  return data;
}

export default function CloudAuthPanel({ config, onSessionChange }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [firmName, setFirmName] = useState('');
  const [session, setSession] = useState<CloudSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('staff');
  const [inviteNotice, setInviteNotice] = useState('');
  const [inviteError, setInviteError] = useState('');
  const configUrl = config.configured ? config.config.url : '';
  const anonKey = config.configured ? config.config.anonKey : '';

  const saveSession = (next: CloudSession | null) => {
    setSession(next);
    onSessionChange?.(next);
    if (next) {
      const expiresAt = next.expires_at ?? Math.floor(Date.now() / 1000) + (next.expires_in ?? 3600);
      const normalized = { ...next, expires_at: expiresAt };
      setSession(normalized);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  };

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as CloudSession;
        if (stored.access_token && stored.refresh_token) { setSession(stored); onSessionChange?.(stored); }
      }
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }, []);

  useEffect(() => {
    if (!session?.expires_at || !session.refresh_token || !configUrl || !anonKey) return;
    const wait = Math.max(1000, session.expires_at * 1000 - Date.now() - 60000);
    const timer = window.setTimeout(async () => {
      try {
        const refreshed = await authRequest({ url: configUrl, anonKey }, 'token?grant_type=refresh_token', { refresh_token: session.refresh_token });
        saveSession(refreshed as CloudSession);
      } catch {
        saveSession(null);
        setNotice('');
        setError('انتهت جلسة الدخول. سجّل الدخول مرة أخرى.');
      }
    }, Math.min(wait, 2147480000));
    return () => window.clearTimeout(timer);
  }, [session?.expires_at, session?.refresh_token, configUrl, anonKey]);

  const runAuth = async () => {
    if (!config.configured) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (!email.trim() || !password) throw new Error('أدخل البريد الإلكتروني وكلمة المرور.');
      if (mode === 'signup') {
        if (displayName.trim().length < 2 || firmName.trim().length < 2) throw new Error('أدخل اسمك واسم مكتب التدقيق (حرفان على الأقل).');
        if (password.length < 12) throw new Error('كلمة المرور يجب أن تكون 12 حرفًا على الأقل. استخدم عبارة مرور طويلة وفريدة.');
        const result = await authRequest(config.config, 'signup', {
          email: email.trim().toLowerCase(),
          password,
          data: { full_name: displayName.trim() },
        });
        if (result.access_token && result.refresh_token) {
          saveSession(result as CloudSession);
          setNotice('تم إنشاء الحساب وتسجيل الدخول. اضغط «تهيئة المكتب الأول» إذا كان هذا أول مكتب على النظام.');
        } else {
          setNotice('تم إرسال طلب التسجيل. إذا كان تأكيد البريد مفعّلًا، أكّد بريدك ثم سجّل الدخول.');
          setMode('login');
        }
      } else {
        const result = await authRequest(config.config, 'token?grant_type=password', {
          email: email.trim().toLowerCase(),
          password,
        });
        saveSession(result as CloudSession);
        setNotice('تم تسجيل الدخول. إذا كان هذا أول مكتب، أكمل تهيئة المكتب.');
      }
      setPassword('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تسجيل الدخول.');
    } finally {
      setBusy(false);
    }
  };

  const bootstrapFirm = async () => {
    if (!config.configured || !session?.access_token) return;
    if (firmName.trim().length < 2 || displayName.trim().length < 2) {
      setError('أدخل اسم المكتب واسم المستخدم قبل التهيئة.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${config.config.url}/functions/v1/ledgerly-bootstrap-first-firm`, {
        method: 'POST',
        headers: {
          apikey: config.config.anonKey,
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ firm_name: firmName.trim(), display_name: displayName.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data.error || data.message || data.details || data.hint || 'تعذرت تهيئة المكتب.';
        if (String(message).includes('already exists')) {
          throw new Error('تم إنشاء المكتب الأول مسبقًا. الحسابات الجديدة تحتاج دعوة من مدير المكتب.');
        }
        if (response.status === 401 || response.status === 403) throw new Error('الجلسة غير مخوّلة أو انتهت. سجّل الدخول من جديد.');
        throw new Error(message);
      }
      setNotice('تم إنشاء مكتب التدقيق وربط حسابك بدور مدير المكتب. البيانات المهنية ما زالت محلية ولم تُزامن بعد.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذرت تهيئة المكتب.');
    } finally {
      setBusy(false);
    }
  };

  const sendInvitation = async () => {
    if (!config.configured || !session?.access_token) return;
    setBusy(true); setInviteError(''); setInviteNotice('');
    try {
      if (!inviteEmail.trim() || !inviteName.trim()) throw new Error('أدخل بريد العضو واسمه.');
      const response = await fetch(`${config.config.url}/functions/v1/ledgerly-invite-member`, {
        method: 'POST',
        headers: {
          apikey: config.config.anonKey,
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: inviteEmail.trim().toLowerCase(), display_name: inviteName.trim(), role: inviteRole }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'تعذر إرسال الدعوة.');
      setInviteNotice('تم إرسال دعوة العضو بالبريد الإلكتروني. يجب أن تكون إعدادات البريد ورابط العودة مهيأة في Supabase.');
      setInviteEmail('');
      setInviteName('');
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : 'تعذر إرسال الدعوة.');
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (config.configured && session?.access_token) {
      try {
        await fetch(`${config.config.url}/auth/v1/logout`, {
          method: 'POST',
          headers: { apikey: config.config.anonKey, Authorization: `Bearer ${session.access_token}` },
        });
      } catch { /* local session is still cleared below */ }
    }
    saveSession(null);
    setNotice('تم تسجيل الخروج من جلسة Ledgerly السحابية.');
    setError('');
  };

  return <section className="audit-card cloud-auth-card">
    <div className="audit-card-head"><div><h3>حساب Ledgerly السحابي</h3><p className="muted-copy">مصادقة Supabase منفصلة عن البيانات المحلية. لا يتم رفع العملاء أو أوراق العمل تلقائيًا.</p></div><span className={session ? 'audit-pill' : 'audit-pill risk-pill'}>{session ? 'مسجّل الدخول' : 'غير مسجّل'}</span></div>
    {!config.configured ? <p className="cloud-auth-note">اضبط VITE_SUPABASE_URL وVITE_SUPABASE_ANON_KEY بمفتاح publishable/anon فقط لتفعيل المصادقة.</p> : <>
      {session ? <div className="summary-lines"><div><strong>الحساب</strong><span>{session.user?.email || email || 'حساب موثّق'}</span></div><div><strong>حالة البيانات</strong><span>محلية؛ لم تُفعّل المزامنة</span></div></div> : null}
      {session ? <div className="cloud-invite-panel">
        <h4>دعوة عضو إلى مكتب التدقيق</h4>
        <p className="cloud-auth-note">متاحة لمدير المكتب أو الشريك الإداري. يلزم إعداد رابط عودة HTTPS وبريد الدعوات في Supabase.</p>
        <div className="cloud-auth-fields">
          <label className="audit-field"><span>اسم العضو</span><input value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="الاسم الكامل" /></label>
          <label className="audit-field"><span>البريد الإلكتروني</span><input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="member@example.com" /></label>
          <label className="audit-field"><span>الدور</span><select value={inviteRole} onChange={e => setInviteRole(e.target.value)}><option value="engagement_partner">شريك المهمة</option><option value="manager">مدير تدقيق</option><option value="senior">مدقق أول</option><option value="staff">مساعد تدقيق</option><option value="reviewer">مراجع مستقل</option><option value="eqcr">مراجع جودة مستقل</option></select></label>
        </div>
        {inviteError ? <p className="cloud-auth-error" role="alert">{inviteError}</p> : null}
        {inviteNotice ? <p className="cloud-auth-success" role="status">{inviteNotice}</p> : null}
        <button type="button" className="audit-secondary" disabled={busy} onClick={() => void sendInvitation()}>{busy ? 'جارٍ التنفيذ…' : 'إرسال دعوة عضو'}</button>
      </div> : null}
      <div className="cloud-auth-mode"><button type="button" className={mode === 'login' ? 'audit-primary' : 'audit-secondary'} onClick={() => { setMode('login'); setError(''); }}>تسجيل الدخول</button><button type="button" className={mode === 'signup' ? 'audit-primary' : 'audit-secondary'} onClick={() => { setMode('signup'); setError(''); }}>إنشاء حساب</button></div>
      <div className="cloud-auth-fields">
        <label className="audit-field"><span>اسم المستخدم</span><input value={displayName} onChange={e => setDisplayName(e.target.value)} autoComplete="name" placeholder="الاسم الكامل" /></label>
        <label className="audit-field"><span>اسم مكتب التدقيق</span><input value={firmName} onChange={e => setFirmName(e.target.value)} placeholder="اسم المكتب" /></label>
        <label className="audit-field"><span>البريد الإلكتروني</span><input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="name@example.com" /></label>
        <label className="audit-field"><span>كلمة المرور</span><input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="12 حرفًا على الأقل" onKeyDown={e => { if (e.key === 'Enter' && !busy) void runAuth(); }} /></label>
      </div>
      {error ? <p className="cloud-auth-error" role="alert">{error}</p> : null}
      {notice ? <p className="cloud-auth-success" role="status">{notice}</p> : null}
      <div className="cloud-auth-actions">
        {!session ? <button type="button" className="audit-primary" disabled={busy} onClick={() => void runAuth()}>{busy ? 'جارٍ التنفيذ…' : mode === 'login' ? 'تسجيل الدخول' : 'إنشاء الحساب'}</button> : null}
        {session ? <button type="button" className="audit-primary" disabled={busy} onClick={() => void bootstrapFirm()}>{busy ? 'جارٍ التنفيذ…' : 'تهيئة المكتب الأول'}</button> : null}
        {session ? <button type="button" className="audit-secondary" disabled={busy} onClick={() => void signOut()}>تسجيل الخروج</button> : null}
      </div>
      <p className="cloud-auth-note">الأمان: يُستخدم مفتاح المتصفح العام فقط، وتُحفظ الجلسة في sessionStorage. إنشاء المكتب مسموح مرة واحدة فقط؛ إضافة أعضاء آخرين تحتاج مسار دعوات إداريًا قبل استخدامه.</p>
    </>}
  </section>;
}
