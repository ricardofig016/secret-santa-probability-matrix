import { RELATIVE_WEIGHTS } from './group.js';

function distribution(weights) {
  const n = weights.length, full = (1 << n) - 1;
  const size = new Uint8Array(full + 1);
  for (let mask = 1; mask <= full; mask++) size[mask] = size[mask >> 1] + (mask & 1);
  const suffix = new Float64Array(full + 1);
  suffix[full] = 1;
  for (let mask = full - 1; mask >= 0; mask--) {
    const row = weights[size[mask]];
    for (let rest = full ^ mask; rest; rest &= rest - 1) {
      const bit = rest & -rest;
      suffix[mask] += row[31 - Math.clz32(bit)] * suffix[mask | bit];
    }
  }
  const total = suffix[0];
  if (!total) return null;
  const forward = new Float64Array(full + 1);
  forward[0] = 1;
  const matrix = weights.map(row => row.map(() => 0));
  for (let mask = 0; mask < full; mask++) {
    if (!forward[mask]) continue;
    const i = size[mask];
    for (let rest = full ^ mask; rest; rest &= rest - 1) {
      const bit = rest & -rest, j = 31 - Math.clz32(bit), next = mask | bit;
      const prefix = forward[mask] * weights[i][j];
      forward[next] += prefix;
      matrix[i][j] += prefix * suffix[next] / total;
    }
  }
  return { matrix, suffix, weights, full };
}

export function model(group) {
  const { participants, pairs } = group;
  if (participants.length < 2) return { status: 'insufficient' };
  const ids = new Map(participants.map((name, index) => [name, index]));
  const weights = participants.map((_, i) => participants.map((_, j) => Number(i !== j)));
  const confirmedRows = new Map(), confirmedCols = new Map();
  const infeasible = { status: 'infeasible' };
  for (const { giver, recipient, state } of pairs) {
    const i = ids.get(giver), j = ids.get(recipient);
    if (state === 'excluded') weights[i][j] = 0;
    else if (RELATIVE_WEIGHTS.has(state)) weights[i][j] = RELATIVE_WEIGHTS.get(state);
    else {
      if (i === j || confirmedRows.has(i) || confirmedCols.has(j)) return infeasible;
      confirmedRows.set(i, j);
      confirmedCols.set(j, i);
    }
  }
  for (let i = 0; i < weights.length; i++) {
    for (let j = 0; j < weights.length; j++) {
      if ((confirmedRows.has(i) && confirmedRows.get(i) !== j) || (confirmedCols.has(j) && confirmedCols.get(j) !== i)) weights[i][j] = 0;
    }
  }
  const dist = distribution(weights);
  if (!dist) return infeasible;
  for (const [i, j] of confirmedRows) dist.matrix[i][j] = 1;
  return { status: 'ok', ...dist };
}

export function expected(matrix, guess) {
  return guess.reduce((sum, j, i) => sum + matrix[i][j], 0);
}

export function bestExpected(matrix, unique) {
  if (!unique) return matrix.map(row => row.reduce((best, p, j) => p > row[best] + 1e-12 ? j : best, 0));
  const full = (1 << matrix.length) - 1;
  const best = new Float64Array(full + 1), choices = new Uint8Array(full), size = new Uint8Array(full + 1);
  for (let mask = 1; mask <= full; mask++) size[mask] = size[mask >> 1] + (mask & 1);
  for (let mask = full - 1; mask >= 0; mask--) {
    best[mask] = -1;
    const row = matrix[size[mask]];
    for (let rest = full ^ mask; rest; rest &= rest - 1) {
      const bit = rest & -rest, j = 31 - Math.clz32(bit);
      const value = row[j] + best[mask | bit];
      if (value > best[mask] + 1e-12) {
        best[mask] = value;
        choices[mask] = j;
      }
    }
  }
  const guess = [];
  for (let mask = 0; mask < full;) {
    guess.push(choices[mask]);
    mask |= 1 << choices[mask];
  }
  return guess;
}

