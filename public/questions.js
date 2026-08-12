/* The question editor.
 *
 * Unlike the hat bench this one writes: every room draws from the bank it
 * saves. So it asks before destroying anything, and it warns before you
 * navigate away from unsaved work — the two things that separate an editor
 * from a viewer. The admin token was removed by request, so it opens straight
 * into the editor.
 */

const $ = (id) => document.getElementById(id);
const WARN_AT = 70; // characters; the display's comfortable ceiling

let dirty = false;
let seedSize = 0;

const api = (init = {}) =>
  fetch('/api/questions' + (init.query || ''), {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });

/* --- rows ---------------------------------------------------------------- */

function grow(area) {
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight}px`;
}

function markDirty() {
  dirty = true;
  say('');
}

function addRow(q = { id: '', text: '', seconds: null, enabled: true }, { focus = false } = {}) {
  const row = $('row-tpl').content.firstElementChild.cloneNode(true);
  row.dataset.id = q.id || '';

  const on = row.querySelector('.q-enabled');
  const text = row.querySelector('.q-text');
  const secs = row.querySelector('.q-secs');
  const len = row.querySelector('.qrow__len');

  on.checked = q.enabled !== false;
  text.value = q.text || '';
  secs.value = q.seconds === null || q.seconds === undefined ? '' : String(q.seconds);
  row.dataset.on = String(on.checked);

  const measure = () => {
    const n = text.value.trim().length;
    row.dataset.long = String(n > WARN_AT);
    len.textContent = n > WARN_AT ? `${n} characters — this will set small on the display` : '';
    grow(text);
  };

  on.addEventListener('change', () => {
    row.dataset.on = String(on.checked);
    markDirty();
  });
  text.addEventListener('input', () => { measure(); markDirty(); });
  secs.addEventListener('input', markDirty);
  row.querySelector('.qrow__del').addEventListener('click', () => {
    row.remove();
    markDirty();
    retally();
  });

  $('qlist').append(row);
  measure();
  if (focus) text.focus();
  return row;
}

const rows = () => [...$('qlist').querySelectorAll('.qrow')];

function collect() {
  return rows().map((row) => {
    const secs = row.querySelector('.q-secs').value.trim();
    return {
      id: row.dataset.id || '',
      text: row.querySelector('.q-text').value.trim(),
      seconds: secs === '' ? null : Number(secs),
      enabled: row.querySelector('.q-enabled').checked,
    };
  });
}

function retally() {
  const all = rows();
  const on = all.filter((r) => r.querySelector('.q-enabled').checked).length;
  const timed = all.filter((r) => r.querySelector('.q-secs').value.trim() !== '').length;
  $('tally').textContent = `${on} on / ${all.length} total · ${timed} with their own timer`;
}

function applyFilter() {
  const needle = $('filter').value.trim().toLowerCase();
  const onlyOn = $('only-on').checked;
  for (const row of rows()) {
    const text = row.querySelector('.q-text').value.toLowerCase();
    const isOn = row.querySelector('.q-enabled').checked;
    row.hidden = (needle && !text.includes(needle)) || (onlyOn && !isOn);
  }
}

function say(message, bad = false) {
  const node = $('qsave');
  node.textContent = message;
  node.dataset.state = bad ? 'bad' : '';
}

/* --- load and save ------------------------------------------------------- */

async function load() {
  const res = await api();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.fix ? `${body.error}  →  ${body.fix}` : body.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  seedSize = data.seedSize || 0;
  $('qlist').textContent = '';
  for (const q of data.questions) addRow(q);
  retally();
  applyFilter();
  dirty = false;
}

async function save() {
  const questions = collect();
  say('Saving…');
  const res = await api({ method: 'PUT', body: { questions } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    say(body.error || `Could not save (HTTP ${res.status}).`, true);
    return;
  }
  dirty = false;
  say(`Saved ${body.count} question${body.count === 1 ? '' : 's'}.`);
  /* Reload so server-assigned ids come back — a new row saved without one would
     otherwise be handed a fresh id on every subsequent save. */
  await load();
}

/* --- wiring -------------------------------------------------------------- */

$('add').addEventListener('click', () => {
  const row = addRow({ id: '', text: '', seconds: null, enabled: true }, { focus: true });
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  markDirty();
  retally();
});

$('save').addEventListener('click', () => { save().catch((e) => say(String(e), true)); });
$('filter').addEventListener('input', applyFilter);
$('only-on').addEventListener('change', applyFilter);

$('reset').addEventListener('click', async () => {
  /* Destructive and irreversible — the bank has no history — so it names the
     number it is about to throw away rather than asking "are you sure?". */
  const count = rows().length;
  const ok = window.confirm(
    `Replace all ${count} questions with the ${seedSize} shipped ones?\n\n` +
      'Every edit made here is lost. This cannot be undone.',
  );
  if (!ok) return;
  const res = await api({ method: 'POST', query: '?reset=seed' });
  if (!res.ok) { say('Could not reset.', true); return; }
  await load();
  say('Back to the shipped pack.');
});

/* Both are live edits held only in the DOM until Save. */
$('qlist').addEventListener('change', retally);
$('qlist').addEventListener('input', retally);

window.addEventListener('beforeunload', (ev) => {
  if (!dirty) return;
  ev.preventDefault();
  ev.returnValue = '';
});

/* No gate any more — open straight into the editor. The editor must be visible
   BEFORE load() adds the rows: each question textarea auto-sizes to its
   scrollHeight, and a display:none element reports 0, which would collapse every
   row's text to zero height (it is clipped by .q-text overflow:hidden). */
$('editor').hidden = false;
load().catch((e) => say(String(e.message || e), true));
