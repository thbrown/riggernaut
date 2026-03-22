Here are some issues that I've seen. Lets enter plan mode and consult design.md for context before addressing all of them:

# ACtivation presidence

Does out activation priority ordering system work when components have multiple activation keys? My understanding is that the curren mthod for doung thos relys on componen addition order, it seems like that wont wor with multiple keys (if we want to coltrol activation presedence fo rthe keys individually).

Also sometimes pressing ^ moves the key to top priorotY? Seems liek it should jsut move it up/down one slot.

# Component distruction animation

There should be a small partical-effect explostion whenever a compnet is destroyed. Sort of like an explosion component (but much smaller).

# Win condition

After the player wins or loses, the game simulation seems to stop. This deproves the player of the experience of viewing glorious explosion that took them out. We should let the simulation keep playing in the backgroun after win/loss.

# Stale canvas

After restarting the battle phase, sometime partical effects are lingering from the previous try. Thye should not.
 
Blaster bolth should be relivte to ship

# Multiple Hotkeys  per componetn assignment

It would be really great if, for components with multipl activation hotkeys (e.g. (de)coupler), we could click the side of the component and assign hotkeys to that side. Right now you have to assign them in the side bar.

Can we also replace north south east and west with top, right, bottom, and left for the (de)coupler?

Lastly, we have good multi-hotkey representations in Battle mode but not for Build mode. Can we make them consistent?

# Images and hotkeys in battle phase

The componet icons in Build mode are more roboust than those in battle mode. In battle phase they mostly look like non-descript colored squares. Can we make the battle phase look more like build mode?

# Component activation animations

Whenever a componet is activated it should have some kind of animation or change ((de)couplers do this well). Blassters should have some recoil. Thrusters should glow a bit. Hinges should show some realistic hinging. etc...

I think for explisions we shoud add a small delay (maybe 1 second) between activation and explosion. But we should play an increasing glow or confinde expansion animation so user knows the activation key did something.

# Collison Dammage? 

It's not clear at all when collisions are occuring. Instead of turning components reder and redder when they are dammaged, can we just apply flashing red for a second when any damage occures? I think that will help user understand what's happening. And this should occure on any ship - friend, foe, or space junk.

Also we need to make the rams cause more damage on collision, even light collisions. I think we should increase all collision damage, and also lower the velocity threshold a bit. *****

# (de)coupler suction particals

These particlas are not in the correct place at all when the ship is moveing around a lot. They should be local particles, always going from far away into the attractor component no matter what speed or rotation the ship has. In they way they should hehave like engine exhaust. They are purely aesthetic to show that suction is happening.

# Blaster particles

In a similar veign, blaster bolts seem dependent on the velocity or rotation of the space ship. Is the ship is moving very quicly in the wrong direction, shooting bolts in that same direction will cause the bolt to fly back into the ship causing damage! We do want friednly fire to cause damage (to everything except the blaster component it was fired from), but the bolt should always proceed outward from the coponet no matter how fast it's moving. This may involve adding ship velocity to the charecteristic bolt velocoty when fired.

# Ownership code structure

I questions a little bit the code structure for each component. Insttead of deriving isActive from a set of variables, maybe its better to isActive (or multiple variable is there are multiple powers) be a state of the component. Then have some sort of "ownership" context which activates or deativates the state. Remember ships can be owned by player, another player, or be unowned space junk. This way when seperation events occure, we just keep the activation states exactly how they were immidiatly prior to seperation (and any later keypresses don't affect the state because the owner is null). Any component with a radio maintains it's owner on seperation. This may be simpler. What do you think?

# Radios

When creating a new component with a radio in the build phase, it seems like thes seperate drones are locked to the grid system of the main ship. We don't want this. Independatn ships should move indepenantly.

segments that contin a radio are never de-coupled form the main ship if they contain a radio. They should be decoupled, but the amin ship should reatin ownership for control purposes.

# Game stats

Input events seem really really hight, i wonder if we ar cound press and holds as many events. Really we should jsut be count key presses that do something here I think.


---------------------

# Starting drones

Starting drones seem joined to the main ship (with command module). They move in unison. They shouldn't

# AI engined don't seem to change

AI engines never turn off even thought the ships chang direction. I think the particals arent synced with the thrust activation.

# THe build phase

Battle multi-hotkeys are have boarding boxes which are too big

# Component destruction

I think there are a few cases where we need to make the component destruction explosion particals match the velocity of the block that was destoryed.

# Blaster bounce annimation

Recoil animation sholuld sync with fire rate (and the magnitude of the recoil should be propotional to power)

# Docing

Error on docking:

0047c3c2:0xf3dab Uncaught RuntimeError: unreachable
    at 0047c3c2:0xf3dab
    at 0047c3c2:0x10bd44
    at 0047c3c2:0x107195
    at 0047c3c2:0xe46b6
    at _YA.rbLinvel (@dimforge_rapier2d-compat.js?v=ded46487:1721:18)
    at QI.linvel (@dimforge_rapier2d-compat.js?v=ded46487:2464:35)
    at processDecouplerDocking (DecouplerSystem.ts:380:27)
    at BattleSimulation.tick (BattleSimulation.ts:515:5)
    at GameLoop.onTick (BattleView.tsx:81:15)
    at loop (GameLoop.ts:38:12)



    



# 

- Space junk is somethimes getting commands from

Shocking damage?

What happens if intet images are left?


----------

# Friendly collisions

I changed my mind on this. Can we make it so componets on the same ship can't collide with eachother at all? HInges are causing too many issues in this department

# Fixed hinges

Althouh other forces shouold affect hinge movement when in motion. Once a hinge is a rest, it should remain fixed at that position until moved.

# Hotkey lables

We can currtly only fit 1 hotkey on the joint in hotkey assign and battle phases. Can we fit all (like we do with decouopler?)

# 90 degree

We want the lines in the graph to ling up with where we can attach a component. Can we also show a small arc sweep close to the hinge fulcrum to indicate where the hinge sweeps?

# Hinge building

While builing hinges, can we add another button (next to the delete and orientation) to toggle the starting hinge lines. We should cycle through every permutation (including direction). This way we can build with hinges at any angle. THis should dhow updated graphics and attachement locations.


Wacky Battle


Okay got a few things here to fix w/ Build phase: 

It's not clear, during build phase, what edges actually can be attached to others. Can we add some sort of visual indicator to the edges of componets that can be attched?

Also, with regard to attachable edges. Just becasue an edge of a componet is attachable and adjacent to another attachable copmponet, that doen't mean we want attach the componet. Perhaps the solutin to this is to add a new button for each component that cycles through all permutations of attachable sides (this will be much clearer what's happening if we have the visual solution from above)

