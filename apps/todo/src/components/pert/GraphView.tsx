import { useEffect, useRef } from 'react';
import {
    ReactFlow,
    useNodesState,
    useEdgesState,
    Background,
    Controls,
    MarkerType,
    PanOnScrollMode
} from '@xyflow/react';
import type { Node, Edge, FitViewOptions, ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import NodeComponent from './NodeComponent';
import GroupNode from './GroupNode';
import PertEdge from './PertEdge';
import type { PertNode } from '../../logic/pert';
import type { CalendarRange } from '../../logic/pert';
import { layoutPert, NODE_WIDTH, NODE_HEIGHT, NODE_HEIGHT_WITH_DATES } from '../../logic/pertLayout';
import type { LayoutGroup, Point } from '../../logic/pertLayout';

const nodeTypes = {
    pertNode: NodeComponent,
    pertGroup: GroupNode,
};

const edgeTypes = {
    pertEdge: PertEdge,
};

// Keep the fitted chart clear of the toolbar (top) and prompt bar (bottom)
// that are overlaid on the graph area.
const FIT_PADDING = { top: 72, right: 32, bottom: 128, left: 32 };
const FIT_VIEW_OPTIONS: FitViewOptions = {
    padding: {
        top: `${FIT_PADDING.top}px`,
        right: `${FIT_PADDING.right}px`,
        bottom: `${FIT_PADDING.bottom}px`,
        left: `${FIT_PADDING.left}px`,
    },
    maxZoom: 1,
};

/** A dependency is on the critical path when both ends are critical and there's no gap between them. */
function isCriticalLink(from?: PertNode, to?: PertNode): boolean {
    return !!from && !!to && from.isCritical && to.isCritical &&
        Math.abs(to.earlyStart - from.earlyFinish) < 0.01;
}

function groupLabel(group: LayoutGroup): string {
    const count = group.memberIds.length;
    return group.kind === 'parallel' ? `${count} parallel tasks` : `No dependencies · ${count} tasks`;
}

interface GraphViewProps {
    pertNodes: PertNode[];
    calendarDates?: Map<string, CalendarRange>;
    completedTaskIds?: Set<string>;
    onUncompleteTask?: (pertTaskId: string) => void;
    onNodeClick?: (nodeId: string) => void;
    onSplitTask?: (taskId: string) => void;
}

export default function GraphView({ pertNodes, calendarDates, completedTaskIds, onUncompleteTask, onNodeClick, onSplitTask }: GraphViewProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const containerRef = useRef<HTMLDivElement>(null);
    const flowRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);
    const structureRef = useRef('');
    const fitPendingRef = useRef(false);

    useEffect(() => {
        const nodeHeight = calendarDates && calendarDates.size > 0 ? NODE_HEIGHT_WITH_DATES : NODE_HEIGHT;
        const container = containerRef.current;
        const layout = layoutPert(pertNodes, {
            nodeHeight,
            viewport: container ? {
                width: container.clientWidth - FIT_PADDING.left - FIT_PADDING.right,
                height: container.clientHeight - FIT_PADDING.top - FIT_PADDING.bottom,
            } : undefined,
        });

        const groupById = new Map(layout.groups.map(g => [g.id, g]));
        const groupOfTask = new Map<string, LayoutGroup>();
        layout.groups.forEach(g => g.memberIds.forEach(id => groupOfTask.set(id, g)));

        // Groups first: React Flow needs parents before their children.
        const initialNodes: Node[] = layout.groups.map(g => ({
            id: g.id,
            type: 'pertGroup',
            position: { x: g.x, y: g.y },
            width: g.width,
            height: g.height,
            data: { label: groupLabel(g) },
        }));

        pertNodes.forEach(pn => {
            const dateRange = calendarDates?.get(pn.id);
            const position = layout.positions.get(pn.id) ?? { x: 0, y: 0 };
            const group = groupOfTask.get(pn.id);
            initialNodes.push({
                id: pn.id,
                type: 'pertNode',
                // Grouped tasks are positioned relative to their block and move with it.
                ...(group
                    ? { parentId: group.id, extent: 'parent' as const, position: { x: position.x - group.x, y: position.y - group.y } }
                    : { position }),
                data: {
                    name: pn.name,
                    duration: pn.duration,
                    earlyStart: pn.earlyStart,
                    earlyFinish: pn.earlyFinish,
                    lateStart: pn.lateStart,
                    lateFinish: pn.lateFinish,
                    slack: pn.slack,
                    isCritical: pn.isCritical,
                    isCompleted: completedTaskIds?.has(pn.id) ?? false,
                    onUncomplete: completedTaskIds?.has(pn.id) && onUncompleteTask
                        ? () => onUncompleteTask(pn.id)
                        : undefined,
                    calendarStart: dateRange?.startDate,
                    calendarEnd: dateRange?.endDate,
                    onSplit: onSplitTask ? () => onSplitTask(pn.id) : undefined,
                },
            });
        });

        // Where each edge's handles sit in the layout (right side out, left side in).
        const anchor = (id: string, side: 'source' | 'target'): Point => {
            const group = groupById.get(id);
            const box = group ?? { ...(layout.positions.get(id) ?? { x: 0, y: 0 }), width: NODE_WIDTH, height: nodeHeight };
            return { x: side === 'source' ? box.x + box.width : box.x, y: box.y + box.height / 2 };
        };

        const nodeById = new Map(pertNodes.map(n => [n.id, n]));
        const initialEdges: Edge[] = layout.edges.map(e => {
            // A bundled edge stands for several dependencies; it's critical if any of them is.
            const isCriticalEdge = e.pairs.some(([from, to]) => isCriticalLink(nodeById.get(from), nodeById.get(to)));
            const color = isCriticalEdge ? 'var(--accent-critical)' : 'var(--text-muted)';
            return {
                id: e.id,
                source: e.source,
                target: e.target,
                type: 'pertEdge',
                data: { waypoints: e.waypoints, anchor: { source: anchor(e.source, 'source'), target: anchor(e.target, 'target') } },
                style: { stroke: color, strokeWidth: isCriticalEdge ? 2 : 1 },
                markerEnd: { type: MarkerType.ArrowClosed, color },
            };
        });
        // Draw critical edges last so they sit on top where edges cross.
        initialEdges.sort((a, b) => Number(a.style?.strokeWidth === 2) - Number(b.style?.strokeWidth === 2));

        setNodes(initialNodes);
        setEdges(initialEdges);

        // Re-fit when a different chart is shown (project loaded, tasks or links
        // changed). A freshly mounted flow is fitted by the `fitView` prop.
        if (pertNodes.length === 0) {
            flowRef.current = null; // the empty state unmounts the flow
            structureRef.current = '';
            fitPendingRef.current = false;
            return;
        }
        const structure = pertNodes.map(n => `${n.id}:${n.dependencies.join(',')}`).join('|') + `#${nodeHeight}`;
        if (structureRef.current && structure !== structureRef.current) {
            fitPendingRef.current = true;
        }
        structureRef.current = structure;
    }, [pertNodes, calendarDates, setNodes, setEdges]);

    // Fit only once React Flow holds the new nodes. Its store is updated in a
    // child effect, which runs before this one; calling fitView in the same
    // effect as setNodes can fit the previous chart instead.
    useEffect(() => {
        if (!fitPendingRef.current) return;
        fitPendingRef.current = false;
        flowRef.current?.fitView(FIT_VIEW_OPTIONS);
    }, [nodes]);

    // Update node data in-place when completion status changes (no re-layout)
    useEffect(() => {
        if (!completedTaskIds) return;
        setNodes(prev => prev.map(node => {
            if (node.type !== 'pertNode') return node;
            const isCompleted = completedTaskIds.has(node.id);
            const wasCompleted = (node.data as any)?.isCompleted ?? false;
            if (isCompleted === wasCompleted) return node;
            return {
                ...node,
                data: {
                    ...node.data,
                    isCompleted,
                    onUncomplete: isCompleted && onUncompleteTask
                        ? () => onUncompleteTask(node.id)
                        : undefined,
                },
            };
        }));
    }, [completedTaskIds, onUncompleteTask, setNodes]);

    // Show empty state if no nodes
    if (!pertNodes || pertNodes.length === 0) {
        return (
            <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: '16px',
                color: 'var(--text-muted)'
            }}>
                <div style={{ fontSize: '48px', opacity: 0.3 }}>📊</div>
                <div style={{ fontSize: '18px' }}>No tasks to display</div>
                <div style={{ fontSize: '14px', opacity: 0.7 }}>Add tasks in the sidebar or generate them with AI</div>
            </div>
        );
    }

    return (
        <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onInit={(instance) => { flowRef.current = instance; }}
                onNodeClick={(_event, node) => { if (node.type === 'pertNode') onNodeClick?.(node.id); }}
                fitView
                fitViewOptions={FIT_VIEW_OPTIONS}
                minZoom={0.1}
                panOnScroll
                panOnScrollMode={PanOnScrollMode.Free}
                zoomOnScroll={false}
            >
                <Background gap={16} size={1} color="rgba(255,255,255,0.05)" />
                <Controls fitViewOptions={FIT_VIEW_OPTIONS} />
            </ReactFlow>
        </div>
    );
}
