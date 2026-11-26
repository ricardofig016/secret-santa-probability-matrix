import { CLUE_OPTIONS, validateGroup } from './group.js';

const $ = id => document.getElementById(id);
const groups = $('groups'), board = $('board'), slider = $('target'), matrix = $('matrix-scroll');
const createForm = $('create-form'), rosterForm = $('roster-form'), clueForm = $('clue-form');
let listing = [], selected, group, revision, history = [], generation = 0, saved = 0;
let mode = 'expected', computedMode, computedTeam, saving = false, saveError = '', conflict = false, changing = false;
let deepStatus = [], deepWorkers = [], deepToken = 0, cardsReady = false, cardGeneration = 0, lastContext, lastCards, lastCardMode, lastTeam, worker, token = 0, modelReady = false, probabilities, hovered = null, selectedRow = null, selectedColumn = null, lines = { rows: [], columns: [] }, computedTarget, sliderTimer, cells = [], clueCell;
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
  mode = 'expected';
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
  else if (view === 'recommendations') {
    requestTarget();
  } else {
    renderCells();
    startAnalysis();
  }
  syncControls();
  if (!saveError) void flush();
}
function target() { return Number(slider.value); }
function showTarget() {
  $('target-value').textContent = slider.value;
}
function makeMatrix() {
  const names = group.participants;
  matrix.replaceChildren();
  cells = [];
  if (!names.length) return;
  const table = element('table');
  table.setAttribute('aria-label', 'Probability that each giver draws each recipient');
  lines = { rows: names.map(() => []), columns: names.map(() => []) };
  const head = table.createTHead().insertRow();
  head.append(element('th', 'Giver ↓ / Recipient →'));
  names.forEach((name, j) => {
    const th = element('th');
    th.scope = 'col';
    th.append(lineButton(name, 'column', j));
    lines.columns[j].push(th);
    head.append(th);
  });
  const body = table.createTBody();
  names.forEach((giver, i) => {
    const tr = body.insertRow();
    const th = element('th');
    th.scope = 'row';
    th.append(lineButton(giver, 'row', i));
    lines.rows[i].push(th);
    tr.append(th);
    cells[i] = names.map((recipient, j) => {
      const button = element('button');
      button.type = 'button';
      button.disabled = i === j;
      button.addEventListener('click', () => openClue(giver, recipient));
      const cell = tr.insertCell();
      cell.dataset.row = i;
      cell.dataset.column = j;
      cell.append(button);
      lines.rows[i].push(cell);
      lines.columns[j].push(cell);
      return button;
    });
  });
  table.addEventListener('pointerover', event => hover(event.target.closest('[data-row], [data-column]')));
  table.addEventListener('focusin', event => hover(event.target.closest('[data-row], [data-column]')));
  table.addEventListener('pointerleave', () => hover(null));
  table.addEventListener('focusout', event => { if (!table.contains(event.relatedTarget)) hover(null); });
  matrix.append(table);
  paintLines();
}
function lineButton(name, kind, index) {
  const button = element('button', name, 'line-toggle');
  button.type = 'button';
  button.dataset[kind] = index;
  button.addEventListener('click', () => {
    if (kind === 'row') selectedRow = selectedRow === name ? null : name;
    else selectedColumn = selectedColumn === name ? null : name;
    paintLines();
  });
  return button;
}
function hover(target) {
  hovered = target ? { row: target.dataset.row, column: target.dataset.column } : null;
  paintLines();
}
function paintLines() {
  const names = group.participants;
  const row = names.indexOf(selectedRow), column = names.indexOf(selectedColumn);
  if (row < 0) selectedRow = null;
  if (column < 0) selectedColumn = null;
  for (const kind of ['rows', 'columns']) lines[kind].flat().forEach(node => node.classList.remove(`hover-${kind}`, `selected-${kind}`));
  if (hovered?.row !== undefined) lines.rows[hovered.row]?.forEach(node => node.classList.add('hover-rows'));
  if (hovered?.column !== undefined) lines.columns[hovered.column]?.forEach(node => node.classList.add('hover-columns'));
  if (row >= 0) lines.rows[row].forEach(node => node.classList.add('selected-rows'));
  if (column >= 0) lines.columns[column].forEach(node => node.classList.add('selected-columns'));
  document.querySelectorAll('.line-toggle').forEach(button => {
    const selected = button.dataset.row !== undefined ? Number(button.dataset.row) === row : Number(button.dataset.column) === column;
    button.setAttribute('aria-pressed', selected);
  });
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
  syncRecommendationControls();
  makeMatrix();
  renderCells();
  startAnalysis();
}
function cardShells() {
  return [...$('cards').children];
}
function setCardsLoading(text) {
  cardsReady = false;
  cardGeneration++;
  stopDeepSearch();
  $('cards').classList.add('loading');
  $('cards').setAttribute('aria-busy', 'true');
  $('cards').querySelectorAll('.deep-search').forEach(button => { button.disabled = true; });
  $('recommendation-status').textContent = text;
}
function resetCards(text) {
  $('cards').classList.remove('loading', 'team-cards');
  $('cards').removeAttribute('aria-busy');
  cardShells().forEach((card, i) => card.replaceChildren(element('h3', i ? 'Unique recipients' : 'Repeats allowed'), element('p', text, 'card-placeholder')));
}
function stopDeepSearch() {
  deepWorkers.forEach(job => { if (job) { clearTimeout(job.deadline); job.worker.terminate(); } });
  deepWorkers = [];
}
function startDeepSearch(index) {
  if (!cardsReady || !lastContext || lastContext.generation !== cardGeneration) return;
  const context = lastContext, pick = lastCards[index], card = cardShells()[index], token = ++deepToken, deep = new Worker('./deep-worker.js', { type: 'module' });
  deepWorkers[index]?.worker.terminate();
  const finish = message => {
    clearTimeout(deadline);
    if (deepWorkers[index]?.token !== token || lastContext !== context || context.generation !== cardGeneration) return deep.terminate();
    deep.terminate();
    deepWorkers[index] = null;
    const current = cardShells()[index];
    current.classList.remove('searching');
    current.querySelector('.deep-search').textContent = 'Deep search';
    deepStatus[index] = message;
    current.querySelector('.deep-status').textContent = message;
  };
  const budgetMs = Number($('deep-duration').value), budget = durationLabel(budgetMs);
  const deadline = setTimeout(() => finish(lastCards[index].team.value > pick.team.value ? `Stopped at ${budget}. Best pair kept. Not proven optimal.` : `Stopped at ${budget}. No better pair found. Not proven optimal.`), budgetMs);
  deepWorkers[index] = { worker: deep, token, deadline };
  deep.onerror = () => finish('Deep search failed.');
  card.classList.add('searching');
  deepStatus[index] = `Deep search running for up to ${budget}…`;
  card.querySelector('.deep-status').textContent = deepStatus[index];
  card.querySelector('.deep-search').textContent = 'Cancel';
  deep.onmessage = ({ data }) => {
    if (deepWorkers[index]?.token !== token || !cardsReady || lastContext !== context || context.generation !== cardGeneration) {
      deep.terminate();
      return;
    }
    if (data.type === 'error') return finish(`Deep search failed: ${data.error}`);
    if (data.value > pick.team.value) {
      lastCards[index] = { ...pick, ballots: data.ballots, distribution: data.distribution, team: { ...pick.team, ballots: data.ballots, value: data.value, method: data.method } };
      renderCards(lastCards, lastCardMode, lastTeam, true);
    }
    const current = cardShells()[index];
    if (data.type === 'progress' && lastCards[index].team.value > pick.team.value) current.querySelector('.deep-status').textContent = deepStatus[index] = `Improved after ${(data.elapsedMs / 1000).toFixed(1)}s. Still searching for up to ${budget}…`;
    if (data.type === 'done') finish(lastCards[index].team.value > pick.team.value ? `Deep search improved this pair in ${(data.elapsedMs / 1000).toFixed(1)}s. Not proven optimal.` : `Deep search found no better pair in ${budget}. Not proven optimal.`);
  };
  deep.postMessage({ group: context.group, unique: Boolean(index), solo: pick.solo, target: context.target, budgetMs });
}
function durationLabel(ms) {
  return ms < 60000 ? `${ms / 1000}s` : `${ms / 60000} min`;
}
function distributionView(distribution) {
  const view = element('div', undefined, 'distribution');
  view.setAttribute('aria-label', 'Chance of reaching each score');
  for (const { score, probability } of distribution) {
    const item = element('div', undefined, 'distribution-item');
    item.style.setProperty('--p', probability);
    item.append(element('span', `${score}+`), element('strong', percent(probability)));
    view.append(item);
  }
  return view;
}
function renderCards(cards, cardMode, team, keepDeep = false) {
  if (!keepDeep) {
    stopDeepSearch();
    deepStatus = [];
  }
  lastCards = cards;
  lastCardMode = cardMode;
  lastTeam = team;
  if (!keepDeep) lastContext = { generation: cardGeneration, group: structuredClone(group), target: cardMode === 'tail' ? computedTarget : undefined };
  cardsReady = true;
  const open = Array.from($('cards').querySelectorAll('details'), item => item.open);
  cardShells().forEach((card, i) => {
    const pick = cards[i];
    const objective = cardMode === 'expected' ? 'Highest expected score' : 'Best chance to beat target';
    const heading = element('h3', `${i ? 'Unique recipients' : 'Repeats allowed'} · ${objective}`);
    const value = team ? pick.team.value : cardMode === 'expected' ? pick.score : pick.probability;
    const solo = team ? pick.team.solo : undefined;
    const exact = !team && (cardMode === 'expected' || pick.method === 'exact');
    const strong = element('strong', cardMode === 'expected' ? `${value.toFixed(2)} / ${group.participants.length}` : percent(value));
    const bound = team && pick.team.bound !== undefined ? ` Upper bound: ${(Math.ceil(pick.team.bound * 100 - 1e-9) / 100).toFixed(2)}.` : '';
    const comparison = team ? ` Team score shown. Same ballot twice: ${cardMode === 'expected' ? solo.toFixed(2) : percent(solo)}.${bound}` : '';
    const tag = element('p', exact ? 'Optimal under this model' : `Approximate search. Exact value for these ballots.${comparison}`, 'tag');
    const deepControls = element('div', undefined, 'deep-controls');
    if (team) {
      const button = element('button', deepWorkers[i] ? 'Cancel' : 'Deep search', 'deep-search');
      button.disabled = !cardsReady;
      button.type = 'button';
      button.onclick = () => {
        if (!deepWorkers[i]) return startDeepSearch(i);
        clearTimeout(deepWorkers[i].deadline);
        deepWorkers[i].worker.terminate();
        deepWorkers[i] = null;
        card.classList.remove('searching');
        button.textContent = 'Deep search';
        status.textContent = deepStatus[i] = 'Deep search cancelled. Best pair kept.';
      };
      const status = element('span', deepStatus[i] ?? `Up to ${durationLabel(Number($('deep-duration').value))}`, 'deep-status');
      deepControls.append(button, status);
    }
    const ballots = element('div', undefined, 'ballots');
    pick.ballots.forEach((guess, ballotIndex) => {
      const details = element('details');
      details.open = open[i * 2 + ballotIndex] ?? true;
      const list = element('ol');
      guess.forEach((recipient, index) => {
        const p = probabilities[index][recipient];
        const item = element('li', `${group.participants[index]} → ${group.participants[recipient]} · ${percent(p)}`);
        item.style.setProperty('--p', p);
        list.append(item);
      });
      details.append(element('summary', team ? `Ballot ${ballotIndex + 1}` : 'View ballot'), list);
      ballots.append(details);
    });
    card.classList.toggle('searching', Boolean(deepWorkers[i]));
    card.replaceChildren(heading, strong, tag, distributionView(pick.distribution), ...(team ? [deepControls] : []), ballots);
  });
  $('cards').classList.toggle('team-cards', team);
  $('cards').classList.remove('loading');
  $('cards').removeAttribute('aria-busy');
  $('recommendation-status').textContent = '';
}
function syncRecommendationControls() {
  $('expected-mode').setAttribute('aria-pressed', mode === 'expected');
  $('target-mode').setAttribute('aria-pressed', mode === 'tail');
  $('target-controls').hidden = mode !== 'tail';
  $('team').checked = group.team;
  $('deep-duration').closest('label').hidden = !group.team;
}
function requestTarget() {
  if (!modelReady) return;
  stopDeepSearch();
  computedTarget = target();
  computedMode = mode;
  computedTeam = group.team;
  setCardsLoading('Updating recommendations…');
  worker.postMessage({ token: ++token, target: computedTarget, mode, team: group.team });
}
function startAnalysis() {
  stopDeepSearch();
  clearTimeout(sliderTimer);
  worker?.terminate();
  modelReady = false;
  showTarget();
  setCardsLoading('Calculating recommendations…');
  $('analysis-status').textContent = 'Calculating probabilities…';
  worker = new Worker('./worker.js', { type: 'module' });
  worker.onerror = () => { $('analysis-status').textContent = 'Could not run the probability calculator.'; };
  worker.onmessage = ({ data }) => {
    if (data.token !== token) return;
    if (data.error) {
      $('analysis-status').textContent = `Calculation failed: ${data.error}`;
      resetCards('Recommendations unavailable.');
      $('recommendation-status').textContent = '';
    } else if (data.status) {
      modelReady = data.status === 'ok';
      $('analysis-status').textContent = data.status === 'insufficient' ? 'Add at least two participants.' : data.status === 'infeasible' ? 'No assignment fits these confirmed pairs and exclusions. Change a clue or use Undo.' : '';
      if (!modelReady) {
        resetCards(data.status === 'insufficient' ? 'Add at least two participants.' : 'No valid assignment.');
        $('recommendation-status').textContent = '';
      } else {
        probabilities = data.matrix;
        renderCells(data.matrix);
        if (computedTarget !== target() || computedMode !== mode || computedTeam !== group.team) requestTarget();
      }
    } else if (data.cards && data.mode === mode && data.team === group.team && (mode === 'expected' || computedTarget === target())) {
      renderCards(data.cards, data.mode, data.team);
    }
  };
  computedTarget = target();
  computedMode = mode;
  computedTeam = group.team;
  worker.postMessage({ token: ++token, group, target: computedTarget, mode, team: group.team });
}

beforeUnloadRegistration();
function beforeUnloadRegistration() {
  window.addEventListener('beforeunload', event => {
    if (generation !== saved) { event.preventDefault(); event.returnValue = true; }
  });
}
slider.oninput = () => {
  showTarget();
  if (modelReady) setCardsLoading('Updating target recommendations…');
  clearTimeout(sliderTimer);
  sliderTimer = setTimeout(requestTarget, 120);
};
function setMode(next) {
  if (mode === next) return;
  mode = next;
  syncRecommendationControls();
  requestTarget();
}
$('deep-duration').onchange = () => {
  const label = `Up to ${durationLabel(Number($('deep-duration').value))}`;
  cardShells().forEach((card, index) => {
    const status = card.querySelector('.deep-status');
    if (status && !deepWorkers[index] && /^Up to /.test(status.textContent)) status.textContent = label;
  });
};
$('expected-mode').onclick = () => setMode('expected');
$('target-mode').onclick = () => setMode('tail');
$('team').onchange = event => {
  edit({ ...group, team: event.target.checked }, 'recommendations');
  syncRecommendationControls();
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
