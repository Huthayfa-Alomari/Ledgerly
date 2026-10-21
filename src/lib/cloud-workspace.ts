import type { SupabaseBrowserConfig } from './supabase-config';

export type CloudSession = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user?: { id: string; email?: string };
};
export type CloudRow = { firm_id: string; payload: unknown; version: number; updated_by: string; updated_at: string };
export type CloudEvidence = {
  id: string; firm_id: string; engagement_id: string; title: string; object_key: string;
  file_name: string; mime_type: string; file_size: number; file_sha256: string; created_by: string; created_at: string;
};
export type CloudDB = {
  clients: unknown[]; engagements: Array<{ id: string; [key: string]: unknown }>; risks: unknown[];
  workpapers: unknown[]; findings: unknown[]; evidence: unknown[]; trialBalance: unknown[];
  auditLog: unknown[]; completionChecks: Record<string, boolean>;
};

export class CloudConflictError extends Error {
  constructor(message = 'توجد نسخة سحابية أحدث؛ اسحبها أو راجع التعارض قبل الرفع.') { super(message); this.name = 'CloudConflictError'; }
}
async function request<T>(config: SupabaseBrowserConfig, session: CloudSession, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${config.url}${path}`, {
    ...init,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${session.access_token}`,
      ...(init.body instanceof Blob ? { 'Content-Type': init.body.type || 'application/octet-stream' } : {}),
      ...(init.body && !(init.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 409 || response.status === 412) throw new CloudConflictError();
    throw new Error(`طلب سحابي فشل (${response.status}): ${text.slice(0, 400)}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
function baselineKey(firmId: string) { return `ledgerly.cloud.baseline.v1.${firmId}`; }
export async function getCurrentFirm(config: SupabaseBrowserConfig, session: CloudSession): Promise<string> {
  if (!session.user?.id) throw new Error('جلسة الدخول لا تحتوي معرّف المستخدم.');
  const rows = await request<Array<{ firm_id: string }>>(config, session,
    `/rest/v1/app_user?select=firm_id&id=eq.${encodeURIComponent(session.user.id)}&status=eq.active&limit=2`);
  const firms = [...new Set(rows.map(row => row.firm_id).filter(Boolean))];
  if (firms.length !== 1) throw new Error(firms.length ? 'الحساب مرتبط بأكثر من مكتب؛ يلزم اختيار المكتب قبل المزامنة.' : 'لم يُربط الحساب بمكتب فعّال بعد. أكمل تهيئة المكتب أو قبول الدعوة أولًا.');
  return firms[0];
}
export async function pullWorkspace(config: SupabaseBrowserConfig, session: CloudSession, firmId: string, recordBaseline = true): Promise<{ row: CloudRow | null; baseline: number }> {
  const rows = await request<CloudRow[]>(config, session,
    `/rest/v1/firm_workspace_snapshot?select=firm_id,payload,version,updated_by,updated_at&firm_id=eq.${encodeURIComponent(firmId)}&limit=1`);
  const row = rows[0] || null;
  const baseline = row?.version || 0;
  if (recordBaseline) localStorage.setItem(baselineKey(firmId), String(baseline));
  return { row, baseline };
}
export async function pushWorkspace(config: SupabaseBrowserConfig, session: CloudSession, firmId: string, db: CloudDB): Promise<CloudRow> {
  const serialized = JSON.stringify(db);
  if (new Blob([serialized]).size > 10 * 1024 * 1024) throw new Error('حجم بيانات المكتب يتجاوز 10 ميغابايت. صدّر نسخة احتياطية واستخدم مزامنة مرحلية قبل المتابعة.');
  const rawBaseline = localStorage.getItem(baselineKey(firmId));
  if (rawBaseline === null) throw new CloudConflictError('اسحب النسخة السحابية أولًا لتحديد نقطة المزامنة، ثم ارفع التعديلات.');
  const expected = Number(rawBaseline);
  if (!Number.isSafeInteger(expected) || expected < 0) throw new Error('نقطة المزامنة المحلية غير صالحة؛ اسحب النسخة السحابية مجددًا.');
  const remote = await request<CloudRow[]>(config, session,
    `/rest/v1/firm_workspace_snapshot?select=firm_id,version&firm_id=eq.${encodeURIComponent(firmId)}&limit=1`);
  const current = remote[0]?.version || 0;
  if (current !== expected) throw new CloudConflictError();
  const now = new Date().toISOString();
  if (current === 0) {
    const inserted = await request<CloudRow[]>(config, session, '/rest/v1/firm_workspace_snapshot?select=*', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ firm_id: firmId, payload: db, version: 1, updated_by: session.user!.id, updated_at: now }),
    });
    const row = inserted[0];
    if (!row) throw new Error('لم يرجع الخادم نسخة المكتب بعد الإنشاء.');
    localStorage.setItem(baselineKey(firmId), String(row.version));
    return row;
  }
  const updated = await request<CloudRow[]>(config, session,
    `/rest/v1/firm_workspace_snapshot?firm_id=eq.${encodeURIComponent(firmId)}&version=eq.${current}&select=*`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ payload: db, version: current + 1, updated_by: session.user!.id, updated_at: now }),
    });
  const row = updated[0];
  if (!row) throw new CloudConflictError();
  localStorage.setItem(baselineKey(firmId), String(row.version));
  return row;
}
export async function listCloudEvidence(config: SupabaseBrowserConfig, session: CloudSession, firmId: string): Promise<CloudEvidence[]> {
  return request<CloudEvidence[]>(config, session,
    `/rest/v1/workspace_evidence_file?select=id,firm_id,engagement_id,title,object_key,file_name,mime_type,file_size,file_sha256,created_by,created_at&firm_id=eq.${encodeURIComponent(firmId)}&order=created_at.desc&limit=200`);
}
export async function uploadEvidence(config: SupabaseBrowserConfig, session: CloudSession, firmId: string, engagementId: string, title: string, file: File): Promise<CloudEvidence> {
  const allowed = new Set(['application/pdf','image/jpeg','image/png','image/webp','text/plain','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
  if (!allowed.has(file.type)) throw new Error('نوع الملف غير مسموح. ارفع PDF أو صورة أو CSV أو Excel أو Word.');
  if (file.size < 1 || file.size > 25 * 1024 * 1024) throw new Error('حجم الملف يجب أن يكون أقل من 25 ميغابايت.');
  if (!engagementId.trim()) throw new Error('اختر ملف التدقيق قبل رفع الدليل.');
  if (!crypto.subtle) throw new Error('المتصفح لا يدعم حساب بصمة SHA-256 المطلوبة.');
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const hash = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2,'0')).join('');
  const id = crypto.randomUUID();
  const safeName = file.name.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-100) || 'evidence';
  const objectKey = `${firmId}/${engagementId}/${id}_${safeName}`;
  const storagePath = objectKey.split('/').map(encodeURIComponent).join('/');
  await request<unknown>(config, session, `/storage/v1/object/ledgerly-evidence/${storagePath}`, {
    method: 'POST', headers: { 'x-upsert': 'false', 'cache-control': '0' }, body: file,
  });
  try {
    const rows = await request<CloudEvidence[]>(config, session, '/rest/v1/workspace_evidence_file?select=*', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ id, firm_id: firmId, engagement_id: engagementId, title: title.trim() || file.name,
        object_key: objectKey, file_name: file.name, mime_type: file.type, file_size: file.size,
        file_sha256: hash, created_by: session.user!.id }),
    });
    if (!rows[0]) throw new Error('تم رفع الملف لكن تعذر تسجيل بياناته. احتفظ بمعرّف الملف واطلب من مدير النظام المراجعة.');
    return rows[0];
  } catch (error) {
    // Keep the object private if metadata insertion fails; never make it public or silently delete evidence.
    throw error;
  }
}
export async function downloadEvidence(config: SupabaseBrowserConfig, session: CloudSession, row: CloudEvidence): Promise<void> {
  const path = row.object_key.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${config.url}/storage/v1/object/ledgerly-evidence/${path}`, {
    headers: { apikey: config.anonKey, Authorization: `Bearer ${session.access_token}` },
  });
  if (!response.ok) throw new Error(`تعذر تنزيل الدليل (${response.status}). تحقق من صلاحيات المكتب والمهمة.`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a'); a.href = url; a.download = row.file_name; a.click();
  } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
