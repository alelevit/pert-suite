import { useEffect } from 'react';
import {
    ReactFlow,
    useNodesState,
    useEdgesState,
    Background,
    Controls,
    MarkerType,
    Position,
    PanOnScrollMode
} from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

import NodeComponent from './NodeComponent';
import type { PertNode } from '../logic/pert';
import type { CalendarRange } from '../logic/pert';

const nodeTypes = {
    pertNode: NodeComponent,
};

const nodeWidth = 220;
const nodeHeight = 150;

function getLayoutedElements(nodes: Node[], edges: Edge[]) {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({ rankdir: 'LR' });

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        return {
            ...node,
            targetPosition: Position.Left,
            sourcePosition: Position.Right,
            position: {
                x: nodeWithPosition.x - nodeWidth / 2,
                y: nodeWithPosition.y - nodeHeight / 2,
            },
        };
    });

    return { nodes: layoutedNodes, edges };
}

interface GraphViewProps {
    pertNodes: PertNode[];
    calendarDates?: Map<string, CalendarRange>;
}

export default function GraphView({ pertNodes, calendarDates }: GraphViewProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

    useEffect(() => {
        const initialNodes: Node[] = pertNodes.map(pn => {
            const dateRange = calendarDates?.get(pn.id);
            return {
                id: pn.id,
                type: 'pertNode',
                data: {
                    name: pn.name,
                    duration: pn.duration,
                    earlyStart: pn.earlyStart,
                    earlyFinish: pn.earlyFinish,
                    lateStart: pn.lateStart,
                    lateFinish: pn.lateFinish,
                    slack: pn.slack,
                    isCritical: pn.isCritical,
                    calendarStart: dateRange?.startDate,
                    calendarEnd: dateRange?.endDate,
                },
                position: { x: 0, y: 0 }
            };
        });

        const initialEdges: Edge[] = [];
        pertNodes.forEach(pn => {
            pn.dependencies.forEach(depId => {
                const sourceNode = pertNodes.find(n => n.id === depId);
                const isCriticalEdge = pn.isCritical && sourceNode?.isCritical &&
                    Math.abs(pn.earlyStart - (sourceNode?.earlyFinish ?? 0)) < 0.01;

                initialEdges.push({
                    id: `${depId}-${pn.id}`,
                    source: depId,
                    target: pn.id,
                    type: 'smoothstep',
                    style: {
                        stroke: isCriticalEdge ? 'var(--accent-critical)' : 'var(--text-muted)',
                        strokeWidth: isCriticalEdge ? 2 : 1
                    },
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                        color: isCriticalEdge ? 'var(--accent-critical)' : 'var(--text-muted)',
                    },
                });
            });
        });

        const layouted = getLayoutedElements(initialNodes, initialEdges);
        setNodes(layouted.nodes);
        setEdges(layouted.edges);
    }, [pertNodes, calendarDates, setNodes, setEdges]);

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
        <div style={{ width: '100%', height: '100%' }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                panOnScroll
                panOnScrollMode={PanOnScrollMode.Free}
                zoomOnScroll={false}
            >
                <Background gap={16} size={1} color="rgba(255,255,255,0.05)" />
                <Controls />
            </ReactFlow>
        </div>
    );
}
