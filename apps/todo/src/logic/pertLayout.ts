import dagre from 'dagre';

/**
 * PERT chart layout.
 *
 * Plain dagre ranks tasks left→right by dependency depth and stacks every task
 * that shares a rank into one column. Projects with many parallel tasks (a
 * kickoff that fans out to a checklist) or many tasks without dependencies
 * therefore render as a single tall column that fitView can't show at a
 * readable zoom.
 *
 * This keeps dagre's left→right flow, but:
 *  1. Interchangeable parallel tasks (identical predecessors AND successors)
 *     are drawn as a grid block, joined by one bundled edge on each side
 *     instead of one edge per task.
 *  2. Tasks with no dependencies in either direction get their own grid.
 *  3. Each connected piece of the network is laid out on its own, and the
 *     pieces are packed into rows sized to the viewport's aspect ratio.
 *  4. dagre's edge routes are returned, so edges that skip columns can be
 *     drawn through the gaps dagre reserved for them instead of behind tasks.
 */

/** Rendered size of NodeComponent — keep in sync with its styles. */
export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 91;
/** NodeComponent height when the 📅 calendar row is shown. */
export const NODE_HEIGHT_WITH_DATES = 111;

const RANK_SEP = 70;          // horizontal gap between dependency columns
const NODE_SEP = 28;          // vertical gap between tasks in one column
const EDGE_SEP = 12;
const GRID_GAP_X = 20;
const GRID_GAP_Y = 16;
const GROUP_PAD = 14;
const GROUP_HEADER = 32;      // room for the block's label
const MIN_GROUP_SIZE = 4;     // smaller parallel sets stay a plain column
const MAX_GRID_ROWS = 6;
const PIECE_GAP_X = 120;
const PIECE_GAP_Y = 100;
const DEFAULT_VIEWPORT = { width: 1200, height: 750 };
/**
 * Grid shapes tried for parallel blocks: a block of n tasks gets about
 * √(n × bias) columns, so larger values give wider, flatter grids. The first
 * is preferred when shapes fit equally well.
 */
const SHAPE_BIASES = [0.9, 0.45, 1.8];
/** Beyond this, each extra shape costs a noticeable dagre run for little gain. */
const MAX_TASKS_FOR_SHAPE_SEARCH = 80;
/** Layouts within this fraction of the best fitted zoom count as a tie. */
const ZOOM_TIE = 0.97;

export interface LayoutTask {
    id: string;
    dependencies: string[];
}

export interface Point {
    x: number;
    y: number;
}

