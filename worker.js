import { bestExpected, model, recommendations, teamRecommendation } from './solver.js';

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
      const result = { ...pick, ballots: [pick.guess] };
      if (!team) return result;
      const pair = teamRecommendation(dist, Boolean(index), pick.guess, mode === 'tail' ? target : undefined);
      return { ...result, ballots: pair.ballots, team: pair };
    });
    self.postMessage({ token, mode, team, cards });
  } catch (error) {
    self.postMessage({ token, error: error.message });
  }
};
