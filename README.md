# Riggernaut

A 2D space battle game where players build custom spaceships from modular parts and fight in a top-down arena. Inspired by [Spaceship Resurrection](https://thbrown.github.io/spaceship-resurrection/).

**[Play it here](https://thbrown.github.io/riggernaut/)**

## Overview

Players assemble ships from components — engines, blasters, armor, hinges, decouplers, and more — then battle AI or other players. Ships are physically simulated: components have mass and health, collisions deal damage, and destroyed components can split a ship into independent pieces.

**Game phases:**
1. **Build** — purchase and arrange components on a grid within your budget
2. **Hotkey Assignment** — bind keyboard keys to component powers
3. **Battle** — top-down physics combat; last Command Module standing wins
4. **Summary** — post-match stats

## Tech Stack

- **Vite + React + TypeScript**
- **Rapier 2D** — deterministic physics (supports multiplayer rollback)
- Canvas rendering for battle, React/DOM for menus and build UI

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:5173/riggernaut/`.

## Build

```bash
npm run build
```

Output goes to `docs/` for GitHub Pages hosting.

To preview the production build locally:

```bash
npm run preview
```

Then open `http://localhost:4173/riggernaut/`.

## Deployment

The `docs/` folder is served via GitHub Pages from the `main` branch. Push to `main` and the live site updates automatically.

To configure: **Settings → Pages → Deploy from branch → `main` / `/docs`**.
