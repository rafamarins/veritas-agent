import { handleRequest } from './http.js';
import { runDailyMaintenance } from './review.js';
export { VeritasQuality } from './quality-store.js';

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/api/'))
      return handleRequest(request, env);
    return env.ASSETS.fetch(request);
  },
  async scheduled(controller, env) {
    const day = new Date(controller.scheduledTime).toISOString().slice(0, 10);
    const status = await runDailyMaintenance(env, day);
    console.info(JSON.stringify({ day, maintenance: status }));
  },
};
