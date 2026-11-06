/**
 * AI assistance. Three narrow jobs, one per step:
 *
 *   verify     — judge whether mismatches are real (transliteration, heirs, typos)
 *   calculate  — explain the code-computed dues in plain language, spot oddities
 *   decide     — draft the note for the file and the SMS to the citizen
 *
 * Rules:
 *  - The model never computes money and never changes state. It returns text
 *    the worker can accept, edit or ignore.
 *  - Only fields needed for the task are sent (no phone numbers).
 *  - If the model is unavailable or returns junk, a rule-based suggestion is
 *    shown instead, clearly labelled, so the worker is never blocked.
 *  - Outputs are cached per (application, step, language, input) so repeated
 *    page views don't cost money, and so the audit trail can show them.
 */
import crypto from 'node:crypto';
import { db, nowIso } from './db';
import type { CaseView } from './workflow';
import { revenueYearLabel } from './khajna';
import { num, type Lang } from './i18n';

export type AiKind = 'verify' | 'calculate' | 'decide:approve' | 'decide:reject' | 'decide:return';

export interface AiSuggestion {
  source: 'gemini' | 'rules';
  verdict?: 'proceed' | 'return' | 'reject';
  summary: string;
  concerns: string[];
  note?: string;
  citizen_message?: string;
}

