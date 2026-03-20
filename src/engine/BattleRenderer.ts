import { BattleSimulation, ShipState } from './BattleSimulation';
import { Side } from '../types/components';
import { DecouplerMode } from './systems/DecouplerSystem';
import { ComponentType } from '../types/components';
import {
  PIXELS_PER_METER, TILE_SIZE,
  CAMERA_DEFAULT_ZOOM, CAMERA_MIN_ZOOM, CAMERA_MAX_ZOOM, CAMERA_ZOOM_STEP, CAMERA_LERP_SPEED,
  MINIMAP_SIZE, MINIMAP_RANGE,
  ENGINE_EXHAUST_SHAPE,
} from '../config/constants';
import { getComponentColor } from '../components/BuildPhase/ComponentRenderer';
import { Projectile } from './entities/Projectile';
import { activeExplosions } from './systems/ExplosionSystem';
import { EXPLOSION_GLOW_RADIUS_MIN, EXPLOSION_GLOW_RADIUS_MAX } from '../config/display';
import {
  updateParticles, drawParticles,
  spawnFireParticles, spawnExplosionParticles,
} from './ParticleSystem';
import { DECOUPLER_ATTRACTION_RADIUS } from '../config/constants';

/** Convert a Side to a local-space unit direction (pre-rotation) */
function sideToLocalDir(side: Side): { dx: number; dy: number } {
  switch (side) {
    case Side.North: return { dx: 0, dy: -1 };
    case Side.South: return { dx: 0, dy: 1 };
    case Side.East: return { dx: 1, dy: 0 };
    case Side.West: return { dx: -1, dy: 0 };
  }
}

interface StarField {
  stars: Array<{ x: number; y: number; size: number; brightness: number }>;
}

export class BattleRenderer {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private cameraX = 0;
  private cameraY = 0;
  private zoom = CAMERA_DEFAULT_ZOOM;
  private targetZoom = CAMERA_DEFAULT_ZOOM;
  private starField: StarField;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();

