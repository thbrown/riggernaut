import RAPIER from '@dimforge/rapier2d-compat';
import { BattleSimulation } from '../BattleSimulation';
import { HINGE_P_GAIN, HINGE_MAX_VEL, HINGE_VEL_DAMPING, HINGE_SETPOINT_STEP } from '../../config/constants';
import { ConnectionGraph } from './ConnectionGraph';

export interface HingeJoint {
  jointHandle: number;
  hingeCompId: string;
  hotkeyLeft?: string;
  hotkeyRight?: string;
  bodyAHandle: number;
  bodyBHandle: number;
  maxAngle: number;
  /** Target angle the motor drives toward */
  setpoint: number;
}

const ONE_DEGREE = Math.PI / 180;

/** Normalize an angle difference to [-π, π] to avoid wrap-around errors. */
function normalizeAngle(a: number): number {
  let d = a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Detect which hinge joints should be locked because both sides of the hinge
 *  are connected through an alternate path in the ConnectionGraph (e.g., via a latched decoupler).
 *  For each hinge, BFS from one neighbor to the other skipping the hinge node itself. */
function computeLockedHinges(sim: BattleSimulation): Set<number> {
  const locked = new Set<number>();

  // Build compId → ConnectionGraph lookup
  const compToGraph = new Map<string, ConnectionGraph>();
  for (const [, graph] of sim.connectionGraphs) {
    for (const hj of sim.hingeJoints) {
      if (graph.hasNode(hj.hingeCompId)) {
        compToGraph.set(hj.hingeCompId, graph);
      }
    }
  }

  for (const hj of sim.hingeJoints) {
    const graph = compToGraph.get(hj.hingeCompId);
    if (!graph) continue;

    const neighbors = graph.getNeighbors(hj.hingeCompId);
    if (neighbors.length < 2) continue; // Can't form a loop with < 2 neighbors

    // BFS from neighbors[0], skipping the hinge node, check if neighbors[1] reachable
    const start = neighbors[0];
    const target = neighbors[1];
    const visited = new Set<string>([start, hj.hingeCompId]); // Pre-mark hinge as visited to skip it
    const queue = [start];
    let found = false;

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (id === target) { found = true; break; }
      for (const nid of graph.getNeighbors(id)) {
        if (!visited.has(nid)) {
          visited.add(nid);
          queue.push(nid);
        }
      }
    }

    if (found) locked.add(hj.jointHandle);
  }

  return locked;
}

/** Recompute which hinges are locked by kinematic loops with decoupler FixedJoints.
 *  Disables motors on newly locked hinges; re-enables and snaps setpoint on newly unlocked ones. */
