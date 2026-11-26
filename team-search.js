import { bestExpected, expected, teamRecommendation, teamValue } from './solver.js';

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
  for (let mask = 0; mask < dist.full;) {
    let pick = rng() * dist.suffix[mask], selected;
    for (let rest = dist.full ^ mask; rest; rest &= rest - 1) {
      const bit = rest & -rest, j = 31 - Math.clz32(bit);
      const mass = dist.weights[result.length][j] * dist.suffix[mask | bit];
      if (!mass) continue;
      selected = bit;
      if ((pick -= mass) < 0) break;
    }
    result.push(31 - Math.clz32(selected));
    mask |= selected;
  }
  return result;
}

const key = ([a, b]) => `${a}|${b}`;
const valid = (ballot, unique) => !unique || new Set(ballot).size === ballot.length;

function counts(n) {
  const size = new Uint8Array(1 << n);
  for (let mask = 1; mask < size.length; mask++) size[mask] = size[mask >> 1] + (mask & 1);
  return size;
}

// Exact conditional matrices for draws won by A and B. Ties are assigned to A.
export function partitionMatrices(dist, [a, b]) {
  const n = a.length, full = dist.full, side = 2 * n + 1, size = counts(n);
  const forward = new Float64Array((full + 1) * side), backward = new Float64Array((full + 1) * side);
  forward[n] = 1;
  for (let mask = 0; mask < full; mask++) {
    const i = size[mask];
    for (let rest = full ^ mask; rest; rest &= rest - 1) {
      const bit = rest & -rest, j = 31 - Math.clz32(bit), weight = dist.weights[i][j];
      if (!weight) continue;
      const delta = Number(b[i] === j) - Number(a[i] === j), to = mask | bit;
      for (let s = 0; s < side; s++) {
        const value = forward[mask * side + s];
        if (value) forward[to * side + s + delta] += value * weight;
      }
    }
  }
  backward[full * side + n] = 1;
  for (let mask = full - 1; mask >= 0; mask--) {
    const i = size[mask];
    for (let rest = full ^ mask; rest; rest &= rest - 1) {
      const bit = rest & -rest, j = 31 - Math.clz32(bit), weight = dist.weights[i][j];
      if (!weight) continue;
      const delta = Number(b[i] === j) - Number(a[i] === j), to = mask | bit;
      for (let s = 0; s < side; s++) {
        const value = backward[to * side + s], target = s + delta;
        if (value && target >= 0 && target < side) backward[mask * side + target] += value * weight;
      }
    }
  }
  for (let mask = 0; mask <= full; mask++) for (let s = 1; s < side; s++) backward[mask * side + s] += backward[mask * side + s - 1];
  const wonA = dist.matrix.map(row => row.map(() => 0)), wonB = dist.matrix.map(row => row.map(() => 0));
  for (let mask = 0; mask < full; mask++) {
    const i = size[mask];
    for (let rest = full ^ mask; rest; rest &= rest - 1) {
      const bit = rest & -rest, j = 31 - Math.clz32(bit), weight = dist.weights[i][j];
      if (!weight) continue;
      const delta = Number(b[i] === j) - Number(a[i] === j), to = mask | bit, all = backward[to * side + side - 1];
      let first = 0, total = 0;
      for (let s = 0; s < side; s++) {
        const value = forward[mask * side + s];
        if (!value) continue;
        const limit = n - (s - n + delta);
        first += value * weight * (limit < 0 ? 0 : limit >= side ? all : backward[to * side + limit]);
        total += value * weight * all;
      }
      wonA[i][j] += first / dist.suffix[0];
      wonB[i][j] += (total - first) / dist.suffix[0];
    }
  }
  return [wonA, wonB];
}

export function partitionSearch(dist, unique, start, iterations = 20) {
  let pair = start.map(ballot => ballot.slice()), value = teamValue(dist, pair);
  for (let iteration = 0; iteration < iterations; iteration++) {
    const next = partitionMatrices(dist, pair).map(matrix => bestExpected(matrix, unique)), candidate = teamValue(dist, next);
    if (candidate <= value + 1e-12) break;
    pair = next;
    value = candidate;
  }
  return { ballots: pair, value };
}

function rowOptions(dist, limit) {
  return dist.matrix.map(row => row.map((p, j) => [p, j]).filter(([p]) => p > 0).sort((x, y) => y[0] - x[0]).slice(0, limit).map(([, j]) => j));
}

export function sampledScore(samples, target) {
  return target === undefined ? (x, y) => Math.max(x, y) : (x, y) => Number(Math.max(x, y) > target) + 1e-4 * Math.max(x, y);
}

function sampledState(samples, pair) {
  return pair.map(ballot => samples.map(actual => actual.reduce((sum, j, i) => sum + (ballot[i] === j), 0)));
}