const API_KEY = process.env.GEMINI_API_KEY;
const MODELS = [process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash'].filter(Boolean) as string[];
const TIMEOUT_MS = 15_000;

export const aiEnabled = () => Boolean(API_KEY);

// ------------------------------------------------------------------ context

function contextFor(v: CaseView, kind: AiKind) {
  const { app, record, checks, dues } = v;
  const base = {
    mouza: app.mouza,
    application: {
      app_no: app.app_no,
      channel: app.channel,
      days_waiting: v.ageDays,
      applicant_name: app.applicant_name,
      father_name: app.father_name,
      village: app.village,
      patta_no: app.patta_no,
      dag_no: app.dag_no,
      claimed_area_bkl: `${app.claimed_bigha}-${app.claimed_katha}-${app.claimed_lessa}`,
    },
    jamabandi_record: record && {
      village: record.village,
      patta_no: record.patta_no,
      patta_type: record.patta_type,
      dag_no: record.dag_no,
      pattadar: `${record.pattadar_name_as} (${record.pattadar_name_en})`,
      pattadar_father: `${record.father_name_as} (${record.father_name_en})`,
      pattadar_status: record.pattadar_status,
      area_bkl: `${record.bigha}-${record.katha}-${record.lessa}`,
      land_class: record.land_class,
    },
    other_dags_under_same_patta: v.otherDags,
    automatic_checks: checks.map((c) => ({ check: c.key, status: c.status, application: c.applicant, record: c.record })),
  };
  if (kind === 'verify') return base;
  const duesCtx = dues && {
    computed_by_software: true,
    rate_per_bigha_per_year: dues.rate,
    area_bigha: Number(dues.areaBigha.toFixed(2)),
    unpaid_years: dues.years.map((y) => y.label),
    amount_per_year: dues.years[0]?.amount ?? 0,
    total_rupees: dues.total,
    flags: dues.flags,
    last_paid_override_by_worker: app.last_paid_override !== null ? revenueYearLabel(app.last_paid_override) : null,
  };
  return { ...base, dues: duesCtx, worker_note_so_far: app.decision_note };
}

const TASKS: Record<AiKind, string> = {
  verify: `TASK: Step 1, land record verification. Look at the automatic checks and judge them like an experienced Mouzadar would.
- A name typed in English vs. Assamese, or with different romanisation (Ranjit/Ronjit, Kalita/Kolita, Prafulla/Praphulla), is usually the SAME person — say so.
- If the pattadar is deceased and the applicant's father's name equals the pattadar's name, the applicant is probably an heir: khajna can still be accepted but advise নামজাৰী (mutation) at the Circle Office.
- If the dag is not found but other dags exist under the patta, suggest the likely correct dag and recommend returning for correction.
- Eksonia (annual) patta land still pays land revenue; mention it only as information.
- A different area is a typo to correct unless it is very large.
Return JSON: {"verdict":"proceed"|"return"|"reject","summary":"2-3 sentences","concerns":["short point", ...],"citizen_message":"only if verdict is return or reject: SMS to the applicant"}`,
  calculate: `TASK: Step 2, dues. The amount was computed by software from the government rate; DO NOT recompute or change any number, only use the numbers given.
Explain in simple words, so the Mouzadar can tell the citizen: which years are unpaid, rate, area, total. Point out anything unusual (many unpaid years, never paid, high amount for the land class, nothing due).
Return JSON: {"summary":"plain explanation, 2-4 sentences","concerns":["short point", ...]}`,
  'decide:approve': `TASK: Step 3, the Mouzadar has chosen to APPROVE. Draft (a) a one-line note for the file, (b) an SMS telling the applicant the amount to pay and the years covered, asking them to pay on the Sewa Setu portal or to the Mouzadar.
Return JSON: {"summary":"one-paragraph case summary for the file","concerns":[],"note":"file note","citizen_message":"SMS"}`,
  'decide:reject': `TASK: Step 3, the Mouzadar has chosen to REJECT. Draft a clear, polite reason based only on the facts given, and an SMS telling the applicant why and what they can do next.
Return JSON: {"summary":"one-paragraph case summary for the file","concerns":[],"note":"reason for rejection","citizen_message":"SMS"}`,
  'decide:return': `TASK: Step 3, the Mouzadar is RETURNING the application to the citizen for correction. Draft exactly what must be corrected and an SMS asking them to fix and resubmit.
Return JSON: {"summary":"one-paragraph case summary for the file","concerns":[],"note":"what must be corrected","citizen_message":"SMS"}`,
};

function systemPrompt(lang: Lang, mouza: string) {
  const language = lang === 'as' ? 'Assamese (অসমীয়া, use ৰ and ৱ correctly; Assamese digits are fine)' : 'simple English';
  return `You assist a Mouzadar (land revenue collector) in Assam who processes e-Khajana (land revenue payment) applications from the Sewa Setu portal and paper applications.
Terms: patta = land holding document (myadi = periodic, eksonia = annual); dag = plot number; Jamabandi = record of rights; area is Bigha-Katha-Lessa (1 bigha = 5 katha, 1 katha = 20 lessa); revenue year runs July to June.
You only advise. The Mouzadar makes every decision. Be brief, concrete and factual; never invent facts that are not in the data.
Write every text field in ${language}. SMS must be under 320 characters, polite (start with নমস্কাৰ / Namaskar and the applicant's name) and end with "— মৌজাদাৰ, ${mouza}" (or "— Mouzadar, ${mouza}" in English).
Respond with JSON only.`;
}

// ------------------------------------------------------------------ gemini

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
let workingModel: string | null = null;
let lastError: string | null = null;

/** For /healthz: is AI configured, which model answered last, and the last error (never the key). */
export const aiStatus = () => ({ enabled: aiEnabled(), model: workingModel, lastError });

/**
 * Model names change over time. If none of the configured models exist for
 * this key, ask the API which "flash" models it offers and use the newest
 * stable one.
 */
async function discoverModels(): Promise<string[]> {
  const res = await fetch(`${BASE}/models?pageSize=200&key=${encodeURIComponent(API_KEY!)}`);
  if (!res.ok) throw new Error(`list models ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  const version = (n: string) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  return (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => n.includes('flash') && !/(image|tts|audio|live|embed|thinking-exp)/.test(n))
    .sort((a, b) => {
      const score = (n: string) => version(n) * 10 - (n.includes('preview') || n.includes('exp') ? 5 : 0) - (n.includes('lite') ? 1 : 0);
      return score(b) - score(a);
    })
    .slice(0, 4);
}

async function generate(model: string, system: string, user: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // Key passed as a query parameter: works for both classic (AIza…) and newer key formats.
    return await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(API_KEY!)}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
    });
  } finally {
    clearTimeout(t);
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Try the last model that worked, then the configured ones, then whatever
 * flash models the key can see. 404 (retired model) and overload errors
 * (429/5xx — common on the free tier) move on to the next model; auth or
 * request errors stop immediately because another model won't fix them.
 */
async function callGemini(system: string, user: string): Promise<unknown> {
  const tried = new Set<string>();
  let candidates = [workingModel, ...MODELS].filter((m): m is string => !!m);
  let discovered = false;
  let attempts = 0;
  let lastFailure = '';
  try {
    while (attempts < MAX_ATTEMPTS) {
      const model = candidates.find((m) => !tried.has(m));
      if (!model) {
        if (discovered) break;
        discovered = true;
        candidates = await discoverModels();
        continue;
      }
      tried.add(model);
      attempts++;
      let res: Response;
      try {
        res = await generate(model, system, user);
      } catch (e) {
        lastFailure = `${model}: ${(e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message}`;
        continue;
      }
      if (res.status === 404 || RETRYABLE.has(res.status)) {
        lastFailure = `${model} ${res.status}: ${(await res.text()).slice(0, 200)}`;
        if (RETRYABLE.has(res.status)) await sleep(600);
        continue;
      }
      if (!res.ok) throw new Error(`gemini ${model} ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
      const text = data.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? '';
      workingModel = model;
      lastError = null;
      return JSON.parse(text.replace(/^```(json)?|```$/g, '').trim());
    }
    throw new Error(`no Gemini model answered (${[...tried].join(', ')}); last: ${lastFailure}`);
  } catch (e) {
    lastError = (e as Error).message;
    throw e;
  }
}

function sanitize(raw: unknown): Omit<AiSuggestion, 'source'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === 'string' ? x.trim().slice(0, 1200) : undefined);
  const summary = str(r.summary);
  if (!summary) return null;
  const verdict = ['proceed', 'return', 'reject'].includes(r.verdict as string) ? (r.verdict as AiSuggestion['verdict']) : undefined;
  return {
    verdict,
    summary,
    concerns: Array.isArray(r.concerns) ? r.concerns.map(str).filter((x): x is string => !!x).slice(0, 6) : [],
    note: str(r.note),
    citizen_message: str(r.citizen_message)?.slice(0, 400),
  };
}

