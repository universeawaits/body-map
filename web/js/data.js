// Loads the dataset. The frontend needs zero configuration: entities.json
// ships in the repo and is served statically next to the page.

import { DATA_URL } from './config.js';

/**
 * @returns {Promise<{generated: string|null, entities: object[]}>}
 */
export async function loadEntities() {
  const response = await fetch(DATA_URL, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Failed to load ${DATA_URL}: HTTP ${response.status}`);
  }
  const payload = await response.json();
  return {
    generated: typeof payload.generated === 'string' ? payload.generated : null,
    entities: Array.isArray(payload.entities) ? payload.entities : [],
  };
}