export function blockSearch(dist, unique, start, target, { size = 2, samples = 1500, candidates = 5, seed = 1 } = {}) {
  const rng = random(seed), drawn = Array.from({ length: samples }, () => draw(dist, rng)), options = rowOptions(dist, candidates);
  const value = sampledScore(drawn, target), pair = start.map(ballot => ballot.slice()), hits = sampledState(drawn, pair);
  const rows = options.map((list, i) => [i, list]).filter(([, list]) => list.length > 1).map(([i]) => i);
  const groups = [];
  for (let x = 0; x < rows.length; x++) {
    if (size === 1) groups.push([rows[x]]);
    for (let y = x + 1; size > 1 && y < rows.length; y++) groups.push([rows[x], rows[y]]);
  }
  let improved = true;
  for (let pass = 0; pass < 3 && improved; pass++) {
    improved = false;
    for (const group of groups) {
      let best = null, bestGain = 1e-9;
      function choose(index, choices) {
        if (index === group.length) {
          const next = pair.map(ballot => ballot.slice());
          group.forEach((row, k) => { next[0][row] = choices[k][0]; next[1][row] = choices[k][1]; });
          if (!valid(next[0], unique) || !valid(next[1], unique)) return;
          let gain = 0;
          for (let s = 0; s < drawn.length; s++) {
            let x = hits[0][s], y = hits[1][s];
            for (const row of group) {
              x += Number(next[0][row] === drawn[s][row]) - Number(pair[0][row] === drawn[s][row]);
              y += Number(next[1][row] === drawn[s][row]) - Number(pair[1][row] === drawn[s][row]);
            }
            gain += value(x, y) - value(hits[0][s], hits[1][s]);
          }
          if (gain > bestGain) { best = next; bestGain = gain; }
          return;
        }
        const row = group[index];
        for (const first of options[row]) for (const second of options[row]) choose(index + 1, [...choices, [first, second]]);
      }
      choose(0, []);
      if (best) {
        pair[0] = best[0];
        pair[1] = best[1];
        const nextHits = sampledState(drawn, pair);
        hits[0] = nextHits[0];
        hits[1] = nextHits[1];
        improved = true;
      }
    }
  }
  return { ballots: pair, value: teamValue(dist, pair, target) };
}

export function orientationSearch(dist, unique, start, target, maxRows = 14) {
  const [a, b] = start, rows = a.map((_, i) => i).filter(i => a[i] !== b[i]).slice(0, maxRows);
  let best = { ballots: start, value: teamValue(dist, start, target) };
  for (let mask = 1; mask < 1 << Math.max(0, rows.length - 1); mask++) {
    const pair = [a.slice(), b.slice()];
    rows.slice(1).forEach((row, bit) => { if (mask >> bit & 1) [pair[0][row], pair[1][row]] = [pair[1][row], pair[0][row]]; });
    if (!valid(pair[0], unique) || !valid(pair[1], unique)) continue;
    const value = teamValue(dist, pair, target);
    if (value > best.value) best = { ballots: pair, value };
  }
  return best;
}

function perturb(pair, dist, unique, rng, rows = 3) {
  const next = pair.map(ballot => ballot.slice()), options = rowOptions(dist, 5);
  for (let step = 0; step < rows; step++) {
    const which = Math.floor(rng() * 2), row = Math.floor(rng() * next[0].length);
    if (unique) {
      const other = Math.floor(rng() * next[0].length);
      [next[which][row], next[which][other]] = [next[which][other], next[which][row]];
    } else if (options[row].length) next[which][row] = options[row][Math.floor(rng() * options[row].length)];
  }
  return next;
}

export function deepTeamSearch(dist, unique, solo, target, { budgetMs = 30000, onProgress = () => {}, shouldStop = () => false, seed = 13 } = {}) {
  const started = performance.now(), rng = random(seed), seen = new Set();
  let best = { ballots: [solo, solo], value: teamValue(dist, [solo, solo], target) };
  const consider = (candidate, method) => {
    const name = key(candidate.ballots);
    if (seen.has(name)) return;
    seen.add(name);
    if (candidate.value > best.value) {
      best = { ...candidate, method };
      onProgress({ ...best, elapsedMs: performance.now() - started });
    }
  };
  const done = () => performance.now() - started >= budgetMs || shouldStop();
  const greedy = teamRecommendation(dist, unique, solo, target);
  consider(greedy, 'greedy');
  const pool = [greedy.ballots, [solo, draw(dist, rng)]];
  if (target === undefined) pool.push(...Array.from({ length: 6 }, () => [solo, draw(dist, rng)]), ...Array.from({ length: 4 }, () => [draw(dist, rng), draw(dist, rng)]));
  while (pool.length && !done()) {
    const start = pool.shift();
    let candidate = { ballots: start, value: teamValue(dist, start, target) };
    if (target === undefined) consider(candidate = partitionSearch(dist, unique, start), 'partition');
    if (done()) break;
    consider(candidate = blockSearch(dist, unique, candidate.ballots, target, { size: 1, seed: Math.floor(rng() * 1e9) }), 'row search');
    if (done()) break;
    if (target === undefined) consider(partitionSearch(dist, unique, candidate.ballots), 'partition');
    if (done()) break;
    if (unique) consider(orientationSearch(dist, unique, candidate.ballots, target, 12), 'orientation');
    if (pool.length < 4) pool.push(perturb(best.ballots, dist, unique, rng));
  }
  return { ...best, elapsedMs: performance.now() - started, stopped: shouldStop(), method: best.method ?? 'deep search' };
}

