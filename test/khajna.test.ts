import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateDues, revenueYearOf, revenueYearLabel, toBigha } from '../src/khajna';
import { nameSimilarity, runChecks } from '../src/checks';

test('revenue year runs July to June', () => {
  assert.equal(revenueYearOf(new Date('2026-06-30T12:00:00')), 2025);
  assert.equal(revenueYearOf(new Date('2026-07-01T12:00:00')), 2026);
  assert.equal(revenueYearLabel(2026), '2026-27');
  assert.equal(revenueYearLabel(2099), '2099-00');
});

test('bigha-katha-lessa conversion', () => {
  assert.equal(toBigha(1, 0, 0), 1);
  assert.equal(toBigha(0, 5, 0), 1);
  assert.equal(toBigha(0, 0, 100), 1);
  assert.equal(toBigha(1, 2, 10), 1.5);
});

const nov2026 = new Date('2026-11-06T10:00:00');

test('dues for two unpaid years', () => {
  const r = calculateDues({ landClass: 'basti', bigha: 1, katha: 0, lessa: 0, lastPaidYear: 2024, settledYear: 1970 }, nov2026);
  assert.deepEqual(r.years.map((y) => y.label), ['2025-26', '2026-27']);
  assert.equal(r.total, 50);
  assert.deepEqual(r.flags, []);
});

test('nothing due when paid for current year', () => {
  const r = calculateDues({ landClass: 'basti', bigha: 1, katha: 0, lessa: 0, lastPaidYear: 2026, settledYear: 1970 }, nov2026);
  assert.equal(r.total, 0);
  assert.deepEqual(r.flags, ['nothing_due']);
});

test('never paid counts from settlement year and flags it', () => {
  const r = calculateDues({ landClass: 'faringati', bigha: 1, katha: 2, lessa: 10, lastPaidYear: null, settledYear: 2021 }, nov2026);
  assert.equal(r.unpaidCount, 6);
  assert.ok(r.flags.includes('never_paid'));
  assert.ok(r.flags.includes('long_arrears'));
  assert.equal(r.total, 6 * 15);
});

test('minimum ₹1 per year for tiny plots', () => {
  const r = calculateDues({ landClass: 'faringati', bigha: 0, katha: 0, lessa: 1, lastPaidYear: 2025, settledYear: 1970 }, nov2026);
  assert.equal(r.total, 1);
});

test('name similarity tolerates romanisation, not different people', () => {
  assert.equal(nameSimilarity('Rita Das', 'ৰীতা দাস', 'Rita Das'), 1);
  assert.ok(nameSimilarity('Ranjit Kalita', 'ৰঞ্জিত কলিতা', 'Ronjit Kolita') >= 0.7);
  assert.ok(nameSimilarity('Bijoy Deka', 'হেমন্ত ডেকা', 'Hemanta Deka') < 0.7);
  assert.equal(nameSimilarity('ৰীতা  দাস', 'ৰীতা দাস', 'Rita Das'), 1);
});

test('missing record fails the record check only', () => {
  const claim = { applicant_name: 'x', father_name: 'y', patta_no: '1', dag_no: '2', claimed_bigha: 1, claimed_katha: 0, claimed_lessa: 0 };
  const c = runChecks(claim, null);
  assert.equal(c.length, 1);
  assert.equal(c[0].status, 'fail');
});
