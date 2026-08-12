/* The question editor.
 *
 * It edits three things now: the MAIN BANK every room draws from by default,
 * any number of CUSTOM SETS (each a standalone list with its own 6-char code
 * that a host types on the TV), and the DEFAULT ANSWER TIME every question
 * without its own timer inherits. Because it writes, it asks before destroying
 * anything and warns before you navigate away from unsaved work — the two
 * things that separate an editor from a viewer. The admin token was removed by
 * request, so it opens straight into the editor.
 */

const $ = (id) => document.getElementById(id);
const WARN_AT = 70; // characters; the display's comfortable ceiling
const DEFAULT_SECONDS = 45; // matches the server's own fallback

let dirty = false;
let seedSize = 0;
let defaultSeconds = DEFAULT_SECONDS;

/* null = the main bank; otherwise the id of the custom set being edited. */
let currentSet = null;
let sets = [];

/* --- api ----------------------------------------------------------------- */

const jsonInit = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

/* /api/questions, scoped to the current list. */
const qapi = (init = {}) => {
  const q = currentSet ? `?set=${encodeURIComponent(currentSet)}` : '';
  const extra = init.query ? (q ? `&${init.query.slice(1)}` : init.query) : '';
  return fetch(`/api/questions${q}${extra}`, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
};

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
  secs.placeholder = String(defaultSeconds);
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

/* --- load and save the current list -------------------------------------- */

async function load() {
  const res = await qapi();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  seedSize = data.seedSize || 0;
  $('qlist').textContent = '';
  for (const q of data.questions) addRow(q);
  retally();
  applyFilter();
  dirty = false;
  // Reset to the shipped pack is a main-bank action only.
  $('reset').hidden = currentSet !== null;
}

async function save() {
  const questions = collect();
  say('Saving…');
  const res = await qapi({ method: 'PUT', body: { questions } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    say(body.error || `Could not save (HTTP ${res.status}).`, true);
    return;
  }
  dirty = false;
  say(`Saved ${body.count} question${body.count === 1 ? '' : 's'}.`);
  /* Reload so server-assigned ids come back, and refresh the set's size in the
     picker (a set that just gained its first question is now startable). */
  await load();
  if (currentSet) await refreshSets();
}

/* --- the default answer time --------------------------------------------- */

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) return;
    const data = await res.json();
    if (Number.isFinite(data.answerSeconds)) defaultSeconds = data.answerSeconds;
    $('def-secs').value = data.answerSeconds == null ? '' : String(data.answerSeconds);
  } catch { /* leave the placeholder */ }
}

async function saveDefaultTime() {
  const raw = $('def-secs').value.trim();
  const saved = $('def-saved');
  const res = await fetch('/api/settings', jsonInit('PUT', { answerSeconds: raw === '' ? null : Number(raw) }));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    saved.textContent = body.error || 'Could not save.';
    saved.dataset.state = 'bad';
    return;
  }
  saved.dataset.state = '';
  defaultSeconds = Number.isFinite(body.answerSeconds) ? body.answerSeconds : DEFAULT_SECONDS;
  $('def-secs').value = body.answerSeconds == null ? '' : String(body.answerSeconds);
  saved.textContent = body.answerSeconds == null ? `Cleared — using ${DEFAULT_SECONDS}s.` : 'Saved.';
  // Every blank per-question timer now shows the new default.
  for (const row of rows()) row.querySelector('.q-secs').placeholder = String(defaultSeconds);
  setTimeout(() => { if (saved.textContent) saved.textContent = ''; }, 2500);
}

/* --- custom sets --------------------------------------------------------- */

async function refreshSets() {
  const res = await fetch('/api/sets');
  if (!res.ok) return;
  const data = await res.json();
  sets = Array.isArray(data.sets) ? data.sets : [];
  renderPackOptions();
  renderSetMeta();
}

function renderPackOptions() {
  const sel = $('pack');
  const options = ['<option value="">Main bank</option>'];
  for (const s of sets) {
    const label = `${escapeHtml(s.name)} · ${s.code} · ${s.size} ${s.size === 1 ? 'question' : 'questions'}`;
    options.push(`<option value="${escapeHtml(s.id)}">${label}</option>`);
  }
  sel.innerHTML = options.join('');
  sel.value = currentSet ?? '';
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* Paint the set-meta panel for the current set, or hide it on the main bank. */
function renderSetMeta() {
  const panel = $('setmeta');
  const set = sets.find((s) => s.id === currentSet) || null;
  if (!set) { panel.hidden = true; return; }
  panel.hidden = false;

  $('set-name').value = set.name;
  $('set-code').value = set.code;

  for (const btn of $('set-mode').querySelectorAll('.seg__btn')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === set.mode));
  }
  const count = $('set-count');
  count.hidden = set.mode !== 'random';
  count.value = String(set.count);

  const note = $('set-note');
  note.dataset.state = '';
  note.textContent =
    set.size === 0
      ? 'Add some questions below, then Save.'
      : set.mode === 'random'
        ? `Each game pulls ${Math.min(set.count, set.size)} of ${set.size} at random.`
        : `Each game asks all ${set.size}, in order.`;
}

