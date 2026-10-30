"use client";

import {
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { saveWorkspaceAction } from "@/lib/actions";
import {
  canvasGridMetrics,
  DEFAULT_CANVAS_ZOOM,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
  zoomCanvasAtPointer,
} from "@/lib/workspace/canvas-zoom";
import { basicEventProbability, evaluateGate, gateFormula, type FtaGateType } from "@/lib/workspace/fta";
import { analyzeRbd, type RbdAnalysis } from "@/lib/workspace/rbd-core";
import { componentAvailability, meanTimeBetweenFailures, missionReliability } from "@/lib/workspace/reliability";
import { lockRbdConnectionPorts, lockedPortPoint, routeRbdConnection, type PortSide } from "@/lib/workspace/routing";
import type {
  DiagramEdge,
  DiagramNode,
  RbdGroup,
  WorkspaceComponent,
  WorkspaceMode,
  WorkspaceState,
} from "@/lib/workspace/types";

type Mode = WorkspaceMode;
type Snapshot = { nodes: DiagramNode[]; edges: DiagramEdge[]; groups: RbdGroup[] };
type FtaAnalysis = { probability: number; formula: string; topEvent: string };
type Analysis = RbdAnalysis | FtaAnalysis;
type EventType = "event top" | "event intermediate" | "event basic";

const BLOCK_WIDTH = 196;
const BLOCK_HEIGHT = 108;
const GATE_WIDTH = 54;
const GATE_HEIGHT = 60;
const CANVAS_WIDTH = 1800;
const CANVAS_HEIGHT = 1100;

const RBD_GATES: FtaGateType[] = ["gate and", "gate or", "gate xor", "gate not"];
const FTA_GATES: FtaGateType[] = ["gate and", "gate or", "gate xor", "gate not", "gate vote"];
const EVENT_TYPES: EventType[] = ["event top", "event intermediate", "event basic"];

function isGate(node?: DiagramNode) {
  return Boolean(node?.type.startsWith("gate "));
}
function gateLabel(type: string) {
  return type.replace("gate ", "").toUpperCase();
}
function isRbdAnalysis(analysis: Analysis | null): analysis is RbdAnalysis {
  return Boolean(analysis && "configuration" in analysis);
}
function eventTypeLabel(type: string) {
  if (type === "event top") return "Top event";
  if (type === "event intermediate") return "Intermediate event";
  return "Basic event";
}

function GateGraphic({ type, index }: { type: string; index: number }) {
  const kind = type.replace("gate ", "");
  return (
    <span className="dwb-gate">
      <svg viewBox="0 0 64 54" role="img" aria-label={`${gateLabel(type)} gate`}>
        <g transform="translate(0 54) scale(1 -1)">
          {kind === "and" && <path d="M10 7h44v17c0 15-10 24-22 24S10 39 10 24V7Z" />}
          {kind === "or" && (
            <>
              <path d="M10 7c12 6 32 6 44 0-2 19-9 34-22 41C19 41 12 26 10 7Z" />
              <path className="dwb-gate-detail" d="M10 7c13 9 31 9 44 0" />
            </>
          )}
          {kind === "xor" && (
            <>
              <path d="M10 10c12 5 32 5 44 0-2 18-9 31-22 38C19 41 12 28 10 10Z" />
              <path className="dwb-gate-detail" d="M9 5c13 7 33 7 46 0" />
            </>
          )}
          {kind === "not" && (
            <>
              <path d="M14 7h36L32 43 14 7Z" />
              <circle cx="32" cy="48" r="4" />
            </>
          )}
          {kind === "vote" && (
            <>
              <path d="M10 7h44v17c0 15-10 24-22 24S10 39 10 24V7Z" />
              <path className="dwb-gate-detail" d="M20 17h24M20 27h24M20 37h24" />
            </>
          )}
        </g>
      </svg>
      <b>G{index}</b>
      <small>{gateLabel(type)}</small>
    </span>
  );
}

export default function DiagramWorkbench({
  projectId,
  mode,
  title,
  missionHours,
  components,
  initialState,
  canWrite,
}: {
  projectId: string;
  mode: Mode;
  title: string;
  missionHours: number;
  components: WorkspaceComponent[];
  initialState: WorkspaceState;
  canWrite: boolean;
}) {
  const router = useRouter();

  const [nodes, setNodes] = useState<DiagramNode[]>(initialState.nodes);
  const [edges, setEdges] = useState<DiagramEdge[]>(initialState.edges);
  const [groups, setGroups] = useState<RbdGroup[]>(initialState.groups ?? []);
  const [mission, setMission] = useState<number>(initialState.missionHours || missionHours);
  const [selected, setSelected] = useState(0);
  const [selectedNodes, setSelectedNodes] = useState<number[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_CANVAS_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false);
  const [search, setSearch] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [notice, setNotice] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysed, setAnalysed] = useState(false);
  const [portDrag, setPortDrag] = useState<{
    from: number;
    side: PortSide;
    start: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);
  const [pendingGate, setPendingGate] = useState<{ from: number; to: number } | null>(null);
  const [voteK, setVoteK] = useState("2");
  const [gateMenu, setGateMenu] = useState<{ nodeId: number; x: number; y: number } | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number } | null>(null);
  const [groupDialog, setGroupDialog] = useState(false);
  const [helpDialog, setHelpDialog] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupError, setGroupError] = useState("");
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error" | "readonly">(canWrite ? "saved" : "readonly");
  const [savedAt, setSavedAt] = useState("");

  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const latest = useRef<Snapshot>({ nodes: initialState.nodes, edges: initialState.edges, groups: initialState.groups ?? [] });
  const canWriteRef = useRef(canWrite);
  const lastSaved = useRef("");
  const firstPass = useRef(true);

  canWriteRef.current = canWrite;

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    latest.current = { nodes, edges, groups };
  }, [nodes, edges, groups]);

  /* ------------------------------------------------------------------ autosave */
  useEffect(() => {
    if (!hydrated) return;
    const payload = JSON.stringify({ version: 1, nodes, edges, groups, missionHours: mission });
    if (firstPass.current) {
      firstPass.current = false;
      lastSaved.current = payload;
      return;
    }
    if (!canWrite || payload === lastSaved.current) return;
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      try {
        const result = await saveWorkspaceAction({
          projectId,
          mode,
          state: JSON.parse(payload),
        });
        lastSaved.current = payload;
        setSaveState("saved");
        setSavedAt(result.savedAt);
      } catch {
        setSaveState("error");
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [nodes, edges, groups, mission, hydrated, canWrite, projectId, mode]);

  /* ------------------------------------------------------------------ helpers */
  const filteredComponents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return components;
    return components.filter((component) =>
      `${component.tag} ${component.description} ${component.system}`.toLowerCase().includes(needle),
    );
  }, [components, search]);

  const filteredGroups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter((group) => `${group.tag} ${group.name} ${group.configuration}`.toLowerCase().includes(needle));
  }, [groups, search]);

  const componentById = useMemo(() => new Map(components.map((component) => [component.id, component])), [components]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  function remember() {
    undoStack.current.push(structuredClone(latest.current));
    if (undoStack.current.length > 60) undoStack.current.shift();
    redoStack.current = [];
  }
  function restore(snapshot: Snapshot) {
    setNodes(snapshot.nodes);
    setEdges(mode === "rbd" ? lockRbdConnectionPorts(snapshot.nodes, snapshot.edges) : snapshot.edges);
    setGroups(snapshot.groups ?? []);
    setSelected(0);
    setSelectedNodes([]);
    setSelectedEdge(null);
    setAnalysis(null);
    setAnalysed(false);
  }
  function undo() {
    if (!canWriteRef.current) return;
    const snapshot = undoStack.current.pop();
    if (!snapshot) return;
    redoStack.current.push(structuredClone(latest.current));
    restore(snapshot);
  }
  function redo() {
    if (!canWriteRef.current) return;
    const snapshot = redoStack.current.pop();
    if (!snapshot) return;
    undoStack.current.push(structuredClone(latest.current));
    restore(snapshot);
  }
  function invalidate() {
    setAnalysis(null);
    setAnalysed(false);
  }
  function selectOnly(id: number) {
    setSelected(id);
    setSelectedNodes(id ? [id] : []);
    setSelectedEdge(null);
  }
  function metricsOf(node: DiagramNode) {
    const component = node.assetId ? componentById.get(node.assetId) : undefined;
    const failureRate = component?.lambda ?? node.failureRate ?? 0;
    const mttr = component?.mttr ?? node.mttr ?? 0;
    const nodeMission = node.mission ?? mission;
    return {
      failureRate,
      mttr,
      nodeMission,
      availability: componentAvailability({ lambda: failureRate, mttr }),
      reliability: missionReliability(failureRate, nodeMission),
    };
  }
  function nextPosition() {
    const index = nodes.filter((node) => !isGate(node)).length;
    if (mode === "fta") return { x: 620 + (index % 3) * 250, y: 70 + Math.floor(index / 3) * 175 };
    return { x: 75 + (index % 4) * 245, y: 90 + Math.floor(index / 4) * 165 };
  }
  function addComponent(component: WorkspaceComponent, position = nextPosition()) {
    if (!canWriteRef.current) return;
    remember();
    const id = Math.max(0, ...nodes.map((node) => node.id)) + 1;
    setNodes((current) => [
      ...current,
      {
        id,
        ...position,
        type: mode === "rbd" ? "block" : "event basic",
        title: component.tag,
        subtitle: component.description,
        assetId: component.id,
        failureRate: component.lambda,
        mttr: component.mttr,
        mission: component.mission || mission,
      },
    ]);
    selectOnly(id);
    invalidate();
  }
  function addGroup(group: RbdGroup, position = nextPosition()) {
    if (!canWriteRef.current) return;
    remember();
    const id = Math.max(0, ...nodes.map((node) => node.id)) + 1;
    setNodes((current) => [
      ...current,
      {
        id,
        ...position,
        type: "group",
        title: group.tag,
        subtitle: group.name,
        groupId: group.id,
        failureRate: group.failureRate,
        mttr: group.mttr,
      },
    ]);
    selectOnly(id);
    invalidate();
  }
  function addGate(type: FtaGateType, position = nextPosition(), k?: number) {
    if (!canWriteRef.current) return;
    remember();
    const id = Math.max(0, ...nodes.map((node) => node.id)) + 1;
    setNodes((current) => [
      ...current,
      {
        id,
        x: position.x + BLOCK_WIDTH / 2 - GATE_WIDTH / 2,
        y: position.y,
        type,
        title: gateLabel(type),
        subtitle: "Logic gate",
        gateK: type === "gate vote" ? Math.max(1, k ?? 2) : undefined,
      },
    ]);
    selectOnly(id);
    invalidate();
  }

  function drop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (!canWriteRef.current) {
      setNotice("This project is read-only for you, so the diagram cannot be changed.");
      return;
    }
    try {
      const payload = JSON.parse(event.dataTransfer.getData("application/x-ramsport")) as {
        id?: string;
        groupId?: string;
        gate?: string;
      };
      const rect = event.currentTarget.getBoundingClientRect();
      const size = payload.gate ? { width: GATE_WIDTH, height: GATE_HEIGHT } : { width: BLOCK_WIDTH, height: BLOCK_HEIGHT };
      const position = {
        x: Math.max(12, ((event.clientX - rect.left - pan.x) * 100) / zoom - size.width / 2),
        y: Math.max(12, ((event.clientY - rect.top - pan.y) * 100) / zoom - size.height / 2),
      };
      const component = components.find((item) => item.id === payload.id);
      const group = groups.find((item) => item.id === payload.groupId);
      if (component) addComponent(component, position);
      else if (mode === "rbd" && group) addGroup(group, position);
      else if (mode === "fta" && payload.gate && FTA_GATES.includes(payload.gate as FtaGateType)) {
        addGate(payload.gate as FtaGateType, position, Number(voteK) || 2);
      } else setNotice("That item is not available in this workbench.");
    } catch {
      setNotice("The dropped item could not be added. Drag a component from the library and try again.");
    }
  }

  /* ------------------------------------------------------------------ connections */
  function portPoint(node: DiagramNode, side: PortSide) {
    return lockedPortPoint(node, side);
  }
  function startPortDrag(event: ReactPointerEvent, node: DiagramNode, side: PortSide) {
    event.preventDefault();
    event.stopPropagation();
    if (!canWriteRef.current) return;
    selectOnly(node.id);
    const rect = (event.currentTarget.closest(".dwb-canvas-wrap") as HTMLElement)?.getBoundingClientRect();
    const point = (x: number, y: number) => ({
      x: ((x - (rect?.left || 0) - pan.x) * 100) / zoom,
      y: ((y - (rect?.top || 0) - pan.y) * 100) / zoom,
    });
    setPortDrag({ from: node.id, side, start: portPoint(node, side), current: point(event.clientX, event.clientY) });
    const move = (pointer: PointerEvent) =>
      setPortDrag((current) => (current ? { ...current, current: point(pointer.clientX, pointer.clientY) } : null));
    const up = (pointer: PointerEvent) => {
      const target = document
        .elementFromPoint(pointer.clientX, pointer.clientY)
        ?.closest<HTMLElement>("[data-port-node]");
      const to = Number(target?.dataset.portNode);
      if (to && to !== node.id) connect(node.id, to);
      else setNotice("Connection not created. Release the line on a connection dot of a different block.");
      setPortDrag(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function normalizedConnection(firstId: number, secondId: number) {
    const first = nodeById.get(firstId);
    const second = nodeById.get(secondId);
    if (!first || !second) return null;
    // Fault trees flow upward: the lower node is the cause, the upper node is the effect.
    return first.y >= second.y ? { from: first.id, to: second.id } : { from: second.id, to: first.id };
  }
  function addEdge(from: number, to: number, fromSide?: PortSide, toSide?: PortSide) {
    remember();
    setEdges((current) => {
      if (current.some((edge) => (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from))) {
        setNotice("These two blocks are already connected.");
        return current;
      }
      const candidate: DiagramEdge = { from, to, style: mode === "rbd" ? "elbow" : "elbow", fromSide, toSide };
      const fixed = mode === "rbd" ? lockRbdConnectionPorts(nodes, [candidate])[0] : candidate;
      return [...current, fixed];
    });
    invalidate();
  }
  function connect(firstId: number, secondId: number) {
    if (mode === "rbd") {
      const source = nodeById.get(firstId);
      const target = nodeById.get(secondId);
      if (!source || !target) {
        setNotice("Connection not created because one of the selected blocks is no longer available.");
        return;
      }
      addEdge(firstId, secondId);
      return;
    }
    const connection = normalizedConnection(firstId, secondId);
    if (!connection) {
      setNotice("Connection not created because one of the selected events is no longer available.");
      return;
    }
    const source = nodeById.get(connection.from);
    const target = nodeById.get(connection.to);
    if (!source || !target) return;
    if (isGate(source) || isGate(target)) {
      addEdge(connection.from, connection.to);
      return;
    }
    const existingGateConnection = edges.find(
      (edge) => edge.to === target.id && isGate(nodeById.get(edge.from)),
    );
    if (existingGateConnection) {
      addEdge(source.id, existingGateConnection.from);
      return;
    }
    setVoteK("2");
    setPendingGate(connection);
  }
  function confirmGate(type: FtaGateType | "direct") {
    if (!pendingGate) return;
    if (type === "direct") {
      addEdge(pendingGate.from, pendingGate.to);
      setPendingGate(null);
      return;
    }
    const source = nodeById.get(pendingGate.from);
    const target = nodeById.get(pendingGate.to);
    if (!source || !target) {
      setPendingGate(null);
      setNotice("The gate could not be created because the selected events are no longer available.");
      return;
    }
    remember();
    const id = Math.max(0, ...nodes.map((node) => node.id)) + 1;
    const k = Math.max(1, Number(voteK) || 2);
    setNodes((current) => [
      ...current,
      {
        id,
        x: (source.x + target.x) / 2 + (BLOCK_WIDTH - GATE_WIDTH) / 2,
        y: (source.y + target.y) / 2 + 30,
        type,
        title: gateLabel(type),
        subtitle: "Logic gate",
        gateK: type === "gate vote" ? k : undefined,
      },
    ]);
    setEdges((current) => [
      ...current,
      { from: source.id, to: id, style: "elbow" },
      { from: id, to: target.id, style: "elbow" },
    ]);
    setSelected(id);
    setPendingGate(null);
    invalidate();
  }
  function changeGate(nodeId: number, type: FtaGateType) {
    if (!canWriteRef.current) return;
    remember();
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              type,
              title: gateLabel(type),
              gateK: type === "gate vote" ? node.gateK ?? 2 : undefined,
            }
          : node,
      ),
    );
    setGateMenu(null);
    invalidate();
  }
  function changeEvent(nodeId: number, type: EventType) {
    if (!canWriteRef.current) return;
    remember();
    setNodes((current) =>
      current.map((node) => {
        if (type === "event top" && node.type === "event top" && node.id !== nodeId) {
          return { ...node, type: "event intermediate" };
        }
        return node.id === nodeId ? { ...node, type } : node;
      }),
    );
    setGateMenu(null);
    invalidate();
  }

  /* ------------------------------------------------------------------ node drag */
  function dragNode(event: ReactPointerEvent, node: DiagramNode) {
    if ((event.target as HTMLElement).closest(".dwb-port")) return;
    if (event.button !== 0) return;
    if (!canWriteRef.current) return;
    if (mode === "rbd" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      setSelectedNodes((current) =>
        current.includes(node.id) ? current.filter((id) => id !== node.id) : [...current, node.id],
      );
      setSelected(0);
      setSelectedEdge(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    remember();
    const movingIds =
      mode === "rbd" && selectedNodes.includes(node.id) && selectedNodes.length > 1 ? selectedNodes : [node.id];
    if (!selectedNodes.includes(node.id)) selectOnly(node.id);
    else {
      setSelected(node.id);
      setSelectedEdge(null);
    }
    setGateMenu(null);
    setGroupMenu(null);
    invalidate();
    const originals = new Map(
      nodes.filter((item) => movingIds.includes(item.id)).map((item) => [item.id, { x: item.x, y: item.y }]),
    );
    const start = { x: event.clientX, y: event.clientY };
    const move = (pointer: PointerEvent) =>
      setNodes((current) =>
        current.map((item) => {
          const initial = originals.get(item.id);
          if (!initial) return item;
          return {
            ...item,
            x: Math.max(12, initial.x + ((pointer.clientX - start.x) * 100) / zoom),
            y: Math.max(12, initial.y + ((pointer.clientY - start.y) * 100) / zoom),
          };
        }),
      );
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function removeSelected() {
    if (!canWriteRef.current) return;
    const ids = selectedNodes.length ? selectedNodes : selected ? [selected] : [];
    if (!ids.length) return;
    remember();
    setNodes((current) => current.filter((node) => !ids.includes(node.id)));
    setEdges((current) => current.filter((edge) => !ids.includes(edge.from) && !ids.includes(edge.to)));
    setSelected(0);
    setSelectedNodes([]);
    invalidate();
  }
  function removeSelectedEdge() {
    if (!canWriteRef.current || selectedEdge === null) return;
    remember();
    setEdges((current) => current.filter((_, index) => index !== selectedEdge));
    setSelectedEdge(null);
    invalidate();
  }

  /* ------------------------------------------------------------------ edge geometry */
  function edgePoints(edge: DiagramEdge) {
    const source = nodeById.get(edge.from);
    const target = nodeById.get(edge.to);
    if (!source || !target) return [] as { x: number; y: number }[];
    const start = portPoint(source, "top");
    const end = portPoint(target, "bottom");
    if (!edge.waypoint && Math.abs(start.x - end.x) < 8) return [start, end];
    const waypoint = edge.waypoint ?? { x: end.x, y: (start.y + end.y) / 2 };
    return [start, { x: start.x, y: waypoint.y }, waypoint, { x: waypoint.x, y: end.y }, end].filter(
      (item, index, values) => !index || item.x !== values[index - 1].x || item.y !== values[index - 1].y,
    );
  }
  function edgePath(edge: DiagramEdge) {
    if (mode === "rbd") return routeRbdConnection(nodes, edge).path;
    const points = edgePoints(edge);
    return points.map((item, index) => `${index ? "L" : "M"}${item.x} ${item.y}`).join(" ");
  }
  function pathPoints(edge: DiagramEdge) {
    if (mode === "rbd") return routeRbdConnection(nodes, edge).points;
    return edgePoints(edge);
  }
  function edgeArrow(edge: DiagramEdge) {
    const points = pathPoints(edge);
    if (!Array.isArray(points) || points.length < 2) return null;
    const candidates = points
      .slice(1)
      .map((second, index) => ({
        first: points[index],
        second,
        index,
        length: Math.abs(second.x - points[index].x) + Math.abs(second.y - points[index].y),
      }))
      .filter((segment) => segment.length >= 24 && segment.index > 0 && segment.index < points.length - 2);
    const segments = candidates.length
      ? candidates
      : points
          .slice(1)
          .map((second, index) => ({
            first: points[index],
            second,
            index,
            length: Math.abs(second.x - points[index].x) + Math.abs(second.y - points[index].y),
          }))
          .filter((segment) => segment.length >= 24);
    const segment = segments.sort((first, second) => second.length - first.length)[0];
    if (!segment) return null;
    return {
      x: (segment.first.x + segment.second.x) / 2,
      y: (segment.first.y + segment.second.y) / 2,
      angle: (Math.atan2(segment.second.y - segment.first.y, segment.second.x - segment.first.x) * 180) / Math.PI,
    };
  }
  function edgeHandle(edge: DiagramEdge) {
    if (edge.waypoint) return edge.waypoint;
    if (mode === "fta") {
      const points = edgePoints(edge);
      if (points.length < 2) return { x: 0, y: 0 };
      return { x: (points[0].x + points[points.length - 1].x) / 2, y: (points[0].y + points[points.length - 1].y) / 2 };
    }
    const route = routeRbdConnection(nodes, edge).points;
    if (route.length < 2) return { x: 0, y: 0 };
    let longest = { first: route[0], second: route[1], length: 0 };
    for (let index = 1; index < route.length; index += 1) {
      const first = route[index - 1];
      const second = route[index];
      const length = Math.abs(second.x - first.x) + Math.abs(second.y - first.y);
      if (length > longest.length) longest = { first, second, length };
    }
    return { x: (longest.first.x + longest.second.x) / 2, y: (longest.first.y + longest.second.y) / 2 };
  }
  function dragEdgeHandle(event: ReactPointerEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();
    if (!canWriteRef.current) return;
    remember();
    setSelectedEdge(index);
    setSelected(0);
    setSelectedNodes([]);
    invalidate();
    const wrap = (event.currentTarget.closest(".dwb-canvas-wrap") as HTMLElement)?.getBoundingClientRect();
    const move = (pointer: PointerEvent) => {
      const waypoint = {
        x: ((pointer.clientX - (wrap?.left ?? 0) - pan.x) * 100) / zoom,
        y: ((pointer.clientY - (wrap?.top ?? 0) - pan.y) * 100) / zoom,
      };
      setEdges((current) => current.map((edge, edgeIndex) => (edgeIndex === index ? { ...edge, waypoint } : edge)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* ------------------------------------------------------------------ grouping (RBD) */
  function createGroup() {
    if (!canWriteRef.current) return;
    const name = groupName.trim();
    const ids = new Set(selectedNodes);
    const members = nodes.filter((node) => ids.has(node.id) && !isGate(node));
    if (!name) {
      setGroupError("Enter a group name.");
      return;
    }
    if (members.length < 2) {
      setGroupError("Select at least two connected RBD blocks.");
      return;
    }
    const internalEdges = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
    const adjacency = new Map(members.map((member) => [member.id, [] as number[]]));
    internalEdges.forEach((edge) => {
      adjacency.get(edge.from)?.push(edge.to);
      adjacency.get(edge.to)?.push(edge.from);
    });
    const visited = new Set<number>();
    const queue = [members[0].id];
    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      queue.push(...(adjacency.get(current) ?? []));
    }
    if (visited.size !== members.length) {
      setGroupError("All selected blocks must belong to one connected subsystem.");
      return;
    }
    const result = analyzeRbd(
      members.map((node) => ({ id: node.id, x: node.x, ...metricsOf(node) })),
      internalEdges,
    );
    if (result.configuration === "Open") {
      setGroupError("The selected blocks do not form a complete RBD path.");
      return;
    }

    const nextNumber =
      groups.reduce((highest, group) => Math.max(highest, Number(group.tag.match(/\d+/)?.[0] ?? 0)), 0) + 1;
    const definition: RbdGroup = {
      id: globalThis.crypto?.randomUUID?.() ?? `group-${Date.now()}`,
      tag: `GRP-${String(nextNumber).padStart(3, "0")}`,
      name,
      failureRate: result.failureRate,
      mtbf: result.mtbf,
      mttr: result.mttr,
      availability: result.availability,
      configuration: result.configuration,
      paths: result.paths,
      memberCount: members.length,
      createdAt: new Date().toISOString(),
      formulaVersion: "rbd-sheet-v1",
    };
    remember();
    setGroups((current) => [...current, definition]);

    const newId = Math.max(0, ...nodes.map((node) => node.id)) + 1;
    const left = Math.min(...members.map((node) => node.x));
    const right = Math.max(...members.map((node) => node.x + BLOCK_WIDTH));
    const top = Math.min(...members.map((node) => node.y));
    const bottom = Math.max(...members.map((node) => node.y + BLOCK_HEIGHT));
    const groupNode: DiagramNode = {
      id: newId,
      x: (left + right - BLOCK_WIDTH) / 2,
      y: (top + bottom - BLOCK_HEIGHT) / 2,
      type: "group",
      title: definition.tag,
      subtitle: definition.name,
      groupId: definition.id,
      failureRate: definition.failureRate,
      mttr: definition.mttr,
    };
    const remaining = nodes.filter((node) => !ids.has(node.id));
    const rewired: DiagramEdge[] = [];
    for (const edge of edges) {
      const fromInside = ids.has(edge.from);
      const toInside = ids.has(edge.to);
      if (fromInside && toInside) continue;
      if (!fromInside && !toInside) {
        rewired.push(edge);
        continue;
      }
      const outsideId = fromInside ? edge.to : edge.from;
      const outside = nodeById.get(outsideId);
      if (!outside) continue;
      const groupSide: PortSide = outside.x + BLOCK_WIDTH / 2 < groupNode.x + BLOCK_WIDTH / 2 ? "left" : "right";
      rewired.push(
        fromInside
          ? { ...edge, from: newId, fromSide: groupSide, waypoint: undefined }
          : { ...edge, to: newId, toSide: groupSide, waypoint: undefined },
      );
    }
    const unique = rewired.filter(
      (edge, index, all) =>
        index ===
        all.findIndex(
          (other) =>
            (other.from === edge.from && other.to === edge.to) || (other.from === edge.to && other.to === edge.from),
        ),
    );
    const nextNodes = [...remaining, groupNode];
    setNodes(nextNodes);
    setEdges(lockRbdConnectionPorts(nextNodes, unique));
    selectOnly(newId);
    setGroupDialog(false);
    invalidate();
  }

  /* ------------------------------------------------------------------ canvas */
  function startCanvasInteraction(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (panMode) {
      startPan(event);
      return;
    }
    if (mode !== "rbd" || !canWriteRef.current) return;
    if ((event.target as HTMLElement).closest(".dwb-node,.dwb-edge-handle,.dwb-status")) return;
    event.preventDefault();
    setGroupMenu(null);
    setGateMenu(null);
    setSelectedEdge(null);
    const rect = event.currentTarget.getBoundingClientRect();
    const point = (clientX: number, clientY: number) => ({
      x: ((clientX - rect.left - pan.x) * 100) / zoom,
      y: ((clientY - rect.top - pan.y) * 100) / zoom,
    });
    const start = point(event.clientX, event.clientY);
    const move = (pointer: PointerEvent) => {
      const current = point(pointer.clientX, pointer.clientY);
      setSelectionBox({
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        width: Math.abs(current.x - start.x),
        height: Math.abs(current.y - start.y),
      });
    };
    const up = (pointer: PointerEvent) => {
      const current = point(pointer.clientX, pointer.clientY);
      const box = {
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        width: Math.abs(current.x - start.x),
        height: Math.abs(current.y - start.y),
      };
      const picked =
        box.width < 4 && box.height < 4
          ? []
          : nodes
              .filter(
                (node) =>
                  node.x < box.x + box.width &&
                  node.x + BLOCK_WIDTH > box.x &&
                  node.y < box.y + box.height &&
                  node.y + BLOCK_HEIGHT > box.y,
              )
              .map((node) => node.id);
      setSelectedNodes(picked);
      setSelected(picked.length === 1 ? picked[0] : 0);
      setSelectionBox(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!panMode || (event.target as HTMLElement).closest(".dwb-node,.dwb-edge-handle")) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    const move = (pointer: PointerEvent) =>
      setPan({ x: start.panX + pointer.clientX - start.x, y: start.panY + pointer.clientY - start.y });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function wheelZoom(event: ReactWheelEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".dwb-status")) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const result = zoomCanvasAtPointer(zoom, pan, { x: event.clientX - rect.left, y: event.clientY - rect.top }, event.deltaY);
    setZoom(result.zoom);
    setPan(result.pan);
  }

  /* ------------------------------------------------------------------ analysis */
  function runAnalysis() {
    if (mode === "rbd") {
      const rbdComponents = nodes
        .filter((node) => node.assetId || node.groupId)
        .map((node) => {
          const metrics = metricsOf(node);
          return { id: node.id, x: node.x, failureRate: metrics.failureRate, mttr: metrics.mttr, availability: metrics.availability };
        });
      if (!rbdComponents.length) {
        setAnalysis(null);
        setNotice("Add at least one component before calculating the RBD.");
        return;
      }
      const result = analyzeRbd(rbdComponents, edges);
      setAnalysis(result);
      setNotice(
        result.configuration === "Open"
          ? "No complete RBD path was found. Connect the required blocks, then calculate again."
          : "",
      );
      return;
    }

    const eventNodes = nodes.filter((node) => !isGate(node));
    if (!eventNodes.length) {
      setAnalysis(null);
      setNotice("Add at least one event before calculating the fault tree.");
      return;
    }
    let top = eventNodes.find((node) => node.type === "event top");
    if (!top) {
      top =
        eventNodes
          .filter((node) => !edges.some((edge) => edge.from === node.id))
          .sort((a, b) => a.y - b.y)[0] ?? eventNodes[0];
    }
    const topInput = edges.find((edge) => edge.to === top!.id);
    const topLogic = nodeById.get(topInput?.from ?? -1);
    const probability = evaluateNode(top.id, new Set());
    remember();
    setNodes(standardLayout(top.id));
    setSelected(top.id);
    setAnalysed(true);
    setAnalysis({
      probability,
      formula: gateFormula(topLogic?.type, topLogic?.gateK),
      topEvent: top.title,
    });
    setNotice("");
  }

  function evaluateNode(id: number, visiting: Set<number>): number {
    if (visiting.has(id)) return 0;
    const node = nodeById.get(id);
    if (!node) return 0;
    const inputs = edges.filter((edge) => edge.to === id).map((edge) => evaluateNode(edge.from, new Set(visiting).add(id)));
    if (isGate(node)) return evaluateGate(node.type, inputs, node.gateK);
    if (inputs.length) return inputs.length === 1 ? inputs[0] : evaluateGate("gate or", inputs);
    const metrics = metricsOf(node);
    return basicEventProbability(metrics.failureRate, metrics.nodeMission);
  }

  function standardLayout(topId: number) {
    const depths = new Map<number, number>([[topId, 0]]);
    const queue = [topId];
    while (queue.length) {
      const target = queue.shift()!;
      const depth = depths.get(target) ?? 0;
      for (const edge of edges.filter((item) => item.to === target)) {
        if (!depths.has(edge.from) || (depths.get(edge.from) ?? 0) < depth + 1) {
          depths.set(edge.from, depth + 1);
          queue.push(edge.from);
        }
      }
    }
    const maxDepth = Math.max(0, ...depths.values());
    for (const node of nodes) if (!depths.has(node.id)) depths.set(node.id, maxDepth + 1);
    const levels = new Map<number, DiagramNode[]>();
    for (const node of nodes) {
      const depth = depths.get(node.id) ?? 0;
      levels.set(depth, [...(levels.get(depth) ?? []), node]);
    }
    return nodes.map((node) => {
      const depth = depths.get(node.id) ?? 0;
      const level = levels.get(depth) ?? [node];
      const index = level.findIndex((item) => item.id === node.id);
      const spacing = 245;
      const width = (level.length - 1) * spacing;
      const centerOffset = isGate(node) ? GATE_WIDTH / 2 : BLOCK_WIDTH / 2;
      return { ...node, x: 900 - width / 2 + index * spacing - centerOffset, y: 55 + depth * 165 };
    });
  }

  /* ------------------------------------------------------------------ keyboard */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName;
      const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(tag);
      if (event.ctrlKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
      if (event.ctrlKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
      if (event.key === "Delete" && !typing) {
        if (selectedEdge !== null) removeSelectedEdge();
        else if (selectedNodes.length || selected) removeSelected();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });


  /* ------------------------------------------------------------------ render */
  const blockPorts: PortSide[] = mode === "rbd" ? ["left", "right"] : ["top", "bottom"];
  const grid = canvasGridMetrics(zoom, pan);
  const gridStyle = {
    "--grid-small": `${grid.small}px`,
    "--grid-large": `${grid.large}px`,
    "--grid-x": `${grid.x}px`,
    "--grid-y": `${grid.y}px`,
  } as CSSProperties;
  const selectedNode = selected ? nodeById.get(selected) : undefined;
  const gateIndex = (nodeId: number) => nodes.filter(isGate).findIndex((node) => node.id === nodeId) + 1;
  const saveLabel =
    saveState === "readonly"
      ? "Read-only"
      : saveState === "saving"
        ? "Saving…"
        : saveState === "error"
          ? "Save failed"
          : savedAt
            ? `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "Saved";

  return (
    <>
      <section className={`dwb dwb-${mode} ${canWrite ? "" : "dwb-readonly"}`} onClick={() => { setGateMenu(null); setGroupMenu(null); }}>
        <header className="dwb-toolbar">
          <button
            className={`dwb-action ghost ${panMode ? "active" : ""}`}
            onClick={() => setPanMode((value) => !value)}
            title="Pan the diagram"
            type="button"
          >
            Pan
          </button>
          <button className="dwb-action ghost" onClick={undo} disabled={!canWrite} title="Undo (Ctrl+Z)" type="button">
            Undo
          </button>
          <button className="dwb-action ghost" onClick={redo} disabled={!canWrite} title="Redo (Ctrl+Y)" type="button">
            Redo
          </button>
          <span className="dwb-separator" />
          <button className="dwb-action run" onClick={runAnalysis} title="Calculate" type="button">
            Calculate
          </button>
          <button
            className="dwb-action danger"
            onClick={() => {
              if (!canWrite) return;
              if (!nodes.length || window.confirm(`Clear the complete ${mode === "rbd" ? "diagram" : "fault tree"}?`)) {
                remember();
                setNodes([]);
                setEdges([]);
                setSelected(0);
                setSelectedNodes([]);
                setSelectedEdge(null);
                invalidate();
              }
            }}
            disabled={!canWrite}
            type="button"
          >
            Clear
          </button>
          <button
            className="dwb-action ghost"
            onClick={() => {
              setZoom(DEFAULT_CANVAS_ZOOM);
              setPan({ x: 0, y: 0 });
              setSelected(0);
              setSelectedNodes([]);
              setSelectedEdge(null);
            }}
            type="button"
          >
            Reset view
          </button>
          <span className="dwb-hint">
            {mode === "rbd"
              ? "Drag blocks from the library. Drag between ports to connect. Right-click a selection to make a reusable group."
              : "Drag events and gates in. Drag between connection dots; the lower event is the cause."}
          </span>
          <span className={`dwb-save ${saveState}`}>{saveLabel}</span>
          <button
            type="button"
            className="dwb-action ghost"
            aria-label="Method explanation"
            title="How this workbench calculates"
            onClick={() => setHelpDialog(true)}
          >
            ?
          </button>
        </header>

        <div className="dwb-body">
          <aside className="dwb-library">
            <div className="dwb-panel-head">
              <strong>Components</strong>
              <button type="button" onClick={() => router.refresh()} title="Reload λ and MTTR from the project">
                ↻
              </button>
            </div>
            <label className="dwb-search">
              <span aria-hidden="true">⌕</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a component" />
            </label>
            <div className="dwb-library-scroll">
              {mode === "fta" ? (
                <section className="dwb-gate-palette">
                  <div className="dwb-section-title">
                    <strong>Logic gates</strong>
                    <span>{FTA_GATES.length}</span>
                  </div>
                  <div className="dwb-gate-grid">
                    {FTA_GATES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        className="dwb-gate-card"
                        draggable={canWrite}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "copy";
                          event.dataTransfer.setData("application/x-ramsport", JSON.stringify({ gate: type }));
                        }}
                        onClick={() => addGate(type, undefined, Number(voteK) || 2)}
                        disabled={!canWrite}
                      >
                        <span className={`dwb-mini-gate ${type.replace("gate ", "")}`} />
                        {gateLabel(type)}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {mode === "rbd" && groups.length > 0 ? (
                <section className="dwb-group-library">
                  <div className="dwb-section-title">
                    <strong>Reusable groups</strong>
                    <span>{groups.length}</span>
                  </div>
                  {filteredGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className="dwb-card dwb-group-card"
                      draggable={canWrite}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "copy";
                        event.dataTransfer.setData("application/x-ramsport", JSON.stringify({ groupId: group.id }));
                      }}
                      onClick={() => addGroup(group)}
                      disabled={!canWrite}
                    >
                      <strong>{group.name}</strong>
                      <span className="dwb-lambda">λ {group.failureRate.toExponential(2)} /h</span>
                      <span className="dwb-mtbf">
                        MTBF {Number.isFinite(group.mtbf) ? Math.round(group.mtbf).toLocaleString() : "∞"} h
                      </span>
                      <span className="dwb-mttr">MTTR {group.mttr.toFixed(2)} h</span>
                      <small>
                        {group.tag} · {group.memberCount} blocks
                      </small>
                    </button>
                  ))}
                </section>
              ) : null}

              <div className="dwb-section-title dwb-asset-title">
                <strong>Project components</strong>
                <span>{filteredComponents.length}</span>
              </div>
              {filteredComponents.map((component) => (
                <button
                  key={component.id}
                  type="button"
                  className="dwb-card"
                  draggable={canWrite}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData("application/x-ramsport", JSON.stringify({ id: component.id }));
                  }}
                  onClick={() => addComponent(component)}
                  disabled={!canWrite}
                  title={`${component.tag} · ${component.system}`}
                >
                  <strong>{component.description}</strong>
                  <span className="dwb-lambda">λ {(component.lambda || 0).toExponential(2)} /h</span>
                  <span className="dwb-mtbf">
                    MTBF {component.lambda ? Math.round(meanTimeBetweenFailures(component.lambda)).toLocaleString() : "∞"} h
                  </span>
                  <span className="dwb-mttr">MTTR {component.mttr.toFixed(2)} h</span>
                  <small>{component.tag}</small>
                </button>
              ))}
              {!filteredComponents.length ? (
                <p className="dwb-library-empty">
                  No component matches “{search}”. Clear the search or add components in the PBS and FRP modules.
                </p>
              ) : null}
            </div>
            <div className="dwb-library-foot">
              <span>{mode === "rbd" ? "Blocks" : "Events"}: {nodes.filter((node) => !isGate(node)).length}</span>
              <span>Gates: {nodes.filter(isGate).length}</span>
            </div>
          </aside>

          <div
            className={`dwb-canvas-wrap ${dragOver ? "drop-ready" : ""} ${panMode ? "pan-active" : ""}`}
            style={gridStyle}
            onPointerDown={startCanvasInteraction}
            onContextMenu={(event) => {
              if (!canWrite) return;
              if (mode === "rbd" && selectedNodes.length >= 2) {
                event.preventDefault();
                setGroupMenu({ x: event.clientX, y: event.clientY });
              }
            }}
            onWheel={wheelZoom}
            onDragOver={(event) => {
              event.preventDefault();
              if (canWrite) setDragOver(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false);
            }}
            onDrop={drop}
          >
            {notice ? (
              <div className="dwb-notice" role="alert">
                <span>{notice}</span>
                <button onClick={() => setNotice("")} aria-label="Dismiss message" type="button">
                  ×
                </button>
              </div>
            ) : null}

            <div
              className="dwb-canvas"
              style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom / 100})`, transformOrigin: "top left" }}
            >
              <svg className="dwb-edges" viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} width={CANVAS_WIDTH} height={CANVAS_HEIGHT}>
                {edges.map((edge, index) => {
                  const arrow = edgeArrow(edge);
                  return (
                    <g key={`${edge.from}-${edge.to}-${index}`}>
                      <path
                        data-export-edge="true"
                        className={`dwb-edge ${selectedEdge === index ? "selected" : ""}`}
                        d={edgePath(edge)}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setSelectedEdge(index);
                          setSelected(0);
                          setSelectedNodes([]);
                        }}
                      />
                      {arrow ? (
                        <polygon
                          className="dwb-arrow"
                          points="-6,-4 6,0 -6,4"
                          transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle})`}
                        />
                      ) : null}
                    </g>
                  );
                })}
                {portDrag ? (
                  <path
                    className="dwb-preview"
                    d={`M${portDrag.start.x} ${portDrag.start.y} L${portDrag.current.x} ${portDrag.current.y}`}
                  />
                ) : null}
              </svg>

              {edges.map((edge, index) =>
                selectedEdge === index ? (
                  <button
                    key={`handle-${index}`}
                    type="button"
                    className="dwb-edge-handle"
                    style={{ left: edgeHandle(edge).x, top: edgeHandle(edge).y }}
                    onPointerDown={(event) => dragEdgeHandle(event, index)}
                    title="Drag to adjust the connector bend"
                  />
                ) : null,
              )}

              {nodes.map((node) => {
                const component = node.assetId ? componentById.get(node.assetId) : undefined;
                const gate = isGate(node);
                const metrics = metricsOf(node);
                const isSelected = selectedNodes.includes(node.id) || selected === node.id;
                return (
                  <div
                    key={node.id}
                    data-export-node="true"
                    className={`dwb-node ${gate ? "is-gate" : "is-block"} ${node.type.replaceAll(" ", "-")} ${isSelected ? "selected" : ""} ${analysed && mode === "fta" ? "analysed" : ""}`}
                    style={{ left: node.x, top: node.y }}
                    onPointerDown={(event) => dragNode(event, node)}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (event.ctrlKey || event.metaKey) return;
                      if (!selectedNodes.includes(node.id)) selectOnly(node.id);
                    }}
                    onContextMenu={(event) => {
                      if (!canWrite) return;
                      event.preventDefault();
                      event.stopPropagation();
                      if (!selectedNodes.includes(node.id)) selectOnly(node.id);
                      if (mode === "fta") setGateMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
                      else if (selectedNodes.length >= 2) setGroupMenu({ x: event.clientX, y: event.clientY });
                    }}
                  >
                    {blockPorts.map((side) => (
                      <span
                        key={side}
                        className={`dwb-port ${side}`}
                        data-port-node={node.id}
                        data-port-side={side}
                        onPointerDown={(event) => startPortDrag(event, node, side)}
                        title="Drag to another connection point"
                      />
                    ))}
                    {gate ? (
                      <GateGraphic type={node.type} index={gateIndex(node.id)} />
                    ) : (
                      <>
                        <strong className="dwb-node-title">{component?.tag ?? node.title}</strong>
                        <div className="dwb-node-values">
                          <span>
                            <b>λ</b>
                            {(component?.lambda ?? node.failureRate ?? 0).toExponential(2)} /h
                          </span>
                          <span>
                            <b>MTBF</b>
                            {metrics.failureRate ? Math.round(meanTimeBetweenFailures(metrics.failureRate)).toLocaleString() : "∞"} h
                          </span>
                          <span>
                            <b>MTTR</b>
                            {metrics.mttr.toFixed(2)} h
                          </span>
                        </div>
                        <small className="dwb-node-name">{component?.description ?? node.subtitle}</small>
                        {mode === "fta" ? (
                          <span className={`dwb-event-badge ${node.type.replace("event ", "")}`}>
                            {node.type === "event top" ? "TOP" : node.type === "event intermediate" ? "INT" : "BASIC"}
                          </span>
                        ) : node.groupId ? (
                          <span className="dwb-event-badge group">GROUP</span>
                        ) : null}
                      </>
                    )}
                  </div>
                );
              })}

              {selectionBox ? (
                <div
                  className="dwb-marquee"
                  style={{ left: selectionBox.x, top: selectionBox.y, width: selectionBox.width, height: selectionBox.height }}
                />
              ) : null}
            </div>

            <footer className="dwb-status">
              <span>{nodes.filter((node) => !isGate(node)).length} {mode === "rbd" ? "blocks" : "events"}</span>
              <span>{nodes.filter(isGate).length} gates</span>
              <span>{edges.length} connections</span>
              {selectedNodes.length > 1 ? <span>{selectedNodes.length} selected</span> : null}
              <div className="dwb-zoom">
                <button type="button" onClick={() => setZoom(Math.max(MIN_CANVAS_ZOOM, zoom - 10))}>
                  −
                </button>
                <input
                  type="range"
                  min={MIN_CANVAS_ZOOM}
                  max={MAX_CANVAS_ZOOM}
                  step="10"
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  aria-label="Canvas zoom"
                />
                <button type="button" onClick={() => setZoom(Math.min(MAX_CANVAS_ZOOM, zoom + 10))}>
                  +
                </button>
                <b>{zoom}%</b>
              </div>
            </footer>
          </div>

          <aside className="dwb-inspector">
            <div className="dwb-panel-head">
              <strong>Result</strong>
              <span>{mode === "rbd" ? "IEC 61078" : "IEC 61025"}</span>
            </div>

            <label className="dwb-mission">
              Mission time (h)
              <input
                type="number"
                min={1}
                step={1}
                value={mission}
                disabled={!canWrite}
                onChange={(event) => {
                  const next = Math.max(1, Number(event.target.value) || 1);
                  setMission(next);
                  invalidate();
                }}
              />
            </label>

            {selectedNode ? (
              <div className="dwb-selected">
                <span>{isGate(selectedNode) ? "Logic gate" : selectedNode.groupId ? "Reusable group" : "Component"}</span>
                <strong>{isGate(selectedNode) ? gateLabel(selectedNode.type) : componentById.get(selectedNode.assetId ?? "")?.tag ?? selectedNode.title}</strong>
                <small>{isGate(selectedNode) ? selectedNode.subtitle : selectedNode.subtitle}</small>
                {isGate(selectedNode) && selectedNode.type === "gate vote" ? (
                  <label className="dwb-inline-field">
                    Voting k / n
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, edges.filter((edge) => edge.to === selectedNode.id).length)}
                      value={selectedNode.gateK ?? 2}
                      disabled={!canWrite}
                      onChange={(event) => {
                        const k = Math.max(1, Number(event.target.value) || 1);
                        setNodes((current) => current.map((node) => (node.id === selectedNode.id ? { ...node, gateK: k } : node)));
                        invalidate();
                      }}
                    />
                  </label>
                ) : null}
                {mode === "fta" && !isGate(selectedNode) ? (
                  <label className="dwb-inline-field">
                    Event mission (h)
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={selectedNode.mission ?? mission}
                      disabled={!canWrite}
                      onChange={(event) => {
                        const value = Math.max(0, Number(event.target.value) || 0);
                        setNodes((current) =>
                          current.map((node) => (node.id === selectedNode.id ? { ...node, mission: value } : node)),
                        );
                        invalidate();
                      }}
                    />
                  </label>
                ) : null}
                {canWrite ? (
                  <button type="button" className="dwb-delete" onClick={removeSelected}>
                    Delete selected
                  </button>
                ) : null}
              </div>
            ) : null}

            {analysis ? (
              <div className="dwb-result">
                {isRbdAnalysis(analysis) ? (
                  <>
                    <p className="dwb-result-lead">
                      {analysis.configuration}
                      {analysis.koon ? ` · ${analysis.koon.k}oo${analysis.koon.n}` : ""}
                    </p>
                    <dl>
                      <div>
                        <dt>Failure rate λs /h</dt>
                        <dd>{analysis.failureRate.toExponential(4)}</dd>
                      </div>
                      <div>
                        <dt>MTBF</dt>
                        <dd>{Number.isFinite(analysis.mtbf) ? `${Math.round(analysis.mtbf).toLocaleString()} h` : "∞"}</dd>
                      </div>
                      <div>
                        <dt>MTTR</dt>
                        <dd>{analysis.mttr.toFixed(2)} h</dd>
                      </div>
                      <div>
                        <dt>Availability</dt>
                        <dd>{(analysis.availability * 100).toFixed(6)}%</dd>
                      </div>
                      <div className="accent">
                        <dt>R(t) at mission</dt>
                        <dd>{(missionReliability(analysis.failureRate, mission) * 100).toFixed(5)}%</dd>
                      </div>
                    </dl>
                    <p className="dwb-result-note">{analysis.note}</p>
                    <div className="dwb-formula">
                      <b>Applied formula</b>
                      <code>{analysis.formula}</code>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="dwb-result-lead">Top-event probability</p>
                    <dl>
                      <div>
                        <dt>Top event</dt>
                        <dd>{analysis.topEvent}</dd>
                      </div>
                      <div className="accent">
                        <dt>Q(t)</dt>
                        <dd>{analysis.probability.toExponential(5)}</dd>
                      </div>
                    </dl>
                    <p className="dwb-result-note">Constant failure rate and statistically independent inputs assumed.</p>
                    <div className="dwb-formula">
                      <b>Applied logic</b>
                      <code>{analysis.formula}</code>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="dwb-result-empty">
                <strong>No result yet</strong>
                <p>
                  {mode === "rbd"
                    ? "Connect the blocks in the required flow, then calculate."
                    : "Build the fault tree from the bottom up, then calculate."}
                </p>
              </div>
            )}

            <section className="dwb-reference">
              <h3>{mode === "rbd" ? "Method reference" : "Gate reference"}</h3>
              {mode === "rbd" ? (
                <dl>
                  <div>
                    <dt>Series</dt>
                    <dd>
                      Every connected block must operate.
                      <code>λs = Σλi</code>
                      <code>MTTRs = Σ(λi × MTTRi) / λs</code>
                    </dd>
                  </div>
                  <div>
                    <dt>K-out-of-N</dt>
                    <dd>
                      At least K of N channels must operate.
                      <code>λs = n! λi^(n-r+1) Ti^(n-r) / ((r-1)!(n-r+1)!)</code>
                      <code>MTTRs = 1 / ((n-r+1)μ)</code>
                    </dd>
                  </div>
                </dl>
              ) : (
                <dl>
                  <div>
                    <dt>AND</dt>
                    <dd>
                      Every input must occur.
                      <code>Q = Π Qi</code>
                    </dd>
                  </div>
                  <div>
                    <dt>OR</dt>
                    <dd>
                      One or more inputs occur.
                      <code>Q = 1 − Π(1 − Qi)</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Voting</dt>
                    <dd>
                      At least k inputs occur.
                      <code>Q = binomial tail</code>
                    </dd>
                  </div>
                  <div>
                    <dt>XOR / NOT</dt>
                    <dd>
                      Exactly one input / logical complement.
                      <code>Q = 1 − Q1</code>
                    </dd>
                  </div>
                </dl>
              )}
            </section>
          </aside>
        </div>

        {pendingGate ? (
          <div className="dwb-dialog-backdrop" role="dialog" aria-modal="true">
            <section className="dwb-dialog">
              <span>FAULT-TREE LOGIC</span>
              <h2>Select the causal relationship</h2>
              <p>
                The selected gate is inserted between these events. Further inputs connected to the same output reuse
                this gate automatically.
              </p>
              <div className="dwb-gate-choices">
                {(mode === "rbd" ? RBD_GATES : FTA_GATES).map((type) => (
                  <button key={type} type="button" onClick={() => confirmGate(type)}>
                    {gateLabel(type)}
                  </button>
                ))}
              </div>
              {mode === "fta" ? (
                <label className="dwb-vote-field">
                  Voting threshold k
                  <input type="number" min={1} value={voteK} onChange={(event) => setVoteK(event.target.value)} />
                </label>
              ) : null}
              {mode === "rbd" ? (
                <button type="button" className="dwb-dialog-link" onClick={() => confirmGate("direct")}>
                  Direct / end-event connection
                </button>
              ) : null}
              <button type="button" className="dwb-dialog-cancel" onClick={() => setPendingGate(null)}>
                Cancel
              </button>
            </section>
          </div>
        ) : null}

        {gateMenu ? (
          <div className="dwb-context" style={{ left: gateMenu.x, top: gateMenu.y }} onClick={(event) => event.stopPropagation()}>
            {(() => {
              const node = nodeById.get(gateMenu.nodeId);
              if (!node) return null;
              return isGate(node) ? (
                <>
                  <strong>Change logic gate</strong>
                  {FTA_GATES.map((type) => (
                    <button key={type} type="button" onClick={() => changeGate(node.id, type)}>
                      <span className={`dwb-mini-gate ${type.replace("gate ", "")}`} />
                      {gateLabel(type)}
                    </button>
                  ))}
                </>
              ) : (
                <>
                  <strong>Set event type</strong>
                  {EVENT_TYPES.map((type) => (
                    <button key={type} type="button" onClick={() => changeEvent(node.id, type)}>
                      {eventTypeLabel(type)}
                    </button>
                  ))}
                </>
              );
            })()}
            {canWrite ? (
              <button className="dwb-context-delete" type="button" onClick={removeSelected}>
                Delete selected
              </button>
            ) : null}
          </div>
        ) : null}

        {groupMenu ? (
          <div className="dwb-context" style={{ left: groupMenu.x, top: groupMenu.y }} onClick={(event) => event.stopPropagation()}>
            <strong>{selectedNodes.length} blocks selected</strong>
            <button
              type="button"
              onClick={() => {
                setGroupMenu(null);
                setGroupError("");
                setGroupName("");
                setGroupDialog(true);
              }}
            >
              Group selected blocks
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedNodes([]);
                setSelected(0);
                setGroupMenu(null);
              }}
            >
              Clear selection
            </button>
          </div>
        ) : null}

        {groupDialog ? (
          <div
            className="dwb-dialog-backdrop"
            role="dialog"
            aria-modal="true"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setGroupDialog(false);
            }}
          >
            <section className="dwb-dialog">
              <span>REUSABLE RBD SUBSYSTEM</span>
              <h2>Name this group</h2>
              <p>
                The {selectedNodes.length} selected blocks and their internal connections are calculated as one
                equivalent reliability block. External connections stay attached.
              </p>
              <label className="dwb-vote-field">
                Group name
                <input
                  autoFocus
                  value={groupName}
                  maxLength={80}
                  onChange={(event) => {
                    setGroupName(event.target.value);
                    setGroupError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") createGroup();
                    if (event.key === "Escape") setGroupDialog(false);
                  }}
                  placeholder="e.g. Traction power subsystem"
                />
              </label>
              {groupError ? (
                <p className="dwb-group-error" role="alert">
                  {groupError}
                </p>
              ) : null}
              <div className="dwb-dialog-actions">
                <button type="button" className="dwb-dialog-cancel" onClick={() => setGroupDialog(false)}>
                  Cancel
                </button>
                <button type="button" className="dwb-dialog-confirm" onClick={createGroup}>
                  Create group
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </section>

        {helpDialog ? (
          <div className="dwb-dialog-backdrop" role="dialog" aria-modal="true">
            <section className="dwb-dialog">
              <span>{mode === "rbd" ? "RELIABILITY BLOCK DIAGRAM" : "FAULT TREE ANALYSIS"}</span>
              <h2>How this workbench calculates</h2>
              <p>
                {mode === "rbd"
                  ? "Connect blocks left-to-right in the required flow, press Calculate, and the system equivalent appears in the inspector."
                  : "Build the tree from the bottom up — basic events connect through gates to the top event, then press Calculate."}
              </p>
              {mode === "rbd" ? (
                <dl>
                  <div>
                    <dt>Series</dt>
                    <dd>
                      Every connected block must operate.
                      <code>λs = Σλi</code>
                      <code>MTTRs = Σ(λi × MTTRi) / λs</code>
                    </dd>
                  </div>
                  <div>
                    <dt>K-out-of-N</dt>
                    <dd>
                      At least K of N channels must operate.
                      <code>λs = n! λi^(n-r+1) Ti^(n-r) / ((r-1)!(n-r+1)!)</code>
                      <code>MTTRs = 1 / ((n-r+1)μ)</code>
                    </dd>
                  </div>
                </dl>
              ) : (
                <dl>
                  <div>
                    <dt>AND</dt>
                    <dd>
                      Every input must occur.
                      <code>Q = Π Qi</code>
                    </dd>
                  </div>
                  <div>
                    <dt>OR</dt>
                    <dd>
                      One or more inputs occur.
                      <code>Q = 1 − Π(1 − Qi)</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Voting</dt>
                    <dd>
                      At least k inputs occur.
                      <code>Q = binomial tail</code>
                    </dd>
                  </div>
                  <div>
                    <dt>XOR / NOT</dt>
                    <dd>
                      Exactly one input / logical complement.
                      <code>Q = 1 − Q1</code>
                    </dd>
                  </div>
                </dl>
              )}
              <p>Calculated results, the applied formula and its assumptions are shown under Results in the inspector.</p>
              <div className="dwb-dialog-actions">
                <button type="button" className="dwb-dialog-confirm" onClick={() => setHelpDialog(false)}>
                  Got it
                </button>
              </div>
            </section>
          </div>
        ) : null}
    </>
  );
}
