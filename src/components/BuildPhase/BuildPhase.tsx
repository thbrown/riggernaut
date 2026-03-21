import { useCallback, useState } from 'react';
import { GamePhase } from '../../types/game';
import { ComponentType, Side } from '../../types/components';
import { PlacedComponent, GridPosition, rotateSide } from '../../types/grid';
import { useGame } from '../../state/GameContext';
import { computeAttachment } from '../../game/grid-logic';
import { getComponentDef } from '../../game/component-registry';
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
  const commandModuleCount = components.filter(c => c.type === ComponentType.CommandModule).length;
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

  const handleCycleSides = useCallback((id: string) => {
    updateComponents(components.map(c => {
      if (c.id !== id) return c;
      const isHinge = c.type === ComponentType.Hinge90 || c.type === ComponentType.Hinge180;
      let baseSides: Side[];
      if (isHinge) {
        const step = c.hingeStartAngle ?? 0;
        const movableSide = rotateSide(Side.East, step);
        baseSides = [Side.West, movableSide];
      } else {
        const def = getComponentDef(c.type as ComponentType);
        baseSides = [...def.attachableSides];
      }

      if (baseSides.length <= 1) return c; // Nothing to cycle

      // Generate all non-empty subsets, starting with full set
      const subsets: Side[][] = [];
      const n = baseSides.length;
      for (let mask = (1 << n) - 1; mask >= 1; mask--) {
        const subset: Side[] = [];
        for (let i = 0; i < n; i++) {
          if (mask & (1 << i)) subset.push(baseSides[i]);
        }
        subsets.push(subset);
      }

      // Find current subset index
      const currentEnabled = c.enabledSides ?? baseSides;
      const currentIdx = subsets.findIndex(s =>
        s.length === currentEnabled.length && s.every(side => currentEnabled.includes(side))
      );
      const nextIdx = (currentIdx + 1) % subsets.length;
      const nextSubset = subsets[nextIdx];

      // If next subset is full set, clear enabledSides (undefined = all enabled)
      if (nextSubset.length === baseSides.length) {
        return { ...c, enabledSides: undefined };
      }
      return { ...c, enabledSides: nextSubset };
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
          onCycleSides={handleCycleSides}
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
