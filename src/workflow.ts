/**
 * The application state machine and dashboard queries.
 *
 *   verify ──complete──▶ calculate ──complete──▶ decide ──approve──▶ approved
 *     │                    │   ▲                   │  ▲
 *     │                    └back                   └back
 *     └──── return / reject is allowed from every open step ────▶ returned / rejected
 *
 * Every transition writes an event, so the history is complete by construction.
 */
import { db, nowIso } from './db';
import { runChecks, type ApplicantClaim, type CheckResult, type LandRecord } from './checks';
import { calculateDues, type DuesResult, type LandClass } from './khajna';

export type Status = 'verify' | 'calculate' | 'decide' | 'approved' | 'rejected' | 'returned';
export const OPEN: Status[] = ['verify', 'calculate', 'decide'];

/** Service deadline in days. ASSUMPTION — set to the notified timeline for the service. */
export const SLA_DAYS = Number(process.env.SLA_DAYS ?? 7);

export interface Application extends ApplicantClaim {
  id: number;
  app_no: string;
  mouza: string;
  channel: 'online' | 'offline';
  submitted_at: string;
  phone: string;
  village: string;
  status: Status;
  land_record_id: number | null;
  last_paid_override: number | null;
  dues_total: number | null;
  dues_years: number | null;
  decision_note: string | null;
  citizen_message: string | null;
  receipt_no: string | null;
  updated_at: string;
}

export interface Event {
  id: number;
  at: string;
  actor: string;
  action: string;
  from_status: Status | null;
  to_status: Status | null;
  note: string | null;
  ai_used: number;
}

export function findRecord(mouza: string, patta: string, dag: string): LandRecord | null {
  return (db.prepare('SELECT * FROM land_records WHERE mouza = ? AND patta_no = ? AND dag_no = ?').get(mouza, patta.trim(), dag.trim()) as LandRecord) ?? null;
}

/** Other dags recorded under the same patta — helps spot a mistyped dag number. */
export function dagsUnderPatta(mouza: string, patta: string): string[] {
  return (db.prepare('SELECT dag_no FROM land_records WHERE mouza = ? AND patta_no = ?').all(mouza, patta.trim()) as { dag_no: string }[]).map((r) => r.dag_no);
}

export function getApp(id: number, mouza: string): Application | null {
  return (db.prepare('SELECT * FROM applications WHERE id = ? AND mouza = ?').get(id, mouza) as Application) ?? null;
}

export function getEvents(appId: number): Event[] {
  return db.prepare('SELECT * FROM events WHERE application_id = ? ORDER BY at, id').all(appId) as Event[];
}

export function duesFor(app: Application, record: LandRecord, asOf = new Date()): DuesResult {
  return calculateDues(
    {
      landClass: record.land_class as LandClass,
      bigha: record.bigha,
      katha: record.katha,
      lessa: record.lessa,
      lastPaidYear: app.last_paid_override ?? record.last_paid_year,
      settledYear: record.settled_year,
    },
    asOf,
  );
}

export interface CaseView {
  app: Application;
  record: LandRecord | null;
  checks: CheckResult[];
  dues: DuesResult | null;
  otherDags: string[];
  ageDays: number;
  daysLeft: number;
}

export function caseView(app: Application): CaseView {
  const record = findRecord(app.mouza, app.patta_no, app.dag_no);
  const ageDays = Math.floor((Date.now() - new Date(app.submitted_at).getTime()) / 86_400_000);
  return {
    app,
    record,
    checks: runChecks(app, record),
    dues: record ? duesFor(app, record) : null,
    otherDags: record ? [] : dagsUnderPatta(app.mouza, app.patta_no),
    ageDays,
    daysLeft: SLA_DAYS - ageDays,
  };
}

export type Reason = 'reason_overdue' | 'reason_arrears' | 'reason_mismatch';

export interface QueueItem extends CaseView {
  score: number;
  reasons: Reason[];
}

/**
 * Ordering for "what needs attention first". Deliberately simple and
 * explainable: deadline first, then problems the worker will have to deal
 * with anyway, then age.
 */
export function queue(mouza: string): QueueItem[] {
  const open = db.prepare(`SELECT * FROM applications WHERE mouza = ? AND status IN ('verify','calculate','decide')`).all(mouza) as Application[];
  return open
    .map((app) => {
      const v = caseView(app);
      const reasons: Reason[] = [];
      let score = v.ageDays;
      if (v.daysLeft < 0) { reasons.push('reason_overdue'); score += 100; }
      else if (v.daysLeft <= 1) score += 50;
      if (v.checks.some((c) => c.status === 'fail')) { reasons.push('reason_mismatch'); score += 10; }
      if (v.dues?.flags.includes('long_arrears')) { reasons.push('reason_arrears'); score += 5; }
      return { ...v, score, reasons };
    })
    .sort((a, b) => b.score - a.score);
}

