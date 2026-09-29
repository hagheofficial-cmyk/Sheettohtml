/* =========================================================================
 * demo-seed.js — تولید دیتای نمونه واقع‌گرایانه برای دمو
 *   اجرا: node scripts/demo-seed.js [baseUrl]   (پیش‌فرض http://localhost:8000)
 *   هشدار: فقط روی دیتاست خالی/تستی اجرا شود؛ رکوردها پاک نمی‌شوند.
 * ========================================================================= */
'use strict';

const BASE = process.argv[2] || 'http://localhost:8000';

/* مولد تصادفی قطعی (قابل تکرار) */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260929);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;

/* تاریخ جلالی تصادفی در بازه ۱۴۰۵/۰۵/۱۵ تا ۱۴۰۵/۰۷/۱۰ */
function randomJalali(minOffset, maxOffset) {
  // ساده: روز ۱۵ تا ۳۱ ششم ۱۴۰۵ یا ۱ تا ۱۰ هفتم
  const offsets = [];
  for (let d = 15; d <= 31; d++) offsets.push([6, d]);
  for (let d = 1; d <= 10; d++) offsets.push([7, d]);
  const o = offsets[Math.floor(minOffset + rnd() * (maxOffset - minOffset))] || pick(offsets);
  return { jy: 1405, jm: o[0], jd: o[1] };
}
const fmt = (j) => `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
const before = (a, b) => (a.jm * 100 + a.jd) < (b.jm * 100 + b.jd);

const TICKET_COMMENTS = [
  'پیگیری تیکت کامل انجام شده ولی یادداشت ناقص ثبت شده است.',
  'عملکرد بسیار خوب، تمام موارد رعایت شده.',
  'دلیل بستن تیکت اشتباه انتخاب شده؛ به کارشناس گوشزد شد.',
  'اکشن در CRM ثبت نشده بود.',
  'زمان پاسخ به تیکت طولانی شده و نیازمند پیگیری بهتر است.',
  '', '', '' // خیلی‌ها بدون کامنت
];
const SOCIAL_COMMENTS = [
  'لحن مکالمه حرفه‌ای بود.',
  'پاسخ با تأخیر غیرموجه انجام شده؛ تذکر داده شد.',
  'مکالمه بدون جمع‌بندی و نتیجه قطعی خاتمه یافته.',
  'پیگیری مستمر تا رفع مشکل انجام شد؛ عملکرد خوب.',
  'عدم پاسخ در شیفت بدون دلیل موجه — اعلام به سرپرست.',
  '', '', ''
];

async function post(path, body) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(path + ' → ' + (data.error || res.status));
  return data;
}

(async () => {
  const boot = await (await fetch(BASE + '/api/bootstrap')).json();
  const agents = boot.agents, qc = boot.qcAgents, lists = boot.lists;

  /* ---------------------------------------------------------- تیکت‌ها */
  let tScores = [];
  for (let i = 0; i < 32; i++) {
    const agent = pick(agents);
    const ticketDate = randomJalali(0, 18);
    let reviewDate = randomJalali(2, 14);
    if (before(reviewDate, ticketDate)) reviewDate = randomJalali(8, 17);

    // توزیع واقع‌گرایانه: بیشتر رعایت شده
    const tri = () => (chance(0.68) ? '1' : chance(0.75) ? '0' : '-');
    const redline = chance(0.92) ? '1' : '0'; // گاه‌به‌گاه ردلاین
    const rec = await post('/api/tickets', {
      qcAgent: pick(qc),
      reviewDate: fmt(reviewDate),
      ticketDate: fmt(ticketDate),
      agentName: agent.name,
      ticketCode: String(52400 + Math.floor(rnd() * 900)),
      q1: tri(), q2: tri(), q3: tri(), q4: tri(),
      redline,
      comment: pick(TICKET_COMMENTS)
    });
    tScores.push(rec.score);
  }

  /* ---------------------------------------------------------- سوشال‌ها */
  for (let i = 0; i < 30; i++) {
    const agent = pick(agents);
    const receive = randomJalali(0, 18);
    const answered = chance(0.82);
    let reply = receive;
    if (chance(0.35)) { // گاهی پاسخ فردای آن روز یا بعدتر
      reply = randomJalali(4, 16);
      if (before(reply, receive)) reply = receive;
    }
    const rHour = chance(0.75) ? 9 + Math.floor(rnd() * 9) : 20 + Math.floor(rnd() * 3); // عموماً ساعت کاری
    const rMin = pick([0, 10, 15, 30, 45]);
    const aHour = chance(0.5) ? rHour + Math.floor(rnd() * 3) : Math.min(23, rHour + 8 + Math.floor(rnd() * 14));
    const responseStatus = answered ? 'پاسخ داده شده' : 'عدم پاسخ';
    const slaOk = chance(0.7);
    const rec = await post('/api/socials', {
      reviewDate: fmt(randomJalali(6, 16)),
      qcAgent: pick(qc),
      agentName: agent.name,
      messenger: pick(lists.messengers),
      receiveDate: fmt(receive),
      replyDate: fmt(reply),
      receiveTime: `${String(Math.min(23, rHour)).padStart(2, '0')}:${String(rMin).padStart(2, '0')}`,
      replyTime: `${String(Math.min(23, aHour)).padStart(2, '0')}:${String(pick([0, 5, 20, 30])).padStart(2, '0')}`,
      responseStatus,
      delayReason: !answered ? pick(lists.delayReasons.filter((d) => d !== 'ندارد')) : (slaOk ? 'ندارد' : pick(lists.delayReasons)),
      reasonVerdict: pick(lists.reasonVerdicts),
      qSla: answered && slaOk ? (chance(0.8) ? '1' : '0') : (answered ? '0' : pick(['0', '-', '-'])),
      qFollow: chance(0.72) ? '1' : chance(0.7) ? '0' : '-',
      qClosing: chance(0.7) ? '1' : chance(0.75) ? '0' : '-',
      qTone: chance(0.8) ? '1' : chance(0.8) ? '0' : '-',
      comment: pick(SOCIAL_COMMENTS)
    });
  }

  const dash = await (await fetch(BASE + '/api/dashboard')).json();
  console.log('دیتای نمونه ساخته شد ✅');
  console.log('  تیکت:', dash.ticketCount, '| سوشال:', dash.socialCount,
    '| میانگین نمره:', dash.avgAll, '| SLA:', dash.slaReal + '%', '| ردلاین:', dash.redlineZero);
})().catch((e) => { console.error('خطا:', e.message); process.exit(1); });
