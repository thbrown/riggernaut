import { BattleSimulation } from '../BattleSimulation';
import {
  PIXELS_PER_METER,
  CAMERA_DEFAULT_ZOOM, CAMERA_MIN_ZOOM, CAMERA_MAX_ZOOM, CAMERA_ZOOM_STEP, CAMERA_LERP_SPEED,
} from '../../config/constants';

/** Duration of smooth COM transition after mass change (seconds) */
const MASS_CHANGE_TRANSITION_DURATION = 0.3;
/** Ticks for mass change transition at 60fps */
const MASS_CHANGE_TICKS = Math.round(MASS_CHANGE_TRANSITION_DURATION * 60);

/** How long the camera holds position after player death (seconds) */
const DEATH_HOLD_DURATION = 5;
const DEATH_HOLD_TICKS = DEATH_HOLD_DURATION * 60;

/** How long the camera pans from death position to killer (seconds) */
const DEATH_PAN_DURATION = 1.5;
const DEATH_PAN_TICKS = DEATH_PAN_DURATION * 60;

type DeathCameraPhase = 'hold' | 'pan' | 'follow';

export class CameraSystem {
  x = 0;
  y = 0;
  zoom = CAMERA_DEFAULT_ZOOM;
  private targetZoom = CAMERA_DEFAULT_ZOOM;

  /** Previous COM in physics space (saved each tick before physics) */
  private prevCom: { x: number; y: number } | null = null;

  /** Mass-change transition state */
  private transitionFrom: { x: number; y: number } | null = null;
  private transitionTo: { x: number; y: number } | null = null;
  private transitionTick = 0;
  private transitionDuration = 0;

  /** Death camera state */
  private deathPhase: DeathCameraPhase | null = null;
  private deathTick = 0;
  /** Position where the player died (physics space) */
  private deathPos: { x: number; y: number } | null = null;
  /** Body handle of the killer (for camera follow after hold) */
  private killerBodyHandle: number | null = null;

  /** Save pre-tick COM for interpolation. Call before physics step. */
  savePrevState(sim: BattleSimulation): void {
    const com = sim.getPlayerBodyPosition();
    if (com) {
      this.prevCom = { x: com.x, y: com.y };
    }
  }

  /** Notify the camera that the player has died. */
  onPlayerDeath(sim: BattleSimulation): void {
    if (this.deathPhase !== null) return; // already triggered

    this.deathPhase = 'hold';
    this.deathTick = 0;
    this.deathPos = { x: this.x / PIXELS_PER_METER, y: this.y / PIXELS_PER_METER };

    // Find the killer from the killerChain (populated by DestructionSystem
    // when the command module was destroyed, before it was removed from components)
    this.killerBodyHandle = null;
    const playerShip = sim.getPlayerShip();
    if (playerShip) {
      this.killerBodyHandle = sim.killerChain.get(playerShip.bodyHandle) ?? null;
    }

    // Fallback: if no cross-ship killer recorded (e.g. self-destruction),
    // find the nearest living enemy ship
    if (this.killerBodyHandle === null) {
      let bestDist = Infinity;
      const px = this.x / PIXELS_PER_METER;
      const py = this.y / PIXELS_PER_METER;
      for (const ship of sim.ships) {
        if (ship.isPlayer) continue;
        if (ship.components.length === 0) continue;
        const body = sim.world.getRigidBody(ship.bodyHandle);
        if (!body) continue;
        const pos = body.translation();
        const dx = pos.x - px;
        const dy = pos.y - py;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          this.killerBodyHandle = ship.bodyHandle;
        }
      }
    }

