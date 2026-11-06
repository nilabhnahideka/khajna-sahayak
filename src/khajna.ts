/**
 * Pure domain logic for land revenue (khajna). No I/O, no AI.
 *
 * Money is calculated by code, never by the language model: the amount a
 * citizen pays must be exact, reproducible and auditable.
 */

export type LandClass = 'basti' | 'rupit' | 'faringati' | 'trade';

/**
 * ILLUSTRATIVE rural rates in ₹ per bigha per revenue year.
 * Real rates are notified by the Revenue & DM Department and vary by
 * district and land class. In production this table would be loaded
 * from the official notification for the mouza, with an effective date.
 */
export const RATES_PER_BIGHA: Record<LandClass, number> = {
  basti: 25, // homestead
  rupit: 12, // wet paddy land
  faringati: 10, // dry crop land
  trade: 1200, // rural trade site
};

/** Assam land measure: 1 bigha = 5 katha, 1 katha = 20 lessa. */
export function toBigha(bigha: number, katha: number, lessa: number): number {
  return bigha + katha / 5 + lessa / 100;
}

/** Revenue year runs 1 July – 30 June. Returns the starting calendar year. */
export function revenueYearOf(date: Date): number {
  return date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
}

export function revenueYearLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export interface DuesInput {
  landClass: LandClass;
  bigha: number;
  katha: number;
  lessa: number;
  /** Start year of the last revenue year fully paid, or null if never paid. */
  lastPaidYear: number | null;
  /** Year the patta was settled; dues never go back before this. */
  settledYear: number;
}

export interface YearLine {
  year: number;
  label: string;
  rate: number;
  amount: number;
}

export interface DuesResult {
  areaBigha: number;
  rate: number;
  years: YearLine[];
  total: number;
  unpaidCount: number;
  currentYear: number;
  flags: DuesFlag[];
}

export type DuesFlag = 'nothing_due' | 'long_arrears' | 'never_paid' | 'high_amount';

/** Number of unpaid years at which we ask the worker to look twice. */
export const LONG_ARREARS_YEARS = 6;
export const HIGH_AMOUNT = 5000;

export function calculateDues(input: DuesInput, asOf: Date = new Date()): DuesResult {
  const currentYear = revenueYearOf(asOf);
  const rate = RATES_PER_BIGHA[input.landClass];
  const areaBigha = toBigha(input.bigha, input.katha, input.lessa);
  const firstUnpaid = Math.max(
    input.lastPaidYear === null ? input.settledYear : input.lastPaidYear + 1,
    input.settledYear,
  );

  const years: YearLine[] = [];
  for (let y = firstUnpaid; y <= currentYear; y++) {
    years.push({ year: y, label: revenueYearLabel(y), rate, amount: Math.max(1, Math.round(areaBigha * rate)) });
  }
  const total = years.reduce((s, l) => s + l.amount, 0);

  const flags: DuesFlag[] = [];
  if (years.length === 0) flags.push('nothing_due');
  if (years.length >= LONG_ARREARS_YEARS) flags.push('long_arrears');
  if (input.lastPaidYear === null) flags.push('never_paid');
  if (total >= HIGH_AMOUNT) flags.push('high_amount');

  return { areaBigha, rate, years, total, unpaidCount: years.length, currentYear, flags };
}