function random(seed) {
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

function draw(dist, rng) {
  const result = [];
  const { weights, full, suffix } = dist;
  for (let mask = 0; mask < full;) {
    let pick = rng() * suffix[mask], selected;
    for (let rest = full ^ mask; rest; rest &= rest - 1) {
      const bit = rest & -rest, j = 31 - Math.clz32(bit);
      const mass = weights[result.length][j] * suffix[mask | bit];
      if (!mass) continue;
      selected = bit;
      if ((pick -= mass) < 0) break;
    }
    result.push(31 - Math.clz32(selected));
    mask |= selected;
  }
  return result;
}

function outcomes(dist) {
  const result = [], n = dist.weights.length;
  function visit(mask, guess, weight) {
    if (mask === dist.full) return result.push([guess, weight / dist.suffix[0]]);
    for (let j = 0; j < n; j++) {
      const next = mask | (1 << j), w = dist.weights[guess.length][j];
      if (next !== mask && w && dist.suffix[next]) visit(next, [...guess, j], weight * w);
    }
  }
  visit(0, [], 1);
  return result;
}

function beats(guess, actual, target) {
  let hits = 0;
  for (let i = 0; i < guess.length; i++) if (guess[i] === actual[i] && ++hits > target) return true;
  return false;
}

function exactTail(dist, target, unique, initial) {
  const actual = outcomes(dist), n = initial.length;
  let probability = -1, guess = initial, tie = -1;
  function visit(current, used, expectedScore) {
    const i = current.length;
    if (i === n) {
      let p = 0;
      for (const [outcome, weight] of actual) if (beats(current, outcome, target)) p += weight;
      if (p > probability + 1e-12 || (Math.abs(p - probability) <= 1e-12 && expectedScore > tie + 1e-12)) {
        guess = current;
        probability = Math.min(1, p);
        tie = expectedScore;
      }
      return;
    }
    for (let j = 0; j < n; j++) {
      if (!unique || !(used & (1 << j))) visit([...current, j], used | (1 << j), expectedScore + dist.matrix[i][j]);
    }
  }
  visit([], 0, 0);
  return { guess, probability, method: 'exact' };
}

function mostLikely(dist) {
  const best = new Float64Array(dist.full + 1), choices = new Uint8Array(dist.full);
  const size = new Uint8Array(dist.full + 1);
  best[dist.full] = 1;
  for (let mask = 1; mask <= dist.full; mask++) size[mask] = size[mask >> 1] + (mask & 1);
  for (let mask = dist.full - 1; mask >= 0; mask--) {
    const row = dist.weights[size[mask]];
    for (let rest = dist.full ^ mask; rest; rest &= rest - 1) {
      const bit = rest & -rest, j = 31 - Math.clz32(bit), value = row[j] * best[mask | bit];
      if (value > best[mask]) { best[mask] = value; choices[mask] = j; }
    }
  }
  const guess = [];
  for (let mask = 0; mask < dist.full;) {
    guess.push(choices[mask]);
    mask |= 1 << choices[mask];
  }
  return { guess, probability: best[0] / dist.suffix[0], method: 'exact' };
}

function approximateTail(dist, target, unique, initial, mapGuess) {
  const rng = random(257931);
  const training = Array.from({ length: 1200 }, () => draw(dist, rng));
  const n = initial.length;
  function evaluate(guess) {
    let count = 0;
    for (const actual of training) if (beats(guess, actual, target)) count++;
    return count;
  }
  let guess = initial.slice(), wins = evaluate(guess), score = expected(dist.matrix, guess);
  function consider(candidate) {
    const count = evaluate(candidate), avg = expected(dist.matrix, candidate);
    if (count > wins || (count === wins && avg > score + 1e-12)) {
      guess = candidate;
      wins = count;
      score = avg;
      return true;
    }
    return false;
  }
  consider(mapGuess);
  for (let i = 0; i < 24; i++) consider(training[i]);
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      for (let j = unique ? i + 1 : 0; j < n; j++) {
        if (!unique && guess[i] === j) continue;
        const candidate = guess.slice();
        if (unique) [candidate[i], candidate[j]] = [candidate[j], candidate[i]];
        else candidate[i] = j;
        changed = consider(candidate) || changed;
      }
    }
    if (!changed) break;
  }
  return { guess, probability: tailProbability(dist, guess, target), method: 'heuristic' };
}

