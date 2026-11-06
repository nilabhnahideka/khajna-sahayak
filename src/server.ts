import './env';
import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { db, isEmpty } from './db';
import { seed } from './seed';
import { login, logout, requireUser, verifyPassword } from './auth';
import { translator, num, type Lang } from './i18n';
import { act, caseView, disposed, disposedTodayCount, getApp, getEvents, queue, SLA_DAYS, WorkflowError, type Action } from './workflow';
import { suggest, aiEnabled, aiStatus, type AiKind } from './ai';
import { revenueYearLabel, RATES_PER_BIGHA } from './khajna';

if (isEmpty()) {
  seed();
  console.log('Database was empty — loaded demo data.');
}

const app = express();
const ROOT = path.join(__dirname, '..');
app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use('/static', express.static(path.join(ROOT, 'public'), { maxAge: '1h' }));

// Language + view helpers available in every template.
app.use((req, res, next) => {
  const lang: Lang = req.cookies?.lang === 'en' ? 'en' : 'as';
  const t = translator(lang);
  Object.assign(res.locals, {
    lang,
    t,
    n: (x: number | string) => num(x, lang),
    ry: (y: number) => num(revenueYearLabel(y), lang),
    date: (iso: string) =>
      new Date(iso).toLocaleString(lang === 'as' ? 'as-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }),
    aiOn: aiEnabled(),
    path: req.path,
  });
  next();
});

app.get('/healthz', (_req, res) => res.json({ ok: true, ai: aiStatus() }));

app.get('/lang/:l', (req, res) => {
  res.cookie('lang', req.params.l === 'en' ? 'en' : 'as', { maxAge: 365 * 86_400_000, sameSite: 'lax' });
  const back = typeof req.query.next === 'string' && req.query.next.startsWith('/') ? req.query.next : '/';
  res.redirect(back);
});

// ------------------------------------------------------------------ auth

app.get('/login', (_req, res) => res.render('login', { error: null, demoPassword: process.env.DEMO_PASSWORD ?? 'khajna2026' }));

app.post('/login', (req, res) => {
  const { username = '', password = '' } = req.body as Record<string, string>;
  const row = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username.trim()) as { id: number; password_hash: string } | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).render('login', { error: res.locals.t('login_failed'), demoPassword: process.env.DEMO_PASSWORD ?? 'khajna2026' });
  }
  login(res, row.id);
  res.redirect('/');
});

app.post('/logout', (_req, res) => {
  logout(res);
  res.redirect('/login');
});

app.use(requireUser);

// ------------------------------------------------------------------ pages

app.get('/', (req, res) => {
  const mouza = res.locals.user!.mouza;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  let items = queue(mouza);
  if (q) {
    const needle = q.toLowerCase();
    items = items.filter(({ app: a }) => [a.applicant_name, a.patta_no, a.dag_no, a.app_no, a.village].some((f) => f.toLowerCase().includes(needle)));
  }
  res.render('dashboard', {
    items,
    q,
    done: disposed(mouza),
    stats: {
      pending: items.length,
      overdue: items.filter((i) => i.daysLeft < 0).length,
      dueSoon: items.filter((i) => i.daysLeft >= 0 && i.daysLeft <= 1).length,
      doneToday: disposedTodayCount(mouza),
    },
    SLA_DAYS,
  });
});

function loadApp(req: Request, res: Response) {
  const id = Number(req.params.id);
  return Number.isInteger(id) ? getApp(id, res.locals.user!.mouza) : null;
}

app.get('/app/:id', (req, res) => {
  const a = loadApp(req, res);
  if (!a) return res.status(404).render('error', { message: '404' });
  const v = caseView(a);
  const thisYear = v.dues?.currentYear ?? new Date().getFullYear();
  res.render('application', {
    v,
    events: getEvents(a.id),
    err: typeof req.query.err === 'string' ? req.query.err : null,
    rates: RATES_PER_BIGHA,
    yearOptions: Array.from({ length: 16 }, (_, i) => thisYear - i),
  });
});

const ACTIONS: Action[] = ['complete', 'back', 'approve', 'reject', 'return', 'set_last_paid'];

app.post('/app/:id/act', (req, res) => {
  const a = loadApp(req, res);
  if (!a) return res.status(404).render('error', { message: '404' });
  const body = req.body as Record<string, string>;
  const action = body.action as Action;
  if (!ACTIONS.includes(action)) return res.redirect(`/app/${a.id}?err=invalid_action`);
  try {
    act(a, action, res.locals.user!.username, {
      note: body.note,
      message: body.message,
      aiUsed: body.ai_used === '1',
      lastPaid: body.last_paid === '' || body.last_paid === 'none' ? null : Number(body.last_paid),
    });
  } catch (e) {
    if (e instanceof WorkflowError) return res.redirect(`/app/${a.id}?err=${e.message}#action`);
    throw e;
  }
  // After a final decision, go back to the queue; otherwise stay on the case.
  const after = getApp(a.id, a.mouza)!;
  res.redirect(['approved', 'rejected', 'returned'].includes(after.status) ? `/?done=${a.id}` : `/app/${a.id}#step`);
});

// ------------------------------------------------------------------ AI API

const KINDS: AiKind[] = ['verify', 'calculate', 'decide:approve', 'decide:reject', 'decide:return'];

app.get('/api/app/:id/ai', async (req, res) => {
  const a = loadApp(req, res);
  if (!a) return res.status(404).json({ error: 'not_found' });
  const kind = req.query.kind as AiKind;
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'bad_kind' });
  const result = await suggest(caseView(a), kind, res.locals.lang as Lang, { refresh: req.query.refresh === '1' });
  res.json(result);
});

app.use((_req: Request, res: Response) => res.status(404).render('error', { message: '404' }));

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => console.log(`Khajna Sahayak on http://localhost:${PORT} (AI ${aiEnabled() ? 'on' : 'off — rule-based fallback'})`));
