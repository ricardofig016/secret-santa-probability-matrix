import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestExpected, expected, model, recommendations, tailProbability, teamRecommendation, teamValue } from './solver.js';
import { TEAM_ALGORITHMS, deepTeamSearch, exhaustiveTeam, partitionMatrices, rowUpperBound, teamDistribution, uniqueFlowUpperBound } from './team-search.js';

const group = (participants = ['A', 'B', 'C', 'D'], pairs = []) => ({ name: 'Christmas', participants, team: false, pairs });
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

test('team values score the better ballot in each draw', () => {
  const dist = model(group(['A', 'B', 'C', 'D', 'E'], [pair('A', 'B', 'more'), pair('C', 'D', 'excluded')]));
  const draws = ballots(5, true).map(guess => ({ guess, weight: guess.reduce((w, j, i) => w * dist.weights[i][j], 1) })).filter(draw => draw.weight);
  const total = draws.reduce((sum, draw) => sum + draw.weight, 0);
  const hits = (guess, actual) => guess.filter((j, i) => actual[i] === j).length;
  for (const pairOfBallots of [[[1, 0, 3, 4, 2], [2, 3, 4, 1, 0]], [[1, 1, 1, 1, 1], [2, 3, 4, 0, 0]]]) {
    near(teamValue(dist, pairOfBallots), draws.reduce((sum, draw) => sum + draw.weight * Math.max(...pairOfBallots.map(guess => hits(guess, draw.guess))), 0) / total);
    for (let target = 0; target < 5; target++) {
      near(teamValue(dist, pairOfBallots, target), draws.reduce((sum, draw) => sum + (Math.max(...pairOfBallots.map(guess => hits(guess, draw.guess))) > target ? draw.weight : 0), 0) / total);
    }
  }
});

test('team recommendations never score below duplicating the solo ballot', () => {
  const names = Array.from({ length: 10 }, (_, i) => `${i}`);
  const dist = model(group(names, [pair('0', '1', 'confirmed'), pair('2', '3', 'more'), pair('4', '5', 'excluded')]));
  for (const unique of [false, true]) {
    const solo = bestExpected(dist.matrix, unique), team = teamRecommendation(dist, unique, solo);
    assert.ok(team.value >= team.solo);
    near(team.value, teamValue(dist, team.ballots));
    if (unique) team.ballots.forEach(ballot => assert.equal(new Set(ballot).size, names.length));
    const targetSolo = recommendations(dist, 3)[Number(unique)].tail.guess, targetTeam = teamRecommendation(dist, unique, targetSolo, 3);
    assert.ok(targetTeam.value >= targetTeam.solo);
    near(targetTeam.value, teamValue(dist, targetTeam.ballots, 3));
  }
});

test('team high-target search keeps a positive solo chance over a worse sampled pair', () => {
  const dist = model(group(Array.from({ length: 18 }, (_, i) => `${i}`)));
  const solo = recommendations(dist, 17)[0].tail.guess, team = teamRecommendation(dist, false, solo, 17);
  assert.ok(team.solo > 0);
  assert.ok(team.value >= team.solo);
});

test('team perfect-score search can cover a second valid draw', () => {
  const dist = model(group(Array.from({ length: 9 }, (_, i) => `${i}`)));
  const solo = recommendations(dist, 8)[0].tail.guess, team = teamRecommendation(dist, false, solo, 8);
  near(team.value, 2 * team.solo);
});

