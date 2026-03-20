// =============================================================================
// Riggernaut Game Constants
// All tunable values in one place. See DESIGN.md for descriptions.
// =============================================================================

// --- Physics ---
export const FIXED_TIMESTEP = 1 / 60; // seconds per physics step
export const PIXELS_PER_METER = 50; // rendering scale (1 tile = 1 meter)
export const TILE_SIZE = 1; // meters (each component occupies 1m x 1m)

// --- Build Phase ---
export const DEFAULT_BUILD_WIDTH = 15; // tiles
export const DEFAULT_BUILD_HEIGHT = 15; // tiles
export const DEFAULT_BUILD_TIMER_SECONDS: number | null = null; // null = unlimited (single player)
export const MULTIPLAYER_BUILD_TIMER_SECONDS = 120;
export const SANDBOX_FUNDS = 999_999;

// --- Cost Randomization ---
export const COST_MIN = 1;
export const COST_MAX = 10;

// --- Battle / Arena ---
export const STARTING_DIST = 300; // meters between opposing ships
export const ALLY_STARTING_DIST = 10; // meters between allied ships (closest components)
export const BATTLE_COUNTDOWN_SECONDS = 3;

// --- Collision Damage ---
export const COLLISION_DAMAGE_SCALAR = 0.04; // multiplier on relative KE
export const MIN_COLLISION_SPEED = 0.3; // tile-widths/sec below which no damage is dealt
export const MAX_COLLISION_DAMAGE = Infinity; // per-tick cap (Infinity = uncapped)

// --- Component Mass (uniform for now) ---
export const DEFAULT_COMPONENT_MASS = 100; // kg

// --- Blaster Stats ---
export const BLASTER_STATS = {
  small: { boltSpeed: 20, damage: 10, fireRatePerSec: 5, boltColor: '#ff3333', boltWidth: 0.15, boltLength: 0.4, kickback: 8 },
  medium: { boltSpeed: 14, damage: 25, fireRatePerSec: 2.5, boltColor: '#ffcc00', boltWidth: 0.2, boltLength: 0.55, kickback: 20 },
  large: { boltSpeed: 8, damage: 50, fireRatePerSec: 1, boltColor: '#9933ff', boltWidth: 0.3, boltLength: 0.75, kickback: 50 },
} as const;

// --- Engine Thrust ---
export const ENGINE_THRUST = {
  small: 300,
  medium: 600,
  large: 1200,
} as const;

// --- Engine Exhaust Damage ---
export const ENGINE_EXHAUST_SHAPE = {
  small:  { semiMajor: 0.9, semiMinor: 0.4 },
  medium: { semiMajor: 1.8, semiMinor: 0.8 },
  large:  { semiMajor: 3.6, semiMinor: 1.6 },
} as const;
export const ENGINE_EXHAUST_DPS = {
  small: 10,
  medium: 20,
  large: 40,
} as const;
export const ENGINE_EXHAUST_PUSH_FORCE = 500;

// --- Explosives ---
export const EXPLOSION_DAMAGE = 160;
export const EXPLOSION_RADIUS = 3; // tile lengths
export const EXPLOSION_CHAIN_MULTIPLIER = 2; // damage & radius multiplier per chain
export const EXPLOSION_RAY_COUNT = 64;
export const EXPLOSION_RAY_DAMAGE_SCALE = 2 * Math.PI;
export const EXPLOSION_FORCE_RADIUS = 5; // tile lengths — larger than damage radius
export const EXPLOSION_FORCE_STRENGTH = 1200; // base impulse strength
export const EXPLOSION_FORCE_RAY_COUNT = 64; // sectors for force redirection analysis
export const EXPLOSION_REDIRECT_EFFICIENCY = 0.7; // fraction of blocked-sector force redirected to open sectors (rest absorbed by walls)

// --- Decoupler ---
export const DECOUPLER_DETACH_IMPULSE = 50;
export const DECOUPLER_ATTRACTION_RADIUS = 4.5; // tile lengths
export const DECOUPLER_DOCK_MAX_SPEED = 1; // tile-widths/sec
export const DECOUPLER_DOCK_COOLDOWN = 3; // seconds
export const DECOUPLER_ATTRACTION_FORCE = 200; // impulse scale for attraction

// --- Hinge ---
export const HINGE_MOTOR_VELOCITY = 2; // rad/s
export const HINGE_MOTOR_DAMPING = 50;
export const HINGE_LOCK_STIFFNESS = 1000;
export const HINGE_LOCK_DAMPING = 100;

// --- Camera ---
export const CAMERA_DEFAULT_ZOOM = 1;
export const CAMERA_MIN_ZOOM = 0.2;
export const CAMERA_MAX_ZOOM = 4;
export const CAMERA_ZOOM_STEP = 0.1;
export const CAMERA_LERP_SPEED = 0.08; // per frame interpolation factor

// --- HUD ---
export const MINIMAP_SIZE = 200; // pixels
export const MINIMAP_RANGE = 500; // meters visible on minimap

// --- Networking (future) ---
export const MAX_ROLLBACK_WINDOW = 10; // simulation steps
export const RECONNECT_TIMEOUT = 30; // seconds

// --- Player Colors ---
export const PLAYER_COLORS = [
  '#3498db', // blue
  '#e74c3c', // red
  '#2ecc71', // green
  '#f39c12', // orange
  '#9b59b6', // purple
  '#1abc9c', // teal
  '#e67e22', // dark orange
  '#ecf0f1', // white
] as const;
