import RAPIER from '@dimforge/rapier2d-compat';
import { ShipBlueprint } from '../types/physics';
import { ComponentType, Side } from '../types/components';
import { getComponentDef } from '../game/components';
import { ComponentInstance, createComponentInstance } from './entities/ComponentInstance';
import { InputManager } from './InputManager';
import { TILE_SIZE, STARTING_DIST, BATTLE_COUNTDOWN_SECONDS, COLLIDER_MARGIN } from '../config/constants';
import { detectAndSplitDisconnected } from './systems/DestructionSystem';
import { updateRammerAI, updateShooterAI, AIType } from './systems/AISystem';
import { Projectile } from './entities/Projectile';
import { processBlasterFire, updateProjectiles } from './systems/ProjectileSystem';
import { detonateExplosive } from './systems/ExplosionSystem';
import { runDamagePhase } from './systems/DamagePhaseSystem';
import { checkWinLoss } from './systems/WinLossSystem';
import { BattleLog } from './BattleLog';
import { HingeJoint, processHingeInput, updateHingeLocks } from './systems/HingeSystem';
import { DecouplerState, processDecouplerInput, processDecouplerAttraction, processDecouplerDocking, buildDecouplerSides } from './systems/DecouplerSystem';
import { DeterministicRng } from './DeterministicRng';
import { ConnectionGraph } from './systems/ConnectionGraph';
import { sideOffset } from './systems/ConnectivitySystem';
import { CameraSystem } from './systems/CameraSystem';

export interface ShipState {
  bodyHandle: number;
  components: ComponentInstance[];
  isPlayer: boolean;
  aiType?: AIType;
  prevPosition: { x: number; y: number };
  prevAngle: number;
  /** Previous center of mass (world-space) for camera interpolation */
  prevCom?: { x: number; y: number };
  /** Per-body interpolation state for multi-body (hinged) ships */
  bodyInterp?: Map<number, { prevPos: { x: number; y: number }; prevAngle: number }>;
}

export class BattleSimulation {
  world: RAPIER.World;
  eventQueue: RAPIER.EventQueue;
  ships: ShipState[] = [];
  colliderToComponent = new Map<number, ComponentInstance>();
  colliderToShip = new Map<number, ShipState>();
  projectiles: Projectile[] = [];
  private input: InputManager;
  tickCount = 0;
  gameOver = false;
  winner: 'player' | 'enemy' | 'draw' | null = null;
  battleLog = new BattleLog();
  countdownTicks = 0;
  countdownTotal = 0;
  hingeJoints: HingeJoint[] = [];
  sameShipContactPairs = new Set<string>();
  /** Body handles currently involved in at least one same-ship contact (ref-counted) */
  sameShipContactBodies = new Map<number, number>();
  decouplers: DecouplerState[] = [];
  /** FixedJoints created for latched decoupler edges between hinge sections */
  decouplerJoints: Array<{ jointHandle: number; compId: string; side: Side }> = [];
  /** Hinge joints locked because they form kinematic loops with decoupler FixedJoints */
  lockedHingeHandles = new Set<number>();
  rng = new DeterministicRng();
  /** Persistent connection graphs keyed by bodyHandle (for hinged ships, primary body handle) */
  connectionGraphs = new Map<number, ConnectionGraph>();
  camera = new CameraSystem();
  /** When a ship's body is destroyed/gone, maps its bodyHandle → the bodyHandle that killed it */
  killerChain = new Map<number, number>();

