import { useState } from 'react';
import { ComponentType } from '../../types/components';
import { ALL_COMPONENT_TYPES, getComponentDef } from '../../game/components';
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
  const def = getComponentDef(type);
  if (def.config.kind === 'blaster') {
    return `DMG: ${def.config.damage}  SPD: ${def.config.boltSpeed}  ROF: ${def.config.fireRatePerSec}/s`;
  }
  if (def.config.kind === 'engine') {
    return `Thrust: ${def.config.thrust}`;
  }
  return null;
}

interface ComponentPanelProps {
  costs: Record<string, number>;
  activeType: ComponentType | null;
  disabledTypes?: Set<ComponentType>;
  onSelect: (type: ComponentType) => void;
  onDragStart: (type: ComponentType) => void;
}

export function ComponentPanel({ costs, activeType, disabledTypes, onSelect, onDragStart }: ComponentPanelProps) {
  const [hoveredType, setHoveredType] = useState<ComponentType | null>(null);

  // Show description for hovered item, falling back to active (selected) item
  const detailType = hoveredType ?? activeType;
  const detailDef = detailType ? getComponentDef(detailType) : null;
  const detailDesc = detailType ? (COMPONENT_DESCRIPTIONS[detailType] ?? '') : '';
  const detailExtra = detailType ? getExtraStats(detailType) : null;

  return (
    <div className="component-panel">
      <h3 className="component-panel__title">Components</h3>
      <div className="component-panel__list">
        {ALL_COMPONENT_TYPES.map(type => {
          const def = getComponentDef(type);
          const cost = costs[type] ?? 0;
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
              onMouseEnter={() => setHoveredType(type)}
              onMouseLeave={() => setHoveredType(null)}
            >
              <ComponentRenderer type={type} size={40} />
              <div className="component-panel__info">
                <span className="component-panel__name">{def.displayName}</span>
                <span className="component-panel__cost">${cost}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="component-panel__desc-section">
        {detailDef ? (
          <>
            <div className="component-panel__desc-header">{detailDef.displayName}</div>
            <div className="component-panel__desc-text">{detailDesc}</div>
            <div className="component-panel__desc-stats">
              <span>HP: {detailDef.maxHealth}</span>
              <span>Hardness: {detailDef.hardness}</span>
              <span>Mass: {detailDef.mass}</span>
            </div>
            {detailExtra && <div className="component-panel__desc-extra">{detailExtra}</div>}
          </>
        ) : (
          <div className="component-panel__desc-empty">Hover or select a component</div>
        )}
      </div>
    </div>
  );
}