// ------------------------------------------------------------------ rules fallback

export function ruleSuggestion(v: CaseView, kind: AiKind, lang: Lang): AiSuggestion {
  const r = buildRuleSuggestion(v, kind, lang);
  if (lang !== 'as') return r;
  const d = (x?: string) => (x === undefined ? x : num(x, 'as'));
  return { ...r, summary: d(r.summary)!, concerns: r.concerns.map((c) => d(c)!), note: d(r.note), citizen_message: d(r.citizen_message) };
}

function buildRuleSuggestion(v: CaseView, kind: AiKind, lang: Lang): AiSuggestion {
  const as = lang === 'as';
  const { app, record, checks, dues } = v;
  const sign = as ? `— মৌজাদাৰ, ${app.mouza}` : `— Mouzadar, ${app.mouza}`;
  const hello = as ? `নমস্কাৰ ${app.applicant_name},` : `Namaskar ${app.applicant_name},`;
  const bad = checks.filter((c) => c.status !== 'ok').map((c) => c.key);
  const concerns: string[] = [];

  if (!record) concerns.push(as ? `পট্টা ${app.patta_no}, দাগ ${app.dag_no} জমাবন্দীত নাই।` : `Patta ${app.patta_no}, dag ${app.dag_no} is not in the Jamabandi.`);
  if (!record && v.otherDags.length) concerns.push(as ? `এই পট্টাৰ দাগ: ${v.otherDags.join(', ')}` : `Dags under this patta: ${v.otherDags.join(', ')}`);
  if (bad.includes('name')) concerns.push(as ? 'নামৰ বানান মিলা নাই — একে ব্যক্তি নে চাওক।' : 'Name spelling differs — check it is the same person.');
  if (bad.includes('father')) concerns.push(as ? 'পিতৃৰ নাম মিলা নাই।' : "Father's name differs.");
  if (bad.includes('area')) concerns.push(as ? 'মাটিৰ কালি মিলা নাই — জমাবন্দীৰ কালি গ্ৰহণযোগ্য।' : 'Area differs — the Jamabandi area applies.');
  if (bad.includes('patta_type')) concerns.push(as ? 'একচনীয়া পট্টা।' : 'Eksonia (annual) patta.');
  if (bad.includes('pattadar_status')) concerns.push(as ? 'পট্টাদাৰ মৃত — নামজাৰীৰ পৰামৰ্শ দিয়ক।' : 'Pattadar deceased — advise mutation.');

  const years = dues?.years.map((y) => y.label).join(', ') ?? '';
  const total = dues?.total ?? 0;

  if (kind === 'verify') {
    const verdict = !record ? 'return' : checks.some((c) => c.status === 'fail') ? 'return' : 'proceed';
    return {
      source: 'rules',
      verdict,
      summary: verdict === 'proceed'
        ? (as ? 'স্বয়ংক্ৰিয় পৰীক্ষাত ডাঙৰ সমস্যা পোৱা নাই।' : 'Automatic checks found no major problem.')
        : (as ? 'আবেদনৰ তথ্য জমাবন্দীৰ সৈতে নিমিলে। শুদ্ধ কৰিবলৈ ঘূৰাই পঠিয়াওক।' : 'The application does not match the Jamabandi. Return it for correction.'),
      concerns,
      citizen_message: verdict === 'return' ? `${hello} ${as ? 'আপোনাৰ খাজনা আবেদনৰ পট্টা/দাগ তথ্য জমাবন্দীৰ সৈতে নিমিলে। অনুগ্ৰহ কৰি শুদ্ধ কৰি পুনৰ জমা দিয়ক।' : 'the patta/dag details in your khajna application do not match the land record. Please correct and resubmit.'} ${sign}` : undefined,
    };
  }

  if (kind === 'calculate') {
    const c: string[] = [];
    if (dues?.flags.includes('nothing_due')) c.push(as ? 'কোনো খাজনা বাকী নাই।' : 'Nothing is due.');
    if (dues?.flags.includes('long_arrears')) c.push(as ? `${dues.unpaidCount} বছৰ বাকী — শেষ ৰচিদ চাওক।` : `${dues.unpaidCount} years unpaid — check the last receipt.`);
    if (dues?.flags.includes('never_paid')) c.push(as ? 'জমাবন্দীত কোনো পৰিশোধ নাই।' : 'No payment on record.');
    if (dues?.flags.includes('high_amount')) c.push(as ? 'পৰিমাণ বেছি — মাটিৰ শ্ৰেণী চাওক।' : 'Large amount — check land class.');
    return {
      source: 'rules',
      summary: dues && dues.total > 0
        ? (as ? `${years} ৰাজহ বৰ্ষৰ খাজনা বাকী। হাৰ প্ৰতি বিঘা ₹${dues.rate}, মাটি ${dues.areaBigha.toFixed(2)} বিঘা। মুঠ ₹${total}।` : `Unpaid revenue years: ${years}. Rate ₹${dues.rate}/bigha, area ${dues.areaBigha.toFixed(2)} bigha. Total ₹${total}.`)
        : (as ? 'এই মাটিৰ কোনো খাজনা বাকী নাই।' : 'No khajna is due on this land.'),
      concerns: c,
    };
  }

  const action = kind.split(':')[1];
  const note =
    action === 'approve' ? (as ? `জমাবন্দীৰ সৈতে তথ্য মিলিছে। ${years} বৰ্ষৰ বাবে মুঠ ₹${total} দাবী।` : `Record verified. Demand ₹${total} for ${years}.`)
    : action === 'return' ? (as ? `শুদ্ধ কৰিব লগা: ${concerns.join(' ') || 'আবেদনৰ তথ্য'}` : `To correct: ${concerns.join(' ') || 'application details'}`)
    : (as ? `নাকচৰ কাৰণ: ${concerns.join(' ') || 'আবেদন বৈধ নহয়'}` : `Reason: ${concerns.join(' ') || 'application not valid'}`);
  const sms =
    action === 'approve' ? (as ? `${hello} আপোনাৰ খাজনা আবেদন অনুমোদিত হৈছে। ${years} ৰ বাবে মুঠ ₹${total} সেৱা সেতু পৰ্টেলত বা মৌজাদাৰৰ ওচৰত পৰিশোধ কৰক। ${sign}` : `${hello} your khajna application is approved. Please pay ₹${total} for ${years} on Sewa Setu or to the Mouzadar. ${sign}`)
    : action === 'return' ? (as ? `${hello} আপোনাৰ খাজনা আবেদনত শুদ্ধ কৰিবলগীয়া তথ্য আছে। অনুগ্ৰহ কৰি শুদ্ধ কৰি পুনৰ জমা দিয়ক। ${sign}` : `${hello} your khajna application needs corrections. Please correct and resubmit. ${sign}`)
    : (as ? `${hello} আপোনাৰ খাজনা আবেদন নাকচ কৰা হৈছে। অধিক তথ্যৰ বাবে মৌজাদাৰৰ সৈতে যোগাযোগ কৰক। ${sign}` : `${hello} your khajna application has been rejected. Please contact the Mouzadar for details. ${sign}`);
  return {
    source: 'rules',
    summary: as ? `${app.applicant_name}, পট্টা ${app.patta_no}, দাগ ${app.dag_no}। ${dues ? `বাকী ₹${total}।` : ''}` : `${app.applicant_name}, patta ${app.patta_no}, dag ${app.dag_no}. ${dues ? `Due ₹${total}.` : ''}`,
    concerns: [],
    note,
    citizen_message: sms,
  };
}