export function tailProbability(dist, guess, target) {
  const { full, weights, suffix } = dist;
  const stride = target + 1;
  const mass = new Float64Array((full + 1) * stride);
  mass[0] = 1;
  let winning = 0;
  const size = new Uint8Array(full + 1);
  for (let mask = 1; mask <= full; mask++) size[mask] = size[mask >> 1] + (mask & 1);
  for (let mask = 0; mask < full; mask++) {
    const i = size[mask], from = mask * stride;
    if (!suffix[mask]) continue;
    for (let rest = full ^ mask; rest; rest &= rest - 1) {
      const bit = rest & -rest, j = 31 - Math.clz32(bit), next = mask | bit;
      const weight = weights[i][j];
      if (!weight || !suffix[next]) continue;
      const to = next * stride, hit = Number(guess[i] === j);
      for (let s = 0; s < stride - hit; s++) mass[to + s + hit] += mass[from + s] * weight;
      if (hit) winning += mass[from + target] * weight * suffix[next];
    }
  }
  return Math.min(1, winning / suffix[0]);
}

export function recommendations(dist, target, average) {
  if (dist.status !== 'ok') return null;
  const n = dist.matrix.length;
  if (!Number.isInteger(target) || target < 0 || target > n) throw new RangeError('Invalid target score.');
  const map = mostLikely(dist);
  const cards = [false, true].map((unique, index) => {
    const guess = average?.[index] ?? bestExpected(dist.matrix, unique);
    const tail = target === n ? { guess, probability: 0, method: 'exact' }
      : target === n - 1 || (unique && target === n - 2) ? map
      : n <= (unique ? 6 : 5) ? exactTail(dist, target, unique, guess)
      : target === 0 && !unique ? { guess: tailProbability(dist, guess, 0) > 1 - 1e-12 ? guess : guess.map((j, i) => i === guess[0] ? j : guess[0]), probability: 1, method: 'exact' }
      : approximateTail(dist, target, unique, guess, map.guess);
    if (tail.method === 'heuristic') {
      for (const candidate of [guess, map.guess]) {
        const probability = tailProbability(dist, candidate, target);
        if (probability > tail.probability) Object.assign(tail, { guess: candidate, probability });
      }
    }
    return { expected: { guess, score: expected(dist.matrix, guess) }, tail: { ...tail, score: expected(dist.matrix, tail.guess) } };
  });
  if (cards[0].tail.method === 'heuristic' && cards[1].tail.probability > cards[0].tail.probability) {
    cards[0].tail = { ...cards[1].tail, method: 'heuristic' };
  }
  return cards;
}

function layers(n) {
  const full = (1 << n) - 1, size = new Uint8Array(full + 1), rank = new Int32Array(full + 1);
  const masks = Array.from({ length: n + 1 }, () => []);
  for (let mask = 0; mask <= full; mask++) {
    if (mask) size[mask] = size[mask >> 1] + (mask & 1);
    rank[mask] = masks[size[mask]].push(mask) - 1;
  }
  return { masks, rank };
}

