/**
 * Deterministic record checks for Step 1 (land record verification).
 * These always run, with or without AI. AI adds judgement on top
 * (e.g. "Ranjit Kalita" and "ৰঞ্জিত কলিতা" are the same person).
 */

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  key: 'record' | 'name' | 'father' | 'area' | 'patta_type' | 'pattadar_status';
  status: CheckStatus;
  applicant: string;
  record: string;
}

export interface ApplicantClaim {
  applicant_name: string;
  father_name: string;
  patta_no: string;
  dag_no: string;
  claimed_bigha: number;
  claimed_katha: number;
  claimed_lessa: number;
}

export interface LandRecord {
  id: number;
  patta_no: string;
  patta_type: 'myadi' | 'eksonia';
  dag_no: string;
  village: string;
  pattadar_name_as: string;
  pattadar_name_en: string;
  father_name_as: string;
  father_name_en: string;
  bigha: number;
  katha: number;
  lessa: number;
  land_class: string;
  last_paid_year: number | null;
  settled_year: number;
  pattadar_status: 'alive' | 'deceased';
}

const BENGALI_SCRIPT = /[ঀ-৿]/;

/** Collapse spelling noise: case, spaces, punctuation, doubled letters, vowel length. */
export function latinSkeleton(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/(ee|ii)/g, 'i')
    .replace(/(oo|uu)/g, 'u')
    .replace(/w/g, 'b') // ৱ/ব are often romanised either way
    .replace(/v/g, 'b')
    .replace(/(.)\1+/g, '$1');
}

export function assameseSkeleton(s: string): string {
  return s
    .replace(/\s+/g, '')
    .replace(/[ীি]/g, 'ি')
    .replace(/[ূু]/g, 'ু')
    .replace(/[়‌‍]/g, ''); // nukta, ZWNJ/ZWJ
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** 1.0 = identical after normalisation. */
export function nameSimilarity(entered: string, recordAs: string, recordEn: string): number {
  const [a, b] = BENGALI_SCRIPT.test(entered)
    ? [assameseSkeleton(entered), assameseSkeleton(recordAs)]
    : [latinSkeleton(entered), latinSkeleton(recordEn)];
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function nameStatus(sim: number): CheckStatus {
  if (sim >= 0.999) return 'ok';
  if (sim >= 0.7) return 'warn';
  return 'fail';
}

/** Bigha-Katha-Lessa, the notation used on Assam land records. */
export const bkl = (b: number, k: number, l: number) => `${b}-${k}-${l}`;

export function runChecks(claim: ApplicantClaim, record: LandRecord | null): CheckResult[] {
  if (!record) {
    return [{ key: 'record', status: 'fail', applicant: `${claim.patta_no} / ${claim.dag_no}`, record: '—' }];
  }
  const nameSim = nameSimilarity(claim.applicant_name, record.pattadar_name_as, record.pattadar_name_en);
  const fatherSim = nameSimilarity(claim.father_name, record.father_name_as, record.father_name_en);
  const areaSame =
    claim.claimed_bigha === record.bigha && claim.claimed_katha === record.katha && claim.claimed_lessa === record.lessa;

  return [
    { key: 'record', status: 'ok', applicant: `${claim.patta_no} / ${claim.dag_no}`, record: `${record.patta_no} / ${record.dag_no} · ${record.village}` },
    { key: 'name', status: nameStatus(nameSim), applicant: claim.applicant_name, record: `${record.pattadar_name_as} (${record.pattadar_name_en})` },
    { key: 'father', status: nameStatus(fatherSim), applicant: claim.father_name, record: `${record.father_name_as} (${record.father_name_en})` },
    { key: 'area', status: areaSame ? 'ok' : 'warn', applicant: bkl(claim.claimed_bigha, claim.claimed_katha, claim.claimed_lessa), record: bkl(record.bigha, record.katha, record.lessa) },
    { key: 'patta_type', status: record.patta_type === 'myadi' ? 'ok' : 'warn', applicant: '—', record: record.patta_type },
    { key: 'pattadar_status', status: record.pattadar_status === 'alive' ? 'ok' : 'warn', applicant: '—', record: record.pattadar_status },
  ];
}