export interface LayoutGroup {
    id: string;
    kind: 'parallel' | 'standalone';
    memberIds: string[];
    /** Absolute top-left corner and size. */
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface LayoutEdge {
    id: string;
    /** Task id or group id. */
    source: string;
    target: string;
    /** The dependency pairs [predecessor, successor] this edge stands for. */
    pairs: Array<[string, string]>;
    /** Interior route points for edges that skip columns; empty otherwise. */
    waypoints: Point[];
}

export interface PertLayout {
    /** Absolute top-left corner of every task. */
    positions: Map<string, Point>;
    groups: LayoutGroup[];
    edges: LayoutEdge[];
    width: number;
    height: number;
}

export interface LayoutOptions {
    nodeHeight?: number;
    /** Usable size of the viewport the chart will be fitted into. */
    viewport?: { width: number; height: number };
}

interface Graph {
    ids: string[];
    order: Map<string, number>;
    preds: Map<string, string[]>;
    succs: Map<string, string[]>;
}

interface Grid {
    cols: number;
    rows: number;
    width: number;
    height: number;
    padX: number;
    top: number;
}

/** A separately laid-out part of the chart, in local coordinates. */
interface Piece {
    width: number;
    height: number;
    positions: Map<string, Point>;
    groups: LayoutGroup[];
    edges: LayoutEdge[];
}

export function layoutPert(tasks: LayoutTask[], options: LayoutOptions = {}): PertLayout {
    if (tasks.length === 0) {
        return { positions: new Map(), groups: [], edges: [], width: 0, height: 0 };
    }
    const nodeHeight = options.nodeHeight ?? NODE_HEIGHT;
    const viewport = options.viewport && options.viewport.width > 0 && options.viewport.height > 0
        ? options.viewport
        : DEFAULT_VIEWPORT;

    const graph = buildGraph(tasks);
    const standalone = graph.ids.filter(id => graph.preds.get(id)!.length === 0 && graph.succs.get(id)!.length === 0);
    const groups = findParallelGroups(graph, new Set(standalone));
    const components = findComponents(graph, new Set(standalone));

    // Try a few grid shapes for parallel blocks, a column count for the
    // standalone grid, and a row width for packing; keep whichever arrangement
    // can be fitted to the viewport at the highest zoom (capped at 1:1).
    const searchShapes = groups.members.size > 0 && tasks.length <= MAX_TASKS_FOR_SHAPE_SEARCH;
    const biases = searchShapes ? SHAPE_BIASES : SHAPE_BIASES.slice(0, 1);
    const standaloneCols = standalone.length > 0 ? range(1, standalone.length) : [0];
    const standalonePieces = new Map(standaloneCols.map(cols => [cols, cols > 0 ? layoutStandalone(standalone, cols, nodeHeight) : null]));

    interface Candidate { biasIndex: number; cols: number; limit: number; zoom: number; aspectError: number }
    const candidates: Candidate[] = [];
    const piecesByBias: Piece[][] = [];
    const targetAspect = viewport.width / viewport.height;
    for (const [biasIndex, bias] of biases.entries()) {
        // Nothing beats fitting at natural size, and ties go to the preferred shape.
        if (biasIndex > 0 && candidates.some(c => c.zoom >= 1)) break;
        const pieces = components.map(ids => layoutComponent(ids, graph, groups, bias, nodeHeight));
        piecesByBias.push(pieces);
        for (const cols of standaloneCols) {
            const all = withStandalone(pieces, standalonePieces.get(cols) ?? null);
            for (const limit of rowLimits(all)) {
                const { width, height } = pack(all, limit);
                candidates.push({
                    biasIndex, cols, limit,
                    zoom: Math.min(viewport.width / width, viewport.height / height, 1),
                    aspectError: Math.abs(Math.log(width / height / targetAspect)),
                });
            }
        }
    }

    const bestZoom = Math.max(...candidates.map(c => c.zoom));
    const best = candidates
        .filter(c => c.zoom >= bestZoom * ZOOM_TIE)
        .sort((a, b) => a.biasIndex - b.biasIndex || a.aspectError - b.aspectError)[0];

    const pieces = withStandalone(piecesByBias[best.biasIndex], standalonePieces.get(best.cols) ?? null);
    return assemble(pieces, pack(pieces, best.limit));
}

function buildGraph(tasks: LayoutTask[]): Graph {
    const ids = tasks.map(t => t.id);
    const order = new Map(ids.map((id, i) => [id, i]));
    const preds = new Map<string, string[]>(ids.map(id => [id, []]));
    const succs = new Map<string, string[]>(ids.map(id => [id, []]));
    for (const task of tasks) {
        for (const dep of new Set(task.dependencies)) {
            // Skip self-references and references to tasks that no longer exist.
            if (dep === task.id || !order.has(dep)) continue;
            preds.get(task.id)!.push(dep);
            succs.get(dep)!.push(task.id);
        }
    }
    return { ids, order, preds, succs };
}

/**
 * Parallel groups: sets of tasks with exactly the same predecessors and the
 * same successors. They're interchangeable in the drawing, can't depend on each
 * other, and every neighbour connects to all of them, so one bundled edge per
 * neighbour represents their dependencies exactly.
 */
function findParallelGroups(graph: Graph, standalone: Set<string>) {
    const bySignature = new Map<string, string[]>();
    for (const id of graph.ids) {
        if (standalone.has(id)) continue;
        const signature = [...graph.preds.get(id)!].sort().join('\u0000') + '\u0001' + [...graph.succs.get(id)!].sort().join('\u0000');
        const list = bySignature.get(signature);
        if (list) list.push(id);
        else bySignature.set(signature, [id]);
    }
    const groupOf = new Map<string, string>();
    const members = new Map<string, string[]>();
    for (const ids of bySignature.values()) {
        if (ids.length < MIN_GROUP_SIZE) continue;
        const groupId = `__parallel:${ids[0]}`;
        members.set(groupId, ids);
        for (const id of ids) groupOf.set(id, groupId);
    }
    return { groupOf, members };
}

/** Weakly connected components of the linked tasks, largest first. */
function findComponents(graph: Graph, standalone: Set<string>): string[][] {
    const seen = new Set<string>(standalone);
    const components: string[][] = [];
    for (const start of graph.ids) {
        if (seen.has(start)) continue;
        const component: string[] = [];
        const stack = [start];
        seen.add(start);
        while (stack.length > 0) {
            const id = stack.pop()!;
            component.push(id);
            for (const next of [...graph.preds.get(id)!, ...graph.succs.get(id)!]) {
                if (!seen.has(next)) {
                    seen.add(next);
                    stack.push(next);
                }
            }
        }
        component.sort((a, b) => graph.order.get(a)! - graph.order.get(b)!);
        components.push(component);
    }
    return components.sort((a, b) => b.length - a.length || graph.order.get(a[0])! - graph.order.get(b[0])!);
}

function layoutComponent(
    ids: string[],
    graph: Graph,
    groups: ReturnType<typeof findParallelGroups>,
    bias: number,
    nodeHeight: number,
): Piece {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: NODE_SEP, ranksep: RANK_SEP, edgesep: EDGE_SEP, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));

    const grids = new Map<string, Grid>();
    for (const id of ids) {
        const groupId = groups.groupOf.get(id);
        if (!groupId) {
            g.setNode(id, { width: NODE_WIDTH, height: nodeHeight });
        } else if (!grids.has(groupId)) {
            const count = groups.members.get(groupId)!.length;
            const cols = clamp(Math.round(Math.sqrt(count * bias)), Math.ceil(count / MAX_GRID_ROWS), count);
            const grid = gridShape(count, cols, nodeHeight, true);
            grids.set(groupId, grid);
            g.setNode(groupId, { width: grid.width, height: grid.height });
        }
    }

    // One edge per (source, target) pair after collapsing groups.
    const edges = new Map<string, LayoutEdge>();
    for (const id of ids) {
        for (const pred of graph.preds.get(id)!) {
            const source = groups.groupOf.get(pred) ?? pred;
            const target = groups.groupOf.get(id) ?? id;
            const key = `${source}\u0000${target}`;
            let edge = edges.get(key);
            if (!edge) {
                edge = { id: `${source}->${target}`, source, target, pairs: [], waypoints: [] };
                edges.set(key, edge);
                g.setEdge(source, target);
            }
            edge.pairs.push([pred, id]);
        }
    }

    dagre.layout(g);

    const positions = new Map<string, Point>();
    const pieceGroups: LayoutGroup[] = [];
    for (const id of ids) {
        if (groups.groupOf.has(id)) continue;
        const n = g.node(id);
        positions.set(id, { x: n.x - NODE_WIDTH / 2, y: n.y - nodeHeight / 2 });
    }
    for (const [groupId, grid] of grids) {
        const n = g.node(groupId);
        const origin = { x: n.x - grid.width / 2, y: n.y - grid.height / 2 };
        const memberIds = groups.members.get(groupId)!;
        memberIds.forEach((id, i) => positions.set(id, offset(cellPosition(grid, i, nodeHeight), origin)));
        pieceGroups.push({ id: groupId, kind: 'parallel', memberIds, ...origin, width: grid.width, height: grid.height });
    }
    for (const edge of edges.values()) {
        // points = [source boundary, ...dummy nodes..., target boundary]. With a
        // single dummy the edge joins neighbouring columns and needs no routing.
        const points: Point[] = g.edge(edge.source, edge.target).points;
        if (points.length > 3) edge.waypoints = points.slice(1, -1).map(p => ({ x: p.x, y: p.y }));
    }

    return normalize({ width: 0, height: 0, positions, groups: pieceGroups, edges: [...edges.values()] }, nodeHeight);
}