    // Generate static star field
    this.starField = { stars: [] };
    for (let i = 0; i < 300; i++) {
      this.starField.stars.push({
        x: (Math.random() - 0.5) * 4000,
        y: (Math.random() - 0.5) * 4000,
        size: Math.random() * 1.5 + 0.5,
        brightness: Math.random() * 0.6 + 0.2,
      });
    }
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
  }

  zoomIn() {
    this.targetZoom = Math.min(this.targetZoom + CAMERA_ZOOM_STEP, CAMERA_MAX_ZOOM);
  }

  zoomOut() {
    this.targetZoom = Math.max(this.targetZoom - CAMERA_ZOOM_STEP, CAMERA_MIN_ZOOM);
  }

  adjustZoom(delta: number) {
    this.targetZoom = Math.max(CAMERA_MIN_ZOOM, Math.min(CAMERA_MAX_ZOOM,
      this.targetZoom - delta * CAMERA_ZOOM_STEP
    ));
  }

  render(sim: BattleSimulation, alpha: number) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Camera locks to player ship's center of mass (interpolated by alpha)
    const playerShip = sim.getPlayerShip();
    if (playerShip) {
      const curCom = sim.getPlayerBodyPosition(); // returns worldCom()
      const prevCom = playerShip.prevCom ?? playerShip.prevPosition;
      if (curCom) {
        const ix = prevCom.x + (curCom.x - prevCom.x) * alpha;
        const iy = prevCom.y + (curCom.y - prevCom.y) * alpha;
        this.cameraX = ix * PIXELS_PER_METER;
        this.cameraY = iy * PIXELS_PER_METER;
      }
    }

    // Smooth zoom only
    this.zoom += (this.targetZoom - this.zoom) * CAMERA_LERP_SPEED;

    // Clear
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, w, h);

    ctx.save();

    // Camera transform: center screen, then zoom, then translate
    ctx.translate(w / 2, h / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cameraX, -this.cameraY);

    // Draw star field (parallax)
    this.drawStars(ctx);

    // Draw ships
    for (const ship of sim.ships) {
      this.drawShip(ctx, sim, ship, alpha);
    }

    // Draw projectiles
    for (const proj of sim.projectiles) {
      this.drawProjectile(ctx, proj);
    }

    // Draw explosions (gradient glow + spawn particles)
    for (const exp of activeExplosions) {
      this.drawExplosion(ctx, exp);
      // Spawn explosion particles on the first frame only (age near 0)
      if (exp.age < 0.02) {
        spawnExplosionParticles(
          exp.x * PIXELS_PER_METER,
          exp.y * PIXELS_PER_METER,
          exp.radius,
          exp.damage / 80, // intensity relative to base damage
        );
      }
    }

    // Update and draw world-space particles
    updateParticles(1 / 60);
    drawParticles(ctx);

    ctx.restore();
  }

  private drawStars(ctx: CanvasRenderingContext2D) {
    const parallax = 0.3;
    for (const star of this.starField.stars) {
      const sx = star.x + this.cameraX * parallax;
      const sy = star.y + this.cameraY * parallax;
      ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness})`;
      ctx.beginPath();
      ctx.arc(sx, sy, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawShip(ctx: CanvasRenderingContext2D, sim: BattleSimulation, ship: ShipState, alpha: number) {
    const body = sim.world.getRigidBody(ship.bodyHandle);
    if (!body) return;

    const curPos = body.translation();
    const curAngle = body.rotation();

    // Interpolate between previous and current state
    const ix = ship.prevPosition.x + (curPos.x - ship.prevPosition.x) * alpha;
    const iy = ship.prevPosition.y + (curPos.y - ship.prevPosition.y) * alpha;
    // Simple angle lerp (handles wrapping for small deltas)
    let dAngle = curAngle - ship.prevAngle;
    while (dAngle > Math.PI) dAngle -= 2 * Math.PI;
    while (dAngle < -Math.PI) dAngle += 2 * Math.PI;
    const iAngle = ship.prevAngle + dAngle * alpha;

    ctx.save();
    ctx.translate(ix * PIXELS_PER_METER, iy * PIXELS_PER_METER);
    ctx.rotate(iAngle);

    for (const comp of ship.components) {
      if (comp.health <= 0) continue;

      const collider = sim.world.getCollider(comp.colliderHandle);
      if (!collider) continue;

      // Get local offset (relative to body) — collider.translation() returns world-space,
      // but we've already translated/rotated by body transform, so compute local offset
      const collWorld = collider.translation();
      const bodyWorld = body.translation();
      const bodyAngle = body.rotation();
      const dxW = collWorld.x - bodyWorld.x;
      const dyW = collWorld.y - bodyWorld.y;
      // Rotate back by body angle to get local coords
      const cosA = Math.cos(-bodyAngle);
      const sinA = Math.sin(-bodyAngle);
      const localX = dxW * cosA - dyW * sinA;
      const localY = dxW * sinA + dyW * cosA;
      const cx = localX * PIXELS_PER_METER;
      const cy = localY * PIXELS_PER_METER;
      const halfSize = (TILE_SIZE / 2) * PIXELS_PER_METER;

      ctx.save();
      ctx.translate(cx, cy);
      // Apply component rotation
      ctx.rotate(comp.rotation * Math.PI / 2);

      // Draw component body
      const color = getComponentColor(comp.type);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(-halfSize + 1, -halfSize + 1, halfSize * 2 - 2, halfSize * 2 - 2);

      // Border
      ctx.strokeStyle = ship.isPlayer ? '#88ccff' : '#ff6644';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-halfSize + 1, -halfSize + 1, halfSize * 2 - 2, halfSize * 2 - 2);

      ctx.globalAlpha = 1;

      // Component type decoration
      this.drawComponentDecoration(ctx, comp.type, halfSize);

      // Damage flash: red pulse when recently hit
      if (comp.lastDamageTick !== undefined) {
        const ticksSince = sim.tickCount - comp.lastDamageTick;
        if (ticksSince < 30) {
          const flashAlpha = 0.6 * (1 - ticksSince / 30) * (0.5 + 0.5 * Math.sin(ticksSince * 0.6));
          ctx.fillStyle = `rgba(255, 50, 50, ${flashAlpha})`;
          ctx.fillRect(-halfSize + 1, -halfSize + 1, halfSize * 2 - 2, halfSize * 2 - 2);
        }
      }

      // Damage visualization: red overlay proportional to damage taken
      const healthPct = comp.health / comp.maxHealth;
      if (healthPct < 1) {
        const damageAlpha = (1 - healthPct) * 0.6;
        ctx.fillStyle = `rgba(255, 0, 0, ${damageAlpha})`;
        ctx.fillRect(-halfSize + 1, -halfSize + 1, halfSize * 2 - 2, halfSize * 2 - 2);

        // Crack lines at every 10% damage threshold (90%, 80%, 70%... etc.)
        const damagePct = 1 - healthPct;
        const crackCount = Math.floor(damagePct * 10); // 0-10 cracks
        ctx.strokeStyle = `rgba(255, 100, 100, ${0.3 + damagePct * 0.5})`;
        ctx.lineWidth = 1;
        // Seed-based crack positions for visual consistency
        const crackSeeds = [
          [-0.5, -0.3, 0.2, 0.4],
          [0.3, -0.5, -0.1, 0.6],
          [-0.6, 0.1, 0.5, -0.2],
          [-0.3, -0.6, 0.4, 0.3],
          [0.5, -0.4, -0.2, 0.5],
          [-0.4, 0.5, 0.6, -0.1],
          [0.2, -0.2, -0.5, 0.6],
          [-0.6, -0.5, 0.3, 0.1],
          [0.4, 0.2, -0.3, -0.4],
          [-0.1, 0.6, 0.5, -0.6],
        ];
        for (let ci = 0; ci < crackCount && ci < crackSeeds.length; ci++) {
          const [x1, y1, x2, y2] = crackSeeds[ci];
          ctx.beginPath();
          ctx.moveTo(halfSize * x1, halfSize * y1);
          ctx.lineTo(halfSize * x2, halfSize * y2);
          ctx.stroke();
        }

        // Fire particles on heavily damaged components (below 30% health)
        // Spawn into the world-space particle system
        if (healthPct < 0.3) {
          // Use interpolated position so particles match rendered ship position
          const cos2 = Math.cos(iAngle);
          const sin2 = Math.sin(iAngle);
          const worldCompX = ix + (localX * cos2 - localY * sin2);
          const worldCompY = iy + (localX * sin2 + localY * cos2);
          spawnFireParticles(
            worldCompX * PIXELS_PER_METER,
            worldCompY * PIXELS_PER_METER,
            halfSize,
          );
        }
      }

      // Draw engine exhaust in component-local space
      // Canvas is already transformed to component center + rotation,
      // so +Y is always the exhaust direction (south = functional side).
      const isEngine = comp.type === ComponentType.EngineSmall ||
        comp.type === ComponentType.EngineMedium ||
        comp.type === ComponentType.EngineLarge;
      if (isEngine) {
        const showExhaust = comp.isActive;
        if (showExhaust) {
          const engineSize = comp.type === ComponentType.EngineSmall ? 'small'
            : comp.type === ComponentType.EngineMedium ? 'medium' : 'large';
          const shape = ENGINE_EXHAUST_SHAPE[engineSize];
          // Particle bounds derived from ENGINE_EXHAUST_SHAPE — same constant
          // used by ExhaustDamageSystem, so visuals and damage stay in sync.
          const majPx = shape.semiMajor * PIXELS_PER_METER;
          const minPx = shape.semiMinor * PIXELS_PER_METER;
          const particleCount = engineSize === 'small' ? 10
            : engineSize === 'medium' ? 18 : 40;

          const prevComposite = ctx.globalCompositeOperation;
          ctx.globalCompositeOperation = 'lighter';

          // Exhaust origin in local space: back edge of engine tile
          const oy = halfSize;

          for (let i = 0; i < particleCount; i++) {
            // Sample random point within a tapered plume shape:
            // lateral spread starts narrow at engine edge, fans out along exhaust
            // Bias toward origin (power curve) so particles cluster near engine = slower feel
            const along = Math.pow(Math.random(), 1.5) * majPx;
            const t = along / majPx; // 0 at origin, 1 at tip
            const taper = 0.15 + 0.85 * t; // narrow at nozzle, full width at end
            const maxPerp = minPx * Math.sqrt(1 - t * t) * taper;
            const perp = (Math.random() - 0.5) * 2 * maxPerp;

            // Elliptical distance (0 at origin, 1 at boundary)
            const na = along / majPx;
            const nb = perp / minPx;
            const d = Math.sqrt(na * na + nb * nb);

            // Clip visual to 85% of damage ellipse so particles don't appear
            // where damage is negligible (avoids misleading overlap on edge tiles)
            if (d > 0.85) continue;

            // Gradual color transition: continuous lerp from white-yellow (d=0)
            // through orange to red (d=1), with alpha fading toward the edge
            const px = perp;
            const py = oy + along;
            const radius = 3 + d * 4;

            // RGB channels lerp smoothly across the full 0–1 range
            const r = 255;
            const g = Math.floor(255 - d * 225 + Math.random() * 20); // 255 → ~30
            const b = Math.floor(220 * (1 - d * 1.4) + Math.random() * 10); // 220 → 0
            const a = 0.8 - d * 0.6 + Math.random() * 0.1; // 0.8 → ~0.2

            ctx.fillStyle = `rgba(${r}, ${Math.max(0, g)}, ${Math.max(0, b)}, ${Math.max(0.05, a)})`;
            ctx.beginPath();
            ctx.arc(px, py, radius, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.globalCompositeOperation = prevComposite;

          // Engine glow: subtle yellow overlay on engine body when active
          const flicker = Math.sin(sim.tickCount * 0.3 + comp.colliderHandle) * 0.05;
          ctx.fillStyle = `rgba(255, 200, 50, ${0.15 + flicker})`;
          ctx.fillRect(-halfSize + 1, -halfSize + 1, halfSize * 2 - 2, halfSize * 2 - 2);
        }
      }

      // Blaster recoil animation — impulse on fire, scaled by blaster size
      if (comp.lastFireTick !== undefined) {
        const ticksSinceFire = sim.tickCount - comp.lastFireTick;
        if (ticksSinceFire < 8) {
          const recoilMag = comp.type === ComponentType.BlasterLarge ? 4
            : comp.type === ComponentType.BlasterMedium ? 2.5 : 1.5;
          const t = ticksSinceFire / 8; // 0→1
          const recoil = recoilMag * Math.exp(-t * 4) * Math.cos(t * Math.PI * 2);
          ctx.translate(0, recoil);
        }
      }

      // Explosive countdown glow
      if (comp.type === ComponentType.Explosive && comp.detonationCountdown !== undefined && comp.detonationCountdown > 0) {
        const progress = 1 - comp.detonationCountdown / 60;
        const pulse = 0.3 + 0.7 * progress;
        const flicker = Math.sin(sim.tickCount * (0.3 + progress * 1.5)) * 0.15;
        ctx.fillStyle = `rgba(255, 150, 0, ${(pulse + flicker) * 0.6})`;
        ctx.fillRect(-halfSize + 1, -halfSize + 1, halfSize * 2 - 2, halfSize * 2 - 2);
      }

      // Decoupler side indicators: filled = latched, hollow = unlatched, pulsing cyan = attractor
      if (comp.type === ComponentType.Decoupler) {
        const dcState = sim.decouplers.find(d => d.compId === comp.id);
        const dotR = 3;
        const dotOffset = halfSize * 0.6;
        // Dots in component-local space (canvas already rotated by comp.rotation)
        const dotPositions: Array<{ x: number; y: number; baseSide: Side }> = [
          { x: 0, y: -dotOffset, baseSide: Side.North },
          { x: dotOffset, y: 0, baseSide: Side.East },
          { x: 0, y: dotOffset, baseSide: Side.South },
          { x: -dotOffset, y: 0, baseSide: Side.West },
        ];
        for (const dot of dotPositions) {
          // Match by baseSide to find the correct side state
          const sideState = dcState?.sides.find(s => s.baseSide === dot.baseSide);
          const mode: DecouplerMode = sideState?.mode ?? 'latched';

          ctx.beginPath();
          ctx.arc(dot.x, dot.y, dotR, 0, Math.PI * 2);
          if (mode === 'latched') {
            ctx.fillStyle = '#fff';
            ctx.fill();
          } else if (mode === 'attractor') {
            // Pulsing cyan for attractor mode
            const pulse = 0.5 + 0.5 * Math.sin(sim.tickCount * 0.15);
            ctx.fillStyle = `rgba(0, 255, 220, ${0.5 + pulse * 0.5})`;
            ctx.fill();
            // Glow ring
            ctx.strokeStyle = `rgba(0, 255, 220, ${pulse * 0.6})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(dot.x, dot.y, dotR + 2 + pulse * 2, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            // Hollow for unlatched
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      }

      // Hotkey labels on player-owned components (includes drones)
      if (comp.owner === 'player') {
        if (comp.type === ComponentType.Decoupler) {
          // Per-edge hotkey labels matching UI storage:
          // index 0 (North) = comp.hotkey, index 1+ = comp.hotkeys[i-1]
          ctx.font = '8px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const edgeOffset = halfSize * 0.75;
          const edgePositions = [
            { x: 0, y: -edgeOffset },  // North
            { x: edgeOffset, y: 0 },   // East
            { x: 0, y: edgeOffset },   // South
            { x: -edgeOffset, y: 0 },  // West
          ];
          for (let ei = 0; ei < edgePositions.length; ei++) {
            const hk = ei === 0 ? comp.hotkey : comp.hotkeys?.[ei - 1];
            if (!hk) continue;
            const ep = edgePositions[ei];
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(ep.x - 6, ep.y - 5, 12, 10);
            ctx.fillStyle = '#fff';
            ctx.fillText(hk.toUpperCase(), ep.x, ep.y);
          }
        } else if (comp.hotkey) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(-8, -8, 16, 14);
          ctx.fillStyle = '#fff';
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(comp.hotkey.toUpperCase(), 0, 0);
        }
      }

      // Attractor particle effect: draw inward-flowing particles in component-local space
      if (comp.type === ComponentType.Decoupler) {
        const dcState2 = sim.decouplers.find(d => d.compId === comp.id);
        const attractorSides2 = dcState2?.sides.filter(s => s.mode === 'attractor') ?? [];
        if (attractorSides2.length > 0) {
          const attractRadPx = DECOUPLER_ATTRACTION_RADIUS * PIXELS_PER_METER;
          const prevComposite = ctx.globalCompositeOperation;
          ctx.globalCompositeOperation = 'lighter';

          for (const side of attractorSides2) {
            // baseSide gives direction in component-local space (canvas already rotated)
            const dir = sideToLocalDir(side.baseSide);

            // Draw ~10 small shrinking circles flowing inward
            for (let pi = 0; pi < 10; pi++) {
              // Deterministic-ish animation using tickCount + particle index
              const t = ((sim.tickCount * 0.03 + pi * 0.1) % 1); // 0→1 inward progress
              const dist = (1 - t) * attractRadPx;
              const spread = (Math.sin(pi * 7.3 + sim.tickCount * 0.02) * 0.4) * attractRadPx * 0.3;
              const px = dir.dx * dist - dir.dy * spread;
              const py = dir.dy * dist + dir.dx * spread;
              const r = (1.5 + (1 - t) * 2);
              const a = 0.3 + t * 0.5;
              ctx.fillStyle = `rgba(0, 255, 220, ${a})`;
              ctx.beginPath();
              ctx.arc(px, py, r, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          ctx.globalCompositeOperation = prevComposite;
        }
      }

      ctx.restore();
    }

    ctx.restore();
  }

  /** Draw type-specific decorative icon on a component (canvas already at component center + rotated) */
  private drawComponentDecoration(ctx: CanvasRenderingContext2D, type: ComponentType, hs: number) {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.2;
    const s = hs * 0.6; // decoration scale factor

    switch (type) {
      case ComponentType.CommandModule:
        // Diamond
        ctx.beginPath();
        ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0);
        ctx.closePath(); ctx.stroke();
        break;

      case ComponentType.EngineSmall:
      case ComponentType.EngineMedium:
      case ComponentType.EngineLarge: {
        // Nozzle rectangle at bottom
        const nw = type === ComponentType.EngineSmall ? s * 0.5
          : type === ComponentType.EngineMedium ? s * 0.7 : s;
        ctx.fillStyle = 'rgba(255,136,0,0.7)';
        ctx.fillRect(-nw, hs * 0.3, nw * 2, hs * 0.5);
        break;
      }

      case ComponentType.Ram:
        // Triangle pointing up
        ctx.beginPath();
        ctx.moveTo(0, -s); ctx.lineTo(-s * 0.7, s * 0.3); ctx.lineTo(s * 0.7, s * 0.3);
        ctx.closePath(); ctx.fillStyle = 'rgba(255,100,100,0.7)'; ctx.fill();
        break;

      case ComponentType.BlasterSmall:
      case ComponentType.BlasterMedium:
      case ComponentType.BlasterLarge: {
        // Barrel at top
        const bw = type === ComponentType.BlasterSmall ? 2
          : type === ComponentType.BlasterMedium ? 3 : 5;
        ctx.fillRect(-bw, -hs + 1, bw * 2, s * 1.2);
        break;
      }

      case ComponentType.Explosive:
        // Warning circle
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.55, 0, Math.PI * 2);
        ctx.stroke();
        break;

      case ComponentType.Radio:
        // Antenna lines
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.2); ctx.lineTo(-s * 0.6, -s);
        ctx.moveTo(0, -s * 0.2); ctx.lineTo(s * 0.6, -s);
        ctx.moveTo(0, -s * 0.2); ctx.lineTo(0, s * 0.4);
        ctx.stroke();
        break;

      case ComponentType.Hinge90:
      case ComponentType.Hinge180: {
        // Arc
        const arcAngle = type === ComponentType.Hinge90 ? Math.PI / 2 : Math.PI;
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.6, -Math.PI / 2 - arcAngle / 2, -Math.PI / 2 + arcAngle / 2);
        ctx.stroke();
        break;
      }
    }
  }

  private drawProjectile(ctx: CanvasRenderingContext2D, proj: Projectile) {
    const px = proj.x * PIXELS_PER_METER;
    const py = proj.y * PIXELS_PER_METER;
    const angle = Math.atan2(proj.vy, proj.vx);
    const halfW = (proj.width / 2) * PIXELS_PER_METER;
    const halfL = (proj.length / 2) * PIXELS_PER_METER;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);

    // Bolt glow
    ctx.shadowColor = proj.color;
    ctx.shadowBlur = 6;

    ctx.fillStyle = proj.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, halfL, halfW, 0, 0, Math.PI * 2);
    ctx.fill();

    // Bright core
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.ellipse(0, 0, halfL * 0.5, halfW * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  private drawExplosion(ctx: CanvasRenderingContext2D, exp: { x: number; y: number; radius: number; age: number; maxAge: number }) {
    const progress = exp.age / exp.maxAge;
    const px = exp.x * PIXELS_PER_METER;
    const py = exp.y * PIXELS_PER_METER;
    const currentRadius = exp.radius * (EXPLOSION_GLOW_RADIUS_MIN + progress * (EXPLOSION_GLOW_RADIUS_MAX - EXPLOSION_GLOW_RADIUS_MIN));
    const alpha = 1 - progress;

    ctx.save();

    // Outer glow
    const gradient = ctx.createRadialGradient(px, py, 0, px, py, currentRadius);
    gradient.addColorStop(0, `rgba(255, 255, 200, ${alpha})`);
    gradient.addColorStop(0.3, `rgba(255, 150, 50, ${alpha * 0.8})`);
    gradient.addColorStop(0.6, `rgba(255, 50, 20, ${alpha * 0.5})`);
    gradient.addColorStop(1, `rgba(100, 20, 10, 0)`);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(px, py, currentRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /** Draw countdown overlay */
  renderCountdown(sim: BattleSimulation) {
    if (!sim.isCountingDown) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Dim overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, w, h);

    const secondsLeft = sim.countdownRemaining;
    const text = secondsLeft > 0 ? String(secondsLeft) : 'FIGHT!';

    // Pulsing scale effect
    const frac = (sim.countdownTicks % 60) / 60;
    const scale = 1 + frac * 0.3;

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    ctx.font = 'bold 120px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#88ccff';
    ctx.shadowColor = '#88ccff';
    ctx.shadowBlur = 30;
    ctx.fillText(text, 0, 0);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  /** Draw HUD elements (minimap, direction indicators, velocity) — drawn in screen space */
  renderHUD(sim: BattleSimulation) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Speed / direction indicator (bottom-left)
    const playerShipHUD = sim.getPlayerShip();
    if (playerShipHUD) {
      const playerBodyHUD = sim.world.getRigidBody(playerShipHUD.bodyHandle);
      if (playerBodyHUD) {
        const vel = playerBodyHUD.linvel();
        const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);

        const indX = 70;
        const indY = h - 70;
        const indRadius = 40;

        // Background circle
        ctx.save();
        ctx.beginPath();
        ctx.arc(indX, indY, indRadius + 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Cross-hair lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.beginPath();
        ctx.moveTo(indX - indRadius, indY);
        ctx.lineTo(indX + indRadius, indY);
        ctx.moveTo(indX, indY - indRadius);
        ctx.lineTo(indX, indY + indRadius);
        ctx.stroke();

        // Velocity direction arrow (length proportional to speed, capped at indicator radius)
        if (speed > 0.3) {
          const maxDisplaySpeed = 20;
          const arrowLen = Math.min(indRadius, (speed / maxDisplaySpeed) * indRadius);
          const velAngle = Math.atan2(vel.y, vel.x);
          const tipX = indX + Math.cos(velAngle) * arrowLen;
          const tipY = indY + Math.sin(velAngle) * arrowLen;

          // Arrow line
          ctx.strokeStyle = '#88ccff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(indX, indY);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();

          // Arrow head
          const headLen = 6;
          const headAngle = 0.5;
          ctx.fillStyle = '#88ccff';
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(
            tipX - Math.cos(velAngle - headAngle) * headLen,
            tipY - Math.sin(velAngle - headAngle) * headLen,
          );
          ctx.lineTo(
            tipX - Math.cos(velAngle + headAngle) * headLen,
            tipY - Math.sin(velAngle + headAngle) * headLen,
          );
          ctx.closePath();
          ctx.fill();
        } else {
          // Stationary dot
          ctx.fillStyle = 'rgba(136, 204, 255, 0.5)';
          ctx.beginPath();
          ctx.arc(indX, indY, 3, 0, Math.PI * 2);
          ctx.fill();
        }

        // Speed text
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#88ccff';
        ctx.fillText(`${speed.toFixed(1)} m/s`, indX, indY + indRadius + 6);

        ctx.restore();
      }
    }

    // Minimap (bottom-right)
    const mmSize = MINIMAP_SIZE;
    const mmPad = 12;
    const mmX = w - mmSize - mmPad;
    const mmY = h - mmSize - mmPad;
    const mmRange = MINIMAP_RANGE * PIXELS_PER_METER;

    ctx.save();

    // Minimap background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.fillRect(mmX, mmY, mmSize, mmSize);
    ctx.strokeRect(mmX, mmY, mmSize, mmSize);

    // Draw dots for ships
    for (const ship of sim.ships) {
      const body = sim.world.getRigidBody(ship.bodyHandle);
      if (!body) continue;
      const pos = body.translation();

      const relX = (pos.x * PIXELS_PER_METER - this.cameraX) / mmRange;
      const relY = (pos.y * PIXELS_PER_METER - this.cameraY) / mmRange;

      if (Math.abs(relX) > 0.5 || Math.abs(relY) > 0.5) continue;

      const dotX = mmX + mmSize / 2 + relX * mmSize;
      const dotY = mmY + mmSize / 2 + relY * mmSize;

      ctx.fillStyle = ship.isPlayer ? '#88ccff' : '#ff6644';
      ctx.beginPath();
      ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // Direction indicators on screen edges for off-screen enemies
    for (const ship of sim.ships) {
      if (ship.isPlayer) continue;
      const hasCmd = ship.components.some(c => c.type === ComponentType.CommandModule && c.health > 0);
      if (!hasCmd) continue;

      const body = sim.world.getRigidBody(ship.bodyHandle);
      if (!body) continue;
      const pos = body.translation();

      const screenX = (pos.x * PIXELS_PER_METER - this.cameraX) * this.zoom + w / 2;
      const screenY = (pos.y * PIXELS_PER_METER - this.cameraY) * this.zoom + h / 2;

      // Only show indicator if off screen
      const margin = 40;
      if (screenX > margin && screenX < w - margin && screenY > margin && screenY < h - margin) continue;

      // Clamp to screen edge
      const cx = w / 2;
      const cy = h / 2;
      const angle = Math.atan2(screenY - cy, screenX - cx);
      const edgePad = 30;
      const indX = Math.max(edgePad, Math.min(w - edgePad, cx + Math.cos(angle) * (w / 2 - edgePad)));
      const indY = Math.max(edgePad, Math.min(h - edgePad, cy + Math.sin(angle) * (h / 2 - edgePad)));

      ctx.save();
      ctx.translate(indX, indY);
      ctx.rotate(angle);

      // Arrow with AI type color
      const aiType = ship.aiType;
      const arrowColor = aiType === 'shooter' ? '#ffaa33' : '#ff6644';
      ctx.fillStyle = arrowColor;
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-5, -7);
      ctx.lineTo(-5, 7);
      ctx.closePath();
      ctx.fill();

      // Small label
      ctx.rotate(-angle);
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = arrowColor;
      ctx.fillText(aiType === 'shooter' ? 'S' : 'R', 0, -12);

      ctx.restore();
    }
  }
}