function setNote(message, bad = false) {
  const note = $('set-note');
  note.textContent = message;
  note.dataset.state = bad ? 'bad' : '';
}

async function updateSet(patch) {
  if (!currentSet) return null;
  const res = await fetch(`/api/sets/${encodeURIComponent(currentSet)}`, jsonInit('PUT', patch));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    setNote(body.error || 'Could not save that change.', true);
    // Re-paint from the last known-good copy so the field snaps back.
    renderSetMeta();
    return null;
  }
  sets = sets.map((s) => (s.id === body.set.id ? body.set : s));
  renderPackOptions();
  renderSetMeta();
  return body.set;
}

async function createSet() {
  if (dirty && !confirm('You have unsaved question edits. Create a new set and lose them?')) return;
  const res = await fetch('/api/sets', jsonInit('POST', {}));
  if (!res.ok) { setNote('Could not create a set.', true); return; }
  const set = await res.json();
  sets.push(set);
  currentSet = set.id;
  renderPackOptions();
  await load();
  renderSetMeta();
  $('set-name').focus();
  $('set-name').select();
}

async function deleteSet() {
  const set = sets.find((s) => s.id === currentSet);
  if (!set) return;
  if (!confirm(`Delete the set "${set.name}" and its ${set.size} question${set.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
  const res = await fetch(`/api/sets/${encodeURIComponent(currentSet)}`, { method: 'DELETE' });
  if (!res.ok) { setNote('Could not delete that set.', true); return; }
  sets = sets.filter((s) => s.id !== currentSet);
  currentSet = null;
  renderPackOptions();
  await load();
  renderSetMeta();
}

async function switchTo(value) {
  const next = value || null;
  if (next === currentSet) return;
  if (dirty && !confirm('You have unsaved question edits. Switch lists and lose them?')) {
    $('pack').value = currentSet ?? '';
    return;
  }
  currentSet = next;
  await load();
  renderSetMeta();
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

$('def-secs').addEventListener('change', () => { saveDefaultTime().catch(() => {}); });

$('pack').addEventListener('change', (ev) => { switchTo(ev.target.value).catch(() => {}); });
$('new-set').addEventListener('click', () => { createSet().catch(() => {}); });
$('del-set').addEventListener('click', () => { deleteSet().catch(() => {}); });

$('set-name').addEventListener('change', () => {
  const name = $('set-name').value.trim();
  if (name) updateSet({ name });
});
$('set-code').addEventListener('input', () => {
  const clean = $('set-code').value.toUpperCase().replace(/[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g, '').slice(0, 6);
  if ($('set-code').value !== clean) $('set-code').value = clean;
});
$('set-code').addEventListener('change', () => {
  const code = $('set-code').value.trim().toUpperCase();
  if (code.length === 6) updateSet({ code });
  else { setNote('A code is 6 characters (A–Z and 2–9).', true); renderSetMeta(); }
});
$('set-count').addEventListener('change', () => {
  const n = Number($('set-count').value);
  if (Number.isFinite(n) && n >= 1) updateSet({ count: Math.round(n) });
});
for (const btn of $('set-mode').querySelectorAll('.seg__btn')) {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    updateSet(mode === 'random' ? { mode, count: Number($('set-count').value) || 10 } : { mode });
  });
}

$('reset').addEventListener('click', async () => {
  /* Destructive and irreversible — the bank has no history — so it names the
     number it is about to throw away rather than asking "are you sure?". */
  const count = rows().length;
  const ok = window.confirm(
    `Replace all ${count} questions with the ${seedSize} shipped ones?\n\n` +
      'Every edit made here is lost. This cannot be undone.',
  );
  if (!ok) return;
  const res = await qapi({ method: 'POST', query: '?reset=seed' });
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

/* --- boot ---------------------------------------------------------------- */

/* No gate any more — open straight into the editor. The editor must be visible
   BEFORE load() adds the rows: each question textarea auto-sizes to its
   scrollHeight, and a display:none element reports 0, which would collapse every
   row's text to zero height (it is clipped by .q-text overflow:hidden). */
$('setup').hidden = false;
$('editor').hidden = false;
Promise.all([loadSettings(), refreshSets(), load()])
  .catch((e) => say(String(e.message || e), true));
