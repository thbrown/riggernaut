import { useCallback, useState, DragEvent } from 'react';
import { ComponentType, Side } from '../../types/components';
import { PlacedComponent, GridPosition, rotateSide } from '../../types/grid';
import { ComponentRenderer } from './ComponentRenderer';
import { computeAttachment, isOccupied } from '../../game/grid-logic';
import { getComponentDef } from '../../game/components';
import './BuildGrid.css';

const TILE_PX = 50;

/** Map local side → CSS positioning for edge toggle zones */
function edgeToggleStyle(side: Side): React.CSSProperties {
  const thickness = 10;
  const base: React.CSSProperties = { position: 'absolute', zIndex: 2 };
  switch (side) {
    case Side.North: return { ...base, top: 0, left: thickness, right: thickness, height: thickness };
    case Side.South: return { ...base, bottom: 0, left: thickness, right: thickness, height: thickness };
    case Side.East:  return { ...base, right: 0, top: thickness, bottom: thickness, width: thickness };
    case Side.West:  return { ...base, left: 0, top: thickness, bottom: thickness, width: thickness };
  }
}

/** Get base attachable sides for a component (unrotated) */
function getBaseSides(comp: PlacedComponent): Side[] {
  const def = getComponentDef(comp.type as ComponentType);
  if (def.colliderShape === 'circle' && def.config.kind === 'hinge') {
    const step = comp.hingeStartAngle ?? 0;
    return [Side.West, rotateSide(Side.East, step)];
  }
  return [...def.attachableSides];
}

interface BuildGridProps {
  width: number;
  height: number;
  components: PlacedComponent[];
  costs: Record<string, number>;
  activeComponentType: ComponentType | null;
  onPlaceComponent: (type: ComponentType, pos: GridPosition) => void;
  onRemoveComponent: (id: string) => void;
  onMoveComponent: (id: string, pos: GridPosition) => void;
  onRotateComponent: (id: string) => void;
  onCycleHingeAngle?: (id: string) => void;
  onToggleSide?: (id: string, side: Side) => void;
}

