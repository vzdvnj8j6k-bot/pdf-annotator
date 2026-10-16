'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import Toolbar from './Toolbar'
import { EraserMark, PageAnnotations, Point, Stroke, TextAnnotation, Tool } from '@/types'
import { getAllAnnotations, saveAnnotations, updateDocumentPages } from '@/lib/db'
import { getSupabaseClient } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

let pdfjsLib: typeof import('pdfjs-dist') | null = null

function PanelIcon({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="2" width="15" height="14" rx="2" />
      <line x1="6.5" y1="2" x2="6.5" y2="16" />
      {open && <polyline points="4,7 4,11" strokeWidth="2" />}
      {!open && <>
        <line x1="9.5" y1="6.5" x2="14.5" y2="6.5" />
        <line x1="9.5" y1="9" x2="14.5" y2="9" />
        <line x1="9.5" y1="11.5" x2="14.5" y2="11.5" />
      </>}
    </svg>
  )
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="1" y="1" width="5.5" height="5.5" rx="1" />
      <rect x="9.5" y="1" width="5.5" height="5.5" rx="1" />
      <rect x="1" y="9.5" width="5.5" height="5.5" rx="1" />
      <rect x="9.5" y="9.5" width="5.5" height="5.5" rx="1" />
    </svg>
  )
}

interface Props {
  pdfUrl: string
  documentId: string
  readonly?: boolean
  initialAnnotations?: Map<number, PageAnnotations>
  initialPage?: number
  onPageChange?: (page: number) => void
  onShare?: () => void
  saveFn?: (documentId: string, pageNumber: number, annotations: PageAnnotations) => Promise<void>
}

const SAVE_DEBOUNCE_MS = 1500