  constructor(input: InputManager) {
    this.input = input;
    this.world = new RAPIER.World({ x: 0, y: 0 });
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  init(playerBlueprint: ShipBlueprint, enemyBlueprints: Array<{ blueprint: ShipBlueprint; aiType: AIType }>) {
    this.spawnShip(playerBlueprint, 0, 0, true);

    const enemyCount = enemyBlueprints.length;
    for (let i = 0; i < enemyCount; i++) {
      const angle = (2 * Math.PI * i) / Math.max(enemyCount, 1);
      const x = Math.cos(angle) * STARTING_DIST;
      const y = Math.sin(angle) * STARTING_DIST;
      const ship = this.spawnShip(enemyBlueprints[i].blueprint, x, y, false);
      ship.aiType = enemyBlueprints[i].aiType;
    }

    // Split any Radio-only sections off as drones (they may have been included
    // in the blueprint via build-phase BFS from Radio, but aren't connected to CM)
    for (const ship of [...this.ships]) {
      detectAndSplitDisconnected(this, ship);
    }

    // Setup countdown (3 seconds at 60fps)
    this.countdownTotal = BATTLE_COUNTDOWN_SECONDS * 60;
    this.countdownTicks = this.countdownTotal;
  }

  private spawnShip(blueprint: ShipBlueprint, offsetX: number, offsetY: number, isPlayer: boolean): ShipState {
    // Check if ship contains any hinge components
    const hingeComps = blueprint.components.filter(
      c => getComponentDef(c.type as ComponentType).colliderShape === 'circle'
    );

    if (hingeComps.length === 0) {
      return this.spawnSimpleShip(blueprint, offsetX, offsetY, isPlayer);
    }

    return this.spawnHingedShip(blueprint, offsetX, offsetY, isPlayer, hingeComps);
  }

  private spawnSimpleShip(blueprint: ShipBlueprint, offsetX: number, offsetY: number, isPlayer: boolean): ShipState {
    const cx = blueprint.components.reduce((s, c) => s + c.gridX, 0) / blueprint.components.length;
    const cy = blueprint.components.reduce((s, c) => s + c.gridY, 0) / blueprint.components.length;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(offsetX, offsetY)
      .setAngularDamping(0)
      .setLinearDamping(0)
      .setCanSleep(false);
    const body = this.world.createRigidBody(bodyDesc);

    const owner = isPlayer ? 'player' as const : 'ai' as const;
    const components: ComponentInstance[] = [];

    for (const comp of blueprint.components) {
      const def = getComponentDef(comp.type as ComponentType);
      const localX = (comp.gridX - cx) * TILE_SIZE;
      const localY = (comp.gridY - cy) * TILE_SIZE;

      const colliderDesc = RAPIER.ColliderDesc.cuboid(TILE_SIZE / 2 - COLLIDER_MARGIN, TILE_SIZE / 2 - COLLIDER_MARGIN)
        .setTranslation(localX, localY)
        .setDensity(def.mass)
        .setFriction(0)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

      const collider = this.world.createCollider(colliderDesc, body);

      const instance = createComponentInstance(
        comp.id,
        comp.type as ComponentType,
        comp.gridX,
        comp.gridY,
        comp.rotation,
        collider.handle,
        body.handle,
        owner,
        comp.hotkey,
        comp.hotkeys,
        comp.hotkeyPriority,
        comp.enabledSides,
        comp.hingeStartAngle,
      );

      components.push(instance);
      this.colliderToComponent.set(collider.handle, instance);

      if (getComponentDef(comp.type as ComponentType).config.kind === 'decoupler') {
        this.decouplers.push({
          compId: comp.id,
          bodyHandle: body.handle,
          sides: buildDecouplerSides(comp.rotation, comp.hotkeys, comp.hotkey),
        });
      }
    }

    components.sort((a, b) => (a.hotkeyPriority ?? 0) - (b.hotkeyPriority ?? 0));

    // Build connection graph from unlatched decoupler sides
    const unlatchedSides = new Map<string, import('../types/components').Side[]>();
    for (const dc of this.decouplers) {
      if (!components.some(c => c.id === dc.compId)) continue;
      const sides = dc.sides.filter(s => s.mode !== 'latched').map(s => s.side);
      if (sides.length > 0) unlatchedSides.set(dc.compId, sides);
    }
    const graph = ConnectionGraph.fromComponents(components, unlatchedSides);
    this.connectionGraphs.set(body.handle, graph);

    const ship: ShipState = {
      bodyHandle: body.handle,
      components,
      isPlayer,
      prevPosition: { x: offsetX, y: offsetY },
      prevAngle: 0,
      bodyInterp: new Map([[body.handle, { prevPos: { x: offsetX, y: offsetY }, prevAngle: 0 }]]),
    };

    for (const comp of components) {
      this.colliderToShip.set(comp.colliderHandle, ship);
    }

    this.ships.push(ship);
    return ship;
  }

  private spawnHingedShip(
    blueprint: ShipBlueprint,
    offsetX: number,
    offsetY: number,
    isPlayer: boolean,
    hingeComps: typeof blueprint.components,
  ): ShipState {
    const hingeIds = new Set(hingeComps.map(c => c.id));
    const compById = new Map(blueprint.components.map(c => [c.id, c]));

    const visited = new Set<string>();
    const sections: Array<{ comps: typeof blueprint.components; sectionId: number }> = [];

    // Build set of directed edges blocked by latchable decoupler sides.
    // These edges create section boundaries (like hinges) so that decoupling
    // can later release a FixedJoint instead of trying to restructure bodies.
    const blockedEdges = new Set<string>();
    for (const comp of blueprint.components) {
      if (comp.type !== ComponentType.Decoupler) continue;
      const sides = buildDecouplerSides(comp.rotation, comp.hotkeys, comp.hotkey);
      for (const sideState of sides) {
        if (!sideState.hotkey) continue; // No hotkey = permanent connection, don't block
        const off = sideOffset(sideState.side);
        const neighbor = blueprint.components.find(
          c => c.gridX === comp.gridX + off.dx && c.gridY === comp.gridY + off.dy,
        );
        if (neighbor) {
          blockedEdges.add(`${comp.id}|${neighbor.id}`);
          blockedEdges.add(`${neighbor.id}|${comp.id}`);
        }
      }
    }

    const cmdComp = blueprint.components.find(c => c.type === ComponentType.CommandModule);
    const startOrder = cmdComp
      ? [cmdComp, ...blueprint.components.filter(c => c !== cmdComp)]
      : blueprint.components;

    for (const start of startOrder) {
      if (visited.has(start.id) || hingeIds.has(start.id)) continue;
      const section: typeof blueprint.components = [];
      const queue = [start.id];
      visited.add(start.id);

      while (queue.length > 0) {
        const id = queue.shift()!;
        const comp = compById.get(id)!;
        section.push(comp);

        for (const neighborId of blueprint.adjacency[id] ?? []) {
          if (visited.has(neighborId)) continue;
          if (hingeIds.has(neighborId)) continue;
          if (blockedEdges.has(`${id}|${neighborId}`)) continue;
          visited.add(neighborId);
          queue.push(neighborId);
        }
      }

      if (section.length > 0) {
        sections.push({ comps: section, sectionId: sections.length });
      }
    }

    const allComps = blueprint.components;
    const gcx = allComps.reduce((s, c) => s + c.gridX, 0) / allComps.length;
    const gcy = allComps.reduce((s, c) => s + c.gridY, 0) / allComps.length;

    const owner = isPlayer ? 'player' as const : 'ai' as const;
    const allComponents: ComponentInstance[] = [];
    const sectionBodies: Array<{ body: RAPIER.RigidBody; comps: typeof blueprint.components; centroidX: number; centroidY: number }> = [];

    for (const section of sections) {
      // Compute this section's own centroid (grid coords)
      const secCx = section.comps.reduce((s, c) => s + c.gridX, 0) / section.comps.length;
      const secCy = section.comps.reduce((s, c) => s + c.gridY, 0) / section.comps.length;

      // Position body at world offset + section centroid relative to global centroid
      const bodyX = offsetX + (secCx - gcx) * TILE_SIZE;
      const bodyY = offsetY + (secCy - gcy) * TILE_SIZE;

      const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(bodyX, bodyY)
        .setAngularDamping(0)
        .setLinearDamping(0)
        .setCanSleep(false);
      const body = this.world.createRigidBody(bodyDesc);

      for (const comp of section.comps) {
        const def = getComponentDef(comp.type as ComponentType);
        // Collider offset relative to section centroid (not global centroid)
        const localX = (comp.gridX - secCx) * TILE_SIZE;
        const localY = (comp.gridY - secCy) * TILE_SIZE;

        const colliderDesc = RAPIER.ColliderDesc.cuboid(TILE_SIZE / 2 - COLLIDER_MARGIN, TILE_SIZE / 2 - COLLIDER_MARGIN)
          .setTranslation(localX, localY)
          .setDensity(def.mass)
          .setFriction(0)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

        const collider = this.world.createCollider(colliderDesc, body);

        const instance = createComponentInstance(
          comp.id,
          comp.type as ComponentType,
          comp.gridX,
          comp.gridY,
          comp.rotation,
          collider.handle,
          body.handle,
          owner,
          comp.hotkey,
          comp.hotkeys,
          comp.hotkeyPriority,
          comp.enabledSides,
          comp.hingeStartAngle,
        );

        allComponents.push(instance);
        this.colliderToComponent.set(collider.handle, instance);

        if (getComponentDef(comp.type as ComponentType).config.kind === 'decoupler') {
          this.decouplers.push({
            compId: comp.id,
            bodyHandle: body.handle,
            sides: buildDecouplerSides(comp.rotation, comp.hotkeys, comp.hotkey),
          });
        }
      }

      sectionBodies.push({ body, comps: section.comps, centroidX: secCx, centroidY: secCy });
    }

    // ===== HINGE CHAIN PROCESSING =====
    // Tracks intermediate bodies created for multi-hinge chains
    const allIntermediateBodies: RAPIER.RigidBody[] = [];

    // Build hinge-to-hinge adjacency
    const hingeAdj = new Map<string, string[]>();
    for (const hc of hingeComps) {
      const neighbors: string[] = [];
      for (const nid of blueprint.adjacency[hc.id] ?? []) {
        if (hingeIds.has(nid)) neighbors.push(nid);
      }
      hingeAdj.set(hc.id, neighbors);
    }

    // Find connected components (chains) among hinges
    const chainVisited = new Set<string>();
    const hingeChainGroups: string[][] = [];
    for (const hc of hingeComps) {
      if (chainVisited.has(hc.id)) continue;
      const chain: string[] = [];
      const q = [hc.id];
      chainVisited.add(hc.id);
      while (q.length > 0) {
        const id = q.shift()!;
        chain.push(id);
        for (const nid of hingeAdj.get(id) ?? []) {
          if (!chainVisited.has(nid)) {
            chainVisited.add(nid);
            q.push(nid);
          }
        }
      }
      hingeChainGroups.push(chain);
    }

    // Map component id → section index
    const compToSection = new Map<string, number>();
    for (let si = 0; si < sectionBodies.length; si++) {
      for (const c of sectionBodies[si].comps) compToSection.set(c.id, si);
    }

    // Helper: attach a hinge as a ball collider on a body
    const attachHingeCollider = (hc: typeof hingeComps[0], body: RAPIER.RigidBody, cxGrid: number, cyGrid: number) => {
      const def = getComponentDef(hc.type as ComponentType);
      const lx = (hc.gridX - cxGrid) * TILE_SIZE;
      const ly = (hc.gridY - cyGrid) * TILE_SIZE;
      const cd = RAPIER.ColliderDesc.ball(TILE_SIZE / 2)
        .setTranslation(lx, ly).setDensity(def.mass).setFriction(0)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const col = this.world.createCollider(cd, body);
      const inst = createComponentInstance(
        hc.id, hc.type as ComponentType, hc.gridX, hc.gridY, hc.rotation,
        col.handle, body.handle, owner, hc.hotkey, hc.hotkeys,
        undefined, hc.enabledSides, hc.hingeStartAngle,
      );
      allComponents.push(inst);
      this.colliderToComponent.set(col.handle, inst);
    };

    // Coordinate helpers
    const localToWorld = (body: RAPIER.RigidBody, lx: number, ly: number) => {
      const p = body.translation(); const a = body.rotation();
      return { x: p.x + lx * Math.cos(a) - ly * Math.sin(a), y: p.y + lx * Math.sin(a) + ly * Math.cos(a) };
    };
    const worldToLocal = (body: RAPIER.RigidBody, wx: number, wy: number) => {
      const p = body.translation(); const a = -body.rotation();
      const dx = wx - p.x, dy = wy - p.y;
      return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
    };
    const rotateBodyAround = (body: RAPIER.RigidBody, px: number, py: number, angle: number) => {
      const pos = body.translation();
      const dx = pos.x - px, dy = pos.y - py;
      const c = Math.cos(angle), s = Math.sin(angle);
      body.setTranslation({ x: px + dx * c - dy * s, y: py + dx * s + dy * c }, true);
      body.setRotation(body.rotation() + angle, true);
    };
    const getStartAngle = (hc: typeof hingeComps[0]) => {
      const step = hc.hingeStartAngle ?? 0;
      const hDef = getComponentDef(hc.type as ComponentType);
      if (hDef.config.kind === 'hinge') {
        const steps = hDef.config.startAngleSteps;
        if (steps === 2) return [0, Math.PI / 2][step % 2];
        return [0, Math.PI / 2, -Math.PI / 2][step % 3];
      }
      return 0;
    };

    // Process each chain
    for (const chain of hingeChainGroups) {
      // Find section neighbors for each hinge in the chain
      const hingeSectionAdj = new Map<string, number[]>();
      for (const hid of chain) {
        const secs: number[] = [];
        for (const nid of blueprint.adjacency[hid] ?? []) {
          const si = compToSection.get(nid);
          if (si !== undefined && !secs.includes(si)) secs.push(si);
        }
        hingeSectionAdj.set(hid, secs);
      }

      // Collect section endpoints
      const endpoints: Array<{ hingeId: string; si: number }> = [];
      for (const hid of chain) {
        for (const si of hingeSectionAdj.get(hid) ?? []) {
          endpoints.push({ hingeId: hid, si });
        }
      }
      const uniqueSecs = new Set(endpoints.map(e => e.si));

      if (uniqueSecs.size < 2) {
        // Not bridging two sections — attach all as colliders on the nearest section
        const fallbackSi = endpoints[0]?.si ?? 0;
        const sec = sectionBodies[fallbackSi];
        for (const hid of chain) {
          attachHingeCollider(compById.get(hid)!, sec.body, sec.centroidX, sec.centroidY);
        }
        continue;
      }

      // Pick two section endpoints
      const secAIdx = endpoints[0].si;
      const secBIdx = endpoints.find(e => e.si !== secAIdx)!.si;
      const startHingeId = endpoints.find(e => e.si === secAIdx)!.hingeId;

      // Order hinges from section A → section B by traversing hinge adjacency
      const ordered: string[] = [];
      const oVisited = new Set<string>([startHingeId]);
      const oq = [startHingeId];
      while (oq.length > 0) {
        const hid = oq.shift()!;
        ordered.push(hid);
        for (const nid of hingeAdj.get(hid) ?? []) {
          if (!oVisited.has(nid)) { oVisited.add(nid); oq.push(nid); }
        }
      }

      const N = ordered.length;
      const secA = sectionBodies[secAIdx];
      const secB = sectionBodies[secBIdx];

      if (N === 1) {
        // === Single hinge — same as previous behavior ===
        const hc = compById.get(ordered[0])!;
        const bodyA = secA.body;
        const bodyB = secB.body;
        const anchorAX = (hc.gridX - secA.centroidX) * TILE_SIZE;
        const anchorAY = (hc.gridY - secA.centroidY) * TILE_SIZE;
        const anchorBX = (hc.gridX - secB.centroidX) * TILE_SIZE;
        const anchorBY = (hc.gridY - secB.centroidY) * TILE_SIZE;
        const hcDef = getComponentDef(hc.type as ComponentType);
        const maxAngle = hcDef.config.kind === 'hinge' ? hcDef.config.maxAngle : Math.PI / 2;
        const startAngle = getStartAngle(hc);

        if (startAngle !== 0) {
          const hw = localToWorld(bodyA, anchorAX, anchorAY);
          rotateBodyAround(bodyB, hw.x, hw.y, startAngle);
        }

        const cosB = Math.cos(-startAngle);
        const sinB = Math.sin(-startAngle);
        const rotAnchorBX = anchorBX * cosB - anchorBY * sinB;
        const rotAnchorBY = anchorBX * sinB + anchorBY * cosB;

        const jp = RAPIER.JointData.revolute({ x: anchorAX, y: anchorAY }, { x: rotAnchorBX, y: rotAnchorBY });
        const joint = this.world.createImpulseJoint(jp, bodyA, bodyB, true);
        (joint as RAPIER.RevoluteImpulseJoint).setLimits(-maxAngle / 2, maxAngle / 2);

        attachHingeCollider(hc, bodyA, secA.centroidX, secA.centroidY);

        this.hingeJoints.push({
          jointHandle: joint.handle, hingeCompId: hc.id,
          hotkeyLeft: hc.hotkey, hotkeyRight: hc.hotkeys?.[0],
          bodyAHandle: bodyA.handle, bodyBHandle: bodyB.handle,
          maxAngle, setpoint: startAngle,
        });
      } else {
        // === N ≥ 2: create N-1 intermediate bodies forming an articulated chain ===
        // Topology: SecA ←(H0)→ mid[0] ←(H1)→ mid[1] ... mid[N-2] ←(H[N-1])→ SecB
        // H[i] collider lives on the left body; intermediate[k] is at hinge[k+1]'s position.
        const intermediates: RAPIER.RigidBody[] = [];
        for (let k = 0; k < N - 1; k++) {
          const hc = compById.get(ordered[k + 1])!;
          const bx = offsetX + (hc.gridX - gcx) * TILE_SIZE;
          const by = offsetY + (hc.gridY - gcy) * TILE_SIZE;
          const bd = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(bx, by).setAngularDamping(0).setLinearDamping(0).setCanSleep(false);
          intermediates.push(this.world.createRigidBody(bd));
        }
        allIntermediateBodies.push(...intermediates);

        // Apply start angles cumulatively left-to-right:
        // For hinge[i], rotate all bodies to its right around the hinge's world position.
        for (let i = 0; i < N; i++) {
          const hc = compById.get(ordered[i])!;
          const sa = getStartAngle(hc);
          if (sa === 0) continue;

          const leftBody = i === 0 ? secA.body : intermediates[i - 1];
          // Anchor of hinge[i] on its left body in local coords
          const anchorLocal = i === 0
            ? { x: (hc.gridX - secA.centroidX) * TILE_SIZE, y: (hc.gridY - secA.centroidY) * TILE_SIZE }
            : { x: 0, y: 0 }; // intermediate[i-1] is centered at hinge[i]'s position
          const hw = localToWorld(leftBody, anchorLocal.x, anchorLocal.y);

          // Rotate all bodies to the right of this hinge
          for (let j = i; j < N - 1; j++) rotateBodyAround(intermediates[j], hw.x, hw.y, sa);
          rotateBodyAround(secB.body, hw.x, hw.y, sa);
        }

        // Create revolute joints and attach hinge colliders
        for (let i = 0; i < N; i++) {
          const hc = compById.get(ordered[i])!;
          const hcDef = getComponentDef(hc.type as ComponentType);
        const maxAngle = hcDef.config.kind === 'hinge' ? hcDef.config.maxAngle : Math.PI / 2;
          const sa = getStartAngle(hc);

          const leftBody = i === 0 ? secA.body : intermediates[i - 1];
          const rightBody = i === N - 1 ? secB.body : intermediates[i];

          // Anchor on left body (body-local)
          const anchorLeft = i === 0
            ? { x: (hc.gridX - secA.centroidX) * TILE_SIZE, y: (hc.gridY - secA.centroidY) * TILE_SIZE }
            : { x: 0, y: 0 };

          // Anchor on right body: transform hinge world pos into right body's local frame
          const hw = localToWorld(leftBody, anchorLeft.x, anchorLeft.y);
          const anchorRight = worldToLocal(rightBody, hw.x, hw.y);

          const jp = RAPIER.JointData.revolute(anchorLeft, anchorRight);
          const joint = this.world.createImpulseJoint(jp, leftBody, rightBody, true);
          (joint as RAPIER.RevoluteImpulseJoint).setLimits(-maxAngle / 2, maxAngle / 2);

          // Hinge collider on the left body
          if (i === 0) {
            attachHingeCollider(hc, leftBody, secA.centroidX, secA.centroidY);
          } else {
            // intermediate[i-1] is centered at hinge[i]'s grid position
            attachHingeCollider(hc, leftBody, hc.gridX, hc.gridY);
          }

          this.hingeJoints.push({
            jointHandle: joint.handle, hingeCompId: hc.id,
            hotkeyLeft: hc.hotkey, hotkeyRight: hc.hotkeys?.[0],
            bodyAHandle: leftBody.handle, bodyBHandle: rightBody.handle,
            maxAngle, setpoint: sa,
          });
        }
      }
    }

    allComponents.sort((a, b) => (a.hotkeyPriority ?? 0) - (b.hotkeyPriority ?? 0));

    // Create FixedJoints for latched decoupler edges that span different bodies.
    // These hold sections rigid until the decoupler is activated.
    for (const comp of blueprint.components) {
      if (comp.type !== ComponentType.Decoupler) continue;
      const sides = buildDecouplerSides(comp.rotation, comp.hotkeys, comp.hotkey);
      const dcInst = allComponents.find(c => c.id === comp.id);
      if (!dcInst) continue;

      for (const sideState of sides) {
        if (!sideState.hotkey) continue;
        const off = sideOffset(sideState.side);
        const neighborInst = allComponents.find(
          c => c.gridX === comp.gridX + off.dx && c.gridY === comp.gridY + off.dy,
        );
        if (!neighborInst || neighborInst.bodyHandle === dcInst.bodyHandle) continue;

        const dcBody = this.world.getRigidBody(dcInst.bodyHandle);
        const nBody = this.world.getRigidBody(neighborInst.bodyHandle);
        if (!dcBody || !nBody) continue;

        // Compute shared anchor point (midpoint between the two components) in each body's local frame
        const dcCollider = this.world.getCollider(dcInst.colliderHandle);
        const nCollider = this.world.getCollider(neighborInst.colliderHandle);
        if (!dcCollider || !nCollider) continue;

        const dcWorldPos = dcCollider.translation();
        const nWorldPos = nCollider.translation();
        const midX = (dcWorldPos.x + nWorldPos.x) / 2;
        const midY = (dcWorldPos.y + nWorldPos.y) / 2;

        const anchorA = worldToLocal(dcBody, midX, midY);
        const anchorB = worldToLocal(nBody, midX, midY);
        const relRotation = dcBody.rotation() - nBody.rotation();

        const jp = RAPIER.JointData.fixed(anchorA, 0, anchorB, relRotation);
        const joint = this.world.createImpulseJoint(jp, dcBody, nBody, true);

        this.decouplerJoints.push({
          jointHandle: joint.handle,
          compId: comp.id,
          side: sideState.side,
        });
      }
    }

    // Lock hinge motors that form kinematic loops with the FixedJoints
    updateHingeLocks(this);

    // Build connection graph spanning all bodies (hinged ship)
    const hingedUnlatchedSides = new Map<string, import('../types/components').Side[]>();
    for (const dc of this.decouplers) {
      if (!allComponents.some(c => c.id === dc.compId)) continue;
      const sides = dc.sides.filter(s => s.mode !== 'latched').map(s => s.side);
      if (sides.length > 0) hingedUnlatchedSides.set(dc.compId, sides);
    }
    const hingedGraph = ConnectionGraph.fromComponents(allComponents, hingedUnlatchedSides);

    const primaryBody = sectionBodies[0]?.body;
    const bodyInterpMap = new Map<number, { prevPos: { x: number; y: number }; prevAngle: number }>();
    for (const sec of sectionBodies) {
      const pos = sec.body.translation();
      bodyInterpMap.set(sec.body.handle, { prevPos: { x: pos.x, y: pos.y }, prevAngle: sec.body.rotation() });
    }
    for (const ib of allIntermediateBodies) {
      const pos = ib.translation();
      bodyInterpMap.set(ib.handle, { prevPos: { x: pos.x, y: pos.y }, prevAngle: ib.rotation() });
    }

    const primaryHandle = primaryBody?.handle ?? 0;
    this.connectionGraphs.set(primaryHandle, hingedGraph);

    const ship: ShipState = {
      bodyHandle: primaryHandle,
      components: allComponents,
      isPlayer,
      prevPosition: { x: offsetX, y: offsetY },
      prevAngle: 0,
      bodyInterp: bodyInterpMap,
    };

    for (const comp of allComponents) {
      this.colliderToShip.set(comp.colliderHandle, ship);
    }

    this.ships.push(ship);
    return ship;
  }

  /** Countdown remaining in seconds (0 = fight started) */
  get countdownRemaining(): number {
    return Math.max(0, Math.ceil(this.countdownTicks / 60));
  }

  get isCountingDown(): boolean {
    return this.countdownTicks > 0;
  }

  tick(_dt: number) {
    this.tickCount++;
    const gameActive = !this.gameOver;

    // Countdown phase — no input, no physics, just tick down
    if (this.countdownTicks > 0) {
      this.countdownTicks--;
      return;
    }

    // Save camera state before physics
    this.camera.savePrevState(this);

    // Save previous state for interpolation
    for (const ship of this.ships) {
      const body = this.world.getRigidBody(ship.bodyHandle);
      if (!body) continue;
      const pos = body.translation();
      ship.prevPosition = { x: pos.x, y: pos.y };
      ship.prevAngle = body.rotation();

      // Save per-body interpolation state for multi-body ships
      if (ship.bodyInterp) {
        const seenHandles = new Set<number>();
        for (const comp of ship.components) {
          if (comp.health <= 0) continue;
          if (seenHandles.has(comp.bodyHandle)) continue;
          seenHandles.add(comp.bodyHandle);
          const b = this.world.getRigidBody(comp.bodyHandle);
          if (!b) continue;
          const bp = b.translation();
          ship.bodyInterp.set(comp.bodyHandle, { prevPos: { x: bp.x, y: bp.y }, prevAngle: b.rotation() });
        }
        // Remove stale entries for bodies no longer on this ship
        for (const handle of ship.bodyInterp.keys()) {
          if (!seenHandles.has(handle)) {
            ship.bodyInterp.delete(handle);
          }
        }
      }
    }

    // --- Collect input keys (needed for hinges, decouplers, explosive triggers) ---
    const heldKeys = new Set<string>();
    const pressedKeys = new Set<string>();

    if (gameActive) {
      // Log player inputs (count presses, not holds)
      const loggedKeys = new Set<string>();
      for (const ship of this.ships) {
        for (const comp of ship.components) {
          if (comp.owner !== 'player') continue;
          if (comp.hotkey && this.input.wasPressed(comp.hotkey) && !loggedKeys.has(comp.hotkey)) {
            loggedKeys.add(comp.hotkey);
            this.battleLog.logInput();
          }
        }
      }

      // Collect held keys from player-owned components (includes drones)
      for (const ship of this.ships) {
        for (const comp of ship.components) {
          if (comp.owner !== 'player') continue;
          if (comp.hotkey && this.input.isHeld(comp.hotkey)) {
            heldKeys.add(comp.hotkey);
          }
          if (comp.hotkeys) {
            for (const hk of comp.hotkeys) {
              if (hk && this.input.isHeld(hk)) {
                heldKeys.add(hk);
              }
            }
          }
        }
      }

      // Collect pressed keys from player-owned components (includes drones)
      for (const ship of this.ships) {
        for (const comp of ship.components) {
          if (comp.owner !== 'player') continue;
          if (comp.hotkey && this.input.wasPressed(comp.hotkey)) {
            pressedKeys.add(comp.hotkey);
          }
          if (comp.hotkeys) {
            for (const hk of comp.hotkeys) {
              if (hk && this.input.wasPressed(hk)) {
                pressedKeys.add(hk);
              }
            }
          }
        }
      }
    }

    // === ACTIVATION PHASE: set isActive based on owner ===
    for (const ship of this.ships) {
      for (const comp of ship.components) {
        if (comp.health <= 0) { comp.isActive = false; continue; }

        if (comp.owner === 'player') {
          // Player-owned: active when hotkey is held (works for player ships AND drones)
          comp.isActive = gameActive && !!comp.hotkey && heldKeys.has(comp.hotkey);
        } else if (comp.owner === 'ai') {
          // AI-owned: cleared each tick, AI systems will set selectively
          comp.isActive = false;
        }
        // owner === null (space junk): keep current isActive (frozen state)
      }
    }

    // AI systems — set isActive on engines/blasters they want to fire
    for (let i = 0; i < this.ships.length; i++) {
      const ship = this.ships[i];
      if (ship.isPlayer) continue;
      if (ship.aiType === 'rammer') updateRammerAI(this, ship);
      else if (ship.aiType === 'shooter') updateShooterAI(this, ship, i);
    }

    // === ACTIVE COMPONENT TICK: engines, etc. ===
    for (const ship of this.ships) {
      for (const comp of ship.components) {
        if (!comp.isActive) continue;
        const def = getComponentDef(comp.type);
        def.onTickActive?.(this, comp, ship);
      }
    }

    // Player blaster fire (reads comp.isActive)
    processBlasterFire(this, this.projectiles);

    // Decoupler input first — may remove FixedJoints that affect hinge lock state
    if (gameActive) {
      processDecouplerInput(this, pressedKeys, this.decouplers);
    }

    // Recompute hinge locks (decoupler FixedJoint removal may have broken loops)
    updateHingeLocks(this);

    // Hinge motor control (tap = 1° nudge, hold = HINGE_SETPOINT_STEP per tick)
    processHingeInput(this, this.hingeJoints, heldKeys, pressedKeys);

    // Decoupler attraction (unlatched decouplers pull nearby bodies)
    processDecouplerAttraction(this, this.decouplers);

    // Decoupler docking (low-speed contact merges bodies)
    processDecouplerDocking(this, this.decouplers);

    // Step physics
    this.world.step(this.eventQueue);

    // Drain collision events: track same-ship contacts + collect for damage system
    const damageEvents: Array<[number, number, boolean]> = [];
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      const c1 = this.world.getCollider(h1);
      const c2 = this.world.getCollider(h2);
      if (c1 && c2) {
        const b1 = c1.parent()!.handle;
        const b2 = c2.parent()!.handle;
        if (b1 !== b2) {
          const ship1 = this.colliderToShip.get(h1);
          const ship2 = this.colliderToShip.get(h2);
          if (ship1 && ship2 && ship1 === ship2) {
            // Ignore contacts involving hinge colliders (ball pivots naturally touch adjacent sections)
            const comp1 = this.colliderToComponent.get(h1);
            const comp2 = this.colliderToComponent.get(h2);
            const def1 = comp1 ? getComponentDef(comp1.type) : undefined;
            const def2 = comp2 ? getComponentDef(comp2.type) : undefined;
            if (def1?.colliderShape !== 'circle' && def2?.colliderShape !== 'circle') {
              const key = b1 < b2 ? `${b1}:${b2}` : `${b2}:${b1}`;
              if (started) {
                this.sameShipContactPairs.add(key);
                this.sameShipContactBodies.set(b1, (this.sameShipContactBodies.get(b1) ?? 0) + 1);
                this.sameShipContactBodies.set(b2, (this.sameShipContactBodies.get(b2) ?? 0) + 1);
              } else {
                this.sameShipContactPairs.delete(key);
                const c1count = (this.sameShipContactBodies.get(b1) ?? 1) - 1;
                if (c1count <= 0) this.sameShipContactBodies.delete(b1); else this.sameShipContactBodies.set(b1, c1count);
                const c2count = (this.sameShipContactBodies.get(b2) ?? 1) - 1;
                if (c2count <= 0) this.sameShipContactBodies.delete(b2); else this.sameShipContactBodies.set(b2, c2count);
              }
            }
          }
        }
      }
      damageEvents.push([h1, h2, started]);
    });

