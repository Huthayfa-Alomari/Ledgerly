import test from 'node:test';
import assert from 'node:assert/strict';
import { FILS_PER_JOD, toFils, fromFils, roundJod, formatJod } from '../src/lib/jod-money.mjs';

test('uses the Jordanian dinar smallest unit: one thousand fils per dinar', () => {
  assert.equal(FILS_PER_JOD, 1000);
  assert.equal(toFils(1.234), 1234);
  assert.equal(fromFils(1234), 1.234);
});

test('rounds floating-point input symmetrically to the nearest fils', () => {
  assert.equal(roundJod(0.1 + 0.2), 0.3);
  assert.equal(roundJod(12.3454), 12.345);
  assert.equal(roundJod(12.3456), 12.346);
  assert.equal(roundJod(-12.3456), -12.346);
});

test('does not silently format fils as cents', () => {
  assert.equal(formatJod(12.004), '12.004');
  assert.equal(formatJod(12), '12.000');
});

test('non-finite values do not poison calculations', () => {
  assert.equal(toFils(Number.NaN), 0);
  assert.equal(roundJod(Number.POSITIVE_INFINITY), 0);
});

test('rejects finite values that cannot be represented safely as integer fils', () => {
  assert.throws(() => toFils(Number.MAX_VALUE), RangeError);
  assert.throws(() => roundJod(Number.MAX_VALUE), RangeError);
  assert.throws(() => fromFils(Number.MAX_SAFE_INTEGER + 1), RangeError);
});


import { parseJodAmount } from '../src/lib/jod-money.mjs';

test('parses decimal dots, three JOD decimals, Arabic digits, and currency labels correctly', () => {
  assert.equal(parseJodAmount('12.345'), 12.345);
  assert.equal(parseJodAmount('JOD 12.004'), 12.004);
  assert.equal(parseJodAmount('١٢٫٣٤٥'), 12.345);
  assert.equal(parseJodAmount('١٢.٣٤٥'), 12.345);
  assert.equal(parseJodAmount('د.أ 12.345'), 12.345);
  assert.equal(parseJodAmount('1,234.567'), 1234.567);
  assert.equal(parseJodAmount('1,234'), null, 'single comma with three trailing digits is ambiguous');
  assert.equal(parseJodAmount('1,234,567'), 1234567);
});

test('treats blank cells as zero and rejects malformed values rather than coercing them to zero', () => {
  assert.equal(parseJodAmount(''), 0);
  assert.equal(parseJodAmount('   '), 0);
  assert.equal(parseJodAmount('not-a-number'), null);
  assert.equal(parseJodAmount('12.3.4'), null);
  assert.equal(parseJodAmount('1(2)3'), null);
  assert.equal(parseJodAmount(Number.NaN), null);
  assert.equal(parseJodAmount(Number.POSITIVE_INFINITY), null);
  assert.equal(parseJodAmount('999999999999999999999999999999'), null);
});

test('supports parenthesized negative amounts', () => {
  assert.equal(parseJodAmount('(12.345)'), -12.345);
  assert.equal(parseJodAmount('(JOD 1,234.567)'), -1234.567);
  assert.equal(parseJodAmount('USD 100'), null);
  assert.equal(parseJodAmount('$100'), null);
});


test('strict JOD parser never guesses separator conventions or strips unknown suffixes', () => {
  const warnings = [];
  assert.equal(parseJodAmount('1,5', { onWarning: value => warnings.push(value) }), null);
  assert.equal(parseJodAmount('1.234,567', { onWarning: value => warnings.push(value) }), null);
  assert.equal(parseJodAmount('100 CR', { onWarning: value => warnings.push(value) }), null);
  assert.equal(warnings.length, 3);
  assert.equal(parseJodAmount('1,234.567'), 1234.567);
  assert.equal(parseJodAmount('JOD 12.004'), 12.004);
  assert.equal(parseJodAmount('(12.345)'), -12.345);
  assert.equal(parseJodAmount(''), 0);
  assert.equal(parseJodAmount('', { blankAsZero: false }), null);
});
