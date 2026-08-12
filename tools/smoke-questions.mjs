/* Exercises the question bank API against a running Worker.
   Usage: node tools/smoke-questions.mjs http://127.0.0.1:8787
   The admin token was removed, so /api/questions is open — no token needed. */

const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');

let bad = 0;
const chk = (name, cond, extra = '') => {
  if (!cond) bad++;
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : ''));
};

const call = (init = {}) =>
  fetch(BASE + '/api/questions' + (init.query || ''), {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });

/* --- the page ------------------------------------------------------------ */
const page = await fetch(BASE + '/admin/questions');
const html = await page.text();
chk('/admin/questions serves the editor', page.ok && html.includes('id="qlist"'), String(page.status));

/* --- open access ---------------------------------------------------------- */
const noAuth = await call();
chk('the bank reads without any token', noAuth.ok, String(noAuth.status));

/* --- reading -------------------------------------------------------------- */
const list = await call();
chk('the bank reads with a good token', list.ok, String(list.status));
const data = await list.json();
chk('the bank is seeded from the shipped pack', Array.isArray(data.questions) && data.questions.length > 50,
  (data.questions || []).length + ' questions, seed is ' + data.seedSize);
chk('every question has an id', (data.questions || []).every((q) => !!q.id));
chk('seconds default to null (use the room default)',
  (data.questions || []).every((q) => q.seconds === null || typeof q.seconds === 'number'));

/* --- writing -------------------------------------------------------------- */
const edited = data.questions.slice(0, 5).map((q, i) => ({ ...q, seconds: i === 0 ? 20 : q.seconds }));
edited.push({ id: '', text: 'Name a thing this test invented.', seconds: 90, enabled: true });
edited.push({ id: '', text: '   ', seconds: null, enabled: true }); // blank = deletion

const put = await call({ method: 'PUT', body: { questions: edited } });
const putBody = await put.json();
chk('a valid edit saves', put.ok, JSON.stringify(putBody).slice(0, 80));
chk('the blank row was dropped, not stored', putBody.count === 6, 'count=' + putBody.count);

const after = await (await call()).json();
chk('the per-question timer persisted', after.questions[0].seconds === 20,
  'seconds=' + after.questions[0].seconds);
chk('the new question persisted',
  after.questions.some((q) => q.text === 'Name a thing this test invented.' && q.seconds === 90));
chk('order survived the round trip', after.questions.length === 6, after.questions.length + ' rows');

/* --- validation ----------------------------------------------------------- */
const tooLong = await call({
  method: 'PUT',
  body: { questions: [{ id: '', text: 'x'.repeat(200), seconds: null, enabled: true }] },
});
chk('an over-long question is refused', tooLong.status === 400, String(tooLong.status));

const badSecs = await call({
  method: 'PUT',
  body: { questions: [{ id: '', text: 'Fine question.', seconds: 9999, enabled: true }] },
});
chk('an absurd timer is refused', badSecs.status === 400, String(badSecs.status));

const allOff = await call({
  method: 'PUT',
  body: { questions: [{ id: '', text: 'Fine question.', seconds: null, enabled: false }] },
});
chk('a bank with nothing switched on is refused', allOff.status === 400, String(allOff.status));

const stillThere = await (await call()).json();
chk('a refused write changed nothing', stillThere.questions.length === 6,
  stillThere.questions.length + ' rows');

/* --- reset ---------------------------------------------------------------- */
const reset = await call({ method: 'POST', query: '?reset=seed' });
const resetBody = await reset.json();
chk('reset restores the shipped pack', reset.ok && resetBody.count === data.seedSize,
  resetBody.count + ' vs seed ' + data.seedSize);

console.log(bad ? `\n${bad} FAILED` : '\nall question-bank checks passed');
process.exit(bad ? 1 : 0);
