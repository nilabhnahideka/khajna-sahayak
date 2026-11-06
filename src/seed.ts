import './env';
/**
 * Demo data. All people, pattas and dags are FICTIONAL. Each application is
 * built to show one real situation a Mouzadar meets on the portal.
 *
 * Dates are relative to "now", so the dashboard looks right whenever the
 * app is opened.
 */
import { db, SCHEMA } from './db';
import { hashPassword } from './auth';
import { calculateDues, type LandClass } from './khajna';

const MOUZA = 'বৰখেত্ৰী মৌজা';
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3600_000).toISOString();

interface R {
  village: string; patta: string; type: 'myadi' | 'eksonia'; dag: string;
  nameAs: string; nameEn: string; fatherAs: string; fatherEn: string;
  b: number; k: number; l: number; cls: LandClass; lastPaid: number | null; settled: number;
  status?: 'alive' | 'deceased';
}

const records: R[] = [
  { village: 'পানীগাঁও', patta: '45', type: 'myadi', dag: '210', nameAs: 'ৰীতা দাস', nameEn: 'Rita Das', fatherAs: 'হৰেন দাস', fatherEn: 'Haren Das', b: 1, k: 2, l: 0, cls: 'basti', lastPaid: 2024, settled: 1975 },
  { village: 'পানীগাঁও', patta: '78', type: 'myadi', dag: '332', nameAs: 'ৰঞ্জিত কলিতা', nameEn: 'Ronjit Kolita', fatherAs: 'প্ৰফুল্ল কলিতা', fatherEn: 'Praphulla Kolita', b: 3, k: 0, l: 0, cls: 'rupit', lastPaid: 2023, settled: 1968 },
  { village: 'বৰবাৰী', patta: '112', type: 'myadi', dag: '451', nameAs: 'মিনতি বৰুৱা', nameEn: 'Minoti Baruah', fatherAs: 'জয়ন্ত বৰুৱা', fatherEn: 'Joyanta Baruah', b: 0, k: 4, l: 10, cls: 'basti', lastPaid: 2024, settled: 1980 },
  { village: 'বৰবাৰী', patta: '23', type: 'myadi', dag: '89', nameAs: 'দীপক শইকীয়া', nameEn: 'Dipak Saikia', fatherAs: 'ভবেন শইকীয়া', fatherEn: 'Bhaben Saikia', b: 1, k: 3, l: 0, cls: 'faringati', lastPaid: 2025, settled: 1972 },
  { village: 'নতুনগাঁও', patta: '61', type: 'myadi', dag: '140', nameAs: 'কমলা নাথ', nameEn: 'Kamala Nath', fatherAs: 'গোপাল নাথ', fatherEn: 'Gopal Nath', b: 2, k: 0, l: 0, cls: 'basti', lastPaid: 2016, settled: 1965 },
  { village: 'নতুনগাঁও', patta: '7', type: 'eksonia', dag: '512', nameAs: 'আব্দুল হক', nameEn: 'Abdul Haque', fatherAs: 'ৰহিম হক', fatherEn: 'Rahim Haque', b: 1, k: 0, l: 0, cls: 'rupit', lastPaid: 2024, settled: 2005 },
  { village: 'পানীগাঁও', patta: '90', type: 'myadi', dag: '301', nameAs: 'হেমন্ত ডেকা', nameEn: 'Hemanta Deka', fatherAs: 'মহেশ ডেকা', fatherEn: 'Mahesh Deka', b: 2, k: 1, l: 0, cls: 'rupit', lastPaid: 2022, settled: 1960, status: 'deceased' },
  { village: 'বৰবাৰী', patta: '34', type: 'myadi', dag: '77', nameAs: 'পূৰ্ণিমা গগৈ', nameEn: 'Purnima Gogoi', fatherAs: 'ধীৰেন গগৈ', fatherEn: 'Dhiren Gogoi', b: 0, k: 3, l: 0, cls: 'basti', lastPaid: 2026, settled: 1990 },
  { village: 'চেঁচামুখ', patta: '15', type: 'myadi', dag: '66', nameAs: 'অনিল মেধি', nameEn: 'Anil Medhi', fatherAs: 'ৰমেশ মেধি', fatherEn: 'Ramesh Medhi', b: 1, k: 0, l: 0, cls: 'basti', lastPaid: 2025, settled: 1978 },
  { village: 'চেঁচামুখ', patta: '102', type: 'myadi', dag: '19', nameAs: 'ধনজিৎ চৌধুৰী', nameEn: 'Dhanjit Choudhury', fatherAs: 'নৃপেন চৌধুৰী', fatherEn: 'Nripen Choudhury', b: 3, k: 0, l: 0, cls: 'trade', lastPaid: 2022, settled: 1999 },
  { village: 'নতুনগাঁও', patta: '55', type: 'myadi', dag: '204', nameAs: 'নয়নমণি বৰা', nameEn: 'Nayanmoni Bora', fatherAs: 'দিলীপ বৰা', fatherEn: 'Dilip Bora', b: 1, k: 1, l: 0, cls: 'basti', lastPaid: 2023, settled: 1983 },
  { village: 'পানীগাঁও', patta: '81', type: 'myadi', dag: '345', nameAs: 'সুৰেশ পাঠক', nameEn: 'Suresh Pathak', fatherAs: 'কেশৱ পাঠক', fatherEn: 'Keshab Pathak', b: 4, k: 0, l: 0, cls: 'rupit', lastPaid: 2024, settled: 1958 },
  { village: 'বৰবাৰী', patta: '29', type: 'myadi', dag: '95', nameAs: 'মামণি তালুকদাৰ', nameEn: 'Mamoni Talukdar', fatherAs: 'ভূপেন তালুকদাৰ', fatherEn: 'Bhupen Talukdar', b: 1, k: 0, l: 0, cls: 'basti', lastPaid: 2024, settled: 1970 },
  { village: 'চেঁচামুখ', patta: '40', type: 'myadi', dag: '120', nameAs: 'লক্ষ্মী কাকতি', nameEn: 'Lakhi Kakati', fatherAs: 'বিপিন কাকতি', fatherEn: 'Bipin Kakati', b: 0, k: 2, l: 0, cls: 'basti', lastPaid: 2025, settled: 1985 },
  { village: 'নতুনগাঁও', patta: '130', type: 'myadi', dag: '610', nameAs: 'প্ৰদীপ হাজৰিকা', nameEn: 'Pradip Hazarika', fatherAs: 'অমৰ হাজৰিকা', fatherEn: 'Amar Hazarika', b: 1, k: 2, l: 10, cls: 'faringati', lastPaid: null, settled: 2021 },
];