export function BuildGrid({
  width, height, components, activeComponentType,
  onPlaceComponent, onRemoveComponent, onMoveComponent, onRotateComponent,
  onCycleHingeAngle, onToggleSide,
}: BuildGridProps) {
  const [dragOverPos, setDragOverPos] = useState<GridPosition | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { unattached } = computeAttachment(components);

  const handleDragOver = useCallback((e: DragEvent, pos: GridPosition) => {
    e.preventDefault();
    setDragOverPos(pos);
  }, []);

  const handleDrop = useCallback((e: DragEvent, pos: GridPosition) => {
    e.preventDefault();
    setDragOverPos(null);

    const componentType = e.dataTransfer.getData('component-type') as ComponentType;
    const movingId = e.dataTransfer.getData('component-id');

    if (movingId) {
      if (!isOccupied(components.filter(c => c.id !== movingId), pos)) {
        onMoveComponent(movingId, pos);
      }
    } else if (componentType) {
      if (!isOccupied(components, pos)) {
        onPlaceComponent(componentType, pos);
      }
    }
  }, [components, onPlaceComponent, onMoveComponent]);

  const handleComponentDragStart = useCallback((e: DragEvent, comp: PlacedComponent) => {
    e.dataTransfer.setData('component-id', comp.id);
    e.dataTransfer.setData('component-type', comp.type);
  }, []);

  const handleDragEnd = useCallback((e: DragEvent, comp: PlacedComponent) => {
    if (e.dataTransfer.dropEffect === 'none') {
      onRemoveComponent(comp.id);
    }
  }, [onRemoveComponent]);

  const handleCellClick = useCallback((pos: GridPosition) => {
    setSelectedId(null);
    if (activeComponentType && !isOccupied(components, pos)) {
      onPlaceComponent(activeComponentType, pos);
    }
  }, [activeComponentType, components, onPlaceComponent]);

  const handleComponentClick = useCallback((e: React.MouseEvent, comp: PlacedComponent) => {
    e.stopPropagation();
    setSelectedId(prev => prev === comp.id ? null : comp.id);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, comp: PlacedComponent) => {
    e.preventDefault();
    onRotateComponent(comp.id);
  }, [onRotateComponent]);

  const compByPos = new Map<string, PlacedComponent>();
  for (const c of components) {
    compByPos.set(`${c.position.x},${c.position.y}`, c);
  }

  const isHingeType = (type: string) =>
    type === ComponentType.Hinge90 || type === ComponentType.Hinge180;

  return (
    <div className="build-grid__wrapper">
      <div
        className="build-grid"
        style={{
          width: width * TILE_PX,
          height: height * TILE_PX,
          gridTemplateColumns: `repeat(${width}, ${TILE_PX}px)`,
          gridTemplateRows: `repeat(${height}, ${TILE_PX}px)`,
        }}
      >
        {Array.from({ length: height }, (_, y) =>
          Array.from({ length: width }, (_, x) => {
            const pos = { x, y };
            const key = `${x},${y}`;
            const comp = compByPos.get(key);
            const isOver = dragOverPos?.x === x && dragOverPos?.y === y;
            const isUnattached = comp && unattached.has(comp.id);
            const isSelected = comp && selectedId === comp.id;

            return (
              <div
                key={key}
                className={`build-grid__cell ${isOver ? 'build-grid__cell--hover' : ''}`}
                onDragOver={(e) => handleDragOver(e, pos)}
                onDragLeave={() => setDragOverPos(null)}
                onDrop={(e) => handleDrop(e, pos)}
                onClick={() => handleCellClick(pos)}
              >
                {comp && (
                  <div
                    className={`build-grid__component ${isUnattached ? 'build-grid__component--unattached' : ''} ${isSelected ? 'build-grid__component--selected' : ''}`}
                    draggable
                    onDragStart={(e) => handleComponentDragStart(e, comp)}
                    onDragEnd={(e) => handleDragEnd(e, comp)}
                    onClick={(e) => handleComponentClick(e, comp)}
                    onContextMenu={(e) => handleContextMenu(e, comp)}
                  >
                    <ComponentRenderer
                      type={comp.type as ComponentType}
                      rotation={comp.rotation}
                      size={TILE_PX}
                      dimmed={isUnattached}
                      hingeStartAngle={comp.hingeStartAngle}
                      enabledSides={comp.enabledSides}
                    />
                    {/* Edge toggle zones — click to enable/disable individual attachment sides */}
                    {isSelected && onToggleSide && (() => {
                      const baseSides = getBaseSides(comp);
                      const enabledSides = comp.enabledSides ?? baseSides;
                      // Rotate base sides to visual position (account for component rotation)
                      return baseSides.map(baseSide => {
                        const visualSide = rotateSide(baseSide, comp.rotation);
                        const isEnabled = enabledSides.includes(baseSide);
                        return (
                          <div
                            key={`edge-${baseSide}`}
                            className={`build-grid__edge-toggle ${isEnabled ? 'build-grid__edge-toggle--enabled' : 'build-grid__edge-toggle--disabled'}`}
                            style={edgeToggleStyle(visualSide)}
                            onClick={(e) => { e.stopPropagation(); onToggleSide(comp.id, baseSide); }}
                            title={`${isEnabled ? 'Disable' : 'Enable'} ${Side[baseSide]} attachment`}
                          />
                        );
                      });
                    })()}
                    {isSelected && (
                      <div className="build-grid__actions">
                        <button
                          className="build-grid__action-btn"
                          onClick={(e) => { e.stopPropagation(); onRotateComponent(comp.id); }}
                          title="Rotate (or right-click)"
                        >
                          &#8635;
                        </button>
                        {isHingeType(comp.type) && onCycleHingeAngle && (
                          <button
                            className="build-grid__action-btn"
                            onClick={(e) => { e.stopPropagation(); onCycleHingeAngle(comp.id); }}
                            title="Bend hinge"
                          >
                            &#8736;
                          </button>
                        )}
                        <button
                          className="build-grid__action-btn build-grid__action-btn--remove"
                          onClick={(e) => { e.stopPropagation(); onRemoveComponent(comp.id); setSelectedId(null); }}
                          title="Remove (refund)"
                        >
                          X
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