// Exact joint walk over draws. Expected uses D = S2 - S1 because E[max] = E[S1] + E[max(D, 0)].
export function teamValue(dist, [a, b], target) {
  const n = a.length, { masks, rank } = layers(n), { weights, suffix } = dist;
  const tail = target !== undefined, side = tail ? target + 1 : 2 * n + 1, states = tail ? side * side : side;
  let current = new Float64Array(states), won = 0;
  current[tail ? 0 : n] = 1;
  for (let k = 0; k < n; k++) {
    const next = new Float64Array(masks[k + 1].length * states);
    masks[k].forEach((mask, index) => {
      if (!suffix[mask]) return;
      const from = index * states;
      for (let j = 0; j < n; j++) {
        const bit = 1 << j, to = mask | bit, weight = weights[k][j];
        if (mask & bit || !weight || !suffix[to]) continue;
        const h1 = Number(a[k] === j), h2 = Number(b[k] === j), base = rank[to] * states;
        for (let state = 0; state < states; state++) {
          const mass = current[from + state];
          if (!mass) continue;
          if (!tail) next[base + state + h2 - h1] += mass * weight;
          else {
            const x = Math.floor(state / side) + h1, y = state % side + h2;
            if (x > target || y > target) won += mass * weight * suffix[to];
            else next[base + x * side + y] += mass * weight;
          }
        }
      }
    });
    current = next;
  }
  if (tail) return Math.min(1, won / suffix[0]);
  let gain = 0;
  for (let d = 1; d <= n; d++) gain += d * current[n + d];
  return expected(dist.matrix, a) + gain / suffix[0];
}

function teamSearch(dist, unique, start, target) {
  const n = start.length, rng = random(91357), samples = Array.from({ length: 5000 }, () => draw(dist, rng));
  const buckets = Array.from({ length: n }, () => Array.from({ length: n }, () => []));
  samples.forEach((actual, sample) => actual.forEach((j, i) => buckets[i][j].push(sample)));
  const value = target === undefined ? (x, y) => Math.max(x, y) : (x, y) => Number(Math.max(x, y) > target) + 1e-4 * Math.max(x, y);
  const hits = ballot => samples.map(actual => actual.reduce((sum, j, i) => sum + (ballot[i] === j), 0));
  const ballots = [start.slice(), start.slice()], counts = [hits(start), hits(start)];
  function improve(which) {
    const ballot = ballots[which], mine = counts[which], other = counts[1 - which];
    let improved = false;
    function tryMove(changes) {
      const delta = new Map();
      for (const [row, from, to] of changes) {
        for (const sample of buckets[row][from]) delta.set(sample, (delta.get(sample) ?? 0) - 1);
        for (const sample of buckets[row][to]) delta.set(sample, (delta.get(sample) ?? 0) + 1);
      }
      let gain = 0;
      for (const [sample, change] of delta) gain += value(mine[sample] + change, other[sample]) - value(mine[sample], other[sample]);
      if (gain <= 1e-9) return false;
      for (const [sample, change] of delta) mine[sample] += change;
      for (const [row, , to] of changes) ballot[row] = to;
      return improved = true;
    }
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        for (let j = unique ? i + 1 : 0; j < n; j++) {
          if (unique) changed = tryMove([[i, ballot[i], ballot[j]], [j, ballot[j], ballot[i]]]) || changed;
          else if (ballot[i] !== j) changed = tryMove([[i, ballot[i], j]]) || changed;
        }
      }
      if (!changed) break;
    }
    return improved;
  }
  for (let round = 0; round < 4 && (improve(1) | improve(0)); round++);
  return ballots;
}

export function teamRecommendation(dist, unique, solo, target) {
  const score = pair => teamValue(dist, pair, target);
  if (target === dist.matrix.length) return { ballots: [solo, solo], value: 0, solo: 0, method: 'exact' };
  const soloValue = score([solo, solo]), rng = random(44021);
  const candidates = [teamSearch(dist, unique, solo, target)];
  for (let i = 0; i < 64; i++) {
    const alternative = draw(dist, rng);
    if (String(alternative) !== String(solo)) { candidates.push([solo, alternative]); break; }
  }
  let best = { ballots: [solo, solo], value: soloValue };
  for (const ballots of candidates) {
    const value = score(ballots);
    if (value > best.value) best = { ballots, value };
  }
  return { ...best, solo: soloValue, method: 'heuristic' };
}
