import { BattleSimulation, ShipState } from './BattleSimulation';
import {
  PIXELS_PER_METER, TILE_SIZE,
  MINIMAP_SIZE, MINIMAP_RANGE,
} from '../config/constants';
import { Side, ALL_SIDES } from '../types/components';
import { rotateSide } from '../types/grid';
import { sideOffset } from './systems/ConnectivitySystem';
import { CameraSystem } from './systems/CameraSystem';
import { getComponentDef } from '../game/components';
import { Projectile } from './entities/Projectile';
import { activeExplosions } from './systems/ExplosionSystem';
import { EXPLOSION_GLOW_RADIUS_MIN, EXPLOSION_GLOW_RADIUS_MAX } from '../config/display';
import {
  updateParticles, drawParticles,
  spawnFireParticles, spawnExplosionParticles,
} from './ParticleSystem';
import { hotkeyDisplayChar } from '../utils/hotkey-display';

interface Star { x: number; y: number; size: number; brightness: number; parallax: number; }
interface StarField { stars: Star[]; }

export class BattleRenderer {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private camera: CameraSystem | null = null;
  private starField: StarField;
  rotationLocked = true;
  private currentCameraAngle = 0;

  toggleRotationLock() {
    this.rotationLocked = !this.rotationLocked;
  }

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();

