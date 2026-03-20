import { ComponentType } from '../types/components';
import { ShipBlueprint } from '../types/physics';

/**
 * Rammer v2 (3x3):
 *   Row 0: [Ram]    [Ram]    [Ram]
 *   Row 1: [Armor]  [Cmd]    [Armor]
 *   Row 2: [EngM]   [EngM]   [EngM]
 */
export function createRammerBlueprint(): ShipBlueprint {
  const components = [
    // Row 0 — rams (North face)
    { id: 'r_ram_l',   type: ComponentType.Ram,            gridX: 0, gridY: 0, rotation: 0 },
    { id: 'r_ram_c',   type: ComponentType.Ram,            gridX: 1, gridY: 0, rotation: 0 },
    { id: 'r_ram_r',   type: ComponentType.Ram,            gridX: 2, gridY: 0, rotation: 0 },
    // Row 1 — armor + command
    { id: 'r_armor_l', type: ComponentType.Armor,          gridX: 0, gridY: 1, rotation: 0 },
    { id: 'r_cmd',     type: ComponentType.CommandModule,   gridX: 1, gridY: 1, rotation: 0 },
    { id: 'r_armor_r', type: ComponentType.Armor,          gridX: 2, gridY: 1, rotation: 0 },
    // Row 2 — engines
    { id: 'r_eng_l',   type: ComponentType.EngineMedium,   gridX: 0, gridY: 2, rotation: 0 },
    { id: 'r_eng_c',   type: ComponentType.EngineMedium,   gridX: 1, gridY: 2, rotation: 0 },
    { id: 'r_eng_r',   type: ComponentType.EngineMedium,   gridX: 2, gridY: 2, rotation: 0 },
  ];

  return {
    components: components.map(c => ({ ...c, hotkey: undefined })),
    adjacency: {
      r_ram_l:   ['r_ram_c', 'r_armor_l'],
      r_ram_c:   ['r_ram_l', 'r_ram_r', 'r_cmd'],
      r_ram_r:   ['r_ram_c', 'r_armor_r'],
      r_armor_l: ['r_ram_l', 'r_cmd', 'r_eng_l'],
      r_cmd:     ['r_ram_c', 'r_armor_l', 'r_armor_r', 'r_eng_c'],
      r_armor_r: ['r_ram_r', 'r_cmd', 'r_eng_r'],
      r_eng_l:   ['r_armor_l', 'r_eng_c'],
      r_eng_c:   ['r_cmd', 'r_eng_l', 'r_eng_r'],
      r_eng_r:   ['r_armor_r', 'r_eng_c'],
    },
  };
}

/**
 * Shooter v2 (3x3):
 *   Row 0: [BlastM]        [EngS rot=2]  [BlastM]
 *   Row 1: [EngS rot=3]    [Cmd]         [EngS rot=1]
 *   Row 2: [EngM]          [Armor]       [EngM]
 */
export function createShooterBlueprint(): ShipBlueprint {
  const components = [
    // Row 0 — blasters + retro engine
    { id: 's_blast_l', type: ComponentType.BlasterMedium, gridX: 0, gridY: 0, rotation: 0 },
    { id: 's_retro',   type: ComponentType.EngineSmall,   gridX: 1, gridY: 0, rotation: 2 }, // faces South = retrograde
    { id: 's_blast_r', type: ComponentType.BlasterMedium, gridX: 2, gridY: 0, rotation: 0 },
    // Row 1 — lateral engines + command
    { id: 's_eng_left',  type: ComponentType.EngineSmall, gridX: 0, gridY: 1, rotation: 3 }, // faces East = strafe left
    { id: 's_cmd',       type: ComponentType.CommandModule, gridX: 1, gridY: 1, rotation: 0 },
    { id: 's_eng_right', type: ComponentType.EngineSmall, gridX: 2, gridY: 1, rotation: 1 }, // faces West = strafe right
    // Row 2 — main engines + armor
    { id: 's_eng_l',  type: ComponentType.EngineMedium, gridX: 0, gridY: 2, rotation: 0 },
    { id: 's_armor',   type: ComponentType.Armor,        gridX: 1, gridY: 2, rotation: 0 },
    { id: 's_eng_r',  type: ComponentType.EngineMedium, gridX: 2, gridY: 2, rotation: 0 },
  ];

  return {
    components: components.map(c => ({ ...c, hotkey: undefined })),
    adjacency: {
      s_blast_l:  ['s_retro', 's_eng_left'],
      s_retro:    ['s_blast_l', 's_blast_r', 's_cmd'],
      s_blast_r:  ['s_retro', 's_eng_right'],
      s_eng_left: ['s_blast_l', 's_cmd', 's_eng_l'],
      s_cmd:      ['s_retro', 's_eng_left', 's_eng_right', 's_armor'],
      s_eng_right:['s_blast_r', 's_cmd', 's_eng_r'],
      s_eng_l:    ['s_eng_left', 's_armor'],
      s_armor:    ['s_cmd', 's_eng_l', 's_eng_r'],
      s_eng_r:    ['s_eng_right', 's_armor'],
    },
  };
}
