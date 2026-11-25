import { bestExpected, model, recommendations } from './solver.js';

let dist, average;
self.onmessage = ({ data: { group, target, token } }) => {
  try {
    if (group) {
      dist = model(group);
      average = dist.status === 'ok' ? [false, true].map(unique => bestExpected(dist.matrix, unique)) : null;
      self.postMessage({ token, status: dist.status, matrix: dist.matrix });
    }
    if (dist?.status === 'ok') self.postMessage({ token, cards: recommendations(dist, target, average) });
  } catch (error) {
    self.postMessage({ token, error: error.message });
  }
};