    // Clear any mass-change transition
    this.transitionFrom = null;
    this.transitionDuration = 0;
  }

  /** Get interpolated camera position for rendering. */
  getInterpolatedPosition(sim: BattleSimulation, alpha: number): { x: number; y: number } {
    // Death camera override
    if (this.deathPhase !== null) {
      return this.getDeathCameraPosition(sim, alpha);
    }

    const curCom = sim.getPlayerBodyPosition();
    if (!curCom) return { x: this.x / PIXELS_PER_METER, y: this.y / PIXELS_PER_METER };

    const prev = this.prevCom ?? curCom;

    // Base interpolated position
    let ix = prev.x + (curCom.x - prev.x) * alpha;
    let iy = prev.y + (curCom.y - prev.y) * alpha;

    // If in mass-change transition, blend from old COM to new
    if (this.transitionFrom && this.transitionDuration > 0) {
      const t = Math.min(1, this.transitionTick / this.transitionDuration);
      // Exponential ease-out
      const ease = 1 - Math.pow(1 - t, 3);
      ix = this.transitionFrom.x + (ix - this.transitionFrom.x) * ease;
      iy = this.transitionFrom.y + (iy - this.transitionFrom.y) * ease;
    }

    return { x: ix, y: iy };
  }

  /** Get camera position during death sequence. */
  private getDeathCameraPosition(sim: BattleSimulation, _alpha: number): { x: number; y: number } {
    const deathX = this.deathPos?.x ?? this.x / PIXELS_PER_METER;
    const deathY = this.deathPos?.y ?? this.y / PIXELS_PER_METER;

    if (this.deathPhase === 'hold') {
      // Hold at death position
      return { x: deathX, y: deathY };
    }

    // Get killer position
    const killerPos = this.getKillerPosition(sim);
    if (!killerPos) {
      // Killer doesn't exist anymore — stay at death position
      return { x: deathX, y: deathY };
    }

    if (this.deathPhase === 'pan') {
      // Smooth pan from death position to killer
      const t = Math.min(1, this.deathTick / DEATH_PAN_TICKS);
      // Smooth ease-in-out
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      return {
        x: deathX + (killerPos.x - deathX) * ease,
        y: deathY + (killerPos.y - deathY) * ease,
      };
    }

    // 'follow' — track the killer
    return killerPos;
  }

  /** Find the world position of the killer body, walking the killer chain if needed. */
  private getKillerPosition(sim: BattleSimulation): { x: number; y: number } | null {
    if (this.killerBodyHandle === null) return null;

    // Walk the killer chain: if the current target is gone, follow who killed it
    const visited = new Set<number>();
    let handle: number | null = this.killerBodyHandle;

    while (handle !== null) {
      if (visited.has(handle)) break; // prevent cycles
      visited.add(handle);

      const body = sim.world.getRigidBody(handle);
      if (body) {
        // Found a live body — update our target and return its position
        this.killerBodyHandle = handle;
        const pos = body.translation();
        return { x: pos.x, y: pos.y };
      }

      // Body gone — follow the chain
      handle = sim.killerChain.get(handle) ?? null;
    }

    return null;
  }

  /** Call after a split/merge affecting the player ship to smooth the transition. */
  onMassChange(newCom: { x: number; y: number }): void {
    if (this.deathPhase !== null) return; // don't interfere with death camera
    // Start transition from current camera position (in physics space)
    this.transitionFrom = { x: this.x / PIXELS_PER_METER, y: this.y / PIXELS_PER_METER };
    this.transitionTo = { x: newCom.x, y: newCom.y };
    this.transitionTick = 0;
    this.transitionDuration = MASS_CHANGE_TICKS;
  }

  /** Advance transition state. Call once per tick. */
  tickTransition(): void {
    if (this.transitionDuration > 0) {
      this.transitionTick++;
      if (this.transitionTick >= this.transitionDuration) {
        this.transitionFrom = null;
        this.transitionTo = null;
        this.transitionDuration = 0;
      }
    }

    // Advance death camera
    if (this.deathPhase !== null) {
      this.deathTick++;
      if (this.deathPhase === 'hold' && this.deathTick >= DEATH_HOLD_TICKS) {
        if (this.killerBodyHandle !== null) {
          this.deathPhase = 'pan';
          this.deathTick = 0;
        }
        // If no killer, just stay at death position forever
      } else if (this.deathPhase === 'pan' && this.deathTick >= DEATH_PAN_TICKS) {
        this.deathPhase = 'follow';
        this.deathTick = 0;
      }
    }
  }

  /** Update camera position for rendering. Call from render(). */
  updateForRender(sim: BattleSimulation, alpha: number): void {
    const pos = this.getInterpolatedPosition(sim, alpha);
    this.x = pos.x * PIXELS_PER_METER;
    this.y = pos.y * PIXELS_PER_METER;
    this.zoom += (this.targetZoom - this.zoom) * CAMERA_LERP_SPEED;
  }

  zoomIn(): void {
    this.targetZoom = Math.min(this.targetZoom * CAMERA_ZOOM_STEP, CAMERA_MAX_ZOOM);
  }

  zoomOut(): void {
    this.targetZoom = Math.max(this.targetZoom / CAMERA_ZOOM_STEP, CAMERA_MIN_ZOOM);
  }

  adjustZoom(delta: number): void {
    const factor = delta > 0 ? 1 / CAMERA_ZOOM_STEP : CAMERA_ZOOM_STEP;
    this.targetZoom = Math.max(CAMERA_MIN_ZOOM, Math.min(CAMERA_MAX_ZOOM,
      this.targetZoom * factor,
    ));
  }
}