/** Tasks with no dependencies either way, as a grid (boxed when there are several). */
function layoutStandalone(ids: string[], cols: number, nodeHeight: number): Piece {
    const boxed = ids.length >= MIN_GROUP_SIZE;
    const grid = gridShape(ids.length, cols, nodeHeight, boxed);
    const positions = new Map(ids.map((id, i) => [id, cellPosition(grid, i, nodeHeight)]));
    const groups: LayoutGroup[] = boxed
        ? [{ id: '__standalone', kind: 'standalone', memberIds: ids, x: 0, y: 0, width: grid.width, height: grid.height }]
        : [];
    return { width: grid.width, height: grid.height, positions, groups, edges: [] };
}

function gridShape(count: number, wantedCols: number, nodeHeight: number, boxed: boolean): Grid {
    const rows = Math.ceil(count / clamp(wantedCols, 1, count));
    const cols = Math.ceil(count / rows); // rebalance so the last row isn't mostly empty
    const padX = boxed ? GROUP_PAD : 0;
    const top = boxed ? GROUP_HEADER : 0;
    const bottom = boxed ? GROUP_PAD : 0;
    return {
        cols, rows, padX, top,
        width: 2 * padX + cols * NODE_WIDTH + (cols - 1) * GRID_GAP_X,
        height: top + rows * nodeHeight + (rows - 1) * GRID_GAP_Y + bottom,
    };
}

