import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  Position,
  ReactFlow,
  getBezierPath,
  type EdgeProps,
  type EdgeTypes,
  type NodeProps,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useEffect, useMemo } from "react";
import type { GitFlowNode, GitGraph, GitNodeData } from "../lib/graph";

interface CanvasViewProps {
  graph: GitGraph;
  selectedId: string | null;
  onSelect: (node: GitFlowNode | null) => void;
}

const nodeTypes = {
  gitNode: GitNodeCard,
};

const edgeTypes = {
  gitCurve: GitCurveEdge,
} satisfies EdgeTypes;

export function CanvasView({ graph, selectedId, onSelect }: CanvasViewProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);
  const fitViewNodes = useMemo(
    () => graph.nodes.map((node) => ({ id: node.id })),
    [graph.nodes],
  );
  const fitViewOptions = useMemo(
    () => ({ nodes: fitViewNodes, padding: 0.22, maxZoom: 0.95 }),
    [fitViewNodes],
  );

  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [graph, setEdges, setNodes]);

  return (
    <section className="canvas-shell" aria-label="Git workscene canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.25}
        maxZoom={1.8}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onSelect(node as GitFlowNode)}
        onPaneClick={() => onSelect(null)}
      >
        <Background color="rgba(245,241,232,0.12)" gap={42} />
        <Controls position="bottom-left" showInteractive={false} />
      </ReactFlow>
      <div className="canvas-status">
        {selectedId ? "Node selected" : "Canvas ready"}
      </div>
    </section>
  );
}

function GitNodeCard({ data, selected }: NodeProps<GitFlowNode>) {
  const node = data as GitNodeData;
  return (
    <div className={`git-node git-node-${node.kind} ${selected ? "is-selected" : ""}`}>
      {node.handles?.target.map((id, index) => (
        <Handle
          key={id}
          id={id}
          className="node-handle node-handle-target"
          type="target"
          position={Position.Left}
          isConnectable={false}
          style={{ top: handleTop(index, node.handles?.target.length ?? 1) }}
        />
      ))}
      <div className="node-kind">{node.kind}</div>
      <div className="node-title">{node.title}</div>
      <div className="node-subtitle">{node.subtitle}</div>
      <div className="node-badges">
        {node.badges.map((badge) => (
          <span key={badge}>{badge}</span>
        ))}
      </div>
      {node.handles?.source.map((id, index) => (
        <Handle
          key={id}
          id={id}
          className="node-handle node-handle-source"
          type="source"
          position={Position.Right}
          isConnectable={false}
          style={{ top: handleTop(index, node.handles?.source.length ?? 1) }}
        />
      ))}
    </div>
  );
}

function GitCurveEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  interactionWidth,
}: EdgeProps) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.28,
  });

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={style}
      interactionWidth={interactionWidth ?? 16}
    />
  );
}

function handleTop(index: number, count: number) {
  if (count <= 1) return "50%";
  return `${18 + (index / (count - 1)) * 64}%`;
}