interface A {
  name: string; father: string; phone: string; village: string; patta: string; dag: string;
  b: number; k: number; l: number; channel: 'online' | 'offline'; daysAgo: number;
  status: 'verify' | 'calculate' | 'decide' | 'approved' | 'rejected' | 'returned';
  note?: string; message?: string;
}

const apps: A[] = [
  // Clean case, fresh.
  { name: 'ৰীতা দাস', father: 'হৰেন দাস', phone: '9864012345', village: 'পানীগাঁও', patta: '45', dag: '210', b: 1, k: 2, l: 0, channel: 'online', daysAgo: 2, status: 'verify' },
  // Name typed in English with different romanisation — AI should say same person.
  { name: 'Ranjit Kalita', father: 'Prafulla Kalita', phone: '9435098765', village: 'পানীগাঁও', patta: '78', dag: '332', b: 3, k: 0, l: 0, channel: 'online', daysAgo: 9, status: 'verify' },
  // Wrong dag: 450 does not exist, 451 does.
  { name: 'মিনতি বৰুৱা', father: 'জয়ন্ত বৰুৱা', phone: '7002112233', village: 'বৰবাৰী', patta: '112', dag: '450', b: 0, k: 4, l: 10, channel: 'online', daysAgo: 12, status: 'verify' },
  // Area typed wrong.
  { name: 'দীপক শইকীয়া', father: 'ভবেন শইকীয়া', phone: '9101234567', village: 'বৰবাৰী', patta: '23', dag: '89', b: 1, k: 2, l: 0, channel: 'online', daysAgo: 5, status: 'verify' },
  // Ten years of arrears.
  { name: 'কমলা নাথ', father: 'গোপাল নাথ', phone: '9957001122', village: 'নতুনগাঁও', patta: '61', dag: '140', b: 2, k: 0, l: 0, channel: 'online', daysAgo: 6, status: 'verify' },
  // Eksonia (annual) patta.
  { name: 'Abdul Haque', father: 'Rahim Haque', phone: '6000123456', village: 'নতুনগাঁও', patta: '7', dag: '512', b: 1, k: 0, l: 0, channel: 'online', daysAgo: 3, status: 'verify' },
  // Pattadar has died; son applies. Needs mutation advice.
  { name: 'বিজয় ডেকা', father: 'হেমন্ত ডেকা', phone: '9706543210', village: 'পানীগাঁও', patta: '90', dag: '301', b: 2, k: 1, l: 0, channel: 'online', daysAgo: 8, status: 'verify' },
  // Already paid for this year.
  { name: 'পূৰ্ণিমা গগৈ', father: 'ধীৰেন গগৈ', phone: '8011223344', village: 'বৰবাৰী', patta: '34', dag: '77', b: 0, k: 3, l: 0, channel: 'online', daysAgo: 1, status: 'verify' },
  // Paper application brought to the Mouzadar.
  { name: 'অনিল মেধি', father: 'ৰমেশ মেধি', phone: '9854556677', village: 'চেঁচামুখ', patta: '15', dag: '66', b: 1, k: 0, l: 0, channel: 'offline', daysAgo: 0, status: 'verify' },
  // Trade site — large amount.
  { name: 'Dhanjit Choudhury', father: 'Nripen Choudhury', phone: '9435112244', village: 'চেঁচামুখ', patta: '102', dag: '19', b: 3, k: 0, l: 0, channel: 'online', daysAgo: 4, status: 'verify' },
  // Never paid since settlement.
  { name: 'প্ৰদীপ হাজৰিকা', father: 'অমৰ হাজৰিকা', phone: '7896541230', village: 'নতুনগাঁও', patta: '130', dag: '610', b: 1, k: 2, l: 10, channel: 'online', daysAgo: 7, status: 'verify' },
  // Mid-way.
  { name: 'নয়নমণি বৰা', father: 'দিলীপ বৰা', phone: '9864778899', village: 'নতুনগাঁও', patta: '55', dag: '204', b: 1, k: 1, l: 0, channel: 'online', daysAgo: 6, status: 'calculate' },
  { name: 'সুৰেশ পাঠক', father: 'কেশৱ পাঠক', phone: '9435667788', village: 'পানীগাঁও', patta: '81', dag: '345', b: 4, k: 0, l: 0, channel: 'offline', daysAgo: 5, status: 'decide' },
  // Finished — to show history.
  { name: 'মামণি তালুকদাৰ', father: 'ভূপেন তালুকদাৰ', phone: '9101998877', village: 'বৰবাৰী', patta: '29', dag: '95', b: 1, k: 0, l: 0, channel: 'online', daysAgo: 10, status: 'approved', note: 'জমাবন্দীৰ সৈতে সকলো তথ্য মিলিছে।', message: 'নমস্কাৰ মামণি তালুকদাৰ, আপোনাৰ খাজনা আবেদন অনুমোদিত হৈছে। ৰাজহ বৰ্ষ ২০২৫-২৬ আৰু ২০২৬-২৭ ৰ বাবে মুঠ ৫০ টকা সেৱা সেতু পৰ্টেলত পৰিশোধ কৰক। — মৌজাদাৰ, বৰখেত্ৰী মৌজা' },
  { name: 'লক্ষ্মী কাকতি', father: 'বিপিন কাকতি', phone: '9957334455', village: 'চেঁচামুখ', patta: '40', dag: '210', b: 0, k: 2, l: 0, channel: 'online', daysAgo: 9, status: 'returned', note: 'দাগ নং ভুল। জমাবন্দী অনুসৰি পট্টা ৪০ ৰ দাগ নং ১২০।', message: 'নমস্কাৰ লক্ষ্মী কাকতি, আপোনাৰ আবেদনত দাগ নম্বৰ ভুল আছে (২১০)। পট্টা ৪০ ৰ দাগ নম্বৰ ১২০। অনুগ্ৰহ কৰি শুদ্ধ কৰি পুনৰ জমা দিয়ক। — মৌজাদাৰ, বৰখেত্ৰী মৌজা' },
  { name: 'ৰাজু আলী', father: 'চফিকুল আলী', phone: '6001445566', village: 'বৰবাৰী', patta: '999', dag: '1', b: 5, k: 0, l: 0, channel: 'online', daysAgo: 11, status: 'rejected', note: 'এই মৌজাত পট্টা ৯৯৯ নাই। অন্য মৌজাৰ মাটি হ\'ব পাৰে।', message: 'নমস্কাৰ ৰাজু আলী, পট্টা ৯৯৯ বৰখেত্ৰী মৌজাৰ জমাবন্দীত নাই, সেয়ে আবেদন নাকচ কৰা হ\'ল। আপোনাৰ মাটি যি মৌজাত আছে, সেই মৌজাত আবেদন কৰক। — মৌজাদাৰ, বৰখেত্ৰী মৌজা' },
];

