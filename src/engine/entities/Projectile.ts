import { BlasterConfig } from '../../types/components';
import { TILE_SIZE } from '../../config/constants';

export interface Projectile {
  id: number;
  ownerShipIndex: number;
  /** The component that fired this bolt — exempt from self-collision */
  ownerCompId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Barrel firing direction (world-space unit vector) — used for rendering so the bolt
   *  always appears perpendicular to the barrel regardless of ship velocity. */
  dirX: number;
  dirY: number;
  damage: number;
  color: string;
  width: number;
  length: number;
  maxRange: number;
  distanceTraveled: number;
  alive: boolean;
}

let nextProjectileId = 0;

export function resetProjectileId() { nextProjectileId = 0; }

export function createProjectile(
  ownerShipIndex: number,
  ownerCompId: string,
  x: number, y: number,
  dirX: number, dirY: number,
  config: BlasterConfig,
  bodyVelX = 0, bodyVelY = 0,
): Projectile {
  return {
    id: nextProjectileId++,
    ownerShipIndex,
    ownerCompId,
    x, y,
    vx: dirX * config.boltSpeed + bodyVelX,
    vy: dirY * config.boltSpeed + bodyVelY,
    dirX,
    dirY,
    damage: config.damage,
    color: config.boltColor,
    width: config.boltWidth * TILE_SIZE,
    length: config.boltLength * TILE_SIZE,
    maxRange: config.boltRange * TILE_SIZE,
    distanceTraveled: 0,
    alive: true,
  };
}
