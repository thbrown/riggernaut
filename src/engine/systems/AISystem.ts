import { BattleSimulation, ShipState } from '../BattleSimulation';
import { Side } from '../../types/components';
import { getComponentDef } from '../../game/components';
import { rotateSide } from '../../types/grid';
import { FIXED_TIMESTEP } from '../../config/constants';
import { ComponentInstance } from '../entities/ComponentInstance';
import { applyRotationPD } from './RotationControlSystem';

export type AIType = 'rammer' | 'shooter';

// --- PD Rotation Controller ---
const ROTATION_KP = 800;
const ROTATION_KD = 200;
const ROTATION_MAX_TORQUE = 2000;

/**
 * Compute the world-space thrust direction for an engine component on a given body.
 * Returns { dx, dy } normalized thrust direction, or null if not an engine.
 */
function getEngineThrustDir(
  comp: ComponentInstance,
  bodyAngle: number,
): { dx: number; dy: number } | null {
  const def = getComponentDef(comp.type);
  const functionalSide = def.functionalSide ?? Side.South;
  const thrustSide = rotateSide(functionalSide, comp.rotation);

  let ldx = 0, ldy = 0;
  switch (thrustSide) {
    case Side.North: ldx = 0; ldy = 1; break;
    case Side.South: ldx = 0; ldy = -1; break;
    case Side.East: ldx = -1; ldy = 0; break;
    case Side.West: ldx = 1; ldy = 0; break;
  }

  const cos = Math.cos(bodyAngle);
  const sin = Math.sin(bodyAngle);
  return {
    dx: ldx * cos - ldy * sin,
    dy: ldx * sin + ldy * cos,
  };
}

/**
 * Fire engines on a ship to produce thrust aligned with a desired acceleration direction.
 * Uses velocity feedback: only fires engines whose thrust corrects the velocity error.
 * `throttle` scales the impulse (0..1).
 */
function fireEnginesInDirection(
  sim: BattleSimulation,
  ship: ShipState,
  body: import('@dimforge/rapier2d-compat').RigidBody,
  dirX: number,
  dirY: number,
  throttle: number,
) {
  const angle = body.rotation();
  for (const comp of ship.components) {
    if (comp.health <= 0) continue;
    const def = getComponentDef(comp.type);
    if (def.config.kind !== 'engine') continue;

    const thrustDir = getEngineThrustDir(comp, angle);
    if (!thrustDir) continue;

    const dot = thrustDir.dx * dirX + thrustDir.dy * dirY;
    if (dot < 0.2) continue;

    const thrust = def.config.thrust * throttle * dot;

    const collider = sim.world.getCollider(comp.colliderHandle);
    if (!collider) continue;
    const worldPos = collider.translation();

    body.applyImpulseAtPoint(
      { x: thrustDir.dx * thrust * FIXED_TIMESTEP, y: thrustDir.dy * thrust * FIXED_TIMESTEP },
      { x: worldPos.x, y: worldPos.y },
      true,
    );
    comp.isActive = true;
  }
}

const RAMMER_MAX_SPEED = 15; // desired approach speed (m/s)
const RAMMER_BRAKE_FACTOR = 0.8; // how aggressively to correct lateral drift

/** Rammer AI with velocity feedback: approaches player at controlled speed */
export function updateRammerAI(sim: BattleSimulation, ship: ShipState) {
  const playerShip = sim.ships.find(s => s.isPlayer);
  if (!playerShip) return;

  const body = sim.world.getRigidBody(ship.bodyHandle);
  const playerBody = sim.world.getRigidBody(playerShip.bodyHandle);
  if (!body || !playerBody) return;

  const pos = body.translation();
  const playerPos = playerBody.translation();

  const dx = playerPos.x - pos.x;
  const dy = playerPos.y - pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.1) return;

  const toPlayerX = dx / dist;
  const toPlayerY = dy / dist;

  // Rotate North face (ram face) toward player
  const targetAngle = Math.atan2(toPlayerX, -toPlayerY);
  applyRotationPD(body, targetAngle, ROTATION_KP, ROTATION_KD, ROTATION_MAX_TORQUE);

  // Desired velocity: toward player, capped at max speed
  const desiredVx = toPlayerX * RAMMER_MAX_SPEED;
  const desiredVy = toPlayerY * RAMMER_MAX_SPEED;

  // Velocity error
  const vel = body.linvel();
  const errX = desiredVx - vel.x;
  const errY = desiredVy - vel.y;
  const errMag = Math.sqrt(errX * errX + errY * errY);

  if (errMag < 0.5) return;

  // Normalize error direction, throttle proportional to error magnitude
  const throttle = Math.min(1, errMag / RAMMER_MAX_SPEED);
  fireEnginesInDirection(sim, ship, body, errX / errMag, errY / errMag, throttle);

  // Also correct lateral drift (velocity component perpendicular to desired direction)
  const velAlongDir = vel.x * toPlayerX + vel.y * toPlayerY;
  const lateralX = vel.x - velAlongDir * toPlayerX;
  const lateralY = vel.y - velAlongDir * toPlayerY;
  const lateralMag = Math.sqrt(lateralX * lateralX + lateralY * lateralY);
  if (lateralMag > 1.0) {
    const brakeThrottle = Math.min(1, lateralMag * RAMMER_BRAKE_FACTOR / RAMMER_MAX_SPEED);
    fireEnginesInDirection(sim, ship, body, -lateralX / lateralMag, -lateralY / lateralMag, brakeThrottle);
  }
}

