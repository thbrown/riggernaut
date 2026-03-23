import { useCallback, useState } from 'react';
import { GamePhase } from '../../types/game';
import { ComponentType, Side } from '../../types/components';
import { PlacedComponent, GridPosition, rotateSide } from '../../types/grid';
import { useGame } from '../../state/GameContext';
import { computeAttachment } from '../../game/grid-logic';
import { getComponentDef } from '../../game/components';
import { getHingeStartAngleSteps } from './ComponentRenderer';
import { ComponentPanel } from './ComponentPanel';
import { BuildGrid } from './BuildGrid';
import { PhaseNav } from '../PhaseNav';
import './BuildPhase.css';

let nextId = 1;
function genId(): string {
  return `comp_${nextId++}`;
}

export function BuildPhase() {
  const { state, dispatch } = useGame();
  const { costs, buildGrid, settings, sandbox } = state;
  const { components } = buildGrid;
  const [activeComponentType, setActiveComponentType] = useState<ComponentType | null>(null);

  // Compute total cost
  const totalCost = components.reduce((sum, c) => sum + (costs[c.type] ?? 0), 0);
  const remainingFunds = settings.initialFunds - totalCost;
  const fundsNegative = !sandbox && remainingFunds < 0;

  // Check if ship is valid (has exactly one command module, all attached)
  const { unattached } = computeAttachment(components);
  const commandModuleCount = components.filter(c => getComponentDef(c.type as ComponentType).isConnectivityAnchor).length;
  const hasCommandModule = commandModuleCount === 1;
  const tooManyCommandModules = commandModuleCount > 1;
  const allAttached = unattached.size === 0;
  const canProceed = !fundsNegative && hasCommandModule && !tooManyCommandModules && allAttached && components.length > 0;

  // Disable Command Module in palette if one is already placed
  const disabledTypes = new Set<ComponentType>();
  if (commandModuleCount >= 1) {
    disabledTypes.add(ComponentType.CommandModule);
  }

  const updateComponents = useCallback((newComponents: PlacedComponent[]) => {
    dispatch({ type: 'SET_BUILD_COMPONENTS', components: newComponents });
  }, [dispatch]);

  const handlePlaceComponent = useCallback((type: ComponentType, pos: GridPosition) => {
    if (disabledTypes.has(type)) return;
    const comp: PlacedComponent = {
      id: genId(),
      type,
      position: pos,
      rotation: 0,
    };
    updateComponents([...components, comp]);
    setActiveComponentType(type);
  }, [components, updateComponents, disabledTypes]);

  const handleRemoveComponent = useCallback((id: string) => {
    updateComponents(components.filter(c => c.id !== id));
  }, [components, updateComponents]);

  const handleMoveComponent = useCallback((id: string, pos: GridPosition) => {
    updateComponents(components.map(c =>
      c.id === id ? { ...c, position: pos } : c
    ));
  }, [components, updateComponents]);

  const handleRotateComponent = useCallback((id: string) => {
    updateComponents(components.map(c =>
      c.id === id ? { ...c, rotation: (c.rotation + 1) % 4 } : c
    ));
  }, [components, updateComponents]);

  const handleCycleHingeAngle = useCallback((id: string) => {
    updateComponents(components.map(c => {
      if (c.id !== id) return c;
      const maxSteps = getHingeStartAngleSteps(c.type as ComponentType);
      const current = c.hingeStartAngle ?? 0;
      // Reset enabledSides when changing hinge angle since base sides change
      return { ...c, hingeStartAngle: (current + 1) % maxSteps, enabledSides: undefined };
    }));
  }, [components, updateComponents]);

  const handleToggleSide = useCallback((id: string, side: Side) => {
    updateComponents(components.map(c => {
      if (c.id !== id) return c;
      const def = getComponentDef(c.type as ComponentType);
      let baseSides: Side[];
      if (def.colliderShape === 'circle' && def.config.kind === 'hinge') {
        const step = c.hingeStartAngle ?? 0;
        baseSides = [Side.West, rotateSide(Side.East, step)];
      } else {
        baseSides = [...def.attachableSides];
      }

      if (!baseSides.includes(side)) return c; // Can't toggle non-base sides

      const currentEnabled = c.enabledSides ?? [...baseSides];
      const isEnabled = currentEnabled.includes(side);

      if (isEnabled) {
        const newSides = currentEnabled.filter(s => s !== side);
        if (newSides.length === 0) return c; // Can't disable all
        return { ...c, enabledSides: newSides };
      } else {
        const newSides = [...currentEnabled, side];
        // If all sides re-enabled, clear enabledSides (undefined = all enabled)
        return { ...c, enabledSides: newSides.length === baseSides.length ? undefined : newSides };
      }
    }));
  }, [components, updateComponents]);

  const handleProceed = () => {
    dispatch({ type: 'SET_PHASE', phase: GamePhase.HotkeyAssignment });
  };

  const handleBack = () => {
    dispatch({ type: 'SET_PHASE', phase: GamePhase.MainMenu });
  };

  return (
    <div className="build-phase">
      <ComponentPanel
        costs={costs}
        activeType={activeComponentType}
        disabledTypes={disabledTypes}
        onSelect={(type) => setActiveComponentType(prev => prev === type ? null : type)}
        onDragStart={(type) => setActiveComponentType(type)}
      />
      <div className="build-phase__main">
        <div className="build-phase__header">
          <div className="build-phase__funds">
            {sandbox ? (
              <span style={{ color: '#2ecc71' }}>SANDBOX MODE</span>
            ) : (
              <>
                Funds: <span className={fundsNegative ? 'build-phase__funds--negative' : ''}>
                  ${remainingFunds}
                </span>
                {' / '}${settings.initialFunds}
              </>
            )}
          </div>
          <div className="build-phase__actions">
            <button
              className="build-phase__btn"
              onClick={() => updateComponents([])}
              disabled={components.length === 0}
            >
              Clear All
            </button>
            <button
              className="build-phase__btn"
              onClick={() => dispatch({ type: 'TOGGLE_SANDBOX' })}
              style={sandbox ? { borderColor: '#2ecc71', color: '#2ecc71' } : undefined}
            >
              {sandbox ? 'Sandbox: ON' : 'Sandbox: OFF'}
            </button>
          </div>
        </div>
        <BuildGrid
          width={buildGrid.width}
          height={buildGrid.height}
          components={components}
          costs={costs}
          activeComponentType={activeComponentType}
          onPlaceComponent={handlePlaceComponent}
          onRemoveComponent={handleRemoveComponent}
          onMoveComponent={handleMoveComponent}
          onRotateComponent={handleRotateComponent}
          onCycleHingeAngle={handleCycleHingeAngle}
          onToggleSide={handleToggleSide}
        />
        <PhaseNav
          onBack={handleBack}
          onNext={handleProceed}
          backLabel="Main Menu"
          nextLabel="Assign Hotkeys"
          nextDisabled={!canProceed}
          nextTitle={
            commandModuleCount === 0 ? 'Place a Command Module first'
              : tooManyCommandModules ? 'Only one Command Module allowed'
              : !allAttached ? 'All components must be connected'
              : fundsNegative ? 'Cannot proceed with negative funds'
              : ''
          }
        />
      </div>
    </div>
  );
}