test('team partition matrices split each exact edge probability', () => {
  const dist = model(group(['A', 'B', 'C', 'D', 'E'], [pair('A', 'B', 'more'), pair('C', 'D', 'excluded')]));
  const [wonA, wonB] = partitionMatrices(dist, [[1, 0, 3, 4, 2], [2, 3, 4, 1, 0]]);
  const ballotsPair = [[1, 0, 3, 4, 2], [2, 3, 4, 1, 0]];
  const draws = ballots(5, true).map(actual => ({ actual, weight: actual.reduce((w, j, i) => w * dist.weights[i][j], 1) })).filter(draw => draw.weight);
  const total = draws.reduce((sum, draw) => sum + draw.weight, 0);
  const hits = (ballot, actual) => ballot.filter((j, i) => actual[i] === j).length;
  wonA.forEach((row, i) => row.forEach((p, j) => {
    const expectedA = draws.reduce((sum, draw) => sum + (draw.actual[i] === j && hits(ballotsPair[0], draw.actual) >= hits(ballotsPair[1], draw.actual) ? draw.weight : 0), 0) / total;
    near(p, expectedA);
    near(wonB[i][j], dist.matrix[i][j] - expectedA);
  }));
});

test('all team algorithms return valid exact scores and never beat exhaustive optimum', () => {
  const dist = model(group(['A', 'B', 'C', 'D', 'E'], [pair('A', 'B', 'more'), pair('C', 'D', 'excluded'), pair('E', 'A', 'less')]));
  for (const unique of [false, true]) for (const target of [undefined, 2]) {
    const solo = target === undefined ? bestExpected(dist.matrix, unique) : recommendations(dist, target)[Number(unique)].tail.guess;
    const optimum = exhaustiveTeam(dist, unique, target);
    for (const algorithm of Object.values(TEAM_ALGORITHMS)) {
      const result = algorithm(dist, unique, solo, target);
      near(result.value, teamValue(dist, result.ballots, target));
      assert.ok(result.value <= optimum.value + 1e-12);
      if (unique) result.ballots.forEach(ballot => assert.equal(new Set(ballot).size, 5));
    }
    if (target === undefined) assert.ok(optimum.value <= rowUpperBound(dist) + 1e-12);
  }
});

test('deep search respects cancellation and keeps an exact score', () => {
  const dist = model(group(Array.from({ length: 8 }, (_, i) => `${i}`)));
  const solo = bestExpected(dist.matrix, false), result = deepTeamSearch(dist, false, solo, undefined, { budgetMs: 1000, shouldStop: () => true });
  assert.equal(result.stopped, true);
  near(result.value, teamValue(dist, result.ballots));
});

test('deep search keeps tiny exact improvements', () => {
  const dist = model(group(Array.from({ length: 18 }, (_, i) => `${i}`)));
  const solo = recommendations(dist, 17)[0].tail.guess, greedy = teamRecommendation(dist, false, solo, 17);
  const deep = deepTeamSearch(dist, false, solo, 17, { budgetMs: 1 });
  assert.ok(deep.value >= greedy.value);
});

test('unique flow bound is valid and no looser than the row bound', () => {
  const dist = model(group(['A', 'B', 'C', 'D', 'E'], [pair('A', 'B', 'more'), pair('C', 'D', 'excluded'), pair('E', 'A', 'less')]));
  const bound = uniqueFlowUpperBound(dist), optimum = exhaustiveTeam(dist, true);
  assert.ok(bound <= rowUpperBound(dist) + 1e-12);
  assert.ok(optimum.value <= bound + 1e-12);
});

test('team score distribution reports cumulative exact thresholds', () => {
  const dist = model(group(['A', 'B', 'C', 'D', 'E'], [pair('A', 'B', 'more')]));
  const ballotsPair = [[1, 0, 3, 4, 2], [2, 3, 4, 1, 0]], distribution = teamDistribution(dist, ballotsPair, [1, 2, 3, 4, 5]);
  distribution.forEach(({ score, probability }) => near(probability, teamValue(dist, ballotsPair, score - 1)));
  for (let i = 1; i < distribution.length; i++) assert.ok(distribution[i].probability <= distribution[i - 1].probability + 1e-12);
  assert.deepEqual(teamDistribution(dist, ballotsPair, [6, 7]), [{ score: 6, probability: 0 }, { score: 7, probability: 0 }]);
});
