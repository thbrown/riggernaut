import RAPIER from '@dimforge/rapier2d-compat';
import { FIXED_TIMESTEP } from '../../config/constants';

/** Apply PD rotation control to steer a body toward a target angle */
export function applyRotationPD(
  body: RAPIER.RigidBody,
  targetAngle: number,
  kP: number,
  kD: number,
  maxTorque: number,
) {
  let error = targetAngle - body.rotation();
  // Wrap to [-PI, PI]
  error = ((error + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const torque = Math.max(-maxTorque, Math.min(maxTorque, kP * error - kD * body.angvel()));
  body.applyTorqueImpulse(torque * FIXED_TIMESTEP, true);
}