    // Generate two-layer star field: distant (slow parallax) + near (fast parallax)
    // spread/T are large so the field covers extreme zoom-out without repetition
    this.starField = { stars: [] };
    const spread = 50000;
    // Far layer — many small dim stars, slow parallax
    for (let i = 0; i < 6000; i++) {
      this.starField.stars.push({
        x: (Math.random() - 0.5) * spread,
        y: (Math.random() - 0.5) * spread,
        size: Math.random() * 1.2 + 0.3,
        brightness: Math.random() * 0.35 + 0.1,
        parallax: 0.08,
      });
    }
    // Near layer — fewer large bright stars, fast parallax (strong motion cue)
    for (let i = 0; i < 1200; i++) {
      this.starField.stars.push({
        x: (Math.random() - 0.5) * spread,
        y: (Math.random() - 0.5) * spread,
        size: Math.random() * 2.0 + 1.2,
        brightness: Math.random() * 0.5 + 0.5,
        parallax: 0.55,
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
    this.camera?.zoomIn();
  }

  zoomOut() {
    this.camera?.zoomOut();
  }

  adjustZoom(delta: number) {
    this.camera?.adjustZoom(delta);
  }

  render(sim: BattleSimulation, alpha: number) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Delegate camera to CameraSystem
    this.camera = sim.camera;
    this.camera.updateForRender(sim, alpha);

    // Clear
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, w, h);

    // Compute interpolated player rotation for rotation-lock mode
    let cameraAngle = 0;
    if (this.rotationLocked) {
      const playerShip = sim.getPlayerShip();
      if (playerShip) {
        const body = sim.world.getRigidBody(playerShip.bodyHandle);
        if (body) {
          const curAngle = body.rotation();
          const prevAngle = playerShip.prevAngle;
          let dAngle = curAngle - prevAngle;
          while (dAngle > Math.PI) dAngle -= 2 * Math.PI;
          while (dAngle < -Math.PI) dAngle += 2 * Math.PI;
          cameraAngle = prevAngle + dAngle * alpha;
        }
      }
    }
    this.currentCameraAngle = cameraAngle;

    ctx.save();

    // Camera transform: center screen, zoom, optional counter-rotation, then translate
    const cam = this.camera!;
    ctx.translate(w / 2, h / 2);
    ctx.scale(cam.zoom, cam.zoom);
    if (this.rotationLocked) ctx.rotate(-cameraAngle);
    ctx.translate(-cam.x, -cam.y);

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
    const cam = this.camera!;
    // Fixed tiling period matching the star spread — never changes with zoom
    const T = 50000;
    for (const star of this.starField.stars) {
      // Screen-space offset from camera centre, wrapped to [-T/2, T/2)
      const ox = ((( star.x - cam.x * (1 - star.parallax)) % T) + T) % T - T / 2;
      const oy = ((( star.y - cam.y * (1 - star.parallax)) % T) + T) % T - T / 2;
      // Convert back to world-space draw position
      const sx = ox + cam.x;
      const sy = oy + cam.y;
      ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness})`;
      ctx.beginPath();
      ctx.arc(sx, sy, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawShip(ctx: CanvasRenderingContext2D, sim: BattleSimulation, ship: ShipState, alpha: number) {
    // Build grid lookup from ALL living ship components (across all bodies)
    const compByGrid = new Map<string, ComponentInstance>();
    for (const c of ship.components) {
      if (c.health > 0) compByGrid.set(`${c.gridX},${c.gridY}`, c);
    }
    const shipGraph = sim.getConnectionGraph(ship.bodyHandle);

    // Group living components by bodyHandle
    const bodyGroups = new Map<number, typeof ship.components>();
    for (const comp of ship.components) {
      if (comp.health <= 0) continue;
      let group = bodyGroups.get(comp.bodyHandle);
      if (!group) {
        group = [];
        bodyGroups.set(comp.bodyHandle, group);
      }
      group.push(comp);
    }

    for (const [bodyHandle, comps] of bodyGroups) {
      const body = sim.world.getRigidBody(bodyHandle);
      if (!body) continue;

      const curPos = body.translation();
      const curAngle = body.rotation();

      // Look up per-body interpolation state, fall back to ship-level for primary body
      const interpState = ship.bodyInterp?.get(bodyHandle);
      const prevPos = interpState?.prevPos ??
        (bodyHandle === ship.bodyHandle ? ship.prevPosition : { x: curPos.x, y: curPos.y });
      const prevAngle = interpState?.prevAngle ??
        (bodyHandle === ship.bodyHandle ? ship.prevAngle : curAngle);

      // Interpolate between previous and current state
      const ix = prevPos.x + (curPos.x - prevPos.x) * alpha;
      const iy = prevPos.y + (curPos.y - prevPos.y) * alpha;
      let dAngle = curAngle - prevAngle;
      while (dAngle > Math.PI) dAngle -= 2 * Math.PI;
      while (dAngle < -Math.PI) dAngle += 2 * Math.PI;
      const iAngle = prevAngle + dAngle * alpha;

      ctx.save();
      ctx.translate(ix * PIXELS_PER_METER, iy * PIXELS_PER_METER);
      ctx.rotate(iAngle);

    for (const comp of comps) {
      const collider = sim.world.getCollider(comp.colliderHandle);
      if (!collider) continue;

      const def = getComponentDef(comp.type);

      // Get local offset (relative to body)
      const collWorld = collider.translation();
      const bodyWorld = body.translation();
      const bodyAngle = body.rotation();
      const dxW = collWorld.x - bodyWorld.x;
      const dyW = collWorld.y - bodyWorld.y;
      const cosA = Math.cos(-bodyAngle);
      const sinA = Math.sin(-bodyAngle);
      const localX = dxW * cosA - dyW * sinA;
      const localY = dxW * sinA + dyW * cosA;
      const cx = localX * PIXELS_PER_METER;
      const cy = localY * PIXELS_PER_METER;
      const halfSize = (TILE_SIZE / 2) * PIXELS_PER_METER;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(comp.rotation * Math.PI / 2);

      // Draw component body
      const isCircle = def.colliderShape === 'circle';
      ctx.fillStyle = def.color;
      ctx.globalAlpha = 0.85;

      const teamColor = ship.isPlayer ? '#88ccff' : '#ff6644';

      if (isCircle) {
        ctx.beginPath();
        ctx.arc(0, 0, halfSize - 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = teamColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.strokeStyle = ship.isPlayer ? 'rgba(136,204,255,0.25)' : 'rgba(255,102,68,0.25)';
        ctx.strokeRect(-halfSize + 1, -halfSize + 1, halfSize * 2 - 2, halfSize * 2 - 2);
      } else {
        ctx.fillRect(-halfSize + 1, -halfSize + 1, halfSize * 2 - 2, halfSize * 2 - 2);

        // Selective borders: skip border on sides with active connected neighbors (visual merge)
        ctx.strokeStyle = teamColor;
        ctx.lineWidth = 1.5;
        const b = halfSize - 1; // border inset
        for (const side of ALL_SIDES) {
          const worldSide = rotateSide(side, comp.rotation);
          const off = sideOffset(worldSide);
          const neighbor = compByGrid.get(`${comp.gridX + off.dx},${comp.gridY + off.dy}`);
          const hasActiveNeighbor = neighbor && neighbor !== comp
            && shipGraph?.hasActiveEdge(comp.id, neighbor.id);

          if (!hasActiveNeighbor) {
            ctx.beginPath();
            switch (side) {
              case Side.North: ctx.moveTo(-b, -b); ctx.lineTo(b, -b); break;
              case Side.South: ctx.moveTo(-b, b); ctx.lineTo(b, b); break;
              case Side.East:  ctx.moveTo(b, -b); ctx.lineTo(b, b); break;
              case Side.West:  ctx.moveTo(-b, -b); ctx.lineTo(-b, b); break;
            }
            ctx.stroke();
          }
        }
      }

      ctx.globalAlpha = 1;

      // Component type decoration
      def.drawDecoration?.(ctx, halfSize, comp);

      // Damage flash
      if (comp.lastDamageTick !== undefined) {
        const ticksSince = sim.tickCount - comp.lastDamageTick;
        if (ticksSince < 30) {
          const flashAlpha = 0.6 * (1 - ticksSince / 30) * (0.5 + 0.5 * Math.sin(ticksSince * 0.6));
          ctx.fillStyle = `rgba(255, 50, 50, ${flashAlpha})`;
          if (isCircle) {
            ctx.beginPath();
            ctx.arc(0, 0, halfSize - 1, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillRect(-halfSize + 1, -halfSize + 1, halfSize * 2 - 2, halfSize * 2 - 2);
          }
        }
      }

      // Damage visualization
      const healthPct = comp.health / comp.maxHealth;
      if (healthPct < 1) {
        const damageAlpha = (1 - healthPct) * 0.6;
        ctx.fillStyle = `rgba(255, 0, 0, ${damageAlpha})`;
        if (isCircle) {
          ctx.beginPath();
          ctx.arc(0, 0, halfSize - 1, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-halfSize + 1, -halfSize + 1, halfSize * 2 - 2, halfSize * 2 - 2);
        }

        const damagePct = 1 - healthPct;
        const crackCount = Math.floor(damagePct * 10);
        ctx.strokeStyle = `rgba(255, 100, 100, ${0.3 + damagePct * 0.5})`;
        ctx.lineWidth = 1;
        const crackSeeds = [
          [-0.5, -0.3, 0.2, 0.4], [0.3, -0.5, -0.1, 0.6],
          [-0.6, 0.1, 0.5, -0.2], [-0.3, -0.6, 0.4, 0.3],
          [0.5, -0.4, -0.2, 0.5], [-0.4, 0.5, 0.6, -0.1],
          [0.2, -0.2, -0.5, 0.6], [-0.6, -0.5, 0.3, 0.1],
          [0.4, 0.2, -0.3, -0.4], [-0.1, 0.6, 0.5, -0.6],
        ];
        for (let ci = 0; ci < crackCount && ci < crackSeeds.length; ci++) {
          const [x1, y1, x2, y2] = crackSeeds[ci];
          ctx.beginPath();
          ctx.moveTo(halfSize * x1, halfSize * y1);
          ctx.lineTo(halfSize * x2, halfSize * y2);
          ctx.stroke();
        }

        if (healthPct < 0.3) {
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

      // Type-specific active effects (engine exhaust, blaster recoil, explosive glow, decoupler dots/particles)
      def.drawEffect?.(ctx, halfSize, comp, sim);

      // Disconnected edge glow — orange/amber line on any adjacent edge
      // that has no active connection (severed, decoupled, non-attachable, or cross-body)
      if (shipGraph) {
        for (const side of ALL_SIDES) {
          const worldSide = rotateSide(side, comp.rotation);
          const off = sideOffset(worldSide);
          const neighbor = compByGrid.get(`${comp.gridX + off.dx},${comp.gridY + off.dy}`);
          if (neighbor && neighbor !== comp && !shipGraph.hasActiveEdge(comp.id, neighbor.id)) {
            drawDisconnectedEdgeGlow(ctx, halfSize, side);
          }
        }
      }

      // Hotkey labels
      if (comp.owner === 'player') {
        if (def.drawHotkeyLabel) {
          def.drawHotkeyLabel(ctx, halfSize, comp);
        } else if (comp.hotkey) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(-8, -8, 16, 14);
          ctx.fillStyle = '#fff';
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(hotkeyDisplayChar(comp.hotkey), 0, 0);
        }
      }

      ctx.restore();
    }

    ctx.restore(); // body group transform
    } // end body group loop
  }


  private drawProjectile(ctx: CanvasRenderingContext2D, proj: Projectile) {
    const px = proj.x * PIXELS_PER_METER;
    const py = proj.y * PIXELS_PER_METER;
    const angle = Math.atan2(proj.dirY, proj.dirX);
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
          const velAngle = Math.atan2(vel.y, vel.x) - (this.rotationLocked ? this.currentCameraAngle : 0);
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

    // Clip dots to minimap square
    ctx.beginPath();
    ctx.rect(mmX, mmY, mmSize, mmSize);
    ctx.clip();

    // Rotate around minimap centre when rotation-locked
    const mmCx = mmX + mmSize / 2;
    const mmCy = mmY + mmSize / 2;
    ctx.translate(mmCx, mmCy);
    if (this.rotationLocked) ctx.rotate(-this.currentCameraAngle);

    // Draw dots for ships (coordinates relative to minimap centre)
    for (const ship of sim.ships) {
      const body = sim.world.getRigidBody(ship.bodyHandle);
      if (!body) continue;
      const pos = body.translation();

      const relX = (pos.x * PIXELS_PER_METER - this.camera!.x) / mmRange;
      const relY = (pos.y * PIXELS_PER_METER - this.camera!.y) / mmRange;

      if (Math.abs(relX) > 0.5 || Math.abs(relY) > 0.5) continue;

      ctx.fillStyle = ship.isPlayer ? '#88ccff' : '#ff6644';
      ctx.beginPath();
      ctx.arc(relX * mmSize, relY * mmSize, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // Direction indicators on screen edges for off-screen enemies
    for (const ship of sim.ships) {
      if (ship.isPlayer) continue;
      const hasCmd = ship.components.some(c => getComponentDef(c.type).isConnectivityAnchor && c.health > 0);
      if (!hasCmd) continue;

      const body = sim.world.getRigidBody(ship.bodyHandle);
      if (!body) continue;
      const pos = body.translation();

      const cx = w / 2;
      const cy = h / 2;

      // World→screen, then apply camera counter-rotation if locked
      let relX = (pos.x * PIXELS_PER_METER - this.camera!.x) * this.camera!.zoom;
      let relY = (pos.y * PIXELS_PER_METER - this.camera!.y) * this.camera!.zoom;
      if (this.rotationLocked) {
        const cos = Math.cos(-this.currentCameraAngle);
        const sin = Math.sin(-this.currentCameraAngle);
        const rx = relX * cos - relY * sin;
        const ry = relX * sin + relY * cos;
        relX = rx; relY = ry;
      }
      const screenX = cx + relX;
      const screenY = cy + relY;

      // Only show indicator if off screen
      const margin = 40;
      if (screenX > margin && screenX < w - margin && screenY > margin && screenY < h - margin) continue;

      // Clamp to screen edge
      const angle = Math.atan2(relY, relX);
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

/** Draw a semi-transparent orange/amber glow on a disconnected edge.
 *  Drawn in component-local space (pre-rotation already applied). */
function drawDisconnectedEdgeGlow(ctx: CanvasRenderingContext2D, halfSize: number, side: Side) {
  const glowWidth = 3;
  const edgeInset = 1;
  ctx.save();

  // Position and orient the glow line based on side
  let x: number, y: number, w: number, h: number;
  switch (side) {
    case Side.North:
      x = -halfSize + edgeInset; y = -halfSize; w = (halfSize - edgeInset) * 2; h = glowWidth;
      break;
    case Side.South:
      x = -halfSize + edgeInset; y = halfSize - glowWidth; w = (halfSize - edgeInset) * 2; h = glowWidth;
      break;
    case Side.East:
      x = halfSize - glowWidth; y = -halfSize + edgeInset; w = glowWidth; h = (halfSize - edgeInset) * 2;
      break;
    case Side.West:
      x = -halfSize; y = -halfSize + edgeInset; w = glowWidth; h = (halfSize - edgeInset) * 2;
      break;
  }

  // Soft glow
  ctx.shadowColor = 'rgba(255, 180, 50, 0.6)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = 'rgba(255, 160, 30, 0.5)';
  ctx.fillRect(x, y, w, h);

  // Bright core
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255, 200, 80, 0.7)';
  const coreInset = 0.5;
  if (side === Side.North || side === Side.South) {
    ctx.fillRect(x + coreInset, y + coreInset, w - coreInset * 2, h - coreInset * 2);
  } else {
    ctx.fillRect(x + coreInset, y + coreInset, w - coreInset * 2, h - coreInset * 2);
  }

  ctx.restore();
}
