import RAPIER from '@dimforge/rapier2d-compat';
import { BattleSimulation } from '../BattleSimulation';
import { HINGE_MOTOR_VELOCITY, HINGE_MOTOR_DAMPING, HINGE_LOCK_STIFFNESS, HINGE_LOCK_DAMPING } from '../../config/constants';

export interface HingeJoint {
  jointHandle: number;
  hingeCompId: string;
  hotkeyLeft?: string;
  hotkeyRight?: string;
  bodyAHandle: number;
  bodyBHandle: number;
  maxAngle: number;
  /** Angle at which the hinge locked (undefined = not yet locked) */
  lockedAngle?: number;
}

/** Process hinge motor input each tick */
export function processHingeInput(
  sim: BattleSimulation,
  hingeJoints: HingeJoint[],
  heldKeys: Set<string>,
) {
  for (const hj of hingeJoints) {
    const joint = sim.world.getImpulseJoint(hj.jointHandle);
    if (!joint) continue;

    const revolute = joint as RAPIER.RevoluteImpulseJoint;
    const leftHeld = hj.hotkeyLeft ? heldKeys.has(hj.hotkeyLeft) : false;
    const rightHeld = hj.hotkeyRight ? heldKeys.has(hj.hotkeyRight) : false;

    if (leftHeld && !rightHeld) {
      hj.lockedAngle = undefined; // clear lock when actively moving
      revolute.configureMotorVelocity(-HINGE_MOTOR_VELOCITY, HINGE_MOTOR_DAMPING);
    } else if (rightHeld && !leftHeld) {
      hj.lockedAngle = undefined; // clear lock when actively moving
      revolute.configureMotorVelocity(HINGE_MOTOR_VELOCITY, HINGE_MOTOR_DAMPING);
    } else {
      // Lock hinge at the angle where it stopped
      if (hj.lockedAngle === undefined) {
        const bodyA = sim.world.getRigidBody(hj.bodyAHandle);
        const bodyB = sim.world.getRigidBody(hj.bodyBHandle);
        hj.lockedAngle = bodyA && bodyB ? bodyB.rotation() - bodyA.rotation() : 0;
      }
      revolute.configureMotorPosition(hj.lockedAngle, HINGE_LOCK_STIFFNESS, HINGE_LOCK_DAMPING);
    }
  }
}
