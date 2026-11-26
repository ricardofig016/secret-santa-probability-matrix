import { bestExpected, model, recommendations } from './solver.js';
import { instantTeam, rowUpperBound, teamDistribution, uniqueFlowUpperBound } from './team-search.js';

let dist, average;
self.onmessage = ({ data: { group, target, mode, team, token } }) => {
  try {
    if (group) {
      dist = model(group);
      average = dist.status === 'ok' ? [false, true].map(unique => bestExpected(dist.matrix, unique)) : null;
      self.postMessage({ token, status: dist.status, matrix: dist.matrix });
    }
    if (dist?.status !== 'ok') return;
    const cards = recommendations(dist, target, average).map((card, index) => {
      const pick = card[mode];
      const result = { ...pick, ballots: [pick.guess], distribution: teamDistribution(dist, [pick.guess, pick.guess]) };
      if (!team) return result;
      const pair = instantTeam(dist, Boolean(index), pick.guess, mode === 'tail' ? target : undefined);
      const bound = mode === 'expected' ? (index ? uniqueFlowUpperBound(dist) : rowUpperBound(dist)) : undefined;
      return { ...result, ballots: pair.ballots, solo: pick.guess, distribution: teamDistribution(dist, pair.ballots), team: { ...pair, bound } };
    });
    self.postMessage({ token, mode, team, cards });
  } catch (error) {
    self.postMessage({ token, error: error.message });
  }
};
