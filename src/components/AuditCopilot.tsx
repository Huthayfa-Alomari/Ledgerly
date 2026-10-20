import { useMemo, useState } from 'react';
import type { SupabaseConfigResult } from '../lib/supabase-config';

type Issue = { ref: string; severity: 'error' | 'warning' | 'info'; category: string; title: string; amount: number | null };
type CopilotContext = {
  fiscalYear: string;
  engagementType: string;
  counts: { riskCount: number; openRiskCount: number; workpaperCount: number; approvedWorkpaperCount: number; evidenceCount: number; unlinkedEvidenceCount: number; openFindingCount: number };
  trialBalance: { accountCount: number; balanced: boolean; differences: { opening: number; movement: number; closing: number }; counts: { error: number; warning: number; info: number; total: number }; issues: Issue[] };
};
type Observation = { title: string; whyItMatters: string; suggestedNextStep: string; sourceRefs: string[]; confidence: 'low' | 'medium' | 'high' };
type CopilotResult = { summary: string; observations: Observation[]; questions: string[]; limitations: string[] };
type Props = { config: SupabaseConfigResult; context: CopilotContext; hasEngagement: boolean };

const SESSION_KEY = 'ledgerly.auth.session.v1';

export default function AuditCopilot({ config, context, hasEngagement }: Props) {
  const [prompt, setPrompt] = useState('حلّل أهم الاستثناءات في هذا الملخص واقترح إجراءات متابعة عملية.');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CopilotResult | null>(null);
  const [model, setModel] = useState('');
  const [disclaimer, setDisclaimer] = useState('');
  const availableRefs = useMemo(() => new Set(context.trialBalance.issues.map(issue => issue.ref)), [context]);

  async function runCopilot() {
    setError('');
    setResult(null);
    if (!hasEngagement) { setError('أنشئ ملف تدقيق واختره أولًا.'); return; }
    if (!consent) { setError('وافق صراحةً على إرسال الملخص المنقّح إلى خدمة الذكاء الاصطناعي قبل المتابعة.'); return; }
    if (prompt.trim().length < 3 || prompt.trim().length > 2000) { setError('اكتب سؤالًا بين 3 و2000 حرف.'); return; }
    if (!config.configured) { setError('إعدادات Supabase غير متاحة.'); return; }
    let token = '';
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      const session = raw ? JSON.parse(raw) as { access_token?: string; expires_at?: number } : null;
      if (session?.access_token && (!session.expires_at || session.expires_at > Math.floor(Date.now() / 1000))) token = session.access_token;
    } catch { /* show the actionable sign-in message below */ }
    if (!token) { setError('سجّل الدخول من الإعدادات واربط حسابك بمكتب Ledgerly نشط لاستخدام المساعد.'); return; }

    setBusy(true);
    try {
      const response = await fetch(`${config.config.url}/functions/v1/ledgerly-ai-assistant`, {
        method: 'POST',
        headers: { apikey: config.config.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), context }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; result?: CopilotResult; model?: string; disclaimer?: string };
      if (!response.ok) throw new Error(body.error || 'تعذر تشغيل المساعد. تحقق من تهيئة الخدمة والصلاحيات.');
      if (!body.result || typeof body.result.summary !== 'string') throw new Error('لم تُرجع الخدمة نتيجة مفهومة.');
      const cleaned = {
        ...body.result,
        observations: Array.isArray(body.result.observations) ? body.result.observations.map(item => ({
          ...item,
          sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs.filter(ref => availableRefs.has(ref)) : [],
        })) : [],
        questions: Array.isArray(body.result.questions) ? body.result.questions : [],
        limitations: Array.isArray(body.result.limitations) ? body.result.limitations : [],
      };
      setResult(cleaned);
      setModel(body.model || '');
      setDisclaimer(body.disclaimer || 'مخرجات مساعدة فقط؛ راجعها مهنيًا قبل الاعتماد.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تشغيل المساعد.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="ai-copilot-page">
    <section className="audit-card ai-copilot-hero">
      <div className="ai-copilot-mark" aria-hidden="true">✦</div>
      <div>
        <span className="soft-tag">AI · Human reviewed</span>
        <h3>مساعد Ledgerly الذكي</h3>
        <p className="muted-copy">يساعد المدقق في تفسير مؤشرات الملف واقتراح إجراءات متابعة. لا يعتمد أوراق العمل ولا يصدر رأيًا تدقيقيًا.</p>
      </div>
    </section>
    <section className="audit-card">
      <div className="audit-card-head"><div><h3>ملخص الملف الذي سيُحلّل</h3><p className="muted-copy">تُرسل بيانات مجمعة ومنقّحة فقط عند الضغط على «تحليل». لا تُرسل أسماء العملاء أو أرقامهم الضريبية أو تفاصيل الأدلة أو ملفات المصدر.</p></div><span className="audit-pill">{context.trialBalance.issues.length} مؤشرات</span></div>
      <div className="ai-context-grid">
        <div><span>السنة المالية</span><strong>{context.fiscalYear || '—'}</strong></div>
        <div><span>الحسابات</span><strong>{context.trialBalance.accountCount}</strong></div>
        <div><span>فحوصات تتطلب انتباهًا</span><strong>{context.trialBalance.counts.error + context.trialBalance.counts.warning}</strong></div>
        <div><span>أوراق العمل</span><strong>{context.counts.workpaperCount}</strong></div>
        <div><span>الأدلة غير المرتبطة</span><strong>{context.counts.unlinkedEvidenceCount}</strong></div>
        <div><span>الملاحظات المفتوحة</span><strong>{context.counts.openFindingCount}</strong></div>
      </div>
      <label className="audit-field ai-prompt-field"><span>ما الذي تريد من المساعد مراجعته؟</span><textarea rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={2000} placeholder="مثال: اقترح إجراءات متابعة للفرق في الحركة والرصيد الختامي." /></label>
      <label className="ai-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>أوافق على إرسال السؤال والملخص المجمع الظاهر أعلاه إلى مزود الذكاء الاصطناعي الخارجي لمعالجته. لن تُرسل ملفات الأدلة أو أسماء العملاء من هذا النموذج، ولا تُحفظ المحادثة في Ledgerly.</span></label>
      <p className="audit-warning">لا تُدخل أسماء أشخاص أو عملاء أو أرقامًا ضريبية أو معلومات سرية في السؤال. لا تستخدم المساعد مع بيانات عميل حقيقية إلا بعد موافقة مكتبك والتحقق من التزامات السرية وسياسة مزود الخدمة.</p>
      {error && <p className="ai-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="audit-primary" type="button" disabled={busy || !consent || !hasEngagement} onClick={runCopilot}>{busy ? 'جارٍ التحليل…' : '✦ تحليل الملخص بالذكاء الاصطناعي'}</button><span className="muted-copy">{prompt.length}/2000</span></div>
    </section>
    {result && <section className="audit-card ai-result-card">
      <div className="audit-card-head"><div><h3>نتيجة المساعد</h3><p className="muted-copy">راجع كل نقطة مقابل الملف الأصلي قبل اتخاذ أي إجراء.</p></div>{model && <span className="soft-tag">{model}</span>}</div>
      <p className="ai-result-summary">{result.summary}</p>
      {result.observations.length > 0 && <div className="ai-observations">{result.observations.map((item, index) => <article className="ai-observation" key={index}>
        <div className="ai-observation-head"><strong>{item.title}</strong><span className={`ai-confidence ai-confidence-${item.confidence}`}>{item.confidence === 'high' ? 'ثقة مرتفعة' : item.confidence === 'medium' ? 'ثقة متوسطة' : 'ثقة منخفضة'}</span></div>
        <p><b>لماذا يستحق المراجعة؟</b> {item.whyItMatters}</p><p><b>خطوة مقترحة:</b> {item.suggestedNextStep}</p>
        {item.sourceRefs.length > 0 && <p className="ai-source-refs"><b>مراجع الملخص:</b> {item.sourceRefs.join('، ')}</p>}
      </article>)}</div>}
      {result.questions.length > 0 && <div className="ai-result-section"><h4>أسئلة تحتاج إجابة</h4><ul>{result.questions.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}
      {result.limitations.length > 0 && <div className="ai-result-section"><h4>حدود التحليل</h4><ul>{result.limitations.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}
      <p className="audit-warning">{disclaimer} النتيجة مؤقتة وغير محفوظة في سجل المهمة؛ انسخ ما يلزم إلى ورقة العمل بعد التحقق والموافقة البشرية.</p>
    </section>}
  </div>;
}
