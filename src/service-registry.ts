export type ServiceId =
  | 'external_audit'
  | 'internal_audit'
  | 'bookkeeping'
  | 'tax_advisory'
  | 'training_development'
  | 'feasibility_studies';

export type ServiceReadiness = 'existing-foundation' | 'partial-foundation' | 'planned';

export type ServiceDefinition = {
  id: ServiceId;
  label: string;
  labelEn: string;
  summary: string;
  firstWorkflow: string[];
  readiness: ServiceReadiness;
  readinessLabel: string;
  caution: string;
};

export const SERVICE_REGISTRY: readonly ServiceDefinition[] = [
  {
    id: 'external_audit',
    label: 'التدقيق الخارجي',
    labelEn: 'External audit',
    summary: 'قبول العميل، تقييم المخاطر، أوراق العمل، الأدلة، المراجعة ومسودة التقرير.',
    firstWorkflow: ['قبول العميل والاستقلالية', 'تخطيط المخاطر والإجراءات', 'استيراد ميزان المراجعة', 'أوراق العمل والأدلة', 'مراجعة الملف والإقفال'],
    readiness: 'existing-foundation',
    readinessLabel: 'أساس قائم في التطبيق',
    caution: 'المخرجات الحالية مسودات وتحتاج إلى مراجعة مهنية؛ لا يصدر النظام رأيًا تدقيقيًا تلقائيًا.',
  },
  {
    id: 'internal_audit',
    label: 'التدقيق الداخلي',
    labelEn: 'Internal audit',
    summary: 'سجل المخاطر والضوابط، خطة التدقيق، اختبارات الرقابة، النتائج ومتابعة المعالجة.',
    firstWorkflow: ['تحديد نطاق المراجعة', 'تقييم المخاطر والضوابط', 'تنفيذ اختبارات الرقابة', 'توثيق النتائج والتوصيات', 'متابعة خطط المعالجة'],
    readiness: 'planned',
    readinessLabel: 'يتطلب تنفيذ الوحدة',
    caution: 'هذه خريطة أولية للمسار وليست بعد سجلًا تشغيليًا مستقلًا للتدقيق الداخلي.',
  },
  {
    id: 'bookkeeping',
    label: 'مسك الحسابات',
    labelEn: 'Bookkeeping',
    summary: 'دليل الحسابات، مسودات القيود، الأستاذ العام، التسويات وميزان المراجعة.',
    firstWorkflow: ['إعداد دليل الحسابات', 'استيراد الحركات أو إدخال القيود', 'مراجعة واعتماد القيود', 'التسويات والمطابقات', 'ميزان المراجعة والتقارير'],
    readiness: 'partial-foundation',
    readinessLabel: 'أدوات استيراد وتسوية قائمة',
    caution: 'محرك المطابقة والاستيراد الحالي لا يعني اكتمال دفتر أستاذ أو دورة ترحيل محاسبية متكاملة.',
  },
  {
    id: 'tax_advisory',
    label: 'الاستشارات الضريبية',
    labelEn: 'Tax advisory',
    summary: 'التقويم الضريبي، قائمة المستندات، أوراق احتساب قابلة للمراجعة ومسودات الإقرارات.',
    firstWorkflow: ['تحديد نوع الالتزام والفترة', 'جمع المستندات المطلوبة', 'إعداد ورقة الاحتساب', 'مراجعة مختص ضريبي', 'توثيق حالة الإقرار والمتابعة'],
    readiness: 'planned',
    readinessLabel: 'يتطلب تنفيذ الوحدة',
    caution: 'لن تُضمّن معدلات أو نماذج ضريبية أردنية على أنها سارية قبل التحقق من مصدر رسمي وتاريخ النفاذ ومراجعة مختص.',
  },
  {
    id: 'training_development',
    label: 'التطوير والتدريب',
    labelEn: 'Development & training',
    summary: 'الدورات والجلسات، الحضور، مواد التعلم، التقييم وسجلات الشهادات.',
    firstWorkflow: ['إنشاء برنامج تدريبي', 'تحديد المدرب والجلسات', 'تسجيل المشاركين', 'الحضور والتقييم', 'إصدار سجل إتمام أو شهادة'],
    readiness: 'planned',
    readinessLabel: 'يتطلب تنفيذ الوحدة',
    caution: 'الشهادات في النظام ستكون سجلات إتمام وليست اعتمادًا مهنيًا رسميًا ما لم توجد جهة اعتماد مناسبة.',
  },
  {
    id: 'feasibility_studies',
    label: 'دراسات الجدوى الاقتصادية',
    labelEn: 'Economic feasibility',
    summary: 'افتراضات المشروع، الاستثمار والتكاليف، التدفقات النقدية، نقطة التعادل وتحليل الحساسية.',
    firstWorkflow: ['تعريف المشروع والفترة', 'توثيق الافتراضات ومصادرها', 'بناء الإيرادات والتكاليف', 'حساب التدفقات ونقطة التعادل', 'تحليل السيناريوهات ومراجعة التقرير'],
    readiness: 'planned',
    readinessLabel: 'يتطلب تنفيذ الوحدة',
    caution: 'تُعرض التوقعات على أنها سيناريوهات مبنية على افتراضات وليست ضمانًا للنتائج.',
  },
] as const;

export function getServiceById(id: ServiceId): ServiceDefinition | undefined {
  return SERVICE_REGISTRY.find((service) => service.id === id);
}
