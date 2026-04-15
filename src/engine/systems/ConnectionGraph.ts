import { ComponentInstance } from '../entities/ComponentInstance';
import { Side } from '../../types/components';
import { getComponentDef } from '../../game/components';
import { sideOffset, canAttachRuntime } from './ConnectivitySystem';

/**
 * Persistent runtime connection graph.
 * Tracks which components are connected via active edges,
 * distinct from grid adjacency (build-phase concept).
 */
export class ConnectionGraph {
  /** adjacency: compId → Set of connected compIds */
  private adj = new Map<string, Set<string>>();
  /** All edges that ever existed (even if severed), for hasActiveEdge checks */
  private allEdges = new Set<string>();
  /** Severed edges */
  private severedEdges = new Set<string>();

  private static edgeKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  /** Build a ConnectionGraph from components using attachable-side adjacency logic,
   *  optionally excluding edges on unlatched decoupler sides. */
  static fromComponents(
    components: ComponentInstance[],
    unlatchedSides?: Map<string, Side[]>,
  ): ConnectionGraph {
    const graph = new ConnectionGraph();

    // Initialize nodes
    for (const c of components) {
      graph.adj.set(c.id, new Set());
    }

    // Build edges via the same logic as buildComponentAdjacency
    for (let i = 0; i < components.length; i++) {
      for (let j = i + 1; j < components.length; j++) {
        const a = components[i];
        const b = components[j];
        const dx = Math.abs(a.gridX - b.gridX);
        const dy = Math.abs(a.gridY - b.gridY);
        if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
          if (canAttachRuntime(a, b)) {
            const key = ConnectionGraph.edgeKey(a.id, b.id);
            graph.allEdges.add(key);
            graph.adj.get(a.id)!.add(b.id);
            graph.adj.get(b.id)!.add(a.id);
          }
        }
      }
    }

    // Remove edges for unlatched decoupler sides
    if (unlatchedSides) {
      const compById = new Map(components.map(c => [c.id, c]));
      for (const [compId, sides] of unlatchedSides) {
        const comp = compById.get(compId);
        if (!comp) continue;
        for (const side of sides) {
          const off = sideOffset(side);
          const nx = comp.gridX + off.dx;
          const ny = comp.gridY + off.dy;
          const neighbor = components.find(c => c.gridX === nx && c.gridY === ny);
          if (neighbor) {
            graph.sever(compId, neighbor.id);
          }
        }
      }
    }

