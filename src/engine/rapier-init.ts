import RAPIER from '@dimforge/rapier2d-compat';

let initialized = false;

export async function initRapier(): Promise<typeof RAPIER> {
  if (!initialized) {
    await RAPIER.init();
    initialized = true;
  }
  return RAPIER;
}