function cellPosition(grid: Grid, index: number, nodeHeight: number): Point {
    return {
        x: grid.padX + (index % grid.cols) * (NODE_WIDTH + GRID_GAP_X),
        y: grid.top + Math.floor(index / grid.cols) * (nodeHeight + GRID_GAP_Y),
    };
}

/** Shift a piece so its bounding box starts at (0, 0). */
function normalize(piece: Piece, nodeHeight: number): Piece {
    const boxes = [
        ...[...piece.positions.values()].map(p => ({ x: p.x, y: p.y, width: NODE_WIDTH, height: nodeHeight })),
        ...piece.groups,
        ...piece.edges.flatMap(e => e.waypoints.map(p => ({ ...p, width: 0, height: 0 }))),
    ];
    const minX = Math.min(...boxes.map(b => b.x));
    const minY = Math.min(...boxes.map(b => b.y));
    const shift = { x: -minX, y: -minY };
    return {
        width: Math.max(...boxes.map(b => b.x + b.width)) - minX,
        height: Math.max(...boxes.map(b => b.y + b.height)) - minY,
        positions: new Map([...piece.positions].map(([id, p]) => [id, offset(p, shift)])),
        groups: piece.groups.map(gr => ({ ...gr, ...offset(gr, shift) })),
        edges: piece.edges.map(e => ({ ...e, waypoints: e.waypoints.map(p => offset(p, shift)) })),
    };
}

function withStandalone(pieces: Piece[], standalone: Piece | null): Piece[] {
    return standalone ? [...pieces, standalone] : pieces;
}

/** Candidate row widths: one per possible number of pieces in the first row. */
function rowLimits(pieces: Piece[]): number[] {
    const limits: number[] = [];
    let width = 0;
    for (const piece of pieces) {
        width += (width > 0 ? PIECE_GAP_X : 0) + piece.width;
        limits.push(width);
    }
    return limits;
}

/** Shelf packing: fill rows left→right up to `limit`, then start a new row. */
function pack(pieces: Piece[], limit: number) {
    const origins: Point[] = [];
    let x = 0, y = 0, rowHeight = 0, width = 0;
    for (const piece of pieces) {
        if (x > 0 && x + piece.width > limit) {
            y += rowHeight + PIECE_GAP_Y;
            x = 0;
            rowHeight = 0;
        }
        origins.push({ x, y });
        width = Math.max(width, x + piece.width);
        rowHeight = Math.max(rowHeight, piece.height);
        x += piece.width + PIECE_GAP_X;
    }
    return { origins, width, height: y + rowHeight };
}

function assemble(pieces: Piece[], packed: ReturnType<typeof pack>): PertLayout {
    const layout: PertLayout = { positions: new Map(), groups: [], edges: [], width: packed.width, height: packed.height };
    pieces.forEach((piece, i) => {
        const origin = packed.origins[i];
        for (const [id, p] of piece.positions) layout.positions.set(id, offset(p, origin));
        for (const gr of piece.groups) layout.groups.push({ ...gr, ...offset(gr, origin) });
        for (const e of piece.edges) layout.edges.push({ ...e, waypoints: e.waypoints.map(p => offset(p, origin)) });
    });
    return layout;
}

function offset(p: Point, by: Point): Point {
    return { x: p.x + by.x, y: p.y + by.y };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function range(from: number, to: number): number[] {
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
