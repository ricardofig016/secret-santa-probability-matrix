import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { bestExpected, model, recommendations } from './solver.js';
import { TEAM_ALGORITHMS, deepTeamSearch, exhaustiveTeam, rowUpperBound, uniqueFlowUpperBound } from './team-search.js';

const names = n => Array.from({ length: n }, (_, i) => `P${i}`);
const group = (participants, pairs = []) => ({ name: 'Bench', participants, team: true, pairs });
const pair = (giver, recipient, state) => ({ giver, recipient, state });
const rng = seed => () => (seed = Math.imul(seed ^ seed >>> 15, 2246822519) >>> 0) / 4294967296;

function synthetic(n, kind, seed) {
  const people = names(n), random = rng(seed), pairs = [], used = new Set();
  const add = (i, j, state) => {
    const key = `${i},${j}`;
    if (i !== j && !used.has(key)) { used.add(key); pairs.push(pair(people[i], people[j], state)); }
  };
  if (kind === 'confirmed') for (let i = 0; i < Math.floor(n / 3); i++) add(i, (i + 1) % n, 'confirmed');
  if (kind === 'excluded') for (let k = 0; k < n * 2; k++) add(Math.floor(random() * n), Math.floor(random() * n), 'excluded');
  if (kind === 'clues') for (let k = 0; k < n * 2; k++) add(Math.floor(random() * n), Math.floor(random() * n), ['much-less', 'less', 'more', 'much-more'][Math.floor(random() * 4)]);
  return group(people, pairs);
}

function solo(dist, unique, target) {
  return target === undefined ? bestExpected(dist.matrix, unique) : recommendations(dist, target)[Number(unique)].tail.guess;
}

function measure(fn) {
  const started = performance.now(), result = fn();
  return { ...result, ms: performance.now() - started };
}

const smallCases = [];
const smallSeeds = Number(process.env.SMALL_SEEDS ?? 3);
for (let seed = 1; seed <= smallSeeds; seed++) for (const kind of ['none', 'excluded', 'clues']) smallCases.push([`${kind}-${seed}`, synthetic(5, kind, seed)]);
const summary = {}, deepSummary = {};
const deepBudgets = (process.env.DEEP_BUDGETS ?? '100,500,1000,5000').split(',').map(Number).filter(Number.isFinite);
for (const [, input] of smallCases) {
  const dist = model(input);
  if (dist.status !== 'ok') continue;
  for (const unique of [false, true]) for (const target of [undefined, 2]) {
    const optimum = exhaustiveTeam(dist, unique, target).value, start = solo(dist, unique, target);
    for (const budget of deepBudgets) {
      const result = measure(() => deepTeamSearch(dist, unique, start, target, { budgetMs: budget }));
      const row = deepSummary[budget] ??= { runs: 0, optimal: 0, gap: 0, worst: 0, ms: 0 };
      const gap = optimum - result.value;
      row.runs++;
      row.optimal += gap < 1e-9;
      row.gap += gap;
      row.worst = Math.max(row.worst, gap);
      row.ms += result.ms;
    }
    for (const [name, algorithm] of Object.entries(TEAM_ALGORITHMS)) {
      const result = measure(() => algorithm(dist, unique, start, target));
      const row = summary[name] ??= { runs: 0, optimal: 0, gap: 0, worst: 0, ms: 0 };
      const gap = optimum - result.value;
      row.runs++;
      row.optimal += gap < 1e-9;
      row.gap += gap;
      row.worst = Math.max(row.worst, gap);
      row.ms += result.ms;
    }
  }
}
console.log('Small groups: exhaustive optimum comparison');
console.table(Object.fromEntries(Object.entries(summary).map(([name, row]) => [name, {
  runs: row.runs,
  'optimal %': Number((100 * row.optimal / row.runs).toFixed(1)),
  'mean gap': Number((row.gap / row.runs).toFixed(6)),
  'worst gap': Number(row.worst.toFixed(6)),
  'mean ms': Number((row.ms / row.runs).toFixed(1)),
}])));

console.log('Small groups: Deep search budget comparison');
console.table(Object.fromEntries(Object.entries(deepSummary).map(([budget, row]) => [`${budget} ms`, {
  runs: row.runs,
  'optimal %': Number((100 * row.optimal / row.runs).toFixed(1)),
  'mean gap': Number((row.gap / row.runs).toFixed(6)),
  'worst gap': Number(row.worst.toFixed(6)),
  'mean ms': Number((row.ms / row.runs).toFixed(1)),
}])));

const largeCases = [['unrestricted-12', synthetic(12, 'none', 3)], ['confirmed-12', synthetic(12, 'confirmed', 4)], ['excluded-12', synthetic(12, 'excluded', 5)], ['clues-12', synthetic(12, 'clues', 6)]];
const family = process.argv.includes('--family') ? process.argv[process.argv.indexOf('--family') + 1] : null;
if (family) largeCases.unshift(['family', parse(readFileSync(family, 'utf8'))]);
const budgetMs = Number(process.env.DEEP_BUDGET_MS ?? 5000), rows = [];
for (const [name, input] of largeCases) {
  const dist = model(input);
  if (dist.status !== 'ok') continue;
  for (const unique of [false, true]) {
    const start = solo(dist, unique);
    const base = measure(() => TEAM_ALGORITHMS.greedy(dist, unique, start));
    const instant = measure(() => TEAM_ALGORITHMS.instant(dist, unique, start));
    const deep = measure(() => deepTeamSearch(dist, unique, start, undefined, { budgetMs }));
    rows.push({ case: name, unique, greedy: base.value.toFixed(4), instant: instant.value.toFixed(4), deep: deep.value.toFixed(4), bound: (Math.ceil((unique ? uniqueFlowUpperBound(dist) : rowUpperBound(dist)) * 10000 - 1e-9) / 10000).toFixed(4), 'instant ms': Math.round(instant.ms), 'deep ms': Math.round(deep.ms) });
  }
}
console.log(`Larger groups: expected team score (${budgetMs} ms deep budget)`);
console.table(rows);
