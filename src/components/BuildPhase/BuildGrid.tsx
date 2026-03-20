import { useCallback, useState, DragEvent } from 'react';
import { ComponentType } from '../../types/components';
import { PlacedComponent, GridPosition } from '../../types/grid';
import { ComponentRenderer } from './ComponentRenderer';
import { computeAttachment, isOccupied } from '../../game/grid-logic';
import './BuildGrid.css';

const TILE_PX = 50;

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
}

export function BuildGrid({
  width, height, components, activeComponentType,
  onPlaceComponent, onRemoveComponent, onMoveComponent, onRotateComponent,
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
      // Moving existing component
      if (!isOccupied(components.filter(c => c.id !== movingId), pos)) {
        onMoveComponent(movingId, pos);
      }
    } else if (componentType) {
      // Placing new component from panel
      if (!isOccupied(components, pos)) {
        onPlaceComponent(componentType, pos);
      }
    }
  }, [components, onPlaceComponent, onMoveComponent]);

  const handleComponentDragStart = useCallback((e: DragEvent, comp: PlacedComponent) => {
    e.dataTransfer.setData('component-id', comp.id);
    e.dataTransfer.setData('component-type', comp.type);
  }, []);

  // Drag-out-to-sell: if a component is dragged and dropped outside the grid, remove it
  const handleDragEnd = useCallback((e: DragEvent, comp: PlacedComponent) => {
    // dropEffect 'none' means it was not dropped on a valid target
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

  // Build position lookup for placed components
  const compByPos = new Map<string, PlacedComponent>();
  for (const c of components) {
    compByPos.set(`${c.position.x},${c.position.y}`, c);
  }

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
                    />
                    {isSelected && (
                      <div className="build-grid__actions">
                        <button
                          className="build-grid__action-btn"
                          onClick={(e) => { e.stopPropagation(); onRotateComponent(comp.id); }}
                          title="Rotate (or right-click)"
                        >
                          R
                        </button>
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
