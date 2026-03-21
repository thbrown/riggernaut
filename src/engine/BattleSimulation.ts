import RAPIER from '@dimforge/rapier2d-compat';
import { ShipBlueprint } from '../types/physics';
import { ComponentType } from '../types/components';
import { getComponentDef } from '../game/component-registry';
import { ComponentInstance, createComponentInstance } from './entities/ComponentInstance';
import { InputManager } from './InputManager';
import { ENGINE_THRUST, TILE_SIZE, FIXED_TIMESTEP, STARTING_DIST, BATTLE_COUNTDOWN_SECONDS } from '../config/constants';
import { rotateSide } from '../types/grid';
import { Side } from '../types/components';
import { processCollisionDamage, processDestruction, checkWinLoss, detectAndSplitDisconnected } from './systems/DamageSystem';
import { updateRammerAI, updateShooterAI, AIType } from './systems/AISystem';
import { Projectile } from './entities/Projectile';
import { processBlasterFire, updateProjectiles } from './systems/ProjectileSystem';
import { processExplosions, checkAutoDetonate, detonateExplosive } from './systems/ExplosionSystem';
import { processExhaustDamage } from './systems/ExhaustDamageSystem';
import { BattleLog } from './BattleLog';
import { HingeJoint, processHingeInput } from './systems/HingeSystem';
import { DecouplerState, processDecouplerInput, processDecouplerAttraction, processDecouplerDocking, buildDecouplerSides } from './systems/DecouplerSystem';
import { DeterministicRng } from './DeterministicRng';

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
  projectiles: Projectile[] = [];
  private input: InputManager;
  tickCount = 0;
  gameOver = false;
  winner: 'player' | 'enemy' | 'draw' | null = null;
  battleLog = new BattleLog();
  countdownTicks = 0;
  countdownTotal = 0;
  hingeJoints: HingeJoint[] = [];
  decouplers: DecouplerState[] = [];
  rng = new DeterministicRng();
  /** Next collision group bit for same-ship filtering (bits 1-15) */
  private nextShipGroupBit = 1;

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
      c => c.type === ComponentType.Hinge90 || c.type === ComponentType.Hinge180
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

      const colliderDesc = RAPIER.ColliderDesc.cuboid(TILE_SIZE / 2, TILE_SIZE / 2)
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
      );

      components.push(instance);
      this.colliderToComponent.set(collider.handle, instance);

      if (comp.type === ComponentType.Decoupler) {
        this.decouplers.push({
          compId: comp.id,
          bodyHandle: body.handle,
          sides: buildDecouplerSides(comp.rotation, comp.hotkeys, comp.hotkey),
        });
      }
    }

    components.sort((a, b) => (a.hotkeyPriority ?? 0) - (b.hotkeyPriority ?? 0));

    const ship: ShipState = {
      bodyHandle: body.handle,
      components,
      isPlayer,
      prevPosition: { x: offsetX, y: offsetY },
      prevAngle: 0,
      bodyInterp: new Map([[body.handle, { prevPos: { x: offsetX, y: offsetY }, prevAngle: 0 }]]),
    };

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

        const colliderDesc = RAPIER.ColliderDesc.cuboid(TILE_SIZE / 2, TILE_SIZE / 2)
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
        );

        allComponents.push(instance);
        this.colliderToComponent.set(collider.handle, instance);

        if (comp.type === ComponentType.Decoupler) {
          this.decouplers.push({
            compId: comp.id,
            bodyHandle: body.handle,
            sides: buildDecouplerSides(comp.rotation, comp.hotkeys, comp.hotkey),
          });
        }
      }

      sectionBodies.push({ body, comps: section.comps, centroidX: secCx, centroidY: secCy });
    }

    // Create joints for each hinge component
    for (const hingeComp of hingeComps) {
      const neighbors = blueprint.adjacency[hingeComp.id] ?? [];
      const adjacentSections = new Set<number>();
      const neighborSectionMap = new Map<number, typeof blueprint.components[0]>();

      for (const nid of neighbors) {
        for (let si = 0; si < sectionBodies.length; si++) {
          if (sectionBodies[si].comps.some(c => c.id === nid)) {
            adjacentSections.add(si);
            neighborSectionMap.set(si, compById.get(nid)!);
          }
        }
      }

      const sectionIndices = [...adjacentSections];
      if (sectionIndices.length < 2) {
        // Hinge only touches one section — attach as a regular collider
        const si = sectionIndices[0] ?? 0;
        const sec = sectionBodies[si];
        const body = sec.body;
        const def = getComponentDef(hingeComp.type as ComponentType);
        const localX = (hingeComp.gridX - sec.centroidX) * TILE_SIZE;
        const localY = (hingeComp.gridY - sec.centroidY) * TILE_SIZE;
        const colliderDesc = RAPIER.ColliderDesc.ball(TILE_SIZE / 2)
          .setTranslation(localX, localY)
          .setDensity(def.mass)
          .setFriction(0)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        const collider = this.world.createCollider(colliderDesc, body);
        const instance = createComponentInstance(
          hingeComp.id, hingeComp.type as ComponentType,
          hingeComp.gridX, hingeComp.gridY, hingeComp.rotation,
          collider.handle, body.handle, owner, hingeComp.hotkey,
        );
        allComponents.push(instance);
        this.colliderToComponent.set(collider.handle, instance);
        continue;
      }

      const secA = sectionBodies[sectionIndices[0]];
      const secB = sectionBodies[sectionIndices[1]];
      const bodyA = secA.body;
      const bodyB = secB.body;

      // Anchor relative to each section's own centroid
      const anchorAX = (hingeComp.gridX - secA.centroidX) * TILE_SIZE;
      const anchorAY = (hingeComp.gridY - secA.centroidY) * TILE_SIZE;
      const anchorBX = (hingeComp.gridX - secB.centroidX) * TILE_SIZE;
      const anchorBY = (hingeComp.gridY - secB.centroidY) * TILE_SIZE;

      const maxAngle = hingeComp.type === ComponentType.Hinge90
        ? Math.PI / 2
        : Math.PI;

      // Compute hinge starting angle (matches getHingeStartAngleRad in ComponentRenderer)
      // 90° hinge: step 0 = East (0), step 1 = South (π/2)
      // 180° hinge: step 0 = East (0), step 1 = South (π/2), step 2 = North (-π/2)
      const hingeStep = hingeComp.hingeStartAngle ?? 0;
      let startAngle = 0;
      if (hingeComp.type === ComponentType.Hinge90) {
        startAngle = [0, Math.PI / 2][hingeStep % 2];
      } else {
        startAngle = [0, Math.PI / 2, -Math.PI / 2][hingeStep % 3];
      }

      // Rotate body B by start angle around the hinge point
      if (startAngle !== 0) {
        const hingeWorldX = bodyA.translation().x + anchorAX * Math.cos(bodyA.rotation()) - anchorAY * Math.sin(bodyA.rotation());
        const hingeWorldY = bodyA.translation().y + anchorAX * Math.sin(bodyA.rotation()) + anchorAY * Math.cos(bodyA.rotation());
        const bPos = bodyB.translation();
        const dx = bPos.x - hingeWorldX;
        const dy = bPos.y - hingeWorldY;
        const cosA = Math.cos(startAngle);
        const sinA = Math.sin(startAngle);
        bodyB.setTranslation({ x: hingeWorldX + dx * cosA - dy * sinA, y: hingeWorldY + dx * sinA + dy * cosA }, true);
        bodyB.setRotation(bodyB.rotation() + startAngle, true);
      }

      // Anchor B in body-local space needs to account for B's rotation offset
      const cosB = Math.cos(-startAngle);
      const sinB = Math.sin(-startAngle);
      const rotAnchorBX = anchorBX * cosB - anchorBY * sinB;
      const rotAnchorBY = anchorBX * sinB + anchorBY * cosB;

      const jointParams = RAPIER.JointData.revolute(
        { x: anchorAX, y: anchorAY },
        { x: rotAnchorBX, y: rotAnchorBY },
      );
      const joint = this.world.createImpulseJoint(jointParams, bodyA, bodyB, true);

      const revolute = joint as RAPIER.RevoluteImpulseJoint;
      revolute.setLimits(-maxAngle / 2, maxAngle / 2);

      // Hinge collider attached to body A — circular so corners don't clip during rotation
      const def = getComponentDef(hingeComp.type as ComponentType);
      const colliderDesc = RAPIER.ColliderDesc.ball(TILE_SIZE / 2)
        .setTranslation(anchorAX, anchorAY)
        .setDensity(def.mass)
        .setFriction(0)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const collider = this.world.createCollider(colliderDesc, bodyA);
      const instance = createComponentInstance(
        hingeComp.id, hingeComp.type as ComponentType,
        hingeComp.gridX, hingeComp.gridY, hingeComp.rotation,
        collider.handle, bodyA.handle, owner, hingeComp.hotkey,
        hingeComp.hotkeys,
      );
      allComponents.push(instance);
      this.colliderToComponent.set(collider.handle, instance);

      this.hingeJoints.push({
        jointHandle: joint.handle,
        hingeCompId: hingeComp.id,
        hotkeyLeft: hingeComp.hotkey,
        hotkeyRight: hingeComp.hotkeys?.[0],
        bodyAHandle: bodyA.handle,
        bodyBHandle: bodyB.handle,
        maxAngle,
        lockedAngle: startAngle,
      });
    }

    // Prevent ALL same-ship collisions: assign a unique bit so components
    // on different bodies of this ship can't collide with each other
    const shipBit = 1 << this.nextShipGroupBit;
    this.nextShipGroupBit = (this.nextShipGroupBit % 15) + 1; // cycle bits 1-15
    const shipMembership = shipBit;
    const shipFilter = 0xFFFF & ~shipBit;
    for (const comp of allComponents) {
      const coll = this.world.getCollider(comp.colliderHandle);
      if (coll) coll.setCollisionGroups((shipMembership << 16) | shipFilter);
    }

    allComponents.sort((a, b) => (a.hotkeyPriority ?? 0) - (b.hotkeyPriority ?? 0));

    const primaryBody = sectionBodies[0]?.body;
    const bodyInterpMap = new Map<number, { prevPos: { x: number; y: number }; prevAngle: number }>();
    for (const sec of sectionBodies) {
      const pos = sec.body.translation();
      bodyInterpMap.set(sec.body.handle, { prevPos: { x: pos.x, y: pos.y }, prevAngle: 0 });
    }

    const ship: ShipState = {
      bodyHandle: primaryBody?.handle ?? 0,
      components: allComponents,
      isPlayer,
      prevPosition: { x: offsetX, y: offsetY },
      prevAngle: 0,
      bodyInterp: bodyInterpMap,
    };

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

    // Save previous state for interpolation
    for (const ship of this.ships) {
      const body = this.world.getRigidBody(ship.bodyHandle);
      if (!body) continue;
      const pos = body.translation();
      ship.prevPosition = { x: pos.x, y: pos.y };
      ship.prevAngle = body.rotation();
      if (ship.isPlayer) {
        const comPos = this.getPlayerBodyPosition();
        if (comPos) ship.prevCom = comPos;
      }

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

    // === ENGINE THRUST: apply thrust for all active engines ===
    for (const ship of this.ships) {
      for (const comp of ship.components) {
        if (!comp.isActive) continue;

        if (comp.type === ComponentType.EngineSmall ||
            comp.type === ComponentType.EngineMedium ||
            comp.type === ComponentType.EngineLarge) {
          const body = this.world.getRigidBody(comp.bodyHandle);
          if (!body) continue;
          this.applyEngineThrust(body, comp);
        }
      }
    }

    // Player blaster fire (reads comp.isActive)
    processBlasterFire(this, this.projectiles);

    // Hinge motor control (still uses heldKeys — two opposing actions)
    processHingeInput(this, this.hingeJoints, heldKeys);

    // Decoupler input (uses pressedKeys for mode toggling)
    if (gameActive) {
      processDecouplerInput(this, pressedKeys, this.decouplers);
    }

    // Decoupler attraction (unlatched decouplers pull nearby bodies)
    processDecouplerAttraction(this, this.decouplers);

    // Decoupler docking (low-speed contact merges bodies)
    processDecouplerDocking(this, this.decouplers);

    // Step physics
    this.world.step(this.eventQueue);

    // Snapshot health before any damage to detect auto-detonations
    const prevHealth = new Map<string, number>();
    for (const ship of this.ships) {
      for (const comp of ship.components) {
        prevHealth.set(comp.id, comp.health);
      }
    }

    // Update projectiles (movement + collision)
    updateProjectiles(this, this.projectiles, _dt);

    // Post-step: damage, destruction, win/loss
    processCollisionDamage(this);

    // Exhaust damage (reads comp.isActive)
    processExhaustDamage(this);

    // Player-triggered explosive detonation (1-second fuse)
    if (gameActive) {
      for (const ship of this.ships) {
        for (const comp of ship.components) {
          if (comp.type === ComponentType.Explosive && comp.health > 0
            && comp.owner === 'player' && comp.hotkey && pressedKeys.has(comp.hotkey)) {
            if (comp.detonationCountdown === undefined) {
              comp.detonationCountdown = 60;
            }
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

    // Auto-detonate explosives destroyed this tick
    checkAutoDetonate(this, prevHealth);

    // Snapshot component counts before destruction for logging
    const compCountsBefore = new Map<number, number>();
    for (const ship of this.ships) {
      compCountsBefore.set(ship.bodyHandle, ship.components.filter(c => c.health > 0).length);
    }

    processDestruction(this);

    // Log destruction events
    for (const ship of this.ships) {
      const before = compCountsBefore.get(ship.bodyHandle) ?? 0;
      const after = ship.components.filter(c => c.health > 0).length;
      const destroyed = before - after;
      if (destroyed > 0) {
        this.battleLog.logEvent(this.tickCount, 'destruction', `${destroyed} component(s) destroyed`);
      }
    }

    processExplosions(this, _dt);
    if (gameActive) {
      checkWinLoss(this);
    }

    this.battleLog.endTick = this.tickCount;
    this.input.endFrame();
  }

  private applyEngineThrust(body: RAPIER.RigidBody, comp: ComponentInstance) {
    const size = comp.type === ComponentType.EngineSmall ? 'small'
      : comp.type === ComponentType.EngineMedium ? 'medium' : 'large';
    const thrust = ENGINE_THRUST[size];

    const def = getComponentDef(comp.type);
    const functionalSide = def.functionalSide ?? Side.South;
    const thrustSide = rotateSide(functionalSide, comp.rotation);

    let dx = 0, dy = 0;
    switch (thrustSide) {
      case Side.North: dx = 0; dy = 1; break;
      case Side.South: dx = 0; dy = -1; break;
      case Side.East: dx = -1; dy = 0; break;
      case Side.West: dx = 1; dy = 0; break;
    }

    const angle = body.rotation();
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const fx = (dx * cos - dy * sin) * thrust;
    const fy = (dx * sin + dy * cos) * thrust;

    const collider = this.world.getCollider(comp.colliderHandle);
    if (!collider) return;

    const worldPos = collider.translation();
    body.applyImpulseAtPoint(
      { x: fx * FIXED_TIMESTEP, y: fy * FIXED_TIMESTEP },
      { x: worldPos.x, y: worldPos.y },
      true
    );
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

  destroy() {
    this.world.free();
    this.eventQueue.free();
  }
}
