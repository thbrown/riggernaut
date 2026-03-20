import { ComponentType } from '../../types/components';
import { BLASTER_STATS, TILE_SIZE } from '../../config/constants';

export type BlasterSize = 'small' | 'medium' | 'large';

export interface Projectile {
  id: number;
  ownerShipIndex: number;
  /** The component that fired this bolt — exempt from self-collision */
  ownerCompId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
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

export function blasterSizeFromType(type: ComponentType): BlasterSize | null {
  switch (type) {
    case ComponentType.BlasterSmall: return 'small';
    case ComponentType.BlasterMedium: return 'medium';
    case ComponentType.BlasterLarge: return 'large';
    default: return null;
  }
}

export function createProjectile(
  ownerShipIndex: number,
  ownerCompId: string,
  x: number, y: number,
  dirX: number, dirY: number,
  size: BlasterSize,
  bodyVelX = 0, bodyVelY = 0,
): Projectile {
  const stats = BLASTER_STATS[size];
  return {
    id: nextProjectileId++,
    ownerShipIndex,
    ownerCompId,
    x, y,
    vx: dirX * stats.boltSpeed + bodyVelX,
    vy: dirY * stats.boltSpeed + bodyVelY,
    damage: stats.damage,
    color: stats.boltColor,
    width: stats.boltWidth * TILE_SIZE,
    length: stats.boltLength * TILE_SIZE,
    maxRange: 30 * TILE_SIZE, // bolts travel ~30 tiles before expiring
    distanceTraveled: 0,
    alive: true,
  };
}