// ------------------------------------------------------------------ public

export async function suggest(v: CaseView, kind: AiKind, lang: Lang, opts: { refresh?: boolean } = {}): Promise<AiSuggestion> {
  const ctx = contextFor(v, kind);
  const hash = crypto.createHash('sha256').update(JSON.stringify(ctx)).digest('hex').slice(0, 16);

  if (!opts.refresh) {
    const cached = db.prepare('SELECT source, output_json FROM ai_outputs WHERE application_id = ? AND kind = ? AND lang = ? AND input_hash = ?')
      .get(v.app.id, kind, lang, hash) as { source: 'gemini' | 'rules'; output_json: string } | undefined;
    if (cached && cached.source === 'gemini') return { ...JSON.parse(cached.output_json), source: cached.source };
  }

  let result: AiSuggestion;
  if (aiEnabled()) {
    try {
      const raw = await callGemini(systemPrompt(lang, v.app.mouza), `${TASKS[kind]}\n\nDATA:\n${JSON.stringify(ctx, null, 2)}`);
      const clean = sanitize(raw);
      result = clean ? { ...clean, source: 'gemini' } : ruleSuggestion(v, kind, lang);
    } catch (e) {
      console.warn('[ai] falling back to rules:', (e as Error).message);
      result = ruleSuggestion(v, kind, lang);
    }
  } else {
    result = ruleSuggestion(v, kind, lang);
  }

  db.prepare(`INSERT INTO ai_outputs (application_id, kind, lang, input_hash, source, output_json, created_at) VALUES (?,?,?,?,?,?,?)
              ON CONFLICT(application_id, kind, lang, input_hash) DO UPDATE SET source = excluded.source, output_json = excluded.output_json, created_at = excluded.created_at`)
    .run(v.app.id, kind, lang, hash, result.source, JSON.stringify(result), nowIso());
  return result;
}
