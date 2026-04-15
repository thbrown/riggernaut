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
export const STARTING_DIST = 150; // meters between opposing ships
export const ALLY_STARTING_DIST = 10; // meters between allied ships (closest components)
export const BATTLE_COUNTDOWN_SECONDS = 3;

// --- Collision Damage ---
export const COLLISION_DAMAGE_SCALAR = 0.04; // multiplier on relative KE
export const MIN_COLLISION_SPEED = 1.5; // tile-widths/sec below which no damage is dealtexport const MAX_COLLISION_DAMAGE = Infinity; // per-tick cap (Infinity = uncapped)

// --- Collider Margin ---
export const COLLIDER_MARGIN = 0.01; // meters — tiny gap for sliding clearance between ships

// --- Component Mass (uniform for now) ---
export const DEFAULT_COMPONENT_MASS = 100; // kg

// --- Engine Exhaust ---
export const ENGINE_EXHAUST_PUSH_FORCE = 500;

// --- Explosives ---
export const EXPLOSION_DAMAGE = 360;
export const EXPLOSION_RADIUS = 6; // tile lengths
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
export const ATTRACTOR_ANGULAR_STIFFNESS = 200; // torque scale for rotation alignment
export const ATTRACTOR_ANGULAR_DAMPING = 30; // angular velocity damping during attraction

// --- Hinge ---
export const HINGE_P_GAIN = 20;          // rad/s commanded per radian of angle error
export const HINGE_MAX_VEL = 12;         // rad/s — cap on commanded angular velocity
export const HINGE_VEL_DAMPING = 1e4;   // damping applied at the joint to hold position
export const HINGE_SETPOINT_STEP = Math.PI / 400; // radians per key press (45°)

// --- Camera ---
export const CAMERA_DEFAULT_ZOOM = 1;
export const CAMERA_MIN_ZOOM = 0.001;
export const CAMERA_MAX_ZOOM = 4;
export const CAMERA_ZOOM_STEP = 1.15; // multiplicative factor per scroll step
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