export function disposed(mouza: string, limit = 20): Application[] {
  return db.prepare(`SELECT * FROM applications WHERE mouza = ? AND status IN ('approved','rejected','returned') ORDER BY updated_at DESC LIMIT ?`).all(mouza, limit) as Application[];
}

export function disposedTodayCount(mouza: string): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return (db.prepare(`SELECT COUNT(*) n FROM applications WHERE mouza = ? AND status IN ('approved','rejected','returned') AND updated_at >= ?`).get(mouza, start.toISOString()) as { n: number }).n;
}

// ---------------------------------------------------------------- transitions

export type Action = 'complete' | 'back' | 'approve' | 'reject' | 'return' | 'set_last_paid';

export class WorkflowError extends Error {}

interface ActInput {
  note?: string;
  message?: string;
  aiUsed?: boolean;
  lastPaid?: number | null;
}

function log(appId: number, actor: string, action: string, from: Status | null, to: Status | null, note: string | null, aiUsed = false) {
  db.prepare('INSERT INTO events (application_id, at, actor, action, from_status, to_status, note, ai_used) VALUES (?,?,?,?,?,?,?,?)')
    .run(appId, nowIso(), actor, action, from, to, note, aiUsed ? 1 : 0);
}

function setStatus(app: Application, status: Status, extra: Partial<Application> = {}) {
  const fields = { ...extra, status, updated_at: nowIso() };
  const cols = Object.keys(fields);
  db.prepare(`UPDATE applications SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...cols.map((c) => (fields as Record<string, unknown>)[c] ?? null), app.id);
}

export function act(app: Application, action: Action, actor: string, input: ActInput = {}) {
  const note = input.note?.trim() || null;
  const message = input.message?.trim() || null;
  if (!OPEN.includes(app.status)) throw new WorkflowError('already_disposed');

  db.transaction(() => {
    const v = caseView(app);
    switch (action) {
      case 'complete': {
        if (app.status === 'verify') {
          if (!v.record) throw new WorkflowError('record_not_found');
          setStatus(app, 'calculate', { land_record_id: v.record.id });
          log(app.id, actor, 'verified', 'verify', 'calculate', note, input.aiUsed);
        } else if (app.status === 'calculate') {
          if (!v.dues) throw new WorkflowError('record_not_found');
          setStatus(app, 'decide', { dues_total: v.dues.total, dues_years: v.dues.unpaidCount });
          log(app.id, actor, 'calculated', 'calculate', 'decide', `₹${v.dues.total} (${v.dues.unpaidCount})`, input.aiUsed);
        } else throw new WorkflowError('invalid_action');
        break;
      }
      case 'back': {
        const prev: Partial<Record<Status, Status>> = { calculate: 'verify', decide: 'calculate' };
        const to = prev[app.status];
        if (!to) throw new WorkflowError('invalid_action');
        setStatus(app, to);
        log(app.id, actor, 'sent_back', app.status, to, note);
        break;
      }
      case 'set_last_paid': {
        if (app.status !== 'calculate') throw new WorkflowError('invalid_action');
        db.prepare('UPDATE applications SET last_paid_override = ?, updated_at = ? WHERE id = ?').run(input.lastPaid ?? null, nowIso(), app.id);
        log(app.id, actor, 'last_paid_changed', null, null, note ?? String(input.lastPaid ?? '—'));
        break;
      }
      case 'approve': {
        if (app.status !== 'decide') throw new WorkflowError('invalid_action');
        if (!app.dues_total) throw new WorkflowError('nothing_due');
        const receipt = `KD/${new Date().getFullYear()}/${String(app.id).padStart(5, '0')}`;
        setStatus(app, 'approved', { decision_note: note, citizen_message: message, receipt_no: receipt });
        log(app.id, actor, 'approved', 'decide', 'approved', note, input.aiUsed);
        break;
      }
      case 'reject':
      case 'return': {
        if (!note) throw new WorkflowError('reason_required');
        const to: Status = action === 'reject' ? 'rejected' : 'returned';
        setStatus(app, to, { decision_note: note, citizen_message: message });
        log(app.id, actor, to, app.status, to, note, input.aiUsed);
        break;
      }
      default:
        throw new WorkflowError('invalid_action');
    }
  })();
}
