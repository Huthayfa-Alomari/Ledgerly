import type { ReactNode } from 'react';

export type AuditPriorityItem = {
  id: string;
  title: string;
  detail: string;
  count: number;
  onOpen: () => void;
};

type AuditPriorityPanelProps = {
  items: AuditPriorityItem[];
  note?: string;
};

/**
 * Navigation-first dashboard triage panel. Counts are calculated by the caller
 * from the currently available data; this component makes no compliance claim.
 */
export default function AuditPriorityPanel({ items, note = 'These are administrative indicators, not a conclusion about compliance with auditing standards.' }: AuditPriorityPanelProps) {
  return (
    <section className="audit-card dashboard-priority" aria-labelledby="audit-priority-heading">
      <div className="audit-card-head">
        <div>
          <h3 id="audit-priority-heading">مركز الإجراءات ذات الأولوية</h3>
          <p>مؤشرات تستحق المراجعة قبل اعتبار الملف جاهزًا للإقفال</p>
        </div>
        <span className="soft-tag">Live checks · Local data</span>
      </div>
      <div className="priority-grid">
        {items.map((item) => (
          <button className="priority-item" key={item.id} type="button" onClick={item.onOpen}>
            <span className="priority-count">{item.count}</span>
            <span className="priority-copy">
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </span>
            <span className="priority-arrow" aria-hidden="true">←</span>
          </button>
        ))}
      </div>
      <p className="priority-disclaimer">{note}</p>
    </section>
  );
}
