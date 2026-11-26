import { model } from './solver.js';
import { deepTeamSearch, teamDistribution } from './team-search.js';

self.onmessage = ({ data: { group, unique, solo, target, budgetMs } }) => {
  try {
    const dist = model(group);
    if (dist.status !== 'ok') throw new Error('No valid assignment.');
    const result = deepTeamSearch(dist, unique, solo, target, {
      budgetMs,
      onProgress: progress => self.postMessage({ type: 'progress', ...progress, distribution: teamDistribution(dist, progress.ballots) }),
    });
    self.postMessage({ type: 'done', ...result, distribution: teamDistribution(dist, result.ballots) });
  } catch (error) {
    self.postMessage({ type: 'error', error: error.message });
  }
};
