"use client"

import * as React from "react"
import { CONTENT_TYPE_CONFIG } from "@/lib/content-types"
import type { TextBlock } from "@/components/tile-card"
import { GraphDetailPanel } from "./graph-detail-panel"

// ─── Layout constants ─────────────────────────────────────────────────────────

// Max nodes per ring and their base radii (at reference container min-dim 720px)
const RINGS = [
  { max: 8,  baseR: 210 },
  { max: 16, baseR: 380 },
  { max: 28, baseR: 550 },
  { max: 48, baseR: 720 },
]

const NODE_R   = 28   // regular block node
const CENTER_R = 42   // project centre node
const SYNTH_R  = 32   // synthesis node

// ─── Types ────────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string
  x: number
  y: number
  block?: TextBlock
  isCenter?: boolean
  isSynthesis?: boolean
  synthesisText?: string
  synthesisGenerating?: boolean
}

interface GraphEdge {
  id: string
  sourceId: string
  targetId: string
  sx: number; sy: number
  tx: number; ty: number
  isSpoke: boolean
  isSynth: boolean
}

interface GraphAreaProps {
  blocks: TextBlock[]
  ghostNote?: { id: string; text: string; category: string; isGenerating: boolean }
  projectName: string
  onReEnrich:       (id: string) => void
  onTogglePin:      (id: string) => void
  onEdit:           (id: string, text: string) => void
  onEditAnnotation: (id: string, annotation: string) => void
  hasApiKey: boolean
  onOpenSidebar: () => void
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

function computeNodes(
  blocks: TextBlock[],
  ghostNote: GraphAreaProps["ghostNote"],
  cx: number,
  cy: number,
  minDim: number,
): GraphNode[] {
  const scale = Math.max(0.5, Math.min(1.35, minDim / 720))
  const nodes: GraphNode[] = []

  // Centre: project name
  nodes.push({ id: "__center__", x: cx, y: cy, isCenter: true })

  // Distribute blocks across rings, starting from top (–π/2)
  let placed = 0
  for (let ri = 0; ri < RINGS.length && placed < blocks.length; ri++) {
    const slice = blocks.slice(placed, placed + RINGS[ri].max)
    const count  = slice.length
    const radius = RINGS[ri].baseR * scale
    for (let i = 0; i < count; i++) {
      const angle = (2 * Math.PI * i / count) - Math.PI / 2
      nodes.push({
        id: slice[i].id,
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
        block: slice[i],
      })
    }
    placed += count
  }

  // Synthesis: just beyond the outermost occupied ring, centred at top
  if (ghostNote) {
    const lastRingIdx = Math.min(
      Math.ceil(blocks.length / RINGS[0].max),
      RINGS.length - 1,
    )
    const outerR = (RINGS[lastRingIdx].baseR + 80) * scale
    nodes.push({
      id: ghostNote.id,
      x: cx,
      y: cy - outerR,
      isSynthesis: true,
      synthesisText: ghostNote.text,
      synthesisGenerating: ghostNote.isGenerating,
    })
  }

  return nodes
}

function buildEdges(nodes: GraphNode[], blocks: TextBlock[]): GraphEdge[] {
  const edges: GraphEdge[] = []
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const blockIds = new Set(blocks.map(b => b.id))
  const center = nodeMap.get("__center__")!

  // Spokes: all non-center nodes → center
  for (const n of nodes) {
    if (n.isCenter) continue
    edges.push({
      id: `spoke-${n.id}`,
      sourceId: "__center__",
      targetId: n.id,
      sx: center.x, sy: center.y,
      tx: n.x, ty: n.y,
      isSpoke: true,
      isSynth: n.isSynthesis ?? false,
    })
  }

  // Chords: influencedBy connections between blocks
  const seen = new Set<string>()
  for (const b of blocks) {
    if (!b.influencedBy?.length) continue
    for (const tid of b.influencedBy) {
      if (!blockIds.has(tid)) continue
      const key = [b.id, tid].sort().join("§")
      if (seen.has(key)) continue
      seen.add(key)
      const src = nodeMap.get(b.id)
      const tgt = nodeMap.get(tid)
      if (!src || !tgt) continue
      edges.push({
        id: `chord-${key}`,
        sourceId: b.id,
        targetId: tid,
        sx: src.x, sy: src.y,
        tx: tgt.x, ty: tgt.y,
        isSpoke: false,
        isSynth: false,
      })
    }
  }

  return edges
}

/** Quadratic bezier path curving slightly away from centre */
function chordPath(sx: number, sy: number, tx: number, ty: number, cx: number, cy: number): string {
  const mx = (sx + tx) / 2
  const my = (sy + ty) / 2
  const dx = mx - cx
  const dy = my - cy
  const dist = Math.hypot(dx, dy)
  if (dist < 1) return `M ${sx} ${sy} L ${tx} ${ty}`
  const f = Math.min(55, dist * 0.14) / dist
  return `M ${sx} ${sy} Q ${mx + dx * f} ${my + dy * f} ${tx} ${ty}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GraphArea({
  blocks,
  ghostNote,
  projectName,
  onReEnrich,
  onTogglePin,
  onEdit,
  onEditAnnotation,
}: GraphAreaProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const svgRef       = React.useRef<SVGSVGElement>(null)

  const [dims,       setDims]       = React.useState({ w: 900, h: 600 })
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [hoveredId,  setHoveredId]  = React.useState<string | null>(null)
  const [tooltip,    setTooltip]    = React.useState<{ id: string; x: number; y: number } | null>(null)
  const [transform,  setTransform]  = React.useState({ x: 0, y: 0, k: 1 })

  // Tracks which node IDs have been introduced (for new-node fly-in animation).
  // Initialised with ALL current block IDs so first render has no animation.
  const [knownIds, setKnownIds] = React.useState<Set<string>>(
    () => new Set(blocks.map(b => b.id))
  )

  // Pan refs
  const isPanning = React.useRef(false)
  const panStart  = React.useRef({ mx: 0, my: 0, tx: 0, ty: 0 })

  // ── Measure container ────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setDims({ w: width, h: height })
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  const cx = dims.w / 2
  const cy = dims.h / 2

  // ── Layout ───────────────────────────────────────────────────────────────
  const nodes = React.useMemo(
    () => computeNodes(blocks, ghostNote, cx, cy, Math.min(dims.w, dims.h)),
    [blocks, ghostNote, cx, cy, dims.w, dims.h],
  )

  const edges = React.useMemo(
    () => buildEdges(nodes, blocks),
    [nodes, blocks],
  )

  // ── New-node animation ────────────────────────────────────────────────────
  // Nodes not yet in knownIds start at centre and transition out after one rAF
  const newNodeIds = React.useMemo(() => {
    const s = new Set<string>()
    for (const n of nodes) {
      if (!n.isCenter && !knownIds.has(n.id)) s.add(n.id)
    }
    return s
  }, [nodes, knownIds])

  React.useEffect(() => {
    if (newNodeIds.size === 0) return
    const raf = requestAnimationFrame(() => {
      setKnownIds(prev => {
        const next = new Set(prev)
        for (const id of newNodeIds) next.add(id)
        return next
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [newNodeIds])

  // ── Hover: connected IDs ─────────────────────────────────────────────────
  const connectedToHovered = React.useMemo(() => {
    if (!hoveredId) return null
    const ids = new Set<string>([hoveredId, "__center__"])
    if (nodes.find(n => n.id === hoveredId)?.isSynthesis) {
      // synthesis connects to everything
      for (const n of nodes) ids.add(n.id)
    } else {
      const b = blocks.find(x => x.id === hoveredId)
      if (b?.influencedBy) for (const id of b.influencedBy) ids.add(id)
      for (const x of blocks) {
        if (x.influencedBy?.includes(hoveredId)) ids.add(x.id)
      }
    }
    return ids
  }, [hoveredId, blocks, nodes])

  // ── Zoom ─────────────────────────────────────────────────────────────────
  const handleWheel = React.useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    const rect = svgRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    setTransform(t => {
      const k = Math.max(0.2, Math.min(4, t.k * factor))
      return { x: mx - (mx - t.x) * (k / t.k), y: my - (my - t.y) * (k / t.k), k }
    })
  }, [])

  // ── Pan ──────────────────────────────────────────────────────────────────
  const handleSvgMouseDown = React.useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest(".graph-node")) return
    isPanning.current = true
    panStart.current = { mx: e.clientX, my: e.clientY, tx: transform.x, ty: transform.y }
  }, [transform])

  const handleSvgMouseMove = React.useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!isPanning.current) return
    setTransform(t => ({
      ...t,
      x: panStart.current.tx + (e.clientX - panStart.current.mx),
      y: panStart.current.ty + (e.clientY - panStart.current.my),
    }))
  }, [])

  const handleSvgMouseUp = React.useCallback(() => { isPanning.current = false }, [])

  // ── Selected block ────────────────────────────────────────────────────────
  const selectedBlock = React.useMemo(
    () => blocks.find(b => b.id === selectedId) ?? null,
    [blocks, selectedId],
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full w-full overflow-hidden bg-background">

      {/* Graph canvas */}
      <div
        ref={containerRef}
        style={{ width: selectedId ? "70%" : "100%" }}
        className="relative h-full transition-all duration-300 overflow-hidden"
      >
        {blocks.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/30">
              no nodes yet — add notes to see the graph
            </p>
          </div>
        )}

        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          className="select-none"
          style={{ cursor: isPanning.current ? "grabbing" : "grab" }}
          onWheel={handleWheel}
          onMouseDown={handleSvgMouseDown}
          onMouseMove={handleSvgMouseMove}
          onMouseUp={handleSvgMouseUp}
          onMouseLeave={handleSvgMouseUp}
          onClick={() => setSelectedId(null)}
        >
          <defs>
            <filter id="glow-synthesis" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <radialGradient id="synthesis-gradient" cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor="var(--type-thesis)" stopOpacity="1" />
              <stop offset="100%" stopColor="var(--type-claim)"  stopOpacity="0.8" />
            </radialGradient>
          </defs>

          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>

            {/* ── Edges ──────────────────────────────────────────────────── */}
            <g>
              {edges.map(edge => {
                const dimmed = hoveredId != null &&
                  edge.sourceId !== hoveredId &&
                  edge.targetId !== hoveredId

                const highlighted = hoveredId != null && !dimmed && !edge.isSpoke

                const d = edge.isSpoke
                  ? `M ${edge.sx} ${edge.sy} L ${edge.tx} ${edge.ty}`
                  : chordPath(edge.sx, edge.sy, edge.tx, edge.ty, cx, cy)

                return (
                  <path
                    key={edge.id}
                    d={d}
                    stroke="white"
                    strokeWidth={edge.isSpoke ? 0.7 : 1.6}
                    strokeDasharray={edge.isSynth ? "4 6" : undefined}
                    strokeOpacity={
                      dimmed      ? 0.02 :
                      highlighted ? 0.75 :
                      edge.isSpoke
                        ? (hoveredId === edge.targetId ? 0.4 : 0.09)
                        : 0.28
                    }
                    fill="none"
                    style={{ transition: "stroke-opacity 0.15s" }}
                  />
                )
              })}
            </g>

            {/* ── Nodes ──────────────────────────────────────────────────── */}
            <g>
              {nodes.map(node => {
                const isSelected  = node.id === selectedId
                const isHovered   = node.id === hoveredId
                const isDimmed    = hoveredId != null && !node.isCenter && !isHovered &&
                  (!connectedToHovered || !connectedToHovered.has(node.id))
                const isEnriching = node.block?.isEnriching
                const isNew       = newNodeIds.has(node.id)

                // New nodes start at centre; CSS transition moves them to ring position
                const nx = isNew ? cx : node.x
                const ny = isNew ? cy : node.y

                const r = node.isCenter ? CENTER_R : node.isSynthesis ? SYNTH_R : NODE_R
                const config = node.block ? CONTENT_TYPE_CONFIG[node.block.contentType] : null
                const Icon   = config?.icon ?? null
                const accent = config?.accentVar ?? "var(--type-thesis)"

                let fill = "transparent"
                if (node.isCenter)    fill = "rgba(255,255,255,0.04)"
                else if (node.isSynthesis) fill = "url(#synthesis-gradient)"
                else if (config)      fill = config.accentVar

                return (
                  <g
                    key={node.id}
                    className="graph-node"
                    style={{
                      transform: `translate(${nx}px, ${ny}px)`,
                      transition: isNew
                        ? "none"
                        : "transform 0.7s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s",
                      opacity:    isDimmed ? 0.1 : 1,
                      filter:     node.isSynthesis ? "url(#glow-synthesis)" : undefined,
                      cursor:     node.isCenter ? "default" : "pointer",
                    }}
                    onClick={e => {
                      e.stopPropagation()
                      if (!node.isCenter) {
                        setSelectedId(prev => prev === node.id ? null : node.id)
                      }
                    }}
                    onMouseEnter={e => {
                      if (!node.isCenter) setHoveredId(node.id)
                      const rect = svgRef.current!.getBoundingClientRect()
                      setTooltip({ id: node.id, x: e.clientX - rect.left, y: e.clientY - rect.top })
                    }}
                    onMouseMove={e => {
                      const rect = svgRef.current!.getBoundingClientRect()
                      setTooltip({ id: node.id, x: e.clientX - rect.left, y: e.clientY - rect.top })
                    }}
                    onMouseLeave={() => { setHoveredId(null); setTooltip(null) }}
                  >
                    {/* Centre: decorative outer ring */}
                    {node.isCenter && (
                      <circle
                        r={CENTER_R + 10}
                        fill="none"
                        stroke="white"
                        strokeWidth={0.5}
                        strokeOpacity={0.07}
                      />
                    )}

                    {/* Selected / hovered ring */}
                    {(isSelected || isHovered) && !node.isCenter && (
                      <circle
                        r={r + 9}
                        fill="none"
                        stroke={accent}
                        strokeWidth={isSelected ? 1.5 : 1}
                        strokeOpacity={isSelected ? 0.65 : 0.3}
                      />
                    )}

                    {/* Enriching: spinning dashed ring
                        transformBox:fill-box ensures rotation around THIS element's centre,
                        not the SVG viewport origin (which caused the giant background circle) */}
                    {isEnriching && (
                      <circle
                        r={r + 13}
                        fill="none"
                        stroke={accent}
                        strokeWidth={1.2}
                        strokeDasharray="5 4"
                        strokeOpacity={0.55}
                        style={{
                          transformBox: "fill-box" as React.CSSProperties["transformBox"],
                          transformOrigin: "center",
                          animation: "spin 2.5s linear infinite",
                        }}
                      />
                    )}

                    {/* Synthesis halo */}
                    {node.isSynthesis && (
                      <>
                        <circle r={r + 15} fill="none" stroke="var(--type-thesis)" strokeWidth={0.5} strokeOpacity={0.14} />
                        <circle r={r + 27} fill="none" stroke="var(--type-thesis)" strokeWidth={0.5} strokeOpacity={0.06} />
                      </>
                    )}

                    {/* Main circle */}
                    <circle
                      r={r}
                      fill={fill}
                      fillOpacity={
                        node.isCenter   ? 1 :
                        node.isSynthesis ? 1 :
                        isSelected      ? 1.0 :
                        isHovered       ? 0.96 : 0.90
                      }
                      stroke={
                        node.isCenter ? "rgba(255,255,255,0.13)" :
                        isSelected    ? accent : "none"
                      }
                      strokeWidth={node.isCenter ? 1 : isSelected ? 1.5 : 0}
                    />

                    {/* Block icon */}
                    {Icon && (
                      <foreignObject x={-14} y={-14} width={28} height={28} style={{ pointerEvents: "none" }}>
                        <div
                          // @ts-ignore – xmlns required for foreignObject
                          xmlns="http://www.w3.org/1999/xhtml"
                          style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}
                        >
                          <Icon style={{ width: 15, height: 15, color: "white", opacity: 0.92 }} />
                        </div>
                      </foreignObject>
                    )}

                    {/* Centre: project name label below circle */}
                    {node.isCenter && (
                      <text
                        y={CENTER_R + 17}
                        textAnchor="middle"
                        fontSize={10}
                        fontFamily="monospace"
                        fill="white"
                        fillOpacity={0.32}
                        style={{ pointerEvents: "none", userSelect: "none" }}
                      >
                        {projectName.length > 18 ? projectName.slice(0, 18) + "…" : projectName}
                      </text>
                    )}

                    {/* Synthesis glyph */}
                    {node.isSynthesis && (
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={13}
                        fill="white"
                        fillOpacity={0.9}
                        style={{ pointerEvents: "none" }}
                      >
                        ✦
                      </text>
                    )}

                  </g>
                )
              })}
            </g>

          </g>
        </svg>

        {/* ── Floating tooltip ──────────────────────────────────────────── */}
        {tooltip && (() => {
          const node = nodes.find(n => n.id === tooltip.id)
          if (!node || node.isCenter) return null
          const label = node.isSynthesis
            ? (node.synthesisText ?? "Synthesis")
            : (node.block?.text ?? "")
          const config = node.block ? CONTENT_TYPE_CONFIG[node.block.contentType] : null
          const accent = config?.accentVar ?? "var(--type-thesis)"
          const tipX = Math.min(tooltip.x + 12, (selectedId ? dims.w * 0.7 : dims.w) - 296)
          const tipY = tooltip.y - 16
          return (
            <div
              className="absolute z-50 pointer-events-none"
              style={{ left: tipX, top: tipY, transform: "translateY(-100%)" }}
            >
              <div
                className="rounded-sm shadow-[0_4px_24px_rgba(0,0,0,0.5)] border border-white/10 overflow-hidden"
                style={{ minWidth: 180, maxWidth: 290 }}
              >
                <div className="flex items-center gap-2 px-2.5 py-1.5" style={{ background: accent }}>
                  {config?.icon && React.createElement(config.icon, {
                    className: "h-3 w-3 flex-shrink-0",
                    style: { color: "black", opacity: 0.7 },
                  })}
                  <span className="font-mono text-[9px] font-black uppercase tracking-widest text-black/70">
                    {node.isSynthesis ? "Synthesis" : config?.label}
                  </span>
                  {node.block?.category && (
                    <span className="ml-auto font-mono text-[8px] text-black/50 truncate max-w-[90px]">
                      {node.block.category}
                    </span>
                  )}
                </div>
                <div className="bg-card/95 backdrop-blur-sm px-3 py-2.5">
                  <p className="text-sm font-semibold leading-snug text-foreground">{label}</p>
                </div>
              </div>
              <div
                className="mx-4 h-2 w-2 rotate-45 border-b border-r border-white/10 bg-card/95"
                style={{ marginTop: -1 }}
              />
            </div>
          )
        })()}

        {/* Hints */}
        <div className="absolute bottom-4 left-4 pointer-events-none">
          <span className="font-mono text-[8px] text-muted-foreground/25 uppercase tracking-widest">
            scroll to zoom · drag to pan · click node to inspect
          </span>
        </div>

        {blocks.length > 0 && (
          <div className="absolute top-4 left-4 pointer-events-none">
            <span className="font-mono text-[8px] text-muted-foreground/25 uppercase tracking-widest">
              {blocks.length} node{blocks.length !== 1 ? "s" : ""}
              {ghostNote ? " · synthesis active" : ""}
            </span>
          </div>
        )}

      </div>

      {/* ── Detail panel (30%) ─────────────────────────────────────────────── */}
      {selectedId && (
        <div className="h-full overflow-hidden transition-all duration-300" style={{ width: "30%" }}>
          <GraphDetailPanel
            block={selectedBlock}
            allBlocks={blocks}
            onClose={() => setSelectedId(null)}
            onSelectNode={id => setSelectedId(id)}
            onReEnrich={onReEnrich}
            onTogglePin={onTogglePin}
            onEdit={onEdit}
            onEditAnnotation={onEditAnnotation}
          />
        </div>
      )}

    </div>
  )
}
