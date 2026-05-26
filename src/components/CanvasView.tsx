import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type NodeProps,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useEffect } from "react";
import type { GitFlowNode, GitGraph, GitNodeData } from "../lib/graph";

interface CanvasViewProps {
  graph: GitGraph;
  selectedId: string | null;
  onSelect: (node: GitFlowNode | null) => void;
}

const nodeTypes = {
  gitNode: GitNodeCard,
};

export function CanvasView({ graph, selectedId, onSelect }: CanvasViewProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);
  const initialFitNodes = graph.nodes
    .filter((node) => node.data.kind === "repository" || node.data.kind === "worktree")
    .map((node) => ({ id: node.id }));

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
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ nodes: initialFitNodes, padding: 0.22, maxZoom: 0.95 }}
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
      <Handle
        className="node-handle node-handle-target"
        type="target"
        position={Position.Left}
        isConnectable={false}
      />
      <div className="node-kind">{node.kind}</div>
      <div className="node-title">{node.title}</div>
      <div className="node-subtitle">{node.subtitle}</div>
      <div className="node-badges">
        {node.badges.map((badge) => (
          <span key={badge}>{badge}</span>
        ))}
      </div>
      <Handle
        className="node-handle node-handle-source"
        type="source"
        position={Position.Right}
        isConnectable={false}
      />
    </div>
  );
}
