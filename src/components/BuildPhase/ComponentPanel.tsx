import { ComponentType } from '../../types/components';
import { ALL_COMPONENT_TYPES, getComponentDef } from '../../game/component-registry';
import { BLASTER_STATS, ENGINE_THRUST } from '../../config/constants';
import { ComponentRenderer } from './ComponentRenderer';
import './ComponentPanel.css';

const COMPONENT_DESCRIPTIONS: Record<string, string> = {
  [ComponentType.CommandModule]: 'Brain of the ship. Destruction means defeat. Required to build.',
  [ComponentType.EngineSmall]: 'Light thruster. Low thrust, low profile.',
  [ComponentType.EngineMedium]: 'Balanced thruster. Moderate thrust output.',
  [ComponentType.EngineLarge]: 'Heavy thruster. Maximum thrust, big exhaust zone.',
  [ComponentType.Dummy]: 'Cheap filler block. No special function.',
  [ComponentType.Armor]: 'Reinforced plating. High HP and hardness.',
  [ComponentType.Ram]: 'Hardened prow. Deals heavy collision damage.',
  [ComponentType.BlasterSmall]: 'Rapid-fire laser. Fast shots, low damage.',
  [ComponentType.BlasterMedium]: 'Standard laser. Balanced fire rate and damage.',
  [ComponentType.BlasterLarge]: 'Heavy laser. Slow but devastating. Strong kickback.',
  [ComponentType.Decoupler]: 'Detach and re-dock ship sections on command.',
  [ComponentType.Explosive]: 'Detonates when destroyed. Chain-reacts with neighbors.',
  [ComponentType.Radio]: 'Keeps detached sections under control (like a remote Command Module).',
  [ComponentType.Hinge90]: 'Rotates attached section 90° on command.',
  [ComponentType.Hinge180]: 'Rotates attached section 180° on command.',
};

function getExtraStats(type: ComponentType): string | null {
  switch (type) {
    case ComponentType.BlasterSmall:
      return `DMG: ${BLASTER_STATS.small.damage}  SPD: ${BLASTER_STATS.small.boltSpeed}  ROF: ${BLASTER_STATS.small.fireRatePerSec}/s`;
    case ComponentType.BlasterMedium:
      return `DMG: ${BLASTER_STATS.medium.damage}  SPD: ${BLASTER_STATS.medium.boltSpeed}  ROF: ${BLASTER_STATS.medium.fireRatePerSec}/s`;
    case ComponentType.BlasterLarge:
      return `DMG: ${BLASTER_STATS.large.damage}  SPD: ${BLASTER_STATS.large.boltSpeed}  ROF: ${BLASTER_STATS.large.fireRatePerSec}/s`;
    case ComponentType.EngineSmall:
      return `Thrust: ${ENGINE_THRUST.small}`;
    case ComponentType.EngineMedium:
      return `Thrust: ${ENGINE_THRUST.medium}`;
    case ComponentType.EngineLarge:
      return `Thrust: ${ENGINE_THRUST.large}`;
    default:
      return null;
  }
}

interface ComponentPanelProps {
  costs: Record<string, number>;
  activeType: ComponentType | null;
  disabledTypes?: Set<ComponentType>;
  onSelect: (type: ComponentType) => void;
  onDragStart: (type: ComponentType) => void;
}

export function ComponentPanel({ costs, activeType, disabledTypes, onSelect, onDragStart }: ComponentPanelProps) {
  return (
    <div className="component-panel">
      <h3 className="component-panel__title">Components</h3>
      <div className="component-panel__list">
        {ALL_COMPONENT_TYPES.map(type => {
          const def = getComponentDef(type);
          const cost = costs[type] ?? 0;
          const desc = COMPONENT_DESCRIPTIONS[type] ?? '';
          const extra = getExtraStats(type);
          const disabled = disabledTypes?.has(type) ?? false;
          return (
            <div
              key={type}
              className={`component-panel__item${activeType === type ? ' component-panel__item--active' : ''}${disabled ? ' component-panel__item--disabled' : ''}`}
              draggable={!disabled}
              onClick={() => !disabled && onSelect(type)}
              onDragStart={(e) => {
                if (disabled) { e.preventDefault(); return; }
                e.dataTransfer.setData('component-type', type);
                onDragStart(type);
              }}
            >
              <ComponentRenderer type={type} size={40} />
              <div className="component-panel__info">
                <span className="component-panel__name">{def.displayName}</span>
                <span className="component-panel__cost">${cost}</span>
              </div>
              <div className="component-panel__tooltip">
                <div className="component-panel__tooltip-name">{def.displayName}</div>
                <div className="component-panel__tooltip-desc">{desc}</div>
                <div className="component-panel__tooltip-stats">
                  <span>HP: {def.maxHealth}</span>
                  <span>Hardness: {def.hardness}</span>
                  <span>Mass: {def.mass}</span>
                </div>
                {extra && <div className="component-panel__tooltip-extra">{extra}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
