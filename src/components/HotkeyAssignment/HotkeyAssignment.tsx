import { useCallback, useEffect, useMemo, useState } from 'react';
import { GamePhase } from '../../types/game';
import { ComponentType } from '../../types/components';
import { PlacedComponent } from '../../types/grid';
import { useGame } from '../../state/GameContext';
import { getComponentDef } from '../../game/component-registry';
import { createBlueprint } from '../../game/blueprint';
import { computeAttachment } from '../../game/grid-logic';
import { ComponentRenderer } from '../BuildPhase/ComponentRenderer';
import { PhaseNav } from '../PhaseNav';
import './HotkeyAssignment.css';

const TILE_PX = 50;

function getActionLabel(type: ComponentType): string {
  switch (type) {
    case ComponentType.EngineSmall:
    case ComponentType.EngineMedium:
    case ComponentType.EngineLarge:
      return 'Thrust';
    case ComponentType.BlasterSmall:
    case ComponentType.BlasterMedium:
    case ComponentType.BlasterLarge:
      return 'Fire';
    case ComponentType.Hinge90:
    case ComponentType.Hinge180:
      return 'Rotate';
    case ComponentType.Decoupler:
      return 'Detach';
    case ComponentType.Explosive:
      return 'Detonate';
    case ComponentType.Radio:
      return 'Relay';
    default:
      return '';
  }
}

/** Entry in the order drawer: one component + which key slot binds it */
interface OrderEntry {
  comp: PlacedComponent;
  key: string;
  slotLabel: string; // e.g. "Key", "North", "Left"
}