export function seed(reset = false) {
  if (reset) {
    db.exec('DROP TABLE IF EXISTS ai_outputs; DROP TABLE IF EXISTS events; DROP TABLE IF EXISTS applications; DROP TABLE IF EXISTS land_records; DROP TABLE IF EXISTS users;');
    db.exec(SCHEMA);
  }

  const tx = db.transaction(() => {
    const insUser = db.prepare('INSERT INTO users (username, password_hash, name_as, role, mouza) VALUES (?,?,?,?,?)');
    insUser.run('mouzadar', hashPassword(process.env.DEMO_PASSWORD ?? 'khajna2026'), 'ৰমেন বৰা', 'mouzadar', MOUZA);

    const insRec = db.prepare(`INSERT INTO land_records
      (mouza, village, patta_no, patta_type, dag_no, pattadar_name_as, pattadar_name_en, father_name_as, father_name_en,
       bigha, katha, lessa, land_class, last_paid_year, settled_year, pattadar_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const recIds = new Map<string, number>();
    for (const r of records) {
      const info = insRec.run(MOUZA, r.village, r.patta, r.type, r.dag, r.nameAs, r.nameEn, r.fatherAs, r.fatherEn,
        r.b, r.k, r.l, r.cls, r.lastPaid, r.settled, r.status ?? 'alive');
      recIds.set(`${r.patta}/${r.dag}`, Number(info.lastInsertRowid));
    }

    const insApp = db.prepare(`INSERT INTO applications
      (app_no, mouza, channel, submitted_at, applicant_name, father_name, phone, village, patta_no, dag_no,
       claimed_bigha, claimed_katha, claimed_lessa, status, land_record_id, dues_total, dues_years,
       decision_note, citizen_message, receipt_no, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insEv = db.prepare('INSERT INTO events (application_id, at, actor, action, from_status, to_status, note, ai_used) VALUES (?,?,?,?,?,?,?,?)');

    apps.forEach((a, i) => {
      const submitted = ago(a.daysAgo, 3 + (i % 5));
      const appNo = `EKH/${a.channel === 'online' ? 'SS' : 'OF'}/2026/${String(4100 + i * 7).padStart(5, '0')}`;
      const recId = recIds.get(`${a.patta}/${a.dag}`) ?? null;
      const rec = records.find((r) => r.patta === a.patta && r.dag === a.dag);
      const dues = rec ? calculateDues({ landClass: rec.cls, bigha: rec.b, katha: rec.k, lessa: rec.l, lastPaidYear: rec.lastPaid, settledYear: rec.settled }) : null;
      const past = ['calculate', 'decide', 'approved'].includes(a.status);
      const updated = a.status === 'verify' ? submitted : ago(Math.max(0, a.daysAgo - 2));

      const info = insApp.run(appNo, MOUZA, a.channel, submitted, a.name, a.father, a.phone, a.village, a.patta, a.dag,
        a.b, a.k, a.l, a.status, past ? recId : null,
        ['decide', 'approved'].includes(a.status) ? dues?.total ?? null : null,
        ['decide', 'approved'].includes(a.status) ? dues?.unpaidCount ?? null : null,
        a.note ?? null, a.message ?? null,
        a.status === 'approved' ? `KD/2026/${String(880 + i).padStart(4, '0')}` : null, updated);
      const id = Number(info.lastInsertRowid);

      insEv.run(id, submitted, 'citizen', 'submitted', null, 'verify', a.channel === 'offline' ? 'কাগজৰ আবেদন মৌজাদাৰে প্ৰৱিষ্ট কৰিছে' : 'সেৱা সেতু পৰ্টেলৰ জৰিয়তে', 0);
      if (past) insEv.run(id, ago(a.daysAgo - 1), 'mouzadar', 'verified', 'verify', 'calculate', null, 1);
      if (['decide', 'approved'].includes(a.status)) insEv.run(id, ago(a.daysAgo - 2), 'mouzadar', 'calculated', 'calculate', 'decide', `মুঠ ₹${dues?.total}`, 0);
      if (['approved', 'rejected', 'returned'].includes(a.status)) {
        insEv.run(id, ago(Math.max(0, a.daysAgo - 2), 1), 'mouzadar', a.status, a.status === 'approved' ? 'decide' : 'verify', a.status, a.note ?? null, 1);
      }
    });
  });
  tx();
}

if (require.main === module) {
  seed(process.argv.includes('--reset'));
  console.log('Seeded demo data.');
}
