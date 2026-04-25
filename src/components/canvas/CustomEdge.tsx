import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, type EdgeProps } from '@xyflow/react';

/**
 * Default edge with two upgrades over React Flow's built-in:
 *  - A wider invisible hit-area so clicking the line is easy.
 *  - A visible delete button (×) at the midpoint when the edge is selected.
 *    Backspace/Delete still works via React Flow's default key handling, but
 *    the button is the discoverable affordance.
 */
export function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerEnd,
  style,
}: EdgeProps) {
  const flow = useReactFlow();
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    flow.deleteElements({ edges: [{ id }] });
  };

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {/* Wider invisible hit-area so the line is easier to click. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ cursor: 'pointer' }}
      />
      {selected && (
        <EdgeLabelRenderer>
          <button
            onClick={handleDelete}
            title="Disconnect (or press Backspace / Delete)"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="w-6 h-6 flex items-center justify-center bg-ink-700 border border-ink-500 text-bone-300 hover:bg-red-500/20 hover:border-red-400 hover:text-red-300 transition-colors rounded-full font-mono text-[12px] leading-none shadow-node nodrag nopan"
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