export function HotkeyAssignment() {
  const { state, dispatch } = useGame();
  const { buildGrid } = state;
  const [components, setComponents] = useState<PlacedComponent[]>(buildGrid.components);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number>(0); // which hotkey slot (0=primary, 1+=additional)
  const [drawerOpen, setDrawerOpen] = useState(true);

  // Only show attached components
  const { attached } = computeAttachment(components);
  const shipComponents = components.filter(c => attached.has(c.id));

  // Compute grid bounds to center the ship display
  const minX = Math.min(...shipComponents.map(c => c.position.x));
  const maxX = Math.max(...shipComponents.map(c => c.position.x));
  const minY = Math.min(...shipComponents.map(c => c.position.y));
  const maxY = Math.max(...shipComponents.map(c => c.position.y));
  const gridW = maxX - minX + 1;
  const gridH = maxY - minY + 1;

  /** How many hotkey slots a component type needs */
  function getHotkeySlotCount(type: ComponentType): number {
    if (type === ComponentType.Hinge90 || type === ComponentType.Hinge180) return 2; // left, right
    if (type === ComponentType.Decoupler) return 4; // N, E, S, W sides
    return 1;
  }

  function getSlotLabel(type: ComponentType, slot: number): string {
    if (type === ComponentType.Hinge90 || type === ComponentType.Hinge180) {
      return slot === 0 ? 'Left' : 'Right';
    }
    if (type === ComponentType.Decoupler) {
      return ['Top', 'Right', 'Bottom', 'Left'][slot];
    }
    return 'Key';
  }

  // Build hotkey groups for the order drawer
  const hotkeyGroups = useMemo(() => {
    const groups = new Map<string, OrderEntry[]>();
    for (const comp of shipComponents) {
      const def = getComponentDef(comp.type as ComponentType);
      if (!def.hasPower) continue;

      // Primary hotkey
      if (comp.hotkey) {
        const entries = groups.get(comp.hotkey) ?? [];
        entries.push({ comp, key: comp.hotkey, slotLabel: getSlotLabel(comp.type as ComponentType, 0) });
        groups.set(comp.hotkey, entries);
      }
      // Additional hotkeys
      if (comp.hotkeys) {
        for (let i = 0; i < comp.hotkeys.length; i++) {
          const hk = comp.hotkeys[i];
          if (!hk) continue;
          const entries = groups.get(hk) ?? [];
          entries.push({ comp, key: hk, slotLabel: getSlotLabel(comp.type as ComponentType, i + 1) });
          groups.set(hk, entries);
        }
      }
    }

    // Sort entries within each group by per-key priority (falling back to hotkeyPriority)
    for (const [key, entries] of groups.entries()) {
      entries.sort((a, b) => {
        const aPri = a.comp.hotkeyPriorities?.[key] ?? a.comp.hotkeyPriority ?? 0;
        const bPri = b.comp.hotkeyPriorities?.[key] ?? b.comp.hotkeyPriority ?? 0;
        return aPri - bPri;
      });
    }

    // Sort keys alphabetically
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shipComponents]);

  const moveInGroup = useCallback((key: string, fromIdx: number, toIdx: number) => {
    // Find the group entries for this key
    const group = hotkeyGroups.find(([k]) => k === key);
    if (!group) return;
    const entries = group[1];
    if (toIdx < 0 || toIdx >= entries.length) return;

    // Swap priorities: assign new sequential priorities based on new order
    const reordered = [...entries];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    // Build a map of compId -> new priority for this key group
    const newPriorities = new Map<string, number>();
    reordered.forEach((entry, idx) => {
      newPriorities.set(entry.comp.id, idx);
    });

    setComponents(prev => prev.map(c => {
      const newPri = newPriorities.get(c.id);
      if (newPri !== undefined) {
        const hotkeyPriorities = { ...(c.hotkeyPriorities ?? {}), [key]: newPri };
        return { ...c, hotkeyPriorities };
      }
      return c;
    }));
  }, [hotkeyGroups]);

  // Keyboard listener for assigning hotkeys
  useEffect(() => {
    if (!selectedId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      const comp = components.find(c => c.id === selectedId);
      if (!comp) { setSelectedId(null); return; }

      if (e.key === 'Escape') {
        // Remove hotkey for current slot
        if (selectedSlot === 0) {
          setComponents(prev => prev.map(c =>
            c.id === selectedId ? { ...c, hotkey: undefined } : c
          ));
        } else {
          setComponents(prev => prev.map(c => {
            if (c.id !== selectedId) return c;
            const hotkeys = [...(c.hotkeys ?? [])];
            hotkeys[selectedSlot - 1] = '';
            return { ...c, hotkeys };
          }));
        }
      } else {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (selectedSlot === 0) {
          setComponents(prev => prev.map(c =>
            c.id === selectedId ? { ...c, hotkey: key } : c
          ));
        } else {
          setComponents(prev => prev.map(c => {
            if (c.id !== selectedId) return c;
            const hotkeys = [...(c.hotkeys ?? [])];
            hotkeys[selectedSlot - 1] = key;
            return { ...c, hotkeys };
          }));
        }
      }
      setSelectedId(null);
      setSelectedSlot(0);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, selectedSlot, components]);

  const handleProceed = useCallback(() => {
    // Sync hotkeys back and create blueprint
    dispatch({ type: 'SET_BUILD_COMPONENTS', components });
    const blueprint = createBlueprint(components);
    dispatch({ type: 'SET_BLUEPRINT', blueprint });
    dispatch({ type: 'SET_PHASE', phase: GamePhase.OpponentSelection });
  }, [components, dispatch]);

  const handleBack = useCallback(() => {
    dispatch({ type: 'SET_BUILD_COMPONENTS', components });
    dispatch({ type: 'SET_PHASE', phase: GamePhase.Build });
  }, [components, dispatch]);

  const powerComponents = shipComponents.filter(c => {
    const def = getComponentDef(c.type as ComponentType);
    return def.hasPower;
  });

  return (
    <div className="hotkey-assignment">
      <div className="hotkey-assignment__content">
      <div className="hotkey-assignment__sidebar">
        <h3>Hotkey Assignment</h3>
        <p className="hotkey-assignment__hint">
          Click a powered component, then press a key to assign it.
          Press Escape to remove a hotkey.
        </p>
        <div className="hotkey-assignment__list">
          {powerComponents.map(comp => {
            const def = getComponentDef(comp.type as ComponentType);
            const slotCount = getHotkeySlotCount(comp.type as ComponentType);
            return (
              <div key={comp.id} className="hotkey-assignment__item-group">
                <div
                  className={`hotkey-assignment__item ${selectedId === comp.id && selectedSlot === 0 ? 'hotkey-assignment__item--selected' : ''}`}
                  onClick={() => { setSelectedId(comp.id); setSelectedSlot(0); }}
                >
                  <ComponentRenderer type={comp.type as ComponentType} size={30} rotation={comp.rotation} />
                  <span className="hotkey-assignment__name">{def.displayName}</span>
                  <span className="hotkey-assignment__key">
                    {slotCount > 1 ? `${getSlotLabel(comp.type as ComponentType, 0)}: ` : ''}
                    {comp.hotkey ? `[${comp.hotkey.toUpperCase()}]` : '---'}
                  </span>
                </div>
                {slotCount > 1 && Array.from({ length: slotCount - 1 }, (_, i) => (
                  <div
                    key={`${comp.id}-slot-${i + 1}`}
                    className={`hotkey-assignment__item hotkey-assignment__item--sub ${selectedId === comp.id && selectedSlot === i + 1 ? 'hotkey-assignment__item--selected' : ''}`}
                    onClick={() => { setSelectedId(comp.id); setSelectedSlot(i + 1); }}
                  >
                    <span className="hotkey-assignment__name" style={{ paddingLeft: 34 }}>
                      {getSlotLabel(comp.type as ComponentType, i + 1)}
                    </span>
                    <span className="hotkey-assignment__key">
                      {comp.hotkeys?.[i] ? `[${comp.hotkeys[i].toUpperCase()}]` : '---'}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <div className="hotkey-assignment__grid-area">
        <div
          className="hotkey-assignment__grid"
          style={{
            width: gridW * TILE_PX,
            height: gridH * TILE_PX,
            gridTemplateColumns: `repeat(${gridW}, ${TILE_PX}px)`,
            gridTemplateRows: `repeat(${gridH}, ${TILE_PX}px)`,
          }}
        >
          {shipComponents.map(comp => {
            const def = getComponentDef(comp.type as ComponentType);
            const isSelectable = def.hasPower;
            const isSelected = selectedId === comp.id;
            return (
              <div
                key={comp.id}
                className={`hotkey-assignment__cell ${isSelectable ? 'hotkey-assignment__cell--selectable' : ''} ${isSelected ? 'hotkey-assignment__cell--selected' : ''}`}
                style={{
                  gridColumn: comp.position.x - minX + 1,
                  gridRow: comp.position.y - minY + 1,
                }}
                onClick={(e) => {
                  if (!isSelectable) return;
                  setSelectedId(comp.id);
                  // For decouplers, detect click quadrant to select the side slot
                  if (comp.type === ComponentType.Decoupler) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const cx = e.clientX - rect.left - rect.width / 2;
                    const cy = e.clientY - rect.top - rect.height / 2;
                    // Inverse-rotate click coords by component rotation
                    const rad = -comp.rotation * Math.PI / 2;
                    const cosR = Math.cos(rad);
                    const sinR = Math.sin(rad);
                    const rx = cx * cosR - cy * sinR;
                    const ry = cx * sinR + cy * cosR;
                    // Determine quadrant: Top=0, Right=1, Bottom=2, Left=3
                    if (Math.abs(ry) > Math.abs(rx)) {
                      setSelectedSlot(ry < 0 ? 0 : 2);
                    } else {
                      setSelectedSlot(rx > 0 ? 1 : 3);
                    }
                  } else {
                    setSelectedSlot(0);
                  }
                }}
              >
                <ComponentRenderer
                  type={comp.type as ComponentType}
                  rotation={comp.rotation}
                  size={TILE_PX}
                />
                {comp.type === ComponentType.Decoupler ? (
                  // Per-edge hotkey labels for decouplers (matches battle phase canvas style)
                  <>
                    {[
                      { key: comp.hotkey },
                      { key: comp.hotkeys?.[0] },
                      { key: comp.hotkeys?.[1] },
                      { key: comp.hotkeys?.[2] },
                    ].map((edge, i) => {
                      if (!edge.key) return null;
                      // Rotate label positions by component rotation
                      const rotIdx = (i + comp.rotation) % 4;
                      const positions = [
                        { top: 2, left: '50%', transform: 'translateX(-50%)' },
                        { right: 2, top: '50%', transform: 'translateY(-50%)' },
                        { bottom: 2, left: '50%', transform: 'translateX(-50%)' },
                        { left: 2, top: '50%', transform: 'translateY(-50%)' },
                      ];
                      return (
                        <div
                          key={i}
                          className="hotkey-assignment__label hotkey-assignment__label--edge"
                          style={{ ...positions[rotIdx] as any, position: 'absolute' }}
                        >
                          {edge.key.toUpperCase()}
                        </div>
                      );
                    })}
                  </>
                ) : comp.hotkey ? (
                  <div className="hotkey-assignment__label hotkey-assignment__label--center">
                    {comp.hotkey.toUpperCase()}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {/* Hotkey Order Drawer */}
      <div className={`hotkey-order-drawer ${drawerOpen ? 'hotkey-order-drawer--open' : ''}`}>
        <button
          className="hotkey-order-drawer__toggle"
          onClick={() => setDrawerOpen(prev => !prev)}
        >
          {drawerOpen ? 'Order >' : '< Order'}
        </button>
        {drawerOpen && (
          <div className="hotkey-order-drawer__body">
            <h3>Key Order</h3>
            <p className="hotkey-order-drawer__hint">
              When components share a key, they activate top-to-bottom.
            </p>
            {hotkeyGroups.length === 0 && (
              <p className="hotkey-order-drawer__empty">No hotkeys assigned yet.</p>
            )}
            {hotkeyGroups.map(([key, entries]) => (
              <div key={key} className="hotkey-order-group">
                <div className="hotkey-order-group__header">
                  [{key.toUpperCase()}]
                  {entries.length > 1 && (
                    <span className="hotkey-order-group__count">{entries.length} actions</span>
                  )}
                </div>
                {entries.map((entry, idx) => {
                  const def = getComponentDef(entry.comp.type as ComponentType);
                  const action = getActionLabel(entry.comp.type as ComponentType);
                  return (
                    <div key={`${entry.comp.id}-${entry.slotLabel}`} className="hotkey-order-group__item">
                      <span className="hotkey-order-group__rank">{idx + 1}</span>
                      <ComponentRenderer type={entry.comp.type as ComponentType} size={22} rotation={entry.comp.rotation} />
                      <span className="hotkey-order-group__name">{def.displayName}</span>
                      <span className="hotkey-order-group__action">{action}</span>
                      {entries.length > 1 && (
                        <span className="hotkey-order-group__arrows">
                          <button
                            disabled={idx === 0}
                            onClick={() => moveInGroup(key, idx, idx - 1)}
                            title="Move up (higher priority)"
                          >^</button>
                          <button
                            disabled={idx === entries.length - 1}
                            onClick={() => moveInGroup(key, idx, idx + 1)}
                            title="Move down (lower priority)"
                          >v</button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
      <PhaseNav
        onBack={handleBack}
        onNext={handleProceed}
        backLabel="Back to Build"
        nextLabel="Select Opponents"
      />
    </div>
  );
}
