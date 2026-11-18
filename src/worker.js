import { handleRequest } from './http.js';
import { runDailyReview } from './review.js';
export { VeritasQuality } from './quality-store.js';

export default {
  fetch: handleRequest,
  async scheduled(controller, env) {
    const day = new Date(controller.scheduledTime).toISOString().slice(0, 10);
    const status = await runDailyReview(env, day);
    console.info(JSON.stringify({ day, review: status }));
  },
};
