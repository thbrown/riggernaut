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

    if (dir !== 0) {
      hj.setpoint = Math.max(-hj.maxAngle / 2, Math.min(hj.maxAngle / 2, hj.setpoint + dir * step));
    }

    revolute.configureMotorPosition(hj.setpoint, HINGE_LOCK_STIFFNESS, HINGE_LOCK_DAMPING);
  }
}