Lastly, for hinge components: The "Starting Angle" button isn't what we want. FIrst can we use the icon we use for this for rotation instead? Second, I want the starting angle to actuall bend the hinge so the attachable side is a different side. This would mean three different options for a 180 hinge and two options for a 90 hinge.

---------

# Back to back 180 deg hinges

> When I try to out 180 degre hinges al in series (like a snake), none of my activation hotkeys seem to work. CAn you investiagte?

> When a rammer damages my ship and ther is nothing attached to one side of my hinge, sometimes the remainder of the ship still rotates around the fulcrum of the hinge! In this case the hinge to rotate but whouldnt wag the ship!

# Build mode

> I don't like how selecting a componet needs to exapnd the list to show componetn details. Perhaps we can move this to a "selected component" detail section that takes up fixed hieght at th bottom of the list?

# Hotkey assign

> In the left panel, when assigning a hotkey to a componet with multipl activations, the first hotkey is not styled the same as all other hotkeys.

> When assigning hotkeys to hinges, I can't click near the approximate hotkey location to assigne a hotkeyu. Clicking the component always attempts to assing the fire hotkey (left). I would like it to behave like the decoupler does where click in differnet locations on the componet assign the hotkeys.

> Only during hotkey assignment, can we show empty placeholders anywhere where we can click to assign a hotkey. I think grey outlined squares could be good (about the size of a hotkey char).

> This one applies to more than just this phase, but anytime we have a hotkey string that is more than one char, can we find a good singe-char unicode substitution?

# Battle mode

> When a section docs and there are no hotkeys assigned, it's kind of a bummer. Can we randomly assign hotkeys to coupled compoents that don't already have one?

> Occasionally, after a lot of chaos and ramming. The camera seems te get confused about what ship tis tracking and it glitches all around. Can you investigate?

----

I think the optimal behavior for hinges is for the activations keys to produce a Set point for the hinge angle. And the hinge tries to match that setpoint. That way even hinges that move two different loads with get the the same angle eventually if they share hotkeys.

Can we cussion the attractor? And maybe choose a dominate rotation to attract in the case of attracting composite components? Composits are currently prertty difficult to doc because they rotate away and different parts are attrracted ot the attractor.

We don't detect collisions between parts of the same ship. But I don't think this is correct. I think we still want to detect collisions, and prevent overlapping, but we don't want the ship to cause *damage* to itself two parts of same the ship collide.

In hotkey assign, in build phase the first hotkeuy is on the same line as the component name. FOr multi-hotkey compoents I think we should bump this below like all the others.

// If COM jumped more than 5 tiles (e.g. ship split), snap camera instead of interpolating


On one more thing to inclide. The fix you jsut made "Area B: Build Mode" was not waht I intended. I liked how this was before. Can you revert. Instead I want to move the compnet *descriptions* that currenlty apper inline with the componet name to the bottom (and this section should always appear. i.e. you shouldn't ave to scroll to it, ti should be outside the scrollbar.).


-----


When two hinges on the same ship have componetns that collide, it produces a moment on the ship. It begins to spin quite fast. This seems to indicate a conservation of energy issue with the hinge and self collision system.

When I put two or more 180 degree hinges in a row, their activation hotkeys don't appear to do anything in battle mode.

----


Post step energy clamping?

Okay anohter refactor that I thik we should use plan mode for. We have a good set of compoents (some of which might be a little buggy). I'd like to to establish a common interface for all these componets. Can you design for me such and interface based on the currentt implementations? Ideally we could then use this interface to keep all behavior for a component type inside the component file iteself insetead of sacttered all throughout the codebase. Any code that con't be defined inside a particular component type, should be move into some comman sysem code (but I'd like to avoid this if reasonably possible). There are just too many bugs now with each change, it seems like we have a lit of things duplicated or re-implemented across the code base and I really want t=pull all those code together.

Okay I lke the architecture we have now with individual component files that call into "Systems" for more complex logic that may need to be shared across components. I'm not sure, however that we have the correect set of "Systems". Can you do an audit of the systems and components we have and propose a clean, dependency-cycle free, well-deigned set of systems? Thise can be heiararchical. For example, a theoritical parent system may be called "ShipSystem" and make calls to "ConnectedComponetSystem" and "CollisionSystem" which could indepndently be used by componetns direclty if required.  So lets come up with a heiarchy of "systems" and their APIs. Keep an eye out for any opportinities to extract some common, re-usable logic out of the componets into a System. Doc this archiitecture in the readme, then adopt this new system. Again, lets use plan mode for this.

I have, howver, identified what I think might be a new "system'. The connectivity system. There is some logic for determining whether components are attached or not that I'd like to consolidate in a single place. There is some overlapp witht eh decoupling system

---

Okay now I