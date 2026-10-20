const DEFAULT_TOLERANCE = 0.01;

function finiteAmount(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function amount(value) {
  return finiteAmount(value) ? value : 0;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Performs deterministic, explainable data-quality and prioritization checks.
 * It does not infer accounting correctness or issue an audit conclusion.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ materiality?: number, tolerance?: number }} options
 */
export function analyzeTrialBalance(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const tolerance = finiteAmount(options.tolerance) && options.tolerance >= 0
    ? options.tolerance
    : DEFAULT_TOLERANCE;
  const materiality = finiteAmount(options.materiality) && options.materiality > 0
    ? options.materiality
    : 0;

  const issues = [];
  const codes = new Map();
  const totals = {
    openingDebit: 0,
    openingCredit: 0,
    movementDebit: 0,
    movementCredit: 0,
    closingDebit: 0,
    closingCredit: 0,
  };

  safeRows.forEach((row, index) => {
    const rowId = typeof row?.id === 'string' ? row.id : String(index);
    const code = String(row?.code ?? '').trim();
    const name = String(row?.name ?? '').trim();
    const values = [
      ['openingDebit', row?.openingDebit],
      ['openingCredit', row?.openingCredit],
      ['debit', row?.debit],
      ['credit', row?.credit],
      ['closingDebit', row?.closingDebit],
      ['closingCredit', row?.closingCredit],
    ];

    const invalid = values.filter(([, value]) => !finiteAmount(value));
    if (invalid.length) {
      issues.push({
        id: `invalid-${rowId}`, rowId, code, name, severity: 'error',
        category: 'invalid-data', amount: null,
        title: 'قيمة رقمية غير صالحة',
        detail: `حقول رقمية مفقودة أو غير صالحة: ${invalid.map(([key]) => key).join('، ')}`,
      });
    }

    const negative = values.filter(([, value]) => finiteAmount(value) && value < -tolerance);
    if (negative.length) {
      issues.push({
        id: `negative-${rowId}`, rowId, code, name, severity: 'warning',
        category: 'negative-amount', amount: roundMoney(negative.reduce((sum, [, value]) => sum + Math.abs(value), 0)),
        title: 'مبلغ سالب يحتاج تحققًا',
        detail: `راجع الإشارة في الحقول: ${negative.map(([key]) => key).join('، ')}`,
      });
    }

    if (!code) {
      issues.push({
        id: `missing-code-${rowId}`, rowId, code, name, severity: 'warning',
        category: 'missing-code', amount: null, title: 'رقم الحساب غير موجود',
        detail: 'تعذر التحقق من تكرار رقم الحساب لهذا السجل.',
      });
    } else {
      const matches = codes.get(code) ?? [];
      matches.push({ rowId, name, index });
      codes.set(code, matches);
    }

    if (!name) {
      issues.push({
        id: `missing-name-${rowId}`, rowId, code, name, severity: 'warning',
        category: 'missing-name', amount: null, title: 'اسم الحساب غير موجود',
        detail: 'راجع تسمية الحساب قبل استخدام البيانات في إجراءات التدقيق.',
      });
    }

    for (const [key, value] of values) {
      if (finiteAmount(value)) {
        const totalKey = ({
          openingDebit: 'openingDebit',
          openingCredit: 'openingCredit',
          debit: 'movementDebit',
          credit: 'movementCredit',
          closingDebit: 'closingDebit',
          closingCredit: 'closingCredit',
        })[key];
        totals[totalKey] += value;
      }
    }

    if (finiteAmount(row?.closingDebit) && finiteAmount(row?.closingCredit)
      && row.closingDebit > tolerance && row.closingCredit > tolerance) {
      issues.push({
        id: `dual-closing-${rowId}`, rowId, code, name, severity: 'warning',
        category: 'dual-sided-closing-balance',
        amount: roundMoney(Math.min(row.closingDebit, row.closingCredit)),
        title: 'رصيد ختامي على الجانبين',
        detail: 'يحتوي الحساب على مدين ختامي ودائن ختامي معًا؛ تحقق من التجميع والإشارات.',
      });
    }

    const grossClosing = amount(row?.closingDebit) + amount(row?.closingCredit);
    const grossMovement = amount(row?.debit) + amount(row?.credit);
    if (materiality > 0 && grossClosing >= materiality) {
      issues.push({
        id: `material-closing-${rowId}`, rowId, code, name, severity: 'info',
        category: 'material-closing-balance', amount: roundMoney(grossClosing),
        title: 'رصيد ختامي يساوي/يتجاوز الأهمية النسبية',
        detail: `الرصيد الإجمالي للحساب يبلغ ${roundMoney(grossClosing)}، والأهمية النسبية المدخلة ${roundMoney(materiality)}. هذا مؤشر للأولوية وليس حكمًا على التحريف.`,
      });
    }
    if (materiality > 0 && grossMovement >= materiality) {
      issues.push({
        id: `material-movement-${rowId}`, rowId, code, name, severity: 'info',
        category: 'material-movement', amount: roundMoney(grossMovement),
        title: 'حركة إجمالية تساوي/تتجاوز الأهمية النسبية',
        detail: `إجمالي الحركة المدينة والدائنة يبلغ ${roundMoney(grossMovement)}. راجع الحساب وفق خطة التدقيق.`,
      });
    }
  });

  for (const [code, matches] of codes.entries()) {
    if (matches.length > 1) {
      for (const match of matches) {
        issues.push({
          id: `duplicate-code-${code}-${match.rowId}`, rowId: match.rowId, code, name: match.name,
          severity: 'warning', category: 'duplicate-account-code', amount: null,
          title: 'رقم حساب مكرر',
          detail: `ظهر رقم الحساب نفسه ${matches.length} مرات في الملف؛ تحقق مما إذا كانت هذه حسابات فرعية أو سجلات مكررة.`,
        });
      }
    }
  }

  const differences = {
    opening: roundMoney(totals.openingDebit - totals.openingCredit),
    movement: roundMoney(totals.movementDebit - totals.movementCredit),
    closing: roundMoney(totals.closingDebit - totals.closingCredit),
  };
  for (const [basis, difference] of Object.entries(differences)) {
    if (Math.abs(difference) > tolerance) {
      const labels = {
        opening: ['الافتتاحي', 'مدين افتتاحي', 'دائن افتتاحي'],
        movement: ['الحركة', 'مدين الحركة', 'دائن الحركة'],
        closing: ['الختامي', 'مدين ختامي', 'دائن ختامي'],
      }[basis];
      issues.push({
        id: `imbalance-${basis}`, rowId: null, code: '', name: '', severity: 'error',
        category: `unbalanced-${basis}`, amount: Math.abs(difference),
        title: `فرق في إجمالي الرصيد ${labels[0]}`,
        detail: `الفرق بين ${labels[1]} و${labels[2]} هو ${difference.toFixed(2)}. تحقق من نطاق الاستيراد والأعمدة والإشارات.`,
      });
    }
  }

  const severityOrder = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]
    || String(a.code).localeCompare(String(b.code), 'en')
    || a.id.localeCompare(b.id, 'en'));

  const count = severity => issues.filter(issue => issue.severity === severity).length;
  return {
    accountCount: safeRows.length,
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, roundMoney(value)])),
    differences,
    balanced: Object.values(differences).every(value => Math.abs(value) <= tolerance),
    tolerance,
    materiality,
    issues,
    counts: { error: count('error'), warning: count('warning'), info: count('info'), total: issues.length },
  };
}
