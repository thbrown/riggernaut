# Riggernaut

A 2D space battle game where players build custom spaceships from predefined parts and then battle each other in a top-down arena. Inspired by [Spaceship Resurrection](https://thbrown.github.io/spaceship-resurrection/), a js13k game jam entry (source: `../spaceship-resurrection`).

Start with single-player (vs AI), then add multiplayer (via WebRTC and WebSockets — both should work, in case we need to shut down the WebSocket server).

Note that there are many constants defined or implied in the description below. We should aim to keep all these constants in a single file with good variable names and possibly comment descriptions. We may need to adjust these frequently during game testing. If there is ever a magic number, or any value you are unsure about, please create a config variable and add it to this file.

---

## Definitions

- **Component** — A single building block of a spaceship (e.g. an Engine, a Ram, a Blaster). Each component occupies one tile on the build grid and has its own health, hardness, mass, and (optionally) powers.
- **Section** — A group of rigidly connected components between hinges (or with no hinges). Each section is a single rigid body in the physics engine. A component set with no hinges has one section; a component set with hinges has multiple sections that can rotate relative to each other. Sections on the same component set *can* collide with each other (e.g. when a hinge folds one section into another).
- **Component Set** — A group of components that are physically attached to each other (possibly across multiple sections connected by hinges). A ship is a component set, but detached debris floating in space is also a component set (just one without a Command Module).
- **Ship** — A component set that contains a Command Module and is controlled by a player. A ship can change shape during battle as components are destroyed, jettisoned, or docked.
- **Drone** — A component set that has no Command Module but contains a Radio. A drone receives hotkey input from its owner (the last player whose ship it was docked to) and continues executing active powers, but is physically independent. Useful for guided missiles, escort craft, etc.
- **Space Junk** — A component set with no Command Module and no Radio. Space junk is not controlled by any player but still participates in physics (collisions, explosions, etc.) and can be recaptured via a (De)coupler.
- **Tile** — One grid square in the build area. Each component occupies exactly one tile.
- **Seam** — The boundary between two attached components. Decoupling happens along a seam.
- **Power** — An active ability of a component, activated by pressing its assigned hotkey during battle.

---

## Tech Stack

- **Framework:** Vite + React + TypeScript
- **Battle Rendering:** 2D HTML Canvas
- **Physics:** [Rapier](https://rapier.rs/) for 2D physics simulation (for its deterministic ability)
- **Non-battle UI:** DOM/HTML/React is fine for build phase, summary screen, menus, etc.

---

## Main Menu

A main menu with a background canvas animation (e.g. ship construction or a battle scene, similar to the original Spaceship Resurrection). The menu itself is regular DOM/React overlaying the canvas.

**Menu Options:**
- Single Player
- Multiplayer Lobby
- Tutorial
- Replay
- Library

---

## Game Properties

These settings apply to both single-player and multiplayer games. In single player, the player configures them directly. In multiplayer, the lobby host sets them (with an option to randomize).

| Property | Description | Default |
|---|---|---|
| Teams | Team assignments for each player. FFA (each player is their own team) or custom teams (2v2, 3v3, etc.) | FFA |
| Initial Funds | How much money each player has to spend during the build phase | Most expensive component cost × 2 |
| Build Volume | Max build area dimensions (x, y) | TBD |
| Build Timer | Time limit for the build phase | Unlimited (single player), 2 minutes (multiplayer) |

**Cost randomization:**
- Component cost: random from 1–10, subject to constraints specified in the component definitions (e.g. engine and blaster costs must be linearly increasing with size)
- Initial funds: most expensive component cost × 2
- Costs are randomized once per match and shared across all players

### Player Properties

| Property | Description |
|---|---|
| Color | Player color (used for ship tint, HUD indicators, minimap) |
| Shape | Icon/emblem for color-blind assistance |
| Team | Which team the player belongs to (set by host in multiplayer) |

---

## Game Phases (Shared)

The core phases are shared between single player and multiplayer, with mode-specific differences noted.

### 1. Build Phase

Similar to Spaceship Resurrection's build phase, but with a purchasing system.

**Layout:** Split screen — "Available Components" panel on one side, "Build Area" on the other.

Build phase should use a similar grid system as the original game, but should allow users to leave unused components in the build area for purposes of cost computation. All components that will be used in the battle must be attached to either a Command Module or a Radio. Any unattached components should be shaded red and slightly transparent.

The "Available Components" panel should include the image of the component, its cost, and a tooltip with a short description.

**Mechanics:**
- Players can purchase any number of parts
- Drag a component from the available panel into the build area to purchase it (cost is deducted from available funds)
- Drag a component out of the build area to sell it back (funds are refunded)
- Components can exist unattached to anything, but they count against the player's budget and will not be part of the spaceship for the battle phase
- Players **can** go into debt while building:
  - Available funds display turns negative and red
  - "Enter Battle" button is greyed out with a tooltip: *"Cannot proceed with negative funds"*

### 2. Hotkey Assignment Phase

This view presents the player with a top-down view of the ship they just built. The player can click a component, then press a keyboard key to assign that key to the component. Not all components need to be assigned keys. Selecting a component and pressing Escape removes any defined key. Keys can be assigned to multiple components.

### 3. Battle Phase

**Start:** Countdown sequence — 3... 2... 1... Battle!

**Win/Loss Conditions:**
A player loses when their Command Module is destroyed. A team loses when all of its players' Command Modules are destroyed. In the event of simultaneous destruction, the game is a tie.

**Arena:**
Infinite space for now — no boundaries, environmental hazards, or interactables. Maybe some subtle nebula or star/space particle content for aesthetic reasons (and to show motion of the ship), but these should be minimal.

**Starting Positions:**
Opposing ships spawn equidistant from each other, about `STARTING_DIST` (default 300m) between their centers.

Ships on the same team should spawn about `ALLY_STARTING_DIST` (default 10m) apart (closest component to closest component) in a line, `STARTING_DIST` from the enemy line.

**Damage:**

There are a few ways a component can take damage:

#### Blaster Damage
The Blaster component shoots "bolts." If a bolt contacts a component, damage is dealt to that component.

#### Collision Damage
When components collide with each other, they each cause damage based on the energy of the collision and the relative hardness of each component. Components attached to each other never collide; however, components on the same ship *can* collide (e.g. if a hinge moves one component of the same ship into another).

**Collision damage formula:**

1. Compute the relative kinetic energy of the collision:
   ```
   relative_kinetic_energy = 0.5 * reduced_mass * relative_speed²
   ```
   where `reduced_mass = (m1 * m2) / (m1 + m2)`

2. Compute raw damage:
   ```
   raw_damage = COLLISION_DAMAGE_SCALAR * relative_kinetic_energy
   ```

3. Split damage between the two components inversely proportional to their hardness:
   ```
   damage_to_A = raw_damage * (B.hardness / (A.hardness + B.hardness))
   damage_to_B = raw_damage * (A.hardness / (A.hardness + B.hardness))
   ```
   For example, a Ram (hardness 10) hitting a Dummy (hardness 1) deals ~91% of the damage to the Dummy and only ~9% to the Ram.

**Collision thresholds and limits:**
- `MIN_COLLISION_SPEED` — collisions below this speed deal no damage (prevents chip damage from gentle bumps, docking, or hinge settling). Start with ~0.5 component-widths/sec.
- `MAX_COLLISION_DAMAGE` — optional per-tick damage cap to prevent one-shot kills. TBD whether we want this — high-speed rams *should* be devastating.

**Self-collision via hinges:** Uses the same formula as normal collisions.

**Multi-component collisions:** When two ships collide, multiple component pairs may be in contact simultaneously. Each pair resolves independently.

Collision damage should produce an impulse force to push colliding components away from each other.

#### Explosion Damage
See the [Explosive component](#explosive).

#### Component Destruction (0 HP)
When a component's health reaches 0:
- The component is destroyed and removed from the ship's physics body
- If removal disconnects part of the ship from the Command Module, the orphaned components become neutral space junk (a separate physics body, no longer player-controlled)
- Explosive components auto-detonate on destruction (see [Explosive](#explosive))

#### Damage Aesthetics and Indicators
Components should have a consistent way to indicate damage — perhaps a partially transparent SVG overlay showing cracks that gets more severe with each 10% of HP lost. For heavily damaged components, show small particle effects of fire coming from random places on the component. Fire should grow larger and come from more locations as more damage is taken.

**Camera:**
- Top-down view
- Camera locked to the center of gravity of the player's ship
  - Note: center of gravity shifts as the ship changes shape (jettisoned components, destroyed components, docking with components)
  - Camera transitions should be gradual/animated, not abrupt
- Default zoom is based on ship size, adjustable via:
  - `+` / `-` keys
  - Mouse scroll wheel
  - **Open question:** Should zoom auto-adjust as ship shape changes?

**HUD:**
- Minimap in the bottom-right corner
- Direction indicators on screen edges showing the color and icon of opposing players (similar to the space station indicator in the original Spaceship Resurrection)
- Hotkeys to activate each component should appear on the player's own ship, but not on enemy or team ships

### 4. Summary Phase

Post-game statistics screen. Potential stats include (not limited to):

- Average APM per player
- APM over time per player
- Command Module health over time per player
- HP damage done over time (cumulative) per player
- Cost damage done over time (cumulative) per player
- Win probability over time per player (not sure how to calculate this — maybe skip for first phase)
- Play of the game (highest-leverage moment)

### Post-Game Flow

After winning or losing a game, the player should be brought back to the beginning of the build phase with their ship intact, so they can make modifications and quickly re-enter battle mode. On the second run and beyond, each phase page (except the last page before the battle phase) should show a "Quick Start" button that keeps the previous settings and proceeds directly to battle.

---

## Single Player

This is meant to be mostly a sandbox mode for trying out builds against pre-fab AI ships.

**Phase flow:** Build → Hotkey Assignment → **Opponent Selection** → Battle → Summary

**Single-player differences from shared phases:**
- Build timer is unlimited
- "Sandbox Mode" option: gives the player 999,999 funds and makes the build area resizable via `+` and `-` buttons along each axis

### Opponent Selection Phase

This view gives the player an opportunity to select the number and type of opponents to face. Two pre-fabricated AI bots to start:

#### Rammer
Command Module, two Medium Engines on either side of the Command Module, Ram (×3) stacked on top of each other component.

AI behavior: pursue the player and ram them. Simple physics-based steering.

#### Shooter
Command Module, Medium Engines on either side, one retrograde engine above the Command Module, and two Medium Blasters facing forward on either side of the retrograde engine.

AI behavior: maintain a fixed distance from the player and shoot. Simple physics-based steering.

> AI behavior should be based on simple physics and geometry, not complicated AI algorithms.

---

## Multiplayer

> **Priority:** Get single player working well first, then tackle multiplayer.

**Phase flow:** **Lobby** → Build (timed) → Hotkey Assignment → Battle → Summary

**Multiplayer differences from shared phases:**
- Build timer is enforced (default 2 minutes, configurable by host)
- No Opponent Selection phase (opponents are real players)

### Networking Model

**Lockstep simulation.** Since Rapier is deterministic, all clients run the same physics simulation independently. Only player inputs (with timestep indices) are transmitted over the network.

- Each input event is tagged with the simulation step it occurred on
- On receiving an event from another player, if the event's timestep is in the past, roll back the simulation to that step, apply the event, and re-simulate forward to the current step
- Events older than `MAX_ROLLBACK_WINDOW` (a configurable number of steps) are rejected — if a client is that far behind, it's too late to incorporate their input
- This model aligns naturally with the replay system (replays are just recorded input streams)

**Transport:** Both WebRTC (peer-to-peer) and WebSockets (server-relayed) should be supported. WebRTC is preferred for lower latency; WebSockets as a fallback in case the WebSocket server needs to be shut down or WebRTC connections fail.

### Lobby System

- From the main menu, players enter a lobby browser screen
- The lobby browser shows a list of public lobbies with: lobby name, number of players, game settings summary
- Players can create a new lobby or join an existing one

**Creating a lobby:**
- The host configures all game properties (teams, initial funds, build volume, build timer) with an option to randomize each
- Lobby can be set to **public** (appears in lobby list) or **password-protected**
- A shareable URL is generated for inviting players directly

**Joining a lobby:**
- Click a lobby from the public list, or follow a shared URL
- Two options: **"Join as Player"** or **"Join as Spectator"**
- Players joining see the current game settings and their team assignment
- The host can reassign players to teams from the lobby screen

**Spectators:**
- Spectators watch the game in real time with a free camera (not locked to any ship)
- Spectators see all ships, all hotkeys, and the full minimap
- Spectators cannot interact with the game

**Disconnection:**
- If a player disconnects during the build or hotkey assignment phase, they are removed from the game
- If a player disconnects during the battle phase, their ship immediately becomes space junk (all active powers deactivate, ship drifts with current velocity)
- Disconnected players may reconnect to the same lobby and resume control of their ship (if it still exists and the Command Module is intact) within a `RECONNECT_TIMEOUT` window
- After `RECONNECT_TIMEOUT`, the player is permanently removed and their ship remains as space junk

**Host migration:**
Might be easiest just to shutdown the server.

---

## Tutorial

An easy single-player game with additional popover overlays explaining what everything does in detail. The main game can rely primarily on icons to convey meaning; the tutorial fills in the gaps.

---

## Component Library

A browsable list of all spaceship components. Clicking a component shows:
- A large detail view with the component's description
- How the component works
- An animation (CSS, SVG, or canvas) of the component being activated

---

## Replays

A list of recorded games played in this browser (saved in IndexedDB during gameplay). Each list item should show basic details about the game: date played, duration, file size, game settings, etc. Clicking a replay and pressing "View Replay" replays the game in the browser.

This menu should also allow players to upload a replay file to IndexedDB, so it can be selected from the list and viewed.

---

## Components

### Build-Time Properties (All Components)

| Property | Description |
|---|---|
| Hardness | Determines damage ratio in collisions (higher = takes less damage) |
| Mass | Mass of the component, used for physics and collision damage calculations (currently 100 for all components) |
| Max Health | Total HP of the component |
| Attachable Sides | Enum array (N,S,E,W) indicating which sides can attach to other components |

### Runtime Properties (All Components)

| Property | Description |
|---|---|
| Health | Current HP, calculated independently per component |
| Cost | Relevant during build phase only; randomized per match (see [Game Properties](#game-properties) for randomization rules) |

### Powers

Each component power is bound to a single hotkey (assigned during the [Hotkey Assignment Phase](#2-hotkey-assignment-phase)). Pressing the assigned key activates the power.

### Component List

#### Command Module
- **Hardness:** 2
- **Mass:** 100
- **Max Health:** 100
- **Description:** The core of the ship. If this component is destroyed, the player is defeated.
- **Attachable Sides:** All 4
- **Powers:** None

#### Engine (Small / Medium / Large)
> Three separate components with different stats. Note for cost randomization: engine cost should always be linearly increasing with size, but starting value and slope can be random.

- **Hardness:** 0.5
- **Mass:** 100
- **Max Health:** 50
- **Description:** Provides thrust. Can damage any components within its exhaust radius (the same area as the particle effect). This affects friendly and self components as well. Exhaust damage is continuous while the engine is active, and exhaust should push affected components away (with stronger force the closer to the engine).
  <!-- TODO: Define specific exhaust damage values — radius per engine size, damage per second, push force curve -->
- **Attachable Sides:** 3 (the thrust-output side cannot attach)
- **Powers:** Press hotkey to enable thrust, release to disable thrust (should behave exactly like the engines in Spaceship Resurrection)

#### Dummy
- **Hardness:** 1
- **Mass:** 100
- **Max Health:** 100
- **Description:** Filler block, mostly used to adjust ship center of mass/inertia or to space other components further apart.
- **Attachable Sides:** All 4
- **Powers:** None

#### Armor
- **Hardness:** 5
- **Mass:** 100
- **Max Health:** 200
- **Description:** No powers — just high hardness and HP.
- **Attachable Sides:** All 4
- **Powers:** None

#### Ram
- **Hardness:** 10
- **Mass:** 100
- **Max Health:** 100
- **Description:** No powers — extremely high hardness for ramming enemies. Has a pointed end on one side.
- **Attachable Sides:** 3 (the pointed side cannot attach)
- **Powers:** None

#### Blaster (Small / Medium / Large)
> Three separate components with different stats. Note for cost randomization: like engines, blaster cost should always be linearly increasing with size, but starting value and slope can be random.

| Size | Bolt Speed | Damage | Fire Rate | Bolt Color | Bolt Size |
|---|---|---|---|---|---|
| Small | Fast | Low | High | Red | Small |
| Medium | Medium | Medium | Medium | Yellow | Medium |
| Large | Slow | High | Low | Violet | Large |

Bolts should be slightly longer than they are wide.

- **Hardness:** 0.5
- **Mass:** 100
- **Max Health:** 50
- **Description:** Fires blaster bolts from one side.
- **Attachable Sides:** 3 (the firing side cannot attach)
- **Powers:** Press hotkey to fire a single bolt. Press and hold to fire continuously at the component's fire rate.

#### (De)coupler
- **Hardness:** 0.5
- **Mass:** 100
- **Max Health:** 50
- **Description:** A versatile docking/undocking component with independently controllable sides.
- **Attachable Sides:** All 4, independently detachable
- **Powers:** Each of the four sides has its own hotkey and can be in either **latched** or **unlatched** mode.

**Latched mode (default):**
When the hotkey is pressed AND another component is attached on that side:
- A small impulse is applied to both sides of the decoupling seam in equal and opposite directions
- The components are no longer attached along that seam and behave physically as two separate ships (susceptible to collisions)
- Any active components on the detached ship (the part separated from the Command Module) remain activated (e.g. a blaster keeps blasting, engines keep thrusting)
- Exception: if the detached ship has a Radio component, it continues receiving hotkey input (see [Radio](#radio))
- After these effects resolve, the (De)coupler transitions to **unlatched** mode
- If there is no attachment on that side, nothing happens except the (De)coupler transitions to **unlatched** mode

**Unlatched mode:**
- A small attractive force is applied to any attachable component within a 4–5 component radius (includes space junk and broken ship pieces, friend or foe)
- Once an attachable piece makes contact with the (De)coupler, docking is resolved based on contact speed:
  - **Speed < 1 component-width/sec:** The piece **docks** (see docking resolution below)
  - **Speed >= 1 component-width/sec:** Normal collision occurs, plus a 3-second cooldown before the coupler is eligible to dock again

**Docking resolution:**
1. The (De)coupler immediately transitions to **latched** mode
2. If only one ship has a Command Module → that ship takes ownership of the combined ship
3. If neither ship has a Command Module (both are space junk) → docking completes, the combined junk remains neutral
4. If both ships have a Command Module → the ship with more components pre-docking wins and takes control of the whole ship, defeating the losing player. If equal component count, a coin flip decides. The losing Command Module is replaced with a Dummy component.

#### Explosive
- **Hardness:** 1
- **Mass:** 100
- **Max Health:** 100
- **Description:** Packed with plasma explosives.
- **Attachable Sides:** All 4
- **Powers:** Pressing the hotkey detonates the explosive, producing a particle-effect explosion and damaging nearby components:

**Explosion mechanics:**
- `EXPLOSION_DAMAGE` — global tunable value for base explosion damage
- `EXPLOSION_RADIUS` — global tunable value; default = 3 tile lengths
- Damage decreases according to a power law with distance from the explosion center, falling to zero at `EXPLOSION_RADIUS`
- Damage at a given radius is proportional to the surface area of the target component exposed to the explosion (projected from the explosion center)
- Components completely shielded by other blocks take no damage — unless the shielding blocks are destroyed, in which case excess damage passes through to the blocks behind. All shielding calculations are based on projection from the explosion center outward through the blast radius.
- When an Explosive loses all its health, it automatically detonates
- **Chain reaction bonus:** If an explosion is triggered by another explosive, both damage and radius are doubled. This stacks with each subsequent explosion (e.g. if default radius is 3: chained radii would be 6, 12, 24, etc.)

#### Radio
- **Hardness:** 1
- **Mass:** 100
- **Max Health:** 100
- **Description:** Passive component. Any ship with a Radio continues to receive hotkey presses from its last-docked ship with a Command Module.  This allows players to create escort ships or guided missiles using other components. When a Radio is destroyed on a drone, it becomes space junk immediately. Note: A radio on the same ship as a command module has no effect.
- **Attachable Sides:** All 4
- **Powers:** No active powers (passive only)

#### Hinge (90° and 180°)
> Two separate components.

- **Hardness:** 0.5
- **Mass:** 100
- **Max Health:** 50
- **Description:** Moves the two attached edges (and everything connected to them) along an arc, with the fulcrum at the center of the hinge component.
- **Attachable Sides:** 2 (opposite sides)
- **Powers:** Two hotkeys — move left and move right. Releasing both keys (or pressing both at once) keeps the hinge stationary. The hinge cannot rotate beyond its angular range (90° or 180°).

**Additional hinge mechanics:**
- Sections connected by a hinge **can** collide with and damage each other (e.g. an external impact pushes one section into another, or a ram on one section hits the other). However, the hinge's own rotational movement should **not** cause damage.
  - **Implementation:** Use Rapier collision groups to create a "buffer zone" around the hinge. The hinge component and its directly-attached neighbor on each side are assigned a collision group that filters out the equivalent colliders on the other side of the hinge. All other colliders on each section use normal collision groups and can collide freely. This means normal hinge rotation won't produce damage (the only components that would touch during routine movement can't collide), but if something folds distant parts of two sections together (even player directed movement), that collision registers and deals damage as expected.
- When sections collide due to external forces, the hinge should resist being pushed beyond its angular limits (the joint limits handle this naturally).
- During the build phase, there should be an option to set the default angle (0°, 90°, or 180° for the 180° hinge) to facilitate building.
- Hinge physics should be somewhat realistic: the speed of the hinge should slow proportionally to the inertia of the component sets it is moving. Movement speed of each side depends on its inertia and distance from the fulcrum.

> Cargo container from the original game is removed — not a component in Riggernaut.

> All component graphics will be remade for this game.

---

## Rapier 2D Integration Notes

Notes on how to use [Rapier](https://rapier.rs/docs/) (`@dimforge/rapier2d` or `@dimforge/rapier2d-compat`) for this game's physics. Zero gravity world (`{ x: 0, y: 0 }`) since it's space.

### Representing Components and Ships
> Rapier docs: [Rigid Bodies](https://rapier.rs/docs/user_guides/javascript/rigid_bodies) · [Colliders](https://rapier.rs/docs/user_guides/javascript/colliders)

**Hybrid approach:** Use one rigid body per rigid section of a ship, with a compound collider (one collider per component tile).

- Each component is a collider (`ColliderDesc.cuboid(halfW, halfH)`) attached to its parent rigid body with a local offset (`colliderDesc.setTranslation(localX, localY)`).
- A ship with no hinges = one rigid body with N colliders.
- A ship with hinges = multiple rigid bodies (one per rigid section on each side of each hinge), connected by revolute joints.
- Mass, center of mass, and angular inertia are **automatically recomputed** by Rapier when colliders are added or removed.

**Runtime destruction:** When a component is destroyed, call `world.removeCollider(collider, true)`. If removing that component disconnects part of the ship from the Command Module, create a new rigid body and re-parent the orphaned colliders to it (the orphaned piece becomes space junk or a drone).

### Joints for Hinges
> Rapier docs: [Joints](https://rapier.rs/docs/user_guides/javascript/joints) · [Joint Constraints](https://rapier.rs/docs/user_guides/javascript/joint_constraints)

Use **`RevoluteImpulseJoint`** — constrains two bodies to rotate around a shared anchor point with one rotational degree of freedom.

```js
let params = RAPIER.JointData.revolute(
  { x: anchorOnBody1X, y: anchorOnBody1Y },  // anchor in body1's local space
  { x: anchorOnBody2X, y: anchorOnBody2Y }   // anchor in body2's local space
);
let joint = world.createImpulseJoint(params, body1, body2, true);
```

**Angular limits** (for 90° and 180° hinges):
```js
let revolute = joint as RAPIER.RevoluteImpulseJoint;
revolute.setLimits(-Math.PI / 4, Math.PI / 4);  // 90° range
revolute.setLimits(-Math.PI / 2, Math.PI / 2);  // 180° range
```

**Motor control** (for actively driving the hinge when hotkeys are pressed):
```js
revolute.configureMotorVelocity(targetAngularVelocity, damping);  // constant speed
revolute.configureMotorPosition(targetAngle, stiffness, damping);  // spring to position
```

**Locking the hinge** (when no keys pressed): Set limits to `[currentAngle, currentAngle]` or use `configureMotorPosition(currentAngle, highStiffness, highDamping)`.

**Collisions between hinged sections:** Leave `joint.setContactsEnabled(true)` (the default) — sections connected by hinges should be able to collide and deal damage. To prevent normal hinge rotation from causing damage, use collision groups to create a buffer zone: the hinge collider and its directly-attached neighbor collider on each side get a special collision group that filters out the equivalent colliders on the other side. All other colliders on each section use normal groups and can collide freely. This way routine hinge movement never produces contact events, but extreme folding of distant components does.

**Removing a joint** (hinge destroyed): `world.removeImpulseJoint(joint, true)`.

### Collision Detection and Damage
> Rapier docs: [Advanced Collision Detection](https://rapier.rs/docs/user_guides/javascript/advanced_collision_detection_js)

**Setup:**
```js
let eventQueue = new RAPIER.EventQueue(true);
// On each collider that needs events:
colliderDesc.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
```

**Reading contact forces after each step** (for damage calculation):
```js
world.step(eventQueue);
eventQueue.drainContactForceEvents(event => {
  let h1 = event.collider1();
  let h2 = event.collider2();
  let forceMagnitude = event.totalForceMagnitude();
  // Feed into collision damage formula
});
```

A minimum force threshold can be set per collider (`collider.setContactForceEventThreshold(minForce)`) to avoid processing trivial contacts.

**Collision filtering** (so components on the same rigid ship don't collide):
- Components on the same rigid body already can't collide (they share a body).
- Hinged sections on the same ship **should** collide (contacts enabled by default on revolute joints).
- For finer control, use **collision groups** (16-bit membership + 16-bit filter bitmask): `colliderDesc.setCollisionGroups(bitmask)`.

### Forces and Impulses
> Rapier docs: [Rigid Bodies — Forces and Impulses](https://rapier.rs/docs/user_guides/javascript/rigid_bodies#forces-and-impulses)

**Engine thrust** — apply force at the engine's world position (off-center engines automatically produce torque):
```js
rigidBody.addForceAtPoint({ x: fx, y: fy }, { x: engineWorldX, y: engineWorldY }, true);
```

**Explosion impulse** — instantaneous:
```js
rigidBody.applyImpulseAtPoint({ x: ix, y: iy }, { x: contactX, y: contactY }, true);
```

**Decoupler separation** — equal and opposite impulses:
```js
body1.applyImpulse({ x: ix, y: iy }, true);
body2.applyImpulse({ x: -ix, y: -iy }, true);
```

The `true` parameter wakes up sleeping bodies.

### Sensors for (De)coupler Attraction
> Rapier docs: [Colliders — Sensors](https://rapier.rs/docs/user_guides/javascript/colliders#sensors) · [Scene Queries](https://rapier.rs/docs/user_guides/javascript/scene_queries)

Attach a sensor collider to the (De)coupler's rigid body to detect nearby components:
```js
let sensorDesc = RAPIER.ColliderDesc.ball(attractionRadius)
  .setSensor(true)
  .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
world.createCollider(sensorDesc, couplerBody);
```

The broad phase tracks overlaps automatically. Use `drainCollisionEvents` to detect enter/exit, maintain a list of attracted bodies, and apply attractive forces each frame.

### Cross-Platform Determinism
> Rapier docs: [Determinism](https://rapier.rs/docs/user_guides/javascript/determinism) · [Serialization](https://rapier.rs/docs/user_guides/javascript/serialization)

Rapier's WASM build guarantees: **the same simulation with the same initial conditions, same Rapier version, on any machine/browser/OS will produce identical results.**

**Requirements:**
1. Same Rapier version on all clients
2. All bodies, colliders, and joints created in **identical order** with **identical values**
3. All mutations (add/remove bodies, apply forces) happen at the **same simulation step** in the **same order**

**Critical:** `Math.sin`, `Math.cos`, and other transcendental functions are **not** cross-platform deterministic. Never use them to compute values fed into the physics engine. Use lookup tables or fixed-point approximations instead.

**Verification:** `world.takeSnapshot()` returns a `Uint8Array` — hash it on both machines after the same number of steps to verify determinism. `RAPIER.World.restoreSnapshot(data)` can recreate a world from a snapshot.

### Fixed Timestep

Rapier does not run its own loop. Each `world.step()` advances by one timestep (default 1/60s). We must implement a fixed timestep accumulator:

```js
const FIXED_DT = 1 / 60;
let accumulator = 0;

function gameLoop(frameDeltaTime) {
  accumulator += frameDeltaTime;
  while (accumulator >= FIXED_DT) {
    world.step(eventQueue);
    accumulator -= FIXED_DT;
  }
  // Render with interpolation: alpha = accumulator / FIXED_DT
}
```

This ensures identical simulation on 60Hz and 120Hz monitors.

### Other Rapier Gotchas
> Rapier docs: [Getting Started (JS)](https://rapier.rs/docs/user_guides/javascript/getting_started_js) · [Common Mistakes](https://rapier.rs/docs/user_guides/javascript/common_mistakes)

- **Unit scale:** Don't use pixel coordinates as physics units. Use meters internally (e.g. 1 tile = 1 meter) and apply a pixels-per-meter scale when rendering.
- **Debug rendering:** `world.debugRender()` returns line segments and colors for visualizing physics bodies — useful during development.
- **Sleeping:** Bodies auto-sleep when stationary. Always pass `true` as the wake-up parameter when modifying bodies at runtime.
- **Zero mass:** A rigid body with no colliders has zero mass and won't respond to forces. Ensure all bodies have at least one collider with non-zero density.
