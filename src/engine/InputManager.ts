export class InputManager {
  private keysDown = new Set<string>();
  private keysPressed = new Set<string>();

  constructor() {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
  }

  attach() {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  detach() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.keysDown.clear();
    this.keysPressed.clear();
  }

  private handleKeyDown(e: KeyboardEvent) {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (!this.keysDown.has(key)) {
      this.keysPressed.add(key);
    }
    this.keysDown.add(key);
  }

  private handleKeyUp(e: KeyboardEvent) {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    this.keysDown.delete(key);
  }

  /** Is key currently held down? */
  isHeld(key: string): boolean {
    return this.keysDown.has(key);
  }

  /** Was key pressed this frame? (consume on read) */
  wasPressed(key: string): boolean {
    return this.keysPressed.has(key);
  }

  /** Call at end of each tick to clear per-frame state */
  endFrame() {
    this.keysPressed.clear();
  }
}
