import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';

export type GroupNodeData = {
    label: string;
};

export type GroupNodeType = Node<GroupNodeData, 'pertGroup'>;

// Bundled edges attach to the block's sides; the handles themselves stay invisible.
const hiddenHandle = {
    width: 1, height: 1, minWidth: 0, minHeight: 0,
    border: 'none', background: 'transparent', opacity: 0, pointerEvents: 'none' as const,
};

/** Container drawn behind a grid of parallel (or dependency-free) tasks. */
export default function GroupNode({ data }: NodeProps<GroupNodeType>) {
    return (
        <div style={{
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            borderRadius: '14px',
            border: '1.5px dashed color-mix(in srgb, var(--text-muted) 45%, transparent)',
            background: 'color-mix(in srgb, var(--text-muted) 6%, transparent)',
        }}>
            <Handle type="target" position={Position.Left} isConnectable={false} style={hiddenHandle} />
            <Handle type="source" position={Position.Right} isConnectable={false} style={hiddenHandle} />
            <div style={{
                padding: '9px 14px 0',
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
            }}>
                {data.label}
            </div>
        </div>
    );
}