    // Snapshot health before any damage to detect auto-detonations
    const prevHealth = new Map<string, number>();
    for (const ship of this.ships) {
      for (const comp of ship.components) {
        prevHealth.set(comp.id, comp.health);
      }
    }

    // Update projectiles (movement + collision)
    updateProjectiles(this, this.projectiles, _dt);

    // Player-triggered press actions (explosive fuse, etc.)
    if (gameActive) {
      for (const ship of this.ships) {
        for (const comp of ship.components) {
          if (comp.health <= 0 || comp.owner !== 'player') continue;
          const def = getComponentDef(comp.type);
          if (def.activationMode !== 'press' || !def.onHotkeyPressed) continue;
          if (comp.hotkey && pressedKeys.has(comp.hotkey)) {
            def.onHotkeyPressed(this, comp, ship, comp.hotkey);
          }
        }
      }
    }

    // Tick down explosive countdowns and detonate at 0
    for (const ship of this.ships) {
      for (const comp of ship.components) {
        if (comp.detonationCountdown !== undefined && comp.detonationCountdown > 0 && comp.health > 0) {
          comp.detonationCountdown--;
          if (comp.detonationCountdown <= 0) {
            comp.health = 0;
            detonateExplosive(this, comp, 1);
          }
        }
      }
    }

