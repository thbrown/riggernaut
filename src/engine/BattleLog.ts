export interface BattleEvent {
  tick: number;
  type: 'damage' | 'destruction' | 'kill' | 'explosion' | 'fire';
  details: string;
}

export class BattleLog {
  events: BattleEvent[] = [];
  playerInputCount = 0;
  startTick = 0;
  endTick = 0;

  logEvent(tick: number, type: BattleEvent['type'], details: string) {
    this.events.push({ tick, type, details });
  }

  logInput() {
    this.playerInputCount++;
  }

  getStats() {
    const durationTicks = this.endTick - this.startTick;
    const durationSeconds = durationTicks / 60;
    const avgAPM = durationSeconds > 0 ? (this.playerInputCount / durationSeconds) * 60 : 0;

    const damageEvents = this.events.filter(e => e.type === 'damage');
    const kills = this.events.filter(e => e.type === 'kill');
    const explosions = this.events.filter(e => e.type === 'explosion');

    return {
      durationSeconds: Math.round(durationSeconds),
      avgAPM: Math.round(avgAPM),
      totalDamageEvents: damageEvents.length,
      totalKills: kills.length,
      totalExplosions: explosions.length,
      totalInputs: this.playerInputCount,
    };
  }
}