const SHOOTER_APPROACH_DIST = 20;
const SHOOTER_RETREAT_DIST = 10;
const SHOOTER_PREFERRED_DIST = 15;
const SHOOTER_MAX_SPEED = 8;
const SHOOTER_ORBIT_SPEED = 5;

/** Shooter AI with velocity feedback, lead targeting, rotation, and orbiting */
export function updateShooterAI(sim: BattleSimulation, ship: ShipState, shipIndex: number) {
  const playerShip = sim.ships.find(s => s.isPlayer);
  if (!playerShip) return;

  const body = sim.world.getRigidBody(ship.bodyHandle);
  const playerBody = sim.world.getRigidBody(playerShip.bodyHandle);
  if (!body || !playerBody) return;

  const pos = body.translation();
  const playerPos = playerBody.translation();

  const dx = playerPos.x - pos.x;
  const dy = playerPos.y - pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.1) return;

  const toPlayerX = dx / dist;
  const toPlayerY = dy / dist;
  const vel = body.linvel();

  // Lead targeting: predict where player will be when bolt arrives
  const playerVel = playerBody.linvel();
  // Use a representative bolt speed (medium blaster) for lead prediction
  const timeToTarget = dist / 14;
  const leadX = playerPos.x + playerVel.x * timeToTarget - pos.x;
  const leadY = playerPos.y + playerVel.y * timeToTarget - pos.y;
  const leadDist = Math.sqrt(leadX * leadX + leadY * leadY);
  const aimX = leadDist > 0.01 ? leadX / leadDist : toPlayerX;
  const aimY = leadDist > 0.01 ? leadY / leadDist : toPlayerY;

  // Rotate North/blaster face toward lead position
  const targetAngle = Math.atan2(aimX, -aimY);
  applyRotationPD(body, targetAngle, ROTATION_KP, ROTATION_KD, ROTATION_MAX_TORQUE);

  // Compute desired radial speed based on distance
  let desiredRadialSpeed = 0;
  if (dist > SHOOTER_APPROACH_DIST) {
    desiredRadialSpeed = Math.min(SHOOTER_MAX_SPEED, (dist - SHOOTER_PREFERRED_DIST) * 0.5);
  } else if (dist < SHOOTER_RETREAT_DIST) {
    desiredRadialSpeed = -Math.min(SHOOTER_MAX_SPEED, (SHOOTER_PREFERRED_DIST - dist) * 0.5);
  } else {
    desiredRadialSpeed = (dist - SHOOTER_PREFERRED_DIST) * 0.3;
  }

  // Desired velocity = radial + orbital component
  let desiredVx = toPlayerX * desiredRadialSpeed;
  let desiredVy = toPlayerY * desiredRadialSpeed;

  // Orbital strafing when in comfort band
  if (dist >= SHOOTER_RETREAT_DIST && dist <= SHOOTER_APPROACH_DIST) {
    const orbitSign = (shipIndex % 2 === 0) ? 1 : -1;
    const perpX = -toPlayerY * orbitSign;
    const perpY = toPlayerX * orbitSign;
    desiredVx += perpX * SHOOTER_ORBIT_SPEED;
    desiredVy += perpY * SHOOTER_ORBIT_SPEED;
  }

  // Velocity error
  const errX = desiredVx - vel.x;
  const errY = desiredVy - vel.y;
  const errMag = Math.sqrt(errX * errX + errY * errY);

  if (errMag < 0.8) return;

  const throttle = Math.min(1, errMag / SHOOTER_MAX_SPEED);
  fireEnginesInDirection(sim, ship, body, errX / errMag, errY / errMag, throttle);

  // Activate all blasters so processBlasterFire will fire them
  for (const comp of ship.components) {
    if (comp.health <= 0) continue;
    const cDef = getComponentDef(comp.type);
    if (cDef.config.kind === 'blaster') comp.isActive = true;
  }
}
