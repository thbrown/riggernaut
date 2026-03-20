import { FIXED_TIMESTEP } from '../config/constants';

export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;

  constructor(
    private onTick: (dt: number) => void,
    private onRender: (alpha: number) => void,
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private loop = (time: number) => {
    if (!this.running) return;

    const frameTime = Math.min((time - this.lastTime) / 1000, 0.1); // Cap to 100ms
    this.lastTime = time;
    this.accumulator += frameTime;

    while (this.accumulator >= FIXED_TIMESTEP) {
      this.onTick(FIXED_TIMESTEP);
      this.accumulator -= FIXED_TIMESTEP;
    }

    const alpha = this.accumulator / FIXED_TIMESTEP;
    this.onRender(alpha);

    this.rafId = requestAnimationFrame(this.loop);
  };
}
