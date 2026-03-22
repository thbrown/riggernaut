import RAPIER from '@dimforge/rapier2d-compat';
import { BattleSimulation } from '../BattleSimulation';
import { HINGE_LOCK_STIFFNESS, HINGE_LOCK_DAMPING, HINGE_SETPOINT_STEP } from '../../config/constants';

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

/** Process hinge motor input each tick.
 *  Single press: nudge setpoint by 1°. Hold: move by HINGE_SETPOINT_STEP per tick. */
export function processHingeInput(
  sim: BattleSimulation,
  hingeJoints: HingeJoint[],
  heldKeys: Set<string>,
  pressedKeys: Set<string>,
) {
  for (const hj of hingeJoints) {
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

    // Check if either body of this hinge is involved in any same-ship contact
    const inContact = sim.sameShipContactBodies.has(hj.bodyAHandle)
      || sim.sameShipContactBodies.has(hj.bodyBHandle);

    if (inContact) {
      // Snap setpoint to current actual angle so motor stops pushing into overlap
      const bodyA = sim.world.getRigidBody(hj.bodyAHandle);
      const bodyB = sim.world.getRigidBody(hj.bodyBHandle);
      if (bodyA && bodyB) {
        const currentAngle = bodyB.rotation() - bodyA.rotation();
        // Only snap if setpoint is further from zero than actual angle (motor is pushing)
        if (Math.abs(hj.setpoint) > Math.abs(currentAngle)) {
          hj.setpoint = currentAngle;
        }
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

    revolute.configureMotorPosition(hj.setpoint, HINGE_LOCK_STIFFNESS, HINGE_LOCK_DAMPING);
  }

  // Sync setpoints across hinges that share the same hotkey pair.
  // Use the most conservative setpoint (closest to zero) to avoid pushing back into collisions.
  const hotkeyGroups = new Map<string, HingeJoint[]>();
  for (const hj of hingeJoints) {
    if (!hj.hotkeyLeft && !hj.hotkeyRight) continue;
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
          (joint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(syncSetpoint, HINGE_LOCK_STIFFNESS, HINGE_LOCK_DAMPING);
        }
      }
    }
  }
}