export function updateHingeLocks(sim: BattleSimulation): void {
  const newLocked = computeLockedHinges(sim);
  const oldLocked = sim.lockedHingeHandles;

  // Newly locked: disable motor
  for (const handle of newLocked) {
    if (!oldLocked.has(handle)) {
      const joint = sim.world.getImpulseJoint(handle);
      if (joint) {
        (joint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(0, 0, 0);
      }
    }
  }

  // Newly unlocked: snap setpoint to current angle, re-enable motor
  for (const handle of oldLocked) {
    if (!newLocked.has(handle)) {
      const hj = sim.hingeJoints.find(h => h.jointHandle === handle);
      const joint = sim.world.getImpulseJoint(handle);
      if (hj && joint) {
        // Compute current revolute angle from body rotations
        const bodyA = sim.world.getRigidBody(hj.bodyAHandle);
        const bodyB = sim.world.getRigidBody(hj.bodyBHandle);
        if (bodyA && bodyB) {
          hj.setpoint = normalizeAngle(bodyB.rotation() - bodyA.rotation());
        }
      }
    }
  }

  sim.lockedHingeHandles = newLocked;
}

/** Process hinge motor input each tick.
 *  Single press: nudge setpoint by 1°. Hold: move by HINGE_SETPOINT_STEP per tick. */
export function processHingeInput(
  sim: BattleSimulation,
  hingeJoints: HingeJoint[],
  heldKeys: Set<string>,
  pressedKeys: Set<string>,
) {
  // Build a component-id → owner lookup so detached segments can't respond to player hotkeys
  const compOwner = new Map<string, string | null>();
  for (const ship of sim.ships) {
    for (const comp of ship.components) {
      compOwner.set(comp.id, comp.owner);
    }
  }

  for (const hj of hingeJoints) {
    // Skip hinges locked by decoupler FixedJoint loops
    if (sim.lockedHingeHandles.has(hj.jointHandle)) continue;
    // Skip hinges on non-player segments
    if (compOwner.get(hj.hingeCompId) !== 'player') continue;

    const joint = sim.world.getImpulseJoint(hj.jointHandle);
    if (!joint) continue;

    const revolute = joint as RAPIER.RevoluteImpulseJoint;
    const leftPressed = hj.hotkeyLeft ? pressedKeys.has(hj.hotkeyLeft) : false;
    const rightPressed = hj.hotkeyRight ? pressedKeys.has(hj.hotkeyRight) : false;
    const leftHeld = hj.hotkeyLeft ? heldKeys.has(hj.hotkeyLeft) : false;
    const rightHeld = hj.hotkeyRight ? heldKeys.has(hj.hotkeyRight) : false;

    // Determine step: press frame = 1°, subsequent held frames = HINGE_SETPOINT_STEP
    let step = 0;
    let dir = 0;
    if (leftPressed && !rightPressed) {
      step = ONE_DEGREE;
      dir = -1;
    } else if (rightPressed && !leftPressed) {
      step = ONE_DEGREE;
      dir = 1;
    } else if (leftHeld && !rightHeld) {
      step = HINGE_SETPOINT_STEP;
      dir = -1;
    } else if (rightHeld && !leftHeld) {
      step = HINGE_SETPOINT_STEP;
      dir = 1;
    }

    const bodyA = sim.world.getRigidBody(hj.bodyAHandle);
    const bodyB = sim.world.getRigidBody(hj.bodyBHandle);
    const currentAngle = (bodyA && bodyB) ? normalizeAngle(bodyB.rotation() - bodyA.rotation()) : hj.setpoint;

    // Check if either body of this hinge is involved in any same-ship contact
    const inContact = sim.sameShipContactBodies.has(hj.bodyAHandle)
      || sim.sameShipContactBodies.has(hj.bodyBHandle);

    if (inContact) {
      // Snap setpoint to current actual angle so motor stops pushing into overlap
      if (Math.abs(hj.setpoint) > Math.abs(currentAngle)) {
        hj.setpoint = currentAngle;
      }
    }

    if (dir !== 0) {
      const newSetpoint = Math.max(-hj.maxAngle / 2, Math.min(hj.maxAngle / 2, hj.setpoint + dir * step));

      if (inContact) {
        // Only allow retreat: setpoint must move closer to zero (opening up)
        if (Math.abs(newSetpoint) < Math.abs(hj.setpoint)) {
          hj.setpoint = newSetpoint;
        }
      } else {
        hj.setpoint = newSetpoint;
      }
    }

    // Velocity motor: command angular velocity proportional to angle error, capped at max.
    // As the hinge approaches the setpoint the commanded velocity tapers to zero — no overshoot.
    const error = normalizeAngle(hj.setpoint - currentAngle);
    const targetVel = Math.sign(error) * Math.min(Math.abs(error) * HINGE_P_GAIN, HINGE_MAX_VEL);
    revolute.configureMotorVelocity(targetVel, HINGE_VEL_DAMPING);
  }

  // Sync setpoints across hinges that share the same hotkey pair.
  // Use the most conservative setpoint (closest to zero) to avoid pushing back into collisions.
  const hotkeyGroups = new Map<string, HingeJoint[]>();
  for (const hj of hingeJoints) {
    if (!hj.hotkeyLeft && !hj.hotkeyRight) continue;
    if (sim.lockedHingeHandles.has(hj.jointHandle)) continue;
    const key = `${hj.hotkeyLeft ?? ''}:${hj.hotkeyRight ?? ''}`;
    let group = hotkeyGroups.get(key);
    if (!group) { group = []; hotkeyGroups.set(key, group); }
    group.push(hj);
  }
  for (const group of hotkeyGroups.values()) {
    if (group.length < 2) continue;
    // Pick the setpoint closest to zero (most conservative)
    let syncSetpoint = group[0].setpoint;
    for (let i = 1; i < group.length; i++) {
      if (Math.abs(group[i].setpoint) < Math.abs(syncSetpoint)) {
        syncSetpoint = group[i].setpoint;
      }
    }
    for (const hj of group) {
      if (hj.setpoint !== syncSetpoint) {
        hj.setpoint = syncSetpoint;
        const joint = sim.world.getImpulseJoint(hj.jointHandle);
        if (joint) {
          const bA = sim.world.getRigidBody(hj.bodyAHandle);
          const bB = sim.world.getRigidBody(hj.bodyBHandle);
          const cur = (bA && bB) ? normalizeAngle(bB.rotation() - bA.rotation()) : syncSetpoint;
          const err = normalizeAngle(syncSetpoint - cur);
          const tVel = Math.sign(err) * Math.min(Math.abs(err) * HINGE_P_GAIN, HINGE_MAX_VEL);
          (joint as RAPIER.RevoluteImpulseJoint).configureMotorVelocity(tVel, HINGE_VEL_DAMPING);
        }
      }
    }
  }
}
