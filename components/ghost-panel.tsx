"use client"

import { AnimatePresence, motion } from "framer-motion"
import { Check, ChevronDown, ChevronRight, Sparkles, X } from "lucide-react"
import { useState } from "react"

export interface GhostNote {
  id: string
  text: string
  category: string
  isGenerating: boolean
  sourceBlockIds?: string[]
  sourceBlockPreviews?: { id: string; text: string; category?: string; contentType?: string }[]
}

interface GhostPanelProps {
  ghostNotes: GhostNote[]
  isOpen: boolean
  onClose: () => void
  onClaim: (id: string) => void
  onDismiss: (id: string) => void
  onHoverSources: (ids: string[]) => void
  onScrollToBlock?: (id: string) => void
}

export function GhostPanel({ ghostNotes, isOpen, onClose, onClaim, onDismiss, onHoverSources, onScrollToBlock }: GhostPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  return (
    <div
      style={{
        width: isOpen ? 272 : 0,
        opacity: isOpen ? 1 : 0,
        visibility: isOpen ? "visible" : "hidden",
      }}
      className="flex flex-col h-full bg-black/20 backdrop-blur-3xl border-l border-border shrink-0 overflow-hidden relative z-50 transition-all duration-200 ease-in-out"
    >
      <div className="w-[272px] flex flex-col h-full">
        {/* Header */}
        <div className="flex h-10 items-center justify-between border-b border-border bg-card/5 px-3 py-1.5 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center h-5 w-5 bg-primary/10 rounded-sm">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            </div>
            <h3 className="font-mono text-xs font-bold uppercase tracking-tight text-foreground/80 select-none">
              Synthesis
            </h3>
            {ghostNotes.length > 0 && (
              <span className="font-mono text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-sm font-bold tabular-nums">
                {ghostNotes.length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 px-1.5 hover:bg-white/5 rounded-sm transition-colors text-muted-foreground/55 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Note list */}
        <div className="flex-1 overflow-y-auto custom-scrollbar py-3 px-3 space-y-3">
          {ghostNotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-3 opacity-70">
              <Sparkles className="h-5 w-5 text-white/60" />
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-center leading-relaxed text-white/50">
                Emergent theses<br />will appear here
              </p>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {ghostNotes.map(note => (
                <motion.div
                  key={note.id}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 20, transition: { duration: 0.15 } }}
                  transition={{ duration: 0.2 }}
                  className="rounded-md border border-primary/20 bg-primary/5 p-3 flex flex-col gap-3 cursor-pointer"
                  onMouseEnter={() => note.sourceBlockIds && onHoverSources(note.sourceBlockIds)}
                  onMouseLeave={() => onHoverSources([])}
                >
                  {/* Row: sparkles + category + dismiss */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="h-3 w-3 text-primary/50 shrink-0" />
                      {note.category && !note.isGenerating && (
                        <span className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground/50">
                          {note.category}
                        </span>
                      )}
                    </div>
                    {!note.isGenerating && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDismiss(note.id) }}
                        className="h-5 w-5 flex items-center justify-center rounded-sm text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  {/* Text / loading */}
                  {note.isGenerating ? (
                    <div className="flex items-center gap-2.5 py-1">
                      <div className="flex space-x-1">
                        <div className="h-1 w-1 animate-bounce rounded-full bg-primary/40 [animation-delay:-0.3s]" />
                        <div className="h-1 w-1 animate-bounce rounded-full bg-primary/40 [animation-delay:-0.15s]" />
                        <div className="h-1 w-1 animate-bounce rounded-full bg-primary/40" />
                      </div>
                      <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground/60">
                        Synthesizing...
                      </p>
                    </div>
                  ) : (
                    <p
                      className="text-[13px] font-medium leading-relaxed text-foreground/75"
                      onClick={() => setExpandedId(prev => prev === note.id ? null : note.id)}
                    >
                      {note.text}
                    </p>
                  )}

                  {/* Source blocks detail — expandable */}
                  {!note.isGenerating && note.sourceBlockPreviews && note.sourceBlockPreviews.length > 0 && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); setExpandedId(prev => prev === note.id ? null : note.id) }}
                        className="flex items-center gap-1.5 text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
                      >
                        {expandedId === note.id
                          ? <ChevronDown className="h-3 w-3" />
                          : <ChevronRight className="h-3 w-3" />
                        }
                        <span className="font-mono text-[8px] uppercase tracking-wider">
                          {note.sourceBlockPreviews.length} source nodes
                        </span>
                      </button>

                      <AnimatePresence>
                        {expandedId === note.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="flex flex-col gap-1.5 pt-1 border-t border-primary/10">
                              {note.sourceBlockPreviews.map(src => (
                                <button
                                  key={src.id}
                                  onClick={(e) => { e.stopPropagation(); onScrollToBlock?.(src.id) }}
                                  onMouseEnter={() => onHoverSources([src.id])}
                                  onMouseLeave={() => note.sourceBlockIds && onHoverSources(note.sourceBlockIds)}
                                  className="flex items-start gap-2 p-1.5 rounded-sm hover:bg-white/5 transition-colors text-left group"
                                >
                                  <span
                                    className="mt-0.5 h-1.5 w-1.5 rounded-full shrink-0"
                                    style={{ background: src.contentType ? `var(--type-${src.contentType})` : "var(--muted-foreground)" }}
                                  />
                                  <div className="flex flex-col gap-0.5 min-w-0">
                                    {src.category && (
                                      <span className="font-mono text-[7px] uppercase tracking-widest text-muted-foreground/40">
                                        {src.category}
                                      </span>
                                    )}
                                    <span className="text-[11px] leading-snug text-foreground/60 group-hover:text-foreground/80 line-clamp-2 transition-colors">
                                      {src.text.length > 120 ? src.text.slice(0, 120) + "…" : src.text}
                                    </span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </>
                  )}

                  {/* Add button */}
                  {!note.isGenerating && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onClaim(note.id) }}
                      className="flex items-center gap-1.5 w-full justify-center rounded-sm bg-primary/15 hover:bg-primary/25 px-2.5 py-1.5 font-mono text-[9px] font-black uppercase tracking-wider text-primary transition-colors"
                    >
                      <Check className="h-3 w-3 stroke-[3px]" />
                      Add to canvas
                    </button>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border/30 px-3 py-2 shrink-0">
          <p className="font-mono text-[8px] text-muted-foreground/50 uppercase tracking-[0.15em] text-center">
            Generated from your writing patterns
          </p>
        </div>
      </div>
    </div>
  )
}
