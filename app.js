import { CLUE_OPTIONS, validateGroup } from './group.js';

const $ = id => document.getElementById(id);
const groups = $('groups'), board = $('board'), slider = $('target'), matrix = $('matrix-scroll');
const createForm = $('create-form'), rosterForm = $('roster-form'), clueForm = $('clue-form');
let listing = [], selected, group, revision, history = [], generation = 0, saved = 0;
let saving = false, saveError = '', conflict = false, changing = false;
let worker, token = 0, modelReady = false, probabilities, computedTarget, sliderTimer, cells = [], clueCell;
const samePair = (item, giver, recipient) => item.giver === giver && item.recipient === recipient;
const percent = p => p > 0 && p < 0.0001 ? '<0.01%' : p < 1 && p > 0.9999 ? '>99.99%' : `${Number((p * 100).toFixed(2))}%`;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function notice(text) {
  $('message').textContent = text;
  $('message').hidden = !text;
}
async function request(path, method = 'GET', data) {
  const response = await fetch(`/api/groups${path}`, { method, ...(data && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error || 'Request failed.'), { status: response.status });
  return payload;
}
function syncControls() {
  const dirty = generation !== saved;
  groups.disabled = changing || dirty || !listing.length;
  $('new').disabled = changing || dirty;
  $('undo').disabled = changing || !history.length;
  $('retry').hidden = !saveError || saving || conflict;
  $('reload-group').hidden = !conflict || changing;
  $('save-status').textContent = saveError ? `Not saved: ${saveError}` : saving || dirty ? 'Saving…' : group ? 'Saved' : '';
}
function updateOptions() {
  groups.replaceChildren();
  if (!listing.length) groups.append(new Option('No groups yet', ''));
  for (const { id, name } of listing) groups.append(new Option(name, id, false, selected === id));
}
function openGroup(envelope) {
  ({ id: selected, revision, group } = envelope);
  history = [];
  generation = saved = 0;
  saveError = '';
  conflict = false;
  slider.value = '0';
  updateOptions();
  renderGroup();
}
async function flush() {
  if (saving || conflict || saved === generation) return;
  saving = true;
  saveError = '';
  syncControls();
  try {
    while (saved !== generation) {
      const snapshot = generation;
      ({ revision } = await request(`/${selected}`, 'PUT', { revision, group }));
      saved = snapshot;
    }
  } catch (error) { saveError = error.message; conflict = error.status === 409; }
  finally { saving = false; syncControls(); }
}
function edit(next, view) {
  const validated = validateGroup(next);
  history.push(group);
  group = validated;
  generation++;
  if (view === 'all') renderGroup();
  else {
    renderCells();
    startAnalysis();
  }
  syncControls();
  if (!saveError) void flush();
}
function target() { return Number(slider.value); }
function showTarget() {
  $('target-value').textContent = slider.value;
  $('target-description').textContent = target() === group.participants.length ? 'No ballot can beat this target.' : `Beat the target by getting ${target() + 1} or more pairs correct.`;
}
function makeMatrix() {
  const names = group.participants;
  matrix.replaceChildren();
  cells = [];
  if (!names.length) return;
  const table = element('table');
  table.setAttribute('aria-label', 'Probability that each giver draws each recipient');
  const head = table.createTHead().insertRow();
  head.append(element('th', 'Giver ↓ / Recipient →'));
  for (const name of names) {
    const th = element('th', name);
    th.scope = 'col';
    head.append(th);
  }
  const body = table.createTBody();
  names.forEach((giver, i) => {
    const tr = body.insertRow();
    const th = element('th', giver);
    th.scope = 'row';
    tr.append(th);
    cells[i] = names.map((recipient, j) => {
      const button = element('button');
      button.type = 'button';
      button.disabled = i === j;
      button.addEventListener('click', () => openClue(giver, recipient));
      tr.insertCell().append(button);
      return button;
    });
  });
  matrix.append(table);
}
function renderCells(probabilities) {
  const names = group.participants;
  cells.forEach((row, i) => row.forEach((button, j) => {
    const giver = names[i], recipient = names[j];
    const state = i === j ? 'self' : group.pairs.find(item => samePair(item, giver, recipient))?.state ?? 'unknown';
    const p = probabilities?.[i][j];
    const display = p === undefined ? '' : ` ${percent(p)}`;
    button.dataset.state = state;
    button.style.setProperty('--p', p ?? 0);
    button.textContent = `${{ self: '—', excluded: '×', confirmed: '✓', unknown: '○', less: '↓', 'much-less': '↓↓', more: '↑', 'much-more': '↑↑' }[state]}${display}`;
    const description = `${giver} to ${recipient}: ${state === 'self' ? 'self-pair unavailable' : clueLabels.get(state)}${p === undefined ? '' : `, calculated ${percent(p)}`}`;
    button.setAttribute('aria-label', description);
    button.title = description;
  }));
}
const clueLabels = new Map(CLUE_OPTIONS.map(({ value, label }) => [value || 'unknown', label]));
function openClue(giver, recipient) {
  clueCell = { giver, recipient };
  const state = group.pairs.find(item => samePair(item, giver, recipient))?.state ?? '';
  const field = clueForm.elements.clue;
  field.replaceChildren(...CLUE_OPTIONS.map(({ value, label, factor }) => new Option(factor ? label + ' (' + factor + '× odds)' : label, value)));
  field.value = state;
  $('clue-pair').textContent = giver + ' → ' + recipient;
  $('clue-dialog').showModal();
}
clueForm.onsubmit = event => {
  event.preventDefault();
  const { giver, recipient } = clueCell;
  const state = clueForm.elements.clue.value;
  const current = group.pairs.find(item => samePair(item, giver, recipient))?.state ?? '';
  $('clue-dialog').close();
  if (state === current) return;
  const pairs = group.pairs.filter(item => !samePair(item, giver, recipient));
  if (state) pairs.push({ giver, recipient, state });
  edit({ ...group, pairs });
};
function renderGroup() {
  $('empty').hidden = true;
  board.hidden = false;
  slider.max = group.participants.length;
  makeMatrix();
  renderCells();
  startAnalysis();
}
function renderCards(cards) {
  const open = Array.from($('cards').querySelectorAll('details'), item => item.open);
  const content = [];
  for (const objective of ['expected', 'tail']) cards.forEach((result, i) => {
    const card = element('article', undefined, 'card'), pick = result[objective];
    const heading = element('h3', `${objective === 'expected' ? 'Highest expected score' : 'Best chance to beat target'} · ${i ? 'Unique recipients' : 'Repeats allowed'}`);
    const exact = objective === 'expected' || pick.method === 'exact';
    const value = element('strong', objective === 'expected' ? `${pick.score.toFixed(2)} / ${group.participants.length}` : percent(pick.probability));
    const tag = element('p', exact ? 'Optimal under this model' : 'Approximate search. Chance shown for this ballot.', 'tag');
    const details = element('details');
    details.open = open[content.length] ?? true;
    const list = element('ol');
    pick.guess.forEach((recipient, index) => {
      const p = probabilities[index][recipient];
      const item = element('li', `${group.participants[index]} → ${group.participants[recipient]} · ${percent(p)}`);
      item.style.setProperty('--p', p);
      list.append(item);
    });
    details.append(element('summary', 'View ballot'), list);
    card.append(heading, value, tag, details);
    content.push(card);
  });
  $('cards').replaceChildren(...content);
}
function requestTarget() {
  if (!modelReady) return;
  computedTarget = target();
  $('recommendation-status').textContent = 'Updating target recommendations…';
  worker.postMessage({ token: ++token, target: computedTarget });
}
function startAnalysis() {
  clearTimeout(sliderTimer);
  worker?.terminate();
  modelReady = false;
  showTarget();
  $('cards').replaceChildren();
  $('analysis-status').textContent = 'Calculating probabilities…';
  $('recommendation-status').textContent = '';
  worker = new Worker('./worker.js', { type: 'module' });
  worker.onerror = () => { $('analysis-status').textContent = 'Could not run the probability calculator.'; };
  worker.onmessage = ({ data }) => {
    if (data.token !== token) return;
    if (data.error) {
      $('analysis-status').textContent = `Calculation failed: ${data.error}`;
      $('recommendation-status').textContent = '';
    } else if (data.status) {
      modelReady = data.status === 'ok';
      $('analysis-status').textContent = data.status === 'insufficient' ? 'Add at least two participants.' : data.status === 'infeasible' ? 'No assignment fits these confirmed pairs and exclusions. Change a clue or use Undo.' : '';
      if (modelReady) {
        probabilities = data.matrix;
        renderCells(data.matrix);
        $('recommendation-status').textContent = 'Calculating recommendations…';
        if (computedTarget !== target()) requestTarget();
      }
    } else if (data.cards && computedTarget === target()) {
      $('recommendation-status').textContent = '';
      renderCards(data.cards);
    }
  };
  computedTarget = target();
  worker.postMessage({ token: ++token, group, target: computedTarget });
}

beforeUnloadRegistration();
function beforeUnloadRegistration() {
  window.addEventListener('beforeunload', event => {
    if (generation !== saved) { event.preventDefault(); event.returnValue = true; }
  });
}
slider.oninput = () => {
  showTarget();
  for (const card of [...$('cards').children].slice(2)) card.hidden = true;
  if (modelReady) $('recommendation-status').textContent = 'Updating target recommendations…';
  clearTimeout(sliderTimer);
  sliderTimer = setTimeout(requestTarget, 120);
};
groups.onchange = async () => {
  const id = groups.value;
  changing = true;
  syncControls();
  board.inert = true;
  try { openGroup(await request(`/${id}`)); }
  catch (error) { groups.value = selected; notice(error.message); }
  finally { changing = false; board.inert = false; syncControls(); }
};
$('undo').onclick = () => {
  if (!history.length) return;
  group = history.pop();
  generation++;
  renderGroup();
  syncControls();
  void flush();
};
$('retry').onclick = flush;
$('reload-group').onclick = async () => {
  if (!window.confirm('Discard unsaved edits and reload the latest saved group?')) return;
  changing = true;
  board.inert = true;
  syncControls();
  try { openGroup(await request(`/${selected}`)); }
  catch (error) { notice(error.message); }
  finally { changing = false; board.inert = false; syncControls(); }
};
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => button.closest('dialog').close();
function formError(form, text = '') {
  const output = form.querySelector('.form-error');
  output.textContent = text;
  output.hidden = !text;
}
$('new').onclick = () => {
  createForm.reset();
  formError(createForm);
  $('create-dialog').showModal();
};
createForm.onsubmit = async event => {
  event.preventDefault();
  const dialog = $('create-dialog');
  const controls = [...createForm.elements];
  const name = createForm.elements.name.value.trim();
  controls.forEach(control => { control.disabled = true; });
  const preventDismiss = e => e.preventDefault();
  dialog.addEventListener('cancel', preventDismiss);
  try {
    const envelope = await request('', 'POST', { name });
    listing.push({ id: envelope.id, name: envelope.group.name });
    listing.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    openGroup(envelope);
    dialog.close();
  } catch (error) { formError(createForm, error.message); }
  finally {
    controls.forEach(control => { control.disabled = false; });
    dialog.removeEventListener('cancel', preventDismiss);
    syncControls();
  }
};
$('roster').onclick = () => {
  rosterForm.elements.participants.value = group.participants.join('\n');
  formError(rosterForm);
  $('roster-dialog').showModal();
};
rosterForm.onsubmit = event => {
  event.preventDefault();
  const participants = rosterForm.elements.participants.value.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  const keep = ({ giver, recipient }) => participants.includes(giver) && participants.includes(recipient);
  try {
    const next = validateGroup({ ...group, participants, pairs: group.pairs.filter(keep) });
    if (JSON.stringify(next) !== JSON.stringify(group)) edit(next, 'all');
    $('roster-dialog').close();
  } catch (error) { formError(rosterForm, error.message); }
};
try {
  const { groups: found, warnings } = await request('');
  listing = found;
  notice(warnings.join(' '));
  if (found.length) openGroup(await request(`/${found[0].id}`));
  else { updateOptions(); $('empty').hidden = false; }
} catch (error) { notice(error.message); updateOptions(); $('empty').hidden = false; }
finally { syncControls(); }