    return graph;
  }

  /** Sever the edge between two components. Returns true if edge existed and was active. */
  sever(compA: string, compB: string): boolean {
    const key = ConnectionGraph.edgeKey(compA, compB);
    if (!this.allEdges.has(key)) return false;
    if (this.severedEdges.has(key)) return false;

    this.severedEdges.add(key);
    this.adj.get(compA)?.delete(compB);
    this.adj.get(compB)?.delete(compA);
    return true;
  }

  /** Restore a severed edge. Returns true if edge was severed and is now restored. */
  restore(compA: string, compB: string): boolean {
    const key = ConnectionGraph.edgeKey(compA, compB);
    if (!this.allEdges.has(key)) return false;
    if (!this.severedEdges.has(key)) return false;

    this.severedEdges.delete(key);
    this.adj.get(compA)?.add(compB);
    this.adj.get(compB)?.add(compA);
    return true;
  }

  /** Remove a component and all its edges from the graph. */
  removeComponent(compId: string): void {
    const neighbors = this.adj.get(compId);
    if (neighbors) {
      for (const nid of neighbors) {
        this.adj.get(nid)?.delete(compId);
        const key = ConnectionGraph.edgeKey(compId, nid);
        this.allEdges.delete(key);
        this.severedEdges.delete(key);
      }
    }
    // Also clean up severed edges involving this component
    for (const key of this.severedEdges) {
      if (key.startsWith(compId + '|') || key.endsWith('|' + compId)) {
        this.severedEdges.delete(key);
        this.allEdges.delete(key);
      }
    }
    this.adj.delete(compId);
  }

  /** Merge another graph into this one. Adds all nodes and edges. */
  mergeFrom(other: ConnectionGraph): void {
    for (const [id, neighbors] of other.adj) {
      if (!this.adj.has(id)) {
        this.adj.set(id, new Set(neighbors));
      } else {
        for (const nid of neighbors) {
          this.adj.get(id)!.add(nid);
        }
      }
    }
    for (const key of other.allEdges) {
      this.allEdges.add(key);
    }
    for (const key of other.severedEdges) {
      this.severedEdges.add(key);
    }
  }

  /** BFS from connectivity anchors, return set of reachable component IDs. */
  getReachableFromAnchors(components: ComponentInstance[]): Set<string> {
    const visited = new Set<string>();
    const queue: string[] = [];
    for (const c of components) {
      if (!this.adj.has(c.id)) continue;
      if (getComponentDef(c.type).isConnectivityAnchor && c.health > 0) {
        visited.add(c.id);
        queue.push(c.id);
      }
    }
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const neighborId of this.adj.get(id) ?? []) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      }
    }
    return visited;
  }

  /** Group component IDs into connected clusters. */
  getConnectedClusters(compIds: string[]): string[][] {
    const idSet = new Set(compIds);
    const visited = new Set<string>();
    const clusters: string[][] = [];

    for (const id of compIds) {
      if (visited.has(id)) continue;
      const cluster: string[] = [];
      const queue: string[] = [id];
      visited.add(id);
      while (queue.length > 0) {
        const cid = queue.shift()!;
        cluster.push(cid);
        for (const nid of this.adj.get(cid) ?? []) {
          if (idSet.has(nid) && !visited.has(nid)) {
            visited.add(nid);
            queue.push(nid);
          }
        }
      }
      clusters.push(cluster);
    }
    return clusters;
  }

  /** Get active neighbors of a component. */
  getNeighbors(compId: string): string[] {
    return [...(this.adj.get(compId) ?? [])];
  }

  /** Check if there is an active (non-severed) edge between two components.
   *  Returns true if there was ever an edge and it's NOT severed.
   *  Used for rendering disconnected edge glow. */
  hasActiveEdge(compA: string, compB: string): boolean {
    const key = ConnectionGraph.edgeKey(compA, compB);
    return this.allEdges.has(key) && !this.severedEdges.has(key);
  }

  /** Check if an edge exists (active or severed) between two components. */
  hasEdge(compA: string, compB: string): boolean {
    return this.allEdges.has(ConnectionGraph.edgeKey(compA, compB));
  }

  /** Check if an edge is severed between two components. */
  isSevered(compA: string, compB: string): boolean {
    return this.severedEdges.has(ConnectionGraph.edgeKey(compA, compB));
  }

  /** Extract a subgraph containing only the specified component IDs. */
  extractSubgraph(compIds: string[]): ConnectionGraph {
    const idSet = new Set(compIds);
    const sub = new ConnectionGraph();
    for (const id of compIds) {
      sub.adj.set(id, new Set());
    }
    for (const id of compIds) {
      for (const nid of this.adj.get(id) ?? []) {
        if (idSet.has(nid)) {
          sub.adj.get(id)!.add(nid);
          const key = ConnectionGraph.edgeKey(id, nid);
          sub.allEdges.add(key);
        }
      }
    }
    // Copy severed edges within subgraph
    for (const key of this.severedEdges) {
      const [a, b] = key.split('|');
      if (idSet.has(a) && idSet.has(b)) {
        sub.severedEdges.add(key);
        sub.allEdges.add(key);
      }
    }
    return sub;
  }

  /** Convert to a plain adjacency map (active edges only). */
  toAdjMap(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const [id, neighbors] of this.adj) {
      result.set(id, [...neighbors]);
    }
    return result;
  }

  /** Add a node (component) to the graph if not already present. */
  addNode(compId: string): void {
    if (!this.adj.has(compId)) {
      this.adj.set(compId, new Set());
    }
  }

  /** Check if a component exists as a node in the graph. */
  hasNode(compId: string): boolean {
    return this.adj.has(compId);
  }

  /** Remove any graph nodes whose IDs are not in the living set. */
  syncWithLiving(livingIds: Set<string>): void {
    for (const id of [...this.adj.keys()]) {
      if (!livingIds.has(id)) {
        this.removeComponent(id);
      }
    }
  }

  /** Add an edge between two components (both directions). */
  addEdge(compA: string, compB: string): void {
    this.addNode(compA);
    this.addNode(compB);
    const key = ConnectionGraph.edgeKey(compA, compB);
    this.allEdges.add(key);
    this.adj.get(compA)!.add(compB);
    this.adj.get(compB)!.add(compA);
  }
}