    // ALL post-physics damage in one call
    runDamagePhase(this, prevHealth, _dt, damageEvents);

    // Win/loss
    if (gameActive) {
      checkWinLoss(this);
    }

    // Advance camera transition
    this.camera.tickTransition();

    this.battleLog.endTick = this.tickCount;
    this.input.endFrame();
  }

  getPlayerShip(): ShipState | undefined {
    return this.ships.find(s => s.isPlayer);
  }

  /** Get composite center of mass across all bodies that make up the player ship */
  getPlayerBodyPosition(): { x: number; y: number } | null {
    const ship = this.getPlayerShip();
    if (!ship) return null;

    // Collect all unique body handles (hinged ships have multiple bodies)
    const bodyHandles = new Set<number>();
    for (const comp of ship.components) {
      if (comp.health > 0) bodyHandles.add(comp.bodyHandle);
    }

    let totalMass = 0;
    let comX = 0;
    let comY = 0;
    for (const handle of bodyHandles) {
      const body = this.world.getRigidBody(handle);
      if (!body) continue;
      const m = body.mass();
      const c = body.worldCom();
      comX += c.x * m;
      comY += c.y * m;
      totalMass += m;
    }

    if (totalMass === 0) return null;
    return { x: comX / totalMass, y: comY / totalMass };
  }

  /** Get the connection graph for a ship (by its primary bodyHandle). */
  getConnectionGraph(bodyHandle: number): ConnectionGraph | undefined {
    return this.connectionGraphs.get(bodyHandle);
  }

  destroy() {
    this.world.free();
    this.eventQueue.free();
  }
}
