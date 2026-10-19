import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('engagement management captures scope, schedule, fees, team and independence review', () => {
  for (const field of ['scope','plannedStart','plannedEnd','feeJod','team','independenceStatus','conflictCheck','declarationDate']) {
    assert.match(app, new RegExp(`${field}\\??:`), `engagement type should support ${field}`);
  }
  for (const label of ['نطاق المهمة','تاريخ البدء المخطط','تاريخ الانتهاء المخطط','الأتعاب المتفق عليها (د.أ)','فريق المهمة','تقييم الاستقلالية والإقرارات','فحص تعارض المصالح']) {
    assert.ok(app.includes(label), `engagement form should display ${label}`);
  }
});

test('engagement dates are validated and independence limitation is disclosed', () => {
  assert.ok(app.includes("form.plannedEnd<form.plannedStart"));
  assert.ok(app.includes('لا يُعد إقرارًا إلكترونيًا موقعًا'));
  assert.ok(app.includes('e.independenceStatus||\'غير مسجل\''));
});
