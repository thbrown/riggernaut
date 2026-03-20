/**
 * Particle system ported from spaceship-resurrection.
 * Particles have position, velocity, lifetime, color interpolation, and size growth.
 */
import {
  EXPLOSION_PARTICLE_COUNT_SCALE, EXPLOSION_PARTICLE_SPEED_BASE,
  EXPLOSION_PARTICLE_SPEED_RADIUS_SCALE, EXPLOSION_PARTICLE_LIFE_BASE,
  EXPLOSION_PARTICLE_LIFE_SCALE, EXPLOSION_PARTICLE_SIZE_MIN,
  EXPLOSION_PARTICLE_SIZE_MAX, EXPLOSION_PARTICLE_SIZE_GROWTH,
  EXPLOSION_PARTICLE_SPREAD,
  FIRE_PARTICLE_SPEED_BASE, FIRE_PARTICLE_SPEED_RANGE,
  FIRE_PARTICLE_SPREAD, FIRE_PARTICLE_LIFE_BASE,
  FIRE_PARTICLE_LIFE_RANGE, FIRE_PARTICLE_SIZE, FIRE_PARTICLE_SIZE_GROWTH,
} from '../config/display';

// Fire color gradient: red → orange → yellow → gray (smoke)
const FIRE_COLORS = [
  [255, 0, 0],       // Bright red
  [245, 158, 66],    // Orange
  [250, 241, 75],    // Yellow
  [84, 84, 84],      // Dark gray (smoke)
];

const EXPLOSION_COLORS = [
  [255, 255, 200],   // White-hot
  [255, 200, 50],    // Bright yellow
  [255, 100, 30],    // Orange
  [180, 40, 10],     // Dark red
  [60, 30, 15],      // Dark smoke
];

/** Interpolate between a color array based on percentage (0..1) */
function getColor(pct: number, colors: number[][]): string {
  const clampedPct = Math.max(0, Math.min(1, pct));
  const segments = colors.length - 1;
  const segment = Math.min(Math.floor(clampedPct * segments), segments - 1);
  const segPct = (clampedPct * segments) - segment;

  const c1 = colors[segment];
  const c2 = colors[segment + 1];
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * segPct);
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * segPct);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * segPct);
  return `rgb(${r},${g},${b})`;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;      // remaining lifetime (seconds)
  maxLife: number;    // initial lifetime (seconds)
  colors: number[][]; // color gradient to interpolate
  sizeGrowth: number; // size increase per second
}

/** Global particle pool */
const particles: Particle[] = [];

/** Spawn a single particle */
export function spawnParticle(
  x: number,
  y: number,
  angle: number,       // direction in radians
  speed: number,
  spread: number,       // random velocity variance (pixels)
  life: number,         // lifetime in seconds
  size: number,
  sizeGrowth: number,
  colors: number[][] = FIRE_COLORS,
  baseVx: number = 0,
  baseVy: number = 0,
) {
  const spreadVx = (Math.random() - 0.5) * spread;
  const spreadVy = (Math.random() - 0.5) * spread;
  particles.push({
    x,
    y,
    vx: Math.cos(angle) * speed + spreadVx + baseVx,
    vy: Math.sin(angle) * speed + spreadVy + baseVy,
    size,
    life,
    maxLife: life,
    colors,
    sizeGrowth,
  });
}

/** Spawn explosion particles (one-shot burst). Optional baseVx/baseVy adds parent velocity. */
export function spawnExplosionParticles(
  x: number,
  y: number,
  radius: number,
  intensity: number = 1,
  baseVx: number = 0,
  baseVy: number = 0,
) {
  const count = Math.round(EXPLOSION_PARTICLE_COUNT_SCALE * intensity);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = EXPLOSION_PARTICLE_SPEED_BASE + Math.random() * radius * EXPLOSION_PARTICLE_SPEED_RADIUS_SCALE;
    const life = EXPLOSION_PARTICLE_LIFE_BASE + Math.random() * EXPLOSION_PARTICLE_LIFE_SCALE * intensity;
    const size = EXPLOSION_PARTICLE_SIZE_MIN + Math.random() * (EXPLOSION_PARTICLE_SIZE_MAX - EXPLOSION_PARTICLE_SIZE_MIN);
    spawnParticle(x, y, angle, speed, EXPLOSION_PARTICLE_SPREAD, life, size, EXPLOSION_PARTICLE_SIZE_GROWTH, EXPLOSION_COLORS, baseVx, baseVy);
  }
}

/** Spawn fire/damage particles (ongoing, called each frame for burning components) */
export function spawnFireParticles(
  x: number,
  y: number,
  halfSize: number,
) {
  // 1-2 particles per frame, rising upward with some spread
  const count = Math.random() < 0.5 ? 1 : 2;
  for (let i = 0; i < count; i++) {
    const ox = (Math.random() - 0.5) * halfSize * 1.5;
    const oy = (Math.random() - 0.5) * halfSize * 1.5;
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.8; // mostly upward
    spawnParticle(x + ox, y + oy, angle, FIRE_PARTICLE_SPEED_BASE + Math.random() * FIRE_PARTICLE_SPEED_RANGE, FIRE_PARTICLE_SPREAD, FIRE_PARTICLE_LIFE_BASE + Math.random() * FIRE_PARTICLE_LIFE_RANGE, FIRE_PARTICLE_SIZE, FIRE_PARTICLE_SIZE_GROWTH, FIRE_COLORS);
  }
}

/** Update all particles (call once per frame with dt in seconds) */
export function updateParticles(dt: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.size = Math.max(0, p.size + p.sizeGrowth * dt);
    p.life -= dt;

    if (p.life <= 0) {
      // Remove dead particle (swap with last for perf)
      particles[i] = particles[particles.length - 1];
      particles.pop();
    }
  }
}

/** Draw all particles (call in world-space, after camera transform) */
export function drawParticles(ctx: CanvasRenderingContext2D) {
  for (const p of particles) {
    const pct = 1 - (p.life / p.maxLife); // 0 at birth, 1 at death
    const alpha = Math.max(0, p.life / p.maxLife); // fade out
    const color = getColor(pct, p.colors);

    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Clear all particles (e.g., on scene reset) */
export function clearParticles() {
  particles.length = 0;
}

/** Get current particle count (for debug) */
export function getParticleCount(): number {
  return particles.length;
}
