// =============================================================================
// Display / VFX Configuration
// Tunable visual constants for particles, explosions, and effects.
// =============================================================================

// --- Explosion Glow ---
export const EXPLOSION_GLOW_MAX_AGE = 0.5; // seconds
export const EXPLOSION_GLOW_RADIUS_MIN = 0.3; // fraction of full radius at age=0
export const EXPLOSION_GLOW_RADIUS_MAX = 1.0; // fraction of full radius at age=maxAge

// --- Explosion Particles ---
export const EXPLOSION_PARTICLE_COUNT_SCALE = 20; // particles per unit intensity
export const EXPLOSION_PARTICLE_SPEED_BASE = 20; // min speed (px/s)
export const EXPLOSION_PARTICLE_SPEED_RADIUS_SCALE = 0.8; // speed += random * radius * this
export const EXPLOSION_PARTICLE_LIFE_BASE = 0.15; // min lifetime (seconds)
export const EXPLOSION_PARTICLE_LIFE_SCALE = 0.25; // max additional lifetime * intensity
export const EXPLOSION_PARTICLE_SIZE_MIN = 1.5;
export const EXPLOSION_PARTICLE_SIZE_MAX = 4.0;
export const EXPLOSION_PARTICLE_SIZE_GROWTH = 15; // px/s
export const EXPLOSION_PARTICLE_SPREAD = 15; // velocity variance (px)

// --- Fire Particles (burning components) ---
export const FIRE_PARTICLE_SPEED_BASE = 10;
export const FIRE_PARTICLE_SPEED_RANGE = 20;
export const FIRE_PARTICLE_SPREAD = 8;
export const FIRE_PARTICLE_LIFE_BASE = 0.3;
export const FIRE_PARTICLE_LIFE_RANGE = 0.4;
export const FIRE_PARTICLE_SIZE = 1.5;
export const FIRE_PARTICLE_SIZE_GROWTH = 15;
