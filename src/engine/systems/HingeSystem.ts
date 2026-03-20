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
      revolute.configureMotorVelocity(-HINGE_MOTOR_VELOCITY, HINGE_MOTOR_DAMPING);
    } else if (rightHeld && !leftHeld) {
      revolute.configureMotorVelocity(HINGE_MOTOR_VELOCITY, HINGE_MOTOR_DAMPING);
    } else {
      // Lock hinge at current position using position-based motor
      // Compute current joint angle from body rotations
      const bodyA = sim.world.getRigidBody(hj.bodyAHandle);
      const bodyB = sim.world.getRigidBody(hj.bodyBHandle);
      const currentAngle = bodyA && bodyB ? bodyB.rotation() - bodyA.rotation() : 0;
      revolute.configureMotorPosition(currentAngle, HINGE_LOCK_STIFFNESS, HINGE_LOCK_DAMPING);
    }
  }
}