// Upper bound for two unique-recipient ballots: each giver and recipient may be covered at most twice.
export function uniqueFlowUpperBound(dist) {
  const n = dist.matrix.length, nodes = 2 * n + 2, source = 2 * n, sink = source + 1, edges = [];
  const add = (from, to, capacity, cost) => {
    edges.push({ from, to, capacity, cost, flow: 0 });
    edges.push({ from: to, to: from, capacity: 0, cost: -cost, flow: 0 });
  };
  for (let i = 0; i < n; i++) {
    add(source, i, 2, 0);
    add(n + i, sink, 2, 0);
    for (let j = 0; j < n; j++) if (dist.matrix[i][j] > 0) add(i, n + j, 1, dist.matrix[i][j]);
  }
  let total = 0;
  while (true) {
    const best = Array(nodes).fill(-Infinity), previous = Array(nodes).fill(-1);
    best[source] = 0;
    for (let round = 0; round < nodes; round++) {
      let changed = false;
      edges.forEach((edge, id) => {
        if (edge.capacity > edge.flow && best[edge.from] > -Infinity && best[edge.from] + edge.cost > best[edge.to] + 1e-15) {
          best[edge.to] = best[edge.from] + edge.cost;
          previous[edge.to] = id;
          changed = true;
        }
      });
      if (!changed) break;
    }
    if (best[sink] <= 1e-15) return total;
    for (let node = sink; node !== source; node = edges[previous[node]].from) {
      edges[previous[node]].flow++;
      edges[previous[node] ^ 1].flow--;
    }
    total += best[sink];
  }
}

export function teamDistribution(dist, ballots, thresholds = [4, 5, 6, 7, 8]) {
  return thresholds.map(score => ({ score, probability: score > dist.matrix.length ? 0 : teamValue(dist, ballots, score - 1) }));
}

export function rowUpperBound(dist) {
  return dist.matrix.reduce((sum, row) => {
    const [first = 0, second = 0] = row.slice().sort((x, y) => y - x);
    return sum + first + second;
  }, 0);
}

function outcomes(dist) {
  const result = [], n = dist.matrix.length;
  (function visit(mask, current, weight) {
    if (current.length === n) return result.push([current, weight / dist.suffix[0]]);
    for (let j = 0; j < n; j++) {
      const bit = 1 << j, w = dist.weights[current.length][j];
      if (!(mask & bit) && w && dist.suffix[mask | bit]) visit(mask | bit, [...current, j], weight * w);
    }
  })(0, [], 1);
  return result;
}

// Exhaustive reference for small groups. It scores every ballot pair against every valid draw.
export function exhaustiveTeam(dist, unique, target) {
  const n = dist.matrix.length, draws = outcomes(dist), ballots = [];
  (function visit(current, used) {
    if (current.length === n) return ballots.push(current);
    for (let j = 0; j < n; j++) if (!unique || !(used & 1 << j)) visit([...current, j], used | 1 << j);
  })([], 0);
  const hits = ballots.map(ballot => draws.map(([actual]) => actual.reduce((sum, j, i) => sum + (ballot[i] === j), 0)));
  let best = null;
  for (let i = 0; i < ballots.length; i++) for (let j = i; j < ballots.length; j++) {
    let value = 0;
    for (let k = 0; k < draws.length; k++) {
      const score = Math.max(hits[i][k], hits[j][k]);
      value += draws[k][1] * (target === undefined ? score : Number(score > target));
    }
    if (!best || value > best.value + 1e-12) best = { ballots: [ballots[i], ballots[j]], value };
  }
  return { ...best, value: teamValue(dist, best.ballots, target) };
}

export function instantTeam(dist, unique, solo, target) {
  const greedy = teamRecommendation(dist, unique, solo, target);
  if (target !== undefined) return { ...greedy, method: 'greedy' };
  const refined = partitionSearch(dist, unique, greedy.ballots, 8);
  return refined.value > greedy.value ? { ...refined, solo: greedy.solo, method: 'partition' } : { ...greedy, method: 'greedy' };
}

export const TEAM_ALGORITHMS = {
  duplicate: (dist, unique, solo, target) => ({ ballots: [solo, solo], value: teamValue(dist, [solo, solo], target) }),
  greedy: (dist, unique, solo, target) => teamRecommendation(dist, unique, solo, target),
  instant: instantTeam,
  partition: (dist, unique, solo, target) => target === undefined ? partitionSearch(dist, unique, [solo, solo]) : { ballots: [solo, solo], value: teamValue(dist, [solo, solo], target) },
  rowSearch: (dist, unique, solo, target) => blockSearch(dist, unique, [solo, solo], target, { size: 1 }),
  twoRowSearch: (dist, unique, solo, target) => blockSearch(dist, unique, [solo, solo], target, { size: 2 }),
  orientation: (dist, unique, solo, target) => orientationSearch(dist, unique, [solo, draw(dist, random(7))], target),
};

export { expected };
