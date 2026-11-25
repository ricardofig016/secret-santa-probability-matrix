import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestExpected, expected, model, recommendations, tailProbability } from './solver.js';

const group = (participants = ['A', 'B', 'C', 'D'], pairs = []) => ({ name: 'Christmas', participants, pairs });
const pair = (giver, recipient, state) => ({ giver, recipient, state });
function near(a, b, epsilon = 1e-9) { assert.ok(Math.abs(a - b) < epsilon, `${a} was not close to ${b}`); }

function ballots(n, unique) {
  const list = [];
  function visit(guess) {
    if (guess.length === n) return list.push(guess);
    for (let j = 0; j < n; j++) if (!unique || !guess.includes(j)) visit([...guess, j]);
  }
  visit([]);
  return list;
}

test('uniform derangements include reciprocal pairs and match a directional exclusion reference', () => {
  const confirmed = model(group(undefined, [pair('A', 'B', 'confirmed')]));
  near(confirmed.matrix[0][1], 1);
  near(confirmed.matrix[1][0], 1 / 3);
  const dist = model(group(undefined, [pair('A', 'B', 'excluded')]));
  const reference = [[0,0,1/2,1/2],[1/3,0,1/3,1/3],[1/3,1/2,0,1/6],[1/3,1/2,1/6,0]];
  dist.matrix.forEach((row, i) => row.forEach((p, j) => near(p, reference[i][j])));
});

test('a single relative clue multiplies odds without changing assignment support', () => {
  for (const [state, factor] of [['much-less', .25], ['less', .5], ['more', 2], ['much-more', 4]]) {
    const dist = model(group(undefined, [pair('A', 'B', state)]));
    near(dist.matrix[0][1], factor / (2 + factor));
    dist.matrix.forEach((row, i) => {
      near(row.reduce((a, b) => a + b), 1);
      near(dist.matrix.reduce((sum, r) => sum + r[i], 0), 1);
    });
  }
  const constrained = model(group(undefined, [pair('A', 'B', 'confirmed'), pair('C', 'B', 'much-more')]));
  assert.equal(constrained.matrix[2][1], 0);
});

test('insufficient and infeasible inputs do not yield probabilities', () => {
  assert.equal(model(group(['A'])).status, 'insufficient');
  assert.equal(model(group(undefined, [pair('A', 'B', 'confirmed'), pair('C', 'B', 'confirmed')])).status, 'infeasible');
  assert.equal(model(group(undefined, ['B', 'C', 'D'].map(recipient => pair('A', recipient, 'excluded')))).status, 'infeasible');
});

test('all four objectives and fixed-ballot tail probabilities agree with exhaustive enumeration', () => {
  const dist = model(group(undefined, [pair('D', 'B', 'excluded'), pair('C', 'A', 'much-more')]));
  const n = dist.matrix.length;
  const samples = ballots(n, true).map(guess => ({ guess, w: guess.reduce((w, j, i) => w * dist.weights[i][j], 1) }));
  const total = samples.reduce((sum, sample) => sum + sample.w, 0);
  const tail = (guess, k) => samples.reduce((sum, sample) => sum + (guess.filter((j, i) => sample.guess[i] === j).length > k ? sample.w : 0), 0) / total;
  for (let target = 0; target <= n; target++) {
    const cards = recommendations(dist, target);
    for (const [i, unique] of [false, true].entries()) {
      const options = ballots(n, unique), { expected: avg, tail: beat } = cards[i];
      assert.ok(options.some(x => String(x) === String(beat.guess)));
      assert.ok(options.some(x => String(x) === String(avg.guess)));
      near(avg.score, Math.max(...options.map(guess => expected(dist.matrix, guess))));
      near(beat.probability, Math.max(...options.map(guess => tail(guess, target))));
      near(beat.probability, tail(beat.guess, target));
      near(tailProbability(dist, avg.guess, target), tail(avg.guess, target));
    }
  }
});

test('sixteen-person analysis distinguishes heuristic search from exact ballot probability', () => {
  const dist = model(group(Array.from({ length: 16 }, (_, i) => `${i}`)));
  const [repeated, unique] = recommendations(dist, 6);
  for (const card of [repeated, unique]) {
    near(card.expected.score, 16/15);
    assert.equal(card.tail.method, 'heuristic');
    assert.ok(card.tail.probability > 0 && card.tail.probability < 1);
  }
  assert.equal(new Set(unique.tail.guess).size, 16);
  assert.ok(repeated.tail.probability >= unique.tail.probability);
  const guess = bestExpected(dist.matrix, true);
  assert.equal(new Set(guess).size, 16);
  const guaranteed = recommendations(dist, 0)[0].tail;
  assert.equal(guaranteed.method, 'exact');
  near(tailProbability(dist, guaranteed.guess, 0), 1);
});

test('a guaranteed target-zero ballot keeps the expected-score picks when they already guarantee a point', () => {
  const names = Array.from({ length: 8 }, (_, i) => `${i}`);
  const dist = model(group(names, [pair('0', '1', 'confirmed')]));
  const [repeated] = recommendations(dist, 0);
  assert.deepEqual(repeated.tail.guess, repeated.expected.guess);
  assert.equal(repeated.tail.probability, 1);
});

test('confirmed cells stay exactly certain alongside relative clues', () => {
  const names = Array.from({ length: 16 }, (_, i) => `${i}`);
  const dist = model(group(names, [pair('0', '1', 'confirmed'), pair('2', '3', 'confirmed'), pair('4', '5', 'less')]));
  assert.equal(dist.matrix[0][1], 1);
  assert.equal(dist.matrix[2][3], 1);
});