export default function PDFAnnotator({ pdfUrl, documentId, readonly = false, initialAnnotations, initialPage = 1, onPageChange, onShare, saveFn }: Props) {
  const [pdf, setPdf] = useState<import('pdfjs-dist').PDFDocumentProxy | null>(null)
  const [currentPage, _setCurrentPage] = useState(initialPage)
  const currentPageRef = useRef(initialPage)
  function setCurrentPage(p: number) {
    _setCurrentPage(p)
    currentPageRef.current = p
    onPageChange?.(p)
  }
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1.4)
  const [tool, setTool] = useState<Tool>('none')
  const [color, setColor] = useState('#000000')
  const [brushSize, setBrushSize] = useState(3)
  const [annotations, setAnnotations] = useState<Map<number, PageAnnotations>>(initialAnnotations ?? new Map())
  const [studyMode, setStudyMode] = useState(false)
  const [fontSize, setFontSize] = useState(16)
  const [textInput, setTextInput] = useState<{ x: number; y: number; page: number } | null>(null)
  const [textValue, setTextValue] = useState('')
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [onlineCount, setOnlineCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [toolbarOpen, setToolbarOpen] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [pageGridOpen, setPageGridOpen] = useState(false)

  // Per-page canvas refs
  const pageCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const annotCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const pageContainerRefs = useRef<(HTMLDivElement | null)[]>([])
  const renderTasksRef = useRef<(import('pdfjs-dist').RenderTask | null)[]>([])
  const renderedPagesRef = useRef<Set<number>>(new Set())
  // Keep annotations in a ref so canvas ops can always access latest
  const annotationsRef = useRef(annotations)
  useEffect(() => { annotationsRef.current = annotations }, [annotations])
  const editingTextIdRef = useRef<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const dprRef = useRef(1)
  const textInputRef = useRef<HTMLInputElement>(null)
  const isDrawing = useRef(false)
  const currentStroke = useRef<Stroke | null>(null)
  const drawingPage = useRef(1)
  const draggingTextRef = useRef<{
    annotation: TextAnnotation
    pageNum: number
    startPoint: Point
    currentPoint: Point
    hasMoved: boolean
  } | null>(null)
  const history = useRef<Map<number, PageAnnotations[]>>(new Map())
  const saveTimer = useRef<NodeJS.Timeout | null>(null)
  const pinchStartDist = useRef<number | null>(null)
  const pinchStartScale = useRef<number>(1)
  const scaleRef = useRef(scale)
  const clientId = useRef(uuidv4())
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    async function loadPdf() {
      setIsLoading(true)
      if (!pdfjsLib) {
        pdfjsLib = await import('pdfjs-dist')
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
      }
      try {
        const doc = await pdfjsLib.getDocument({ url: pdfUrl }).promise
        setPdf(doc); setTotalPages(doc.numPages)
        if (!readonly) await updateDocumentPages(documentId, doc.numPages)
      } catch (e) { console.error('PDF load error:', e) } finally { setIsLoading(false) }
    }
    loadPdf()
  }, [pdfUrl, documentId, readonly])

  useEffect(() => {
    if (!initialAnnotations && !readonly) getAllAnnotations(documentId).then(a => setAnnotations(a))
  }, [documentId, initialAnnotations, readonly])

  useEffect(() => {
    if (readonly) return
    const sb = getSupabaseClient()
    const channel = sb.channel(`doc-${documentId}`, { config: { presence: { key: clientId.current } } })
      .on('broadcast', { event: 'annotation-update' }, ({ payload }) => {
        if (payload.clientId === clientId.current) return
        const { pageNumber, data } = payload as { pageNumber: number; data: PageAnnotations; clientId: string }
        setAnnotations(prev => { const next = new Map(prev); next.set(pageNumber, data); return next })
        // Immediately redraw affected page's annotation layer
        const canvas = annotCanvasRefs.current[pageNumber - 1]
        if (canvas && renderedPagesRef.current.has(pageNumber)) {
          const dpr = dprRef.current
          redrawAnnotations(canvas, data, scaleRef.current * dpr, dpr)
        }
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        setOnlineCount(Object.keys(state).length)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await channel.track({ online_at: new Date().toISOString() })
      })
    channelRef.current = channel
    return () => { channel.unsubscribe(); channelRef.current = null }
  }, [documentId, readonly])

  // Render a single page (PDF layer + annotation layer)
  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdf) return
    const idx = pageNum - 1
    const pdfCanvas = pageCanvasRefs.current[idx]
    const annotCanvas = annotCanvasRefs.current[idx]
    if (!pdfCanvas || !annotCanvas) return
    try {
      const page = await pdf.getPage(pageNum)
      const dpr = window.devicePixelRatio || 1
      dprRef.current = dpr
      const viewport = page.getViewport({ scale: scaleRef.current * dpr })
      const cssW = Math.round(viewport.width / dpr), cssH = Math.round(viewport.height / dpr)
      pdfCanvas.width = viewport.width; pdfCanvas.height = viewport.height
      pdfCanvas.style.width = cssW + 'px'; pdfCanvas.style.height = cssH + 'px'
      annotCanvas.width = viewport.width; annotCanvas.height = viewport.height
      annotCanvas.style.width = cssW + 'px'; annotCanvas.style.height = cssH + 'px'
      if (renderTasksRef.current[idx]) { renderTasksRef.current[idx]?.cancel(); renderTasksRef.current[idx] = null }
      const task = page.render({ canvas: pdfCanvas, viewport })
      renderTasksRef.current[idx] = task
      await task.promise
      renderTasksRef.current[idx] = null
      const pa = annotationsRef.current.get(pageNum) ?? { strokes: [], texts: [] }
      redrawAnnotations(annotCanvas, pa, scaleRef.current * dpr, dpr)
      renderedPagesRef.current.add(pageNum)
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'RenderingCancelledException') console.error('Render error:', e)
    }
  }, [pdf])

  const renderPageRef = useRef(renderPage)
  useEffect(() => { renderPageRef.current = renderPage }, [renderPage])

  // IntersectionObserver: lazy load + track current page
  useEffect(() => {
    if (isLoading || totalPages === 0 || !containerRef.current) return
    const observer = new IntersectionObserver(
      entries => {
        let topEntry: IntersectionObserverEntry | null = null
        entries.forEach(entry => {
          const p = Number(entry.target.getAttribute('data-page'))
          if (entry.isIntersecting) {
            if (!topEntry || entry.boundingClientRect.top < topEntry.boundingClientRect.top) topEntry = entry
            if (!renderedPagesRef.current.has(p)) renderPageRef.current(p)
          }
        })
        if (topEntry) {
          const p = Number((topEntry as Element).getAttribute('data-page'))
          if (p && p !== currentPageRef.current) setCurrentPage(p)
        }
      },
      { root: containerRef.current, threshold: [0, 0.1, 0.5] }
    )
    // Small delay so refs are populated
    const tid = setTimeout(() => {
      pageContainerRefs.current.forEach(el => el && observer.observe(el))
    }, 50)
    return () => { clearTimeout(tid); observer.disconnect() }
  }, [totalPages, isLoading])

  // Re-render on scale change
  useEffect(() => {
    scaleRef.current = scale
    if (totalPages === 0) return
    const rendered = Array.from(renderedPagesRef.current)
    renderedPagesRef.current.clear()
    rendered.forEach(p => renderPageRef.current(p))
  }, [scale, totalPages])

  // Redraw annotation layers when studyMode changes
  useEffect(() => {
    const dpr = dprRef.current
    renderedPagesRef.current.forEach(p => {
      const canvas = annotCanvasRefs.current[p - 1]
      if (canvas) {
        const pa = annotationsRef.current.get(p) ?? { strokes: [], texts: [] }
        redrawAnnotations(canvas, pa, scaleRef.current * dpr, dpr)
      }
    })
  }, [studyMode])

  // Render initial pages once loading is done and canvases are in the DOM
  useEffect(() => {
    if (isLoading || !pdf || totalPages === 0) return
    const start = Math.max(1, initialPage - 1)
    const end = Math.min(totalPages, initialPage + 2)
    for (let p = start; p <= end; p++) renderPage(p)
  }, [isLoading, pdf]) // eslint-disable-line

  // Scroll to initial page after load
  useEffect(() => {
    if (!isLoading && totalPages > 0 && initialPage > 1) {
      setTimeout(() => scrollToPage(initialPage, false), 200)
    }
  }, [isLoading, totalPages]) // eslint-disable-line

  function scrollToPage(pageNum: number, smooth = true) {
    const el = pageContainerRefs.current[pageNum - 1]
    if (el) el.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant', block: 'start' })
  }

  function redrawAnnotations(canvas: HTMLCanvasElement, pageAnnotations: PageAnnotations, drawScale: number, lineWidthScale: number, skipTextId?: string | null) {
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    type Op = { type: 'stroke'; data: Stroke } | { type: 'erase'; data: EraserMark }
    const ops: (Op & { seq: number })[] = [
      ...pageAnnotations.strokes.map(s => ({ type: 'stroke' as const, data: s, seq: s.seq ?? 0 })),
      ...(pageAnnotations.eraserMarks ?? []).map(m => ({ type: 'erase' as const, data: m, seq: m.seq ?? Number.MAX_SAFE_INTEGER })),
    ]
    ops.sort((a, b) => a.seq - b.seq)
    for (const op of ops) {
      if (op.type === 'stroke') {
        if (op.data.points.length >= 2) drawStroke(ctx, op.data, drawScale, studyMode, lineWidthScale)
      } else {
        const mark = op.data
        if (mark.points.length === 0) continue
        ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
        ctx.lineWidth = mark.r * 2 * drawScale; ctx.beginPath()
        if (mark.points.length === 1) { ctx.arc(mark.points[0].x*drawScale, mark.points[0].y*drawScale, mark.r*drawScale, 0, Math.PI*2); ctx.fill() }
        else { ctx.moveTo(mark.points[0].x*drawScale, mark.points[0].y*drawScale); for (let i=1;i<mark.points.length;i++) ctx.lineTo(mark.points[i].x*drawScale, mark.points[i].y*drawScale); ctx.stroke() }
        ctx.restore()
      }
    }
    for (const text of pageAnnotations.texts) {
      if (skipTextId && text.id === skipTextId) continue
      ctx.save(); ctx.font = `${text.fontSize*drawScale}px sans-serif`; ctx.fillStyle = text.color; ctx.fillText(text.text, text.x*drawScale, text.y*drawScale); ctx.restore()
    }
  }

  function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, drawScale: number, forceStudyMode: boolean, lineWidthScale: number) {
    if (stroke.points.length < 2) return
    ctx.save()
    const isHighlighter = stroke.tool === 'highlighter' || stroke.tool === 'highlighter-line'
    const maskMode = isHighlighter && forceStudyMode
    ctx.globalAlpha = maskMode ? 1 : stroke.opacity
    ctx.strokeStyle = maskMode ? stroke.color.slice(0, 7) : stroke.color
    ctx.lineWidth = stroke.size * lineWidthScale
    ctx.lineCap = isHighlighter ? 'square' : 'round'
    ctx.lineJoin = isHighlighter ? 'miter' : 'round'
    if (isHighlighter && !maskMode) ctx.globalCompositeOperation = 'multiply'
    const pts = stroke.points
    ctx.beginPath(); ctx.moveTo(pts[0].x*drawScale, pts[0].y*drawScale)
    for (let i=1;i<pts.length;i++) { const prev=pts[i-1], curr=pts[i]; ctx.quadraticCurveTo(prev.x*drawScale, prev.y*drawScale, (prev.x+curr.x)/2*drawScale, (prev.y+curr.y)/2*drawScale) }
    ctx.lineTo(pts[pts.length-1].x*drawScale, pts[pts.length-1].y*drawScale); ctx.stroke(); ctx.restore()
  }

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect()
    const s = scaleRef.current
    return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>, pageNum: number) {
    if (readonly || tool === 'none') return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingPage.current = pageNum
    const point = getPoint(e)
    if (tool === 'text') {
      const pa = annotationsRef.current.get(pageNum) ?? { strokes: [], texts: [] }
      const hit = pa.texts.find(t => Math.abs(t.x - point.x) < 200 && Math.abs(t.y - point.y) < t.fontSize * 1.5)
      if (hit) {
        // Enter drag-wait state: pointerMove will decide if this is a drag or click-to-edit
        editingTextIdRef.current = hit.id
        isDrawing.current = true
        drawingPage.current = pageNum
        draggingTextRef.current = { annotation: hit, pageNum, startPoint: point, currentPoint: point, hasMoved: false }
        // Hide text on canvas; it will be redrawn live during drag
        const curPage = annotationsRef.current.get(pageNum) ?? { strokes: [], texts: [] }
        const annotCanvas = annotCanvasRefs.current[pageNum - 1]
        if (annotCanvas) redrawAnnotations(annotCanvas, curPage, scaleRef.current * dprRef.current, dprRef.current, hit.id)
      } else {
        editingTextIdRef.current = null
        setEditingTextId(null); setTextInput({ ...point, page: pageNum }); setTextValue('')
        setTimeout(() => textInputRef.current?.focus(), 50)
      }
      return
    }
    isDrawing.current = true
    currentStroke.current = {
      id: uuidv4(), tool,
      color: (tool === 'highlighter' || tool === 'highlighter-line') ? color + '80' : color,
      size: (tool === 'highlighter' || tool === 'highlighter-line') ? brushSize*5 : tool === 'eraser' ? brushSize*4 : (tool === 'line') ? brushSize*1.5 : brushSize,
      opacity: (tool === 'highlighter' || tool === 'highlighter-line') ? 0.4 : 1,
      points: [point],
    }
    if (tool === 'eraser') {
      const page = annotationsRef.current.get(pageNum) ?? { strokes: [], texts: [] }
      const hist = history.current.get(pageNum) ?? []
      history.current.set(pageNum, [...hist, page])
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>, pageNum: number) {
    const annotCanvas = annotCanvasRefs.current[pageNum - 1]
    if (!annotCanvas) return
    const dpr = dprRef.current
    const physScale = scaleRef.current * dpr
    // Text drag handling
    if (draggingTextRef.current && draggingTextRef.current.pageNum === pageNum) {
      const drag = draggingTextRef.current
      const point = getPoint(e)
      drag.currentPoint = point
      const dx = point.x - drag.startPoint.x
      const dy = point.y - drag.startPoint.y
      if (!drag.hasMoved && Math.sqrt(dx*dx + dy*dy) > 5) drag.hasMoved = true
      if (drag.hasMoved) {
        const newX = drag.annotation.x + dx
        const newY = drag.annotation.y + dy
        const pa = annotationsRef.current.get(pageNum) ?? { strokes: [], texts: [] }
        redrawAnnotations(annotCanvas, pa, physScale, dpr, drag.annotation.id)
        const ctx = annotCanvas.getContext('2d')!
        ctx.save(); ctx.font = `${drag.annotation.fontSize * physScale}px sans-serif`; ctx.fillStyle = drag.annotation.color
        ctx.fillText(drag.annotation.text, newX * physScale, newY * physScale); ctx.restore()
      }
      return
    }
    if (!isDrawing.current) {
      if (tool === 'eraser') {
        const point = getPoint(e)
        const pa = annotationsRef.current.get(pageNum) ?? { strokes: [], texts: [] }
        redrawAnnotations(annotCanvas, pa, physScale, dpr)
        const ctx = annotCanvas.getContext('2d')!
        const eraserSize = brushSize * 4 * dpr
        ctx.save(); ctx.strokeStyle = 'rgba(150,150,150,0.6)'; ctx.lineWidth = 1.5*dpr; ctx.setLineDash([4*dpr, 3*dpr])
        ctx.beginPath(); ctx.arc(point.x*physScale, point.y*physScale, eraserSize, 0, Math.PI*2); ctx.stroke(); ctx.restore()
      }
      return
    }
    if (!currentStroke.current || drawingPage.current !== pageNum) return
    const point = getPoint(e)
    const isLineMode = tool === 'line' || tool === 'highlighter-line'
    if (isLineMode) {
      currentStroke.current.points = [currentStroke.current.points[0], point]
    } else {
      currentStroke.current.points.push(point)
    }
    const ctx = annotCanvas.getContext('2d')!
    const pa = annotationsRef.current.get(pageNum) ?? { strokes: [], texts: [] }
    if (tool === 'eraser') {
      redrawAnnotations(annotCanvas, pa, physScale, dpr)
      const pts = currentStroke.current.points
      if (pts.length > 0) {
        ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
        ctx.lineWidth = currentStroke.current.size * 2 * dpr; ctx.beginPath()
        if (pts.length === 1) { ctx.arc(pts[0].x*physScale, pts[0].y*physScale, currentStroke.current.size*dpr, 0, Math.PI*2); ctx.fill() }
        else { ctx.moveTo(pts[0].x*physScale, pts[0].y*physScale); for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x*physScale, pts[i].y*physScale); ctx.stroke() }
        ctx.restore()
      }
      // Redraw text annotations on top so eraser never visually removes them
      for (const text of pa.texts ?? []) {
        ctx.save(); ctx.font = `${text.fontSize*physScale}px sans-serif`; ctx.fillStyle = text.color; ctx.fillText(text.text, text.x*physScale, text.y*physScale); ctx.restore()
      }
      ctx.save(); ctx.strokeStyle = 'rgba(150,150,150,0.6)'; ctx.lineWidth = 1.5*dpr; ctx.setLineDash([4*dpr, 3*dpr])
      ctx.beginPath(); ctx.arc(point.x*physScale, point.y*physScale, currentStroke.current.size*dpr, 0, Math.PI*2); ctx.stroke(); ctx.restore()
    } else {
      redrawAnnotations(annotCanvas, pa, physScale, dpr)
      drawStroke(ctx, currentStroke.current, physScale, studyMode, dpr)
      // Redraw texts on top so in-progress strokes never visually cover them
      for (const text of pa.texts ?? []) {
        ctx.save(); ctx.font = `${text.fontSize*physScale}px sans-serif`; ctx.fillStyle = text.color; ctx.fillText(text.text, text.x*physScale, text.y*physScale); ctx.restore()
      }
    }
  }

  function handlePointerUp(pageNum: number) {
    // Text drag completion
    if (draggingTextRef.current) {
      const drag = draggingTextRef.current
      draggingTextRef.current = null
      isDrawing.current = false
      if (drag.hasMoved) {
        // Save new position
        editingTextIdRef.current = null
        const dx = drag.currentPoint.x - drag.startPoint.x
        const dy = drag.currentPoint.y - drag.startPoint.y
        const newX = drag.annotation.x + dx
        const newY = drag.annotation.y + dy
        const pg = annotationsRef.current.get(drag.pageNum) ?? { strokes: [], texts: [] }
        const hist = history.current.get(drag.pageNum) ?? []
        history.current.set(drag.pageNum, [...hist, pg])
        const updatedTexts = pg.texts.map(t => t.id === drag.annotation.id ? { ...t, x: newX, y: newY } : t)
        const updated: PageAnnotations = { ...pg, texts: updatedTexts }
        const nextAnnotations = new Map(annotationsRef.current)
        nextAnnotations.set(drag.pageNum, updated)
        annotationsRef.current = nextAnnotations
        setAnnotations(nextAnnotations)
        scheduleSave(drag.pageNum, updated)
        const canvas = annotCanvasRefs.current[drag.pageNum - 1]
        if (canvas) redrawAnnotations(canvas, updated, scaleRef.current * dprRef.current, dprRef.current)
      } else {
        // No move = click to edit
        const hit = drag.annotation
        setEditingTextId(hit.id); setTextInput({ x: hit.x, y: hit.y, page: drag.pageNum }); setTextValue(hit.text); setFontSize(hit.fontSize)
        setTimeout(() => textInputRef.current?.focus(), 50)
      }
      return
    }
    if (!isDrawing.current || !currentStroke.current) return
    isDrawing.current = false
    const stroke = currentStroke.current; currentStroke.current = null
    const annotCanvas = annotCanvasRefs.current[pageNum - 1]
    if (tool === 'eraser') {
      const page = annotationsRef.current.get(pageNum) ?? { strokes: [], texts: [] }
      if (stroke.points.length > 0) {
        const r = stroke.size / scaleRef.current
        const mark: EraserMark = { id: uuidv4(), points: stroke.points, r, seq: Date.now() }
        const updated: PageAnnotations = { ...page, eraserMarks: [...(page.eraserMarks ?? []), mark] }
        setAnnotations(prev => { const next = new Map(prev); next.set(pageNum, updated); return next })
        scheduleSave(pageNum, updated)
        if (annotCanvas) { const dpr = dprRef.current; redrawAnnotations(annotCanvas, updated, scaleRef.current*dpr, dpr) }
      } else {
        if (annotCanvas) { const dpr = dprRef.current; redrawAnnotations(annotCanvas, page, scaleRef.current*dpr, dpr) }
      }
      return
    }
    if (stroke.points.length < 2) return
    if (tool === 'line' || tool === 'highlighter-line') stroke.points = [stroke.points[0], stroke.points[stroke.points.length - 1]]
    setAnnotations(prev => {
      const next = new Map(prev)
      const page = next.get(pageNum) ?? { strokes: [], texts: [] }
      const hist = history.current.get(pageNum) ?? []
      history.current.set(pageNum, [...hist, page])
      const updated: PageAnnotations = { ...page, strokes: [...page.strokes, { ...stroke, seq: Date.now() }] }
      next.set(pageNum, updated); scheduleSave(pageNum, updated)
      return next
    })
  }

  const textSubmittingRef = useRef(false)

  function handleTextSubmit() {
    if (!textInput || textSubmittingRef.current) return
    textSubmittingRef.current = true
    const pageNum = textInput.page
    const capturedText = textValue
    const capturedFontSize = fontSize
    const capturedColor = color
    const capturedEditingId = editingTextId
    const capturedX = textInput.x
    const capturedY = textInput.y
    // Clear editing ref sync BEFORE any redraw so subsequent redraws show all texts
    editingTextIdRef.current = null
    setTextInput(null); setTextValue(''); setEditingTextId(null)
    setTimeout(() => { textSubmittingRef.current = false }, 100)

    const page = annotationsRef.current.get(pageNum) ?? { strokes: [], texts: [] }
    const hist = history.current.get(pageNum) ?? []
    history.current.set(pageNum, [...hist, page])

    let updatedTexts: TextAnnotation[]
    if (!capturedText.trim()) {
      if (capturedEditingId) {
        // Empty submit while re-editing: delete the text annotation
        updatedTexts = (page.texts ?? []).filter(t => t.id !== capturedEditingId)
      } else {
        // Empty new text: just cancel, restore canvas
        const annotCanvas = annotCanvasRefs.current[pageNum - 1]
        if (annotCanvas) {
          const dpr = dprRef.current
          redrawAnnotations(annotCanvas, page, scaleRef.current * dpr, dpr)
        }
        return
      }
    } else if (capturedEditingId) {
      updatedTexts = (page.texts ?? []).map(t => t.id === capturedEditingId ? { ...t, text: capturedText, fontSize: capturedFontSize, color: capturedColor } : t)
      if (!updatedTexts.some(t => t.id === capturedEditingId)) updatedTexts = [...(page.texts ?? []), { id: capturedEditingId, x: capturedX, y: capturedY, text: capturedText, fontSize: capturedFontSize, color: capturedColor }]
    } else {
      updatedTexts = [...(page.texts ?? []), { id: uuidv4(), x: capturedX, y: capturedY, text: capturedText, fontSize: capturedFontSize, color: capturedColor }]
    }
    const updated: PageAnnotations = { ...page, texts: updatedTexts }
    const nextAnnotations = new Map(annotationsRef.current)
    nextAnnotations.set(pageNum, updated)
    annotationsRef.current = nextAnnotations
    setAnnotations(nextAnnotations)
    scheduleSave(pageNum, updated)
    const annotCanvas = annotCanvasRefs.current[pageNum - 1]
    if (annotCanvas) {
      const dpr = dprRef.current
      redrawAnnotations(annotCanvas, updated, scaleRef.current * dpr, dpr)
    }
  }

  function scheduleSave(pageNum: number, data: PageAnnotations) {
    if (readonly) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setStatus('saving')
    const effectiveSave = saveFn ?? saveAnnotations
    saveTimer.current = setTimeout(async () => {
      try {
        await effectiveSave(documentId, pageNum, data)
        setStatus('saved'); setTimeout(() => setStatus('idle'), 2000)
        channelRef.current?.send({ type: 'broadcast', event: 'annotation-update', payload: { pageNumber: pageNum, data, clientId: clientId.current } })
      } catch { setStatus('error') }
    }, SAVE_DEBOUNCE_MS)
  }

  function handleUndo() {
    const pageNum = currentPageRef.current
    const hist = history.current.get(pageNum)
    if (!hist || hist.length === 0) return
    const previous = hist[hist.length - 1]
    history.current.set(pageNum, hist.slice(0, -1))
    setAnnotations(prev => { const next = new Map(prev); next.set(pageNum, previous); scheduleSave(pageNum, previous); return next })
    const canvas = annotCanvasRefs.current[pageNum - 1]
    if (canvas) { const dpr = dprRef.current; redrawAnnotations(canvas, previous, scaleRef.current*dpr, dpr) }
  }

  function handleClearPage() {
    const pageNum = currentPageRef.current
    if (!confirm('このページの書き込みをすべて消しますか？')) return
    const empty: PageAnnotations = { strokes: [], texts: [] }
    const page = annotationsRef.current.get(pageNum) ?? { strokes: [], texts: [] }
    const hist = history.current.get(pageNum) ?? []
    history.current.set(pageNum, [...hist, page])
    setAnnotations(prev => { const next = new Map(prev); next.set(pageNum, empty); scheduleSave(pageNum, empty); return next })
    const canvas = annotCanvasRefs.current[pageNum - 1]
    if (canvas) { const dpr = dprRef.current; redrawAnnotations(canvas, empty, scaleRef.current*dpr, dpr) }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); handleUndo() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  async function handlePrint() {
    if (!pdf) return
    setStatus('saving')
    const printWindow = window.open('', '_blank')
    if (!printWindow) return
    printWindow.document.write('<html><head><title>印刷</title><style>body{margin:0;background:#fff}img{display:block;width:100%;page-break-after:always;}</style></head><body>')
    for (let p = 1; p <= totalPages; p++) {
      const page = await pdf.getPage(p)
      const viewport = page.getViewport({ scale: 2 })
      const pdfC = document.createElement('canvas'); pdfC.width = viewport.width; pdfC.height = viewport.height
      await page.render({ canvas: pdfC, viewport }).promise
      const annotC = document.createElement('canvas'); annotC.width = viewport.width; annotC.height = viewport.height
      redrawAnnotations(annotC, annotationsRef.current.get(p) ?? { strokes: [], texts: [] }, 2, 1)
      const merged = document.createElement('canvas'); merged.width = viewport.width; merged.height = viewport.height
      const mctx = merged.getContext('2d')!; mctx.drawImage(pdfC, 0, 0); mctx.drawImage(annotC, 0, 0)
      printWindow.document.write(`<img src="${merged.toDataURL()}" />`)
    }
    printWindow.document.write('</body></html>'); printWindow.document.close(); printWindow.focus()
    setTimeout(() => { printWindow.print() }, 500); setStatus('idle')
  }

  useEffect(() => { scaleRef.current = scale }, [scale])

  useEffect(() => {
    const el = containerRef.current; if (!el) return
    function onWheel(e: WheelEvent) { if (!e.ctrlKey) return; e.preventDefault(); setScale(s => Math.min(3, Math.max(0.5, Math.round((s - e.deltaY * 0.001) * 10) / 10))) }
    function onTouchStart(e: TouchEvent) { if (e.touches.length === 2) { const dx=e.touches[0].clientX-e.touches[1].clientX, dy=e.touches[0].clientY-e.touches[1].clientY; pinchStartDist.current=Math.hypot(dx,dy); pinchStartScale.current=scaleRef.current } }
    function onTouchMove(e: TouchEvent) { if (e.touches.length===2 && pinchStartDist.current!==null) { e.preventDefault(); const dx=e.touches[0].clientX-e.touches[1].clientX, dy=e.touches[0].clientY-e.touches[1].clientY; const dist=Math.hypot(dx,dy), ratio=dist/pinchStartDist.current; if (Math.abs(ratio-1)<0.04) return; setScale(Math.round(Math.min(3,Math.max(0.5,pinchStartScale.current*ratio))*20)/20) } }
    function onTouchEnd(e: TouchEvent) { if (e.touches.length<2) pinchStartDist.current=null }
    el.addEventListener('wheel', onWheel, { passive: false }); el.addEventListener('touchstart', onTouchStart, { passive: true }); el.addEventListener('touchmove', onTouchMove, { passive: false }); el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => { el.removeEventListener('wheel', onWheel); el.removeEventListener('touchstart', onTouchStart); el.removeEventListener('touchmove', onTouchMove); el.removeEventListener('touchend', onTouchEnd) }
  }, [])

  const canvasStyle = tool === 'none'
    ? { cursor: 'grab', touchAction: 'auto', pointerEvents: 'none' as const }
    : { cursor: tool==='pen'||tool==='highlighter'||tool==='line'||tool==='highlighter-line' ? 'crosshair' : tool==='eraser' ? 'none' : 'text', touchAction: 'none' as const }

  return (
    <div className="flex h-full w-full overflow-hidden">
      {!readonly && toolbarOpen && (
        <Toolbar
          tool={tool} color={color} size={brushSize} fontSize={fontSize}
          onToolChange={setTool} onColorChange={setColor} onSizeChange={setBrushSize} onFontSizeChange={setFontSize}
          onUndo={handleUndo} onClearPage={handleClearPage}
          canUndo={(history.current.get(currentPageRef.current)?.length ?? 0) > 0}
        />
      )}

      {pageGridOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={() => setPageGridOpen(false)}>
          <div className="bg-white rounded-t-2xl w-full max-w-lg max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-800">ページ一覧</h2>
              <button onClick={() => setPageGridOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="overflow-y-auto p-4">
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => { scrollToPage(p); setPageGridOpen(false) }}
                    className={`aspect-[3/4] rounded-lg border-2 flex flex-col items-center justify-center text-sm font-bold transition-all
                      ${currentPage === p ? 'border-blue-500 bg-blue-600 text-white shadow-md scale-105' : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-blue-300 hover:bg-blue-50'}`}>
                    <span className="text-lg leading-none">{p}</span>
                    <span className="text-[10px] opacity-60 mt-0.5">P</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden bg-gray-100 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-200 shadow-sm">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {!readonly && (
              <button onClick={() => setToolbarOpen(v => !v)}
                className={`p-1.5 rounded-md transition-colors ${toolbarOpen ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                title={toolbarOpen ? 'ツールバーを隠す' : 'ツールバーを表示'}>
                <PanelIcon open={toolbarOpen} />
              </button>
            )}
            <button onClick={() => scrollToPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1}
              className="px-2.5 py-1.5 text-sm bg-gray-100 rounded-md disabled:opacity-40 hover:bg-gray-200 transition-colors">←</button>
            <button onClick={() => setPageGridOpen(true)}
              className="px-2 py-1.5 text-sm font-medium text-gray-700 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors min-w-[4rem] text-center"
              title="ページ一覧">
              {currentPage} / {totalPages}
            </button>
            <button onClick={() => scrollToPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}
              className="px-2.5 py-1.5 text-sm bg-gray-100 rounded-md disabled:opacity-40 hover:bg-gray-200 transition-colors">→</button>
            {totalPages > 1 && (
              <button onClick={() => setPageGridOpen(true)} className="p-1.5 rounded-md bg-gray-100 hover:bg-gray-200 transition-colors text-gray-600" title="ページ一覧">
                <GridIcon />
              </button>
            )}
          </div>

          <div className="hidden sm:flex items-center gap-1 flex-shrink-0 ml-1">
            <button onClick={() => setScale(s => Math.max(0.5, s - 0.2))} className="px-2 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200">－</button>
            <span className="text-xs text-gray-500 w-11 text-center">{Math.round(scale * 100)}%</span>
            <button onClick={() => setScale(s => Math.min(3, s + 0.2))} className="px-2 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200">＋</button>
          </div>

          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
            {!readonly && onlineCount > 1 && (
              <span className="hidden sm:flex items-center gap-1 text-xs text-green-600 font-medium">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />{onlineCount}人
              </span>
            )}
            {status === 'saving' && <span className="hidden sm:inline text-xs text-gray-400">保存中</span>}
            {status === 'saved' && <span className="hidden sm:inline text-xs text-green-500">✓</span>}
            {status === 'error' && <span className="text-xs text-red-500">!</span>}
            <button onClick={() => setStudyMode(m => !m)}
              className={`hidden md:block px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${studyMode ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {studyMode ? '🟥 暗記中' : '📕 暗記'}
            </button>
            <button onClick={handlePrint} className="hidden md:block px-3 py-1.5 text-sm bg-gray-800 text-white rounded-md hover:bg-gray-700 transition-colors">
              🖸 印刷
            </button>
            <div className="md:hidden relative">
              <button onClick={e => { e.stopPropagation(); setMobileMenuOpen(v => !v) }}
                className="p-1.5 rounded-md bg-gray-100 hover:bg-gray-200 transition-colors text-gray-700" aria-label="メニュー">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                  <circle cx="9" cy="4" r="1.5" /><circle cx="9" cy="9" r="1.5" /><circle cx="9" cy="14" r="1.5" />
                </svg>
              </button>
              {mobileMenuOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-40 w-52 overflow-hidden" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                    <span className="text-xs text-gray-500 font-medium">ズーム</span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setScale(s => Math.max(0.5, s - 0.2))} className="w-7 h-7 text-sm bg-gray-100 rounded hover:bg-gray-200">－</button>
                      <span className="text-xs text-gray-600 w-10 text-center">{Math.round(scale * 100)}%</span>
                      <button onClick={() => setScale(s => Math.min(3, s + 0.2))} className="w-7 h-7 text-sm bg-gray-100 rounded hover:bg-gray-200">＋</button>
                    </div>
                  </div>
                  <button onClick={() => { setStudyMode(m => !m); setMobileMenuOpen(false) }}
                    className={`w-full px-4 py-3 text-sm text-left flex items-center gap-3 transition-colors hover:bg-gray-50 ${studyMode ? 'text-red-600 font-medium' : 'text-gray-700'}`}>
                    {studyMode ? '🟥 暗記モード解除' : '📕 暗記モード'}
                  </button>
                  <button onClick={() => { handlePrint(); setMobileMenuOpen(false) }}
                    className="w-full px-4 py-3 text-sm text-left flex items-center gap-3 text-gray-700 hover:bg-gray-50 transition-colors border-t border-gray-100">
                    🖸 印刷
                  </button>
                  {!readonly && (
                    <div className="border-t border-gray-100 px-4 py-2 flex items-center gap-2 text-xs text-gray-400">
                      {status === 'saving' && <span>保存中...</span>}
                      {status === 'saved' && <span className="text-green-500">✓ 保存済み</span>}
                      {status === 'error' && <span className="text-red-500">保存失敗</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Continuous scroll area */}
        <div ref={containerRef} className="flex-1 overflow-auto pdf-scroll-area" onClick={() => mobileMenuOpen && setMobileMenuOpen(false)}>
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-gray-400">PDFを読み込み中...</div>
            </div>
          ) : (
            <div className="flex flex-col items-center py-6 gap-6 px-8 min-w-max">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <div
                  key={p}
                  ref={el => { pageContainerRefs.current[p-1] = el }}
                  data-page={p}
                  className="relative shadow-xl flex-shrink-0"
                  style={{ display: 'inline-block' }}
                >
                  <canvas ref={el => { pageCanvasRefs.current[p-1] = el }} className="block" />
                  <canvas
                    ref={el => { annotCanvasRefs.current[p-1] = el }}
                    className="absolute top-0 left-0"
                    style={readonly ? { cursor: 'default' } : canvasStyle}
                    onPointerDown={e => handlePointerDown(e, p)}
                    onPointerMove={e => handlePointerMove(e, p)}
                    onPointerUp={() => handlePointerUp(p)}
                    onPointerCancel={() => handlePointerUp(p)}
                    onPointerLeave={() => {
                      handlePointerUp(p)
                      const canvas = annotCanvasRefs.current[p-1]
                      if (canvas && !isDrawing.current) {
                        const dpr = dprRef.current
                        redrawAnnotations(canvas, annotationsRef.current.get(p) ?? { strokes: [], texts: [] }, scaleRef.current*dpr, dpr, editingTextIdRef.current)
                      }
                    }}
                  />
                  {textInput?.page === p && (
                    <input
                      ref={textInputRef}
                      value={textValue}
                      onChange={e => setTextValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleTextSubmit()
                        if (e.key === 'Escape') {
                          editingTextIdRef.current = null
                          setTextInput(null); setTextValue(''); setEditingTextId(null)
                          if (textInput) {
                            const canvas = annotCanvasRefs.current[textInput.page - 1]
                            if (canvas) {
                              const dpr = dprRef.current
                              redrawAnnotations(canvas, annotationsRef.current.get(textInput.page) ?? { strokes: [], texts: [] }, scaleRef.current * dpr, dpr)
                            }
                          }
                        }
                      }}
                      onBlur={handleTextSubmit}
                      className="absolute bg-transparent border-b border-blue-400 outline-none"
                      style={{
                        left: textInput.x * scale,
                        top: textInput.y * scale,
                        color, fontSize: fontSize * scale, minWidth: 100,
                      }}
                      placeholder="テキストを入力..."
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
