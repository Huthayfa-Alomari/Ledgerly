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
