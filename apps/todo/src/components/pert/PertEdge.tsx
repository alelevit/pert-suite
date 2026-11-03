import { BaseEdge, getBezierPath, Position } from '@xyflow/react';
import type { Edge, EdgeProps } from '@xyflow/react';
import type { Point } from '../../logic/pertLayout';

export type PertEdgeData = {
    /** Route between the endpoints for edges that skip columns (from the layout). */
    waypoints: Point[];
    /** Handle positions the route was computed for. */
    anchor: { source: Point; target: Point };
};

export type PertEdgeType = Edge<PertEdgeData, 'pertEdge'>;

const ANCHOR_TOLERANCE = 12;

/**
 * Dependency arrow. Edges between neighbouring columns are plain curves; edges
 * that skip columns follow the gap the layout reserved for them, so they don't
 * run behind unrelated tasks. If a node has been dragged away from its laid-out
 * position the route no longer fits, so it falls back to a plain curve.
 */
export default function PertEdge({ id, sourceX, sourceY, targetX, targetY, data, style, markerEnd }: EdgeProps<PertEdgeType>) {
    const routed = !!data && data.waypoints.length > 0
        && isNear(data.anchor.source, sourceX, sourceY)
        && isNear(data.anchor.target, targetX, targetY);

    const path = routed
        ? smoothPath([{ x: sourceX, y: sourceY }, ...data.waypoints, { x: targetX, y: targetY }])
        : getBezierPath({ sourceX, sourceY, sourcePosition: Position.Right, targetX, targetY, targetPosition: Position.Left })[0];

    return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />;
}

function isNear(p: Point, x: number, y: number): boolean {
    return Math.abs(p.x - x) <= ANCHOR_TOLERANCE && Math.abs(p.y - y) <= ANCHOR_TOLERANCE;
}

/**
 * Smooth curve through points ordered left→right that leaves and enters
 * horizontally. Uses monotone cubic interpolation (Steffen 1990) so the curve
 * never overshoots the points and stays inside the reserved gap.
 */
function smoothPath(points: Point[]): string {
    const n = points.length;
    const slopes: number[] = [];
    for (let i = 0; i < n - 1; i++) {
        const dx = points[i + 1].x - points[i].x;
        slopes.push(dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx);
    }
    const tangents = points.map((p, i) => {
        if (i === 0 || i === n - 1) return 0;
        const s0 = slopes[i - 1];
        const s1 = slopes[i];
        if (s0 * s1 <= 0) return 0;
        const h0 = p.x - points[i - 1].x;
        const h1 = points[i + 1].x - p.x;
        const blended = (s0 * h1 + s1 * h0) / (h0 + h1);
        return Math.sign(s0) * 2 * Math.min(Math.abs(s0), Math.abs(s1), Math.abs(blended) / 2);
    });

    let d = `M ${points[0].x},${points[0].y}`;
    for (let i = 0; i < n - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const third = (b.x - a.x) / 3;
        d += ` C ${a.x + third},${a.y + tangents[i] * third} ${b.x - third},${b.y - tangents[i + 1] * third} ${b.x},${b.y}`;
    }
    return d;
}
