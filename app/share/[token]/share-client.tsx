'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getDocumentByToken, getPdfUrl } from '@/lib/db'
import { Document, PageAnnotations } from '@/types'

// PDF.js loaded dynamically
let pdfjsLib: typeof import('pdfjs-dist') | null = null

export default function SharePage() {
  const params = useParams()
  const token = params.token as string

  const [document, setDocument] = useState<Document | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [annotations, setAnnotations] = useState<Map<number, PageAnnotations>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      const result = await getDocumentByToken(token)
      if (!result) {
        setNotFound(true)
        setIsLoading(false)
        return
      }
      setDocument(result.document)
      setPdfUrl(getPdfUrl(result.document.pdf_path))
      setAnnotations(result.annotations)
      setIsLoading(false)
    }
    load()
  }, [token])

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-lg">読み込み中...</div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-5xl mb-4">🔍</div>
          <h1 className="text-xl font-bold text-gray-700 mb-2">ページが見つかりません</h1>
          <p className="text-gray-400 text-sm mb-6">共有リンクが無効か、削除されています</p>
          <Link href="/" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm">
            ホームへ戻る
          </Link>
        </div>
      </div>
    )
  }

  if (!document || !pdfUrl) return null

  return <ShareReader document={document} pdfUrl={pdfUrl} annotations={annotations} token={token} />
}

function ShareReader({
  document: doc,
  pdfUrl,
  annotations,
  token,
}: {
  document: Document
  pdfUrl: string
  annotations: Map<number, PageAnnotations>
  token: string
}) {
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(doc.total_pages || 1)
  const [scale, setScale] = useState(1.4)
  const [isPrinting, setIsPrinting] = useState(false)
  const [studyMode, setStudyMode] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const pdfCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const annotCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const pdfRef = useRef<import('pdfjs-dist').PDFDocumentProxy | null>(null)
  const renderTasksRef = useRef<Map<number, import('pdfjs-dist').RenderTask>>(new Map())
  const renderedPagesRef = useRef<Set<number>>(new Set())
  const visiblePagesRef = useRef<Set<number>>(new Set())
  const scaleRef = useRef(scale)
  const studyModeRef = useRef(studyMode)
  const [revealedStrokes, setRevealedStrokes] = useState<Set<string>>(new Set())
  const revealedStrokesRef = useRef<Set<string>>(new Set())
  const pinchStartDist = useRef<number | null>(null)
  const pinchStartScale = useRef<number>(1)

  const renderPageRef = useRef<(pageNum: number) => Promise<void>>(async () => {})

  useEffect(() => { scaleRef.current = scale }, [scale])
  useEffect(() => { studyModeRef.current = studyMode }, [studyMode])
  useEffect(() => { revealedStrokesRef.current = revealedStrokes }, [revealedStrokes])
  // Clear revealed strokes when study mode is turned off
  useEffect(() => {
    if (!studyMode) {
      const empty = new Set<string>()
      revealedStrokesRef.current = empty
      setRevealedStrokes(empty)
    }
  }, [studyMode])

  useEffect(() => {
    renderPageRef.current = async (pageNum: number) => {
      if (!pdfRef.current || !pdfCanvasRefs.current[pageNum - 1] || !annotCanvasRefs.current[pageNum - 1]) return
      const prevTask = renderTasksRef.current.get(pageNum)
      if (prevTask) { prevTask.cancel(); renderTasksRef.current.delete(pageNum) }
      try {
        const page = await pdfRef.current.getPage(pageNum)
        const dpr = window.devicePixelRatio || 1
        const sc = scaleRef.current
        const viewport = page.getViewport({ scale: sc * dpr })
        const cssW = Math.round(viewport.width / dpr)
        const cssH = Math.round(viewport.height / dpr)

        const pdfCanvas = pdfCanvasRefs.current[pageNum - 1]!
        pdfCanvas.width = viewport.width
        pdfCanvas.height = viewport.height
        pdfCanvas.style.width = cssW + 'px'
        pdfCanvas.style.height = cssH + 'px'

        const annotCanvas = annotCanvasRefs.current[pageNum - 1]!
        annotCanvas.width = viewport.width
        annotCanvas.height = viewport.height
        annotCanvas.style.width = cssW + 'px'
        annotCanvas.style.height = cssH + 'px'

        const task = page.render({ canvas: pdfCanvas, viewport })
        renderTasksRef.current.set(pageNum, task)
        await task.promise
        renderTasksRef.current.delete(pageNum)
        renderedPagesRef.current.add(pageNum)
        drawAnnotations(annotCanvas, annotations.get(pageNum) ?? { strokes: [], texts: [] }, sc * dpr, sc * dpr, studyModeRef.current, revealedStrokesRef.current)
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== 'RenderingCancelledException') {
          console.error('Render error:', e)
        }
      }
    }
  }, [scale, annotations])

  // Load PDF
  useEffect(() => {
    async function load() {
      if (!pdfjsLib) {
        pdfjsLib = await import('pdfjs-dist')
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
      }
      try {
        const pdf = await pdfjsLib.getDocument({ url: pdfUrl }).promise
        pdfRef.current = pdf
        setTotalPages(pdf.numPages)
        // Auto-scale: fit page width to container
        const page = await pdf.getPage(1)
        const naturalWidth = page.getViewport({ scale: 1 }).width
        const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth
        const autoScale = Math.min(2.0, Math.max(0.4, (containerWidth - 48) / naturalWidth))
        setScale(Math.round(autoScale * 20) / 20)
      } catch (e) {
        console.error('PDF load error:', e)
      }
    }
    load()
  }, [pdfUrl])

  // Re-render visible pages when scale or studyMode changes
  useEffect(() => {
    renderedPagesRef.current.clear()
    visiblePagesRef.current.forEach(p => renderPageRef.current(p))
  }, [scale, studyMode])

  // IntersectionObserver for lazy rendering and page tracking
  useEffect(() => {
    const container = containerRef.current
    if (!container || totalPages < 1) return
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          const p = Number(entry.target.getAttribute('data-page'))
          if (entry.isIntersecting) {
            visiblePagesRef.current.add(p)
            if (!renderedPagesRef.current.has(p)) renderPageRef.current(p)
          } else {
            visiblePagesRef.current.delete(p)
          }
        })
        if (visiblePagesRef.current.size > 0) {
          const topPage = Math.min(...visiblePagesRef.current)
          setCurrentPage(topPage)
        }
      },
      { root: container, rootMargin: '300px 0px', threshold: 0.01 }
    )
    pageRefs.current.forEach(el => { if (el) observer.observe(el) })
    return () => observer.disconnect()
  }, [totalPages])

  function scrollToPage(p: number) {
    pageRefs.current[p - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setCurrentPage(p)
  }

  function handlePageClick(e: React.MouseEvent<HTMLDivElement>, pageNum: number) {
    if (!studyModeRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const cssX = e.clientX - rect.left
    const cssY = e.clientY - rect.top
    const sc = scaleRef.current
    const pageX = cssX / sc
    const pageY = cssY / sc

    const pa = annotations.get(pageNum) ?? { strokes: [], texts: [] }
    // Find topmost highlighter stroke whose bounding box contains the click
    const hit = [...pa.strokes].reverse().find(stroke => {
      if (stroke.tool !== 'highlighter' && stroke.tool !== 'highlighter-line') return false
      if (stroke.points.length < 2) return false
      const halfSize = stroke.size / 2
      const xs = stroke.points.map(p => p.x)
      const ys = stroke.points.map(p => p.y)
      return pageX >= Math.min(...xs) - halfSize && pageX <= Math.max(...xs) + halfSize
        && pageY >= Math.min(...ys) - halfSize && pageY <= Math.max(...ys) + halfSize
    })

    if (!hit) return

    const next = new Set(revealedStrokesRef.current)
    if (next.has(hit.id)) next.delete(hit.id)
    else next.add(hit.id)
    revealedStrokesRef.current = next
    setRevealedStrokes(new Set(next))

    // Re-render this page with new revealed set
    renderedPagesRef.current.delete(pageNum)
    renderPageRef.current(pageNum)
  }

  function drawAnnotations(canvas: HTMLCanvasElement, pageAnnotations: PageAnnotations, drawScale: number, lineWidthScale: number, forceStudyMode = false, revealedIds: Set<string> = new Set()) {
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    for (const stroke of pageAnnotations.strokes) {
      if (stroke.points.length < 2) continue
      ctx.save()
      const isH = stroke.tool === 'highlighter' || stroke.tool === 'highlighter-line'
      const maskMode = isH && forceStudyMode && !revealedIds.has(stroke.id)
      ctx.globalAlpha = maskMode ? 1 : stroke.opacity
      ctx.strokeStyle = maskMode ? stroke.color.slice(0, 7) : stroke.color
      ctx.lineWidth = stroke.size * lineWidthScale
      ctx.lineCap = isH ? 'square' : 'round'
      ctx.lineJoin = isH ? 'miter' : 'round'
      if (isH && !maskMode) ctx.globalCompositeOperation = 'multiply'
      const pts = stroke.points
      ctx.beginPath()
      ctx.moveTo(pts[0].x * drawScale, pts[0].y * drawScale)
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1], curr = pts[i]
        ctx.quadraticCurveTo(prev.x * drawScale, prev.y * drawScale, (prev.x + curr.x) / 2 * drawScale, (prev.y + curr.y) / 2 * drawScale)
      }
      ctx.lineTo(pts[pts.length - 1].x * drawScale, pts[pts.length - 1].y * drawScale)
      ctx.stroke()
      ctx.restore()
    }

    for (const text of pageAnnotations.texts) {
      ctx.save()
      ctx.font = `${text.fontSize * drawScale}px sans-serif`
      ctx.fillStyle = text.color
      ctx.fillText(text.text, text.x * drawScale, text.y * drawScale)
      ctx.restore()
    }

    if (pageAnnotations.eraserMarks?.length) {
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const mark of pageAnnotations.eraserMarks) {
        if (!mark.points.length) continue
        ctx.lineWidth = mark.r * 2 * drawScale
        ctx.beginPath()
        if (mark.points.length === 1) {
          ctx.arc(mark.points[0].x * drawScale, mark.points[0].y * drawScale, mark.r * drawScale, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.moveTo(mark.points[0].x * drawScale, mark.points[0].y * drawScale)
          for (let i = 1; i < mark.points.length; i++) ctx.lineTo(mark.points[i].x * drawScale, mark.points[i].y * drawScale)
          ctx.stroke()
        }
      }
      ctx.restore()
    }
  }

  async function handlePrint() {
    if (!pdfRef.current) return
    setIsPrinting(true)
    const printWindow = window.open('', '_blank')
    if (!printWindow) { setIsPrinting(false); return }
    printWindow.document.write('<html><head><title>印刷</title><style>body{margin:0;background:#fff}img{display:block;width:100%;page-break-after:always;}</style></head><body>')
    const total = pdfRef.current.numPages
    for (let p = 1; p <= total; p++) {
      const page = await pdfRef.current.getPage(p)
      const viewport = page.getViewport({ scale: 2 })
      const pdfC = globalThis.document.createElement('canvas')
      pdfC.width = viewport.width; pdfC.height = viewport.height
      await page.render({ canvas: pdfC, viewport }).promise
      const annotC = globalThis.document.createElement('canvas')
      annotC.width = viewport.width; annotC.height = viewport.height
      drawAnnotations(annotC, annotations.get(p) ?? { strokes: [], texts: [] }, 2, 2)
      const merged = globalThis.document.createElement('canvas')
      merged.width = viewport.width; merged.height = viewport.height
      const mctx = merged.getContext('2d')!
      mctx.drawImage(pdfC, 0, 0); mctx.drawImage(annotC, 0, 0)
      printWindow.document.write(`<img src="${merged.toDataURL()}" />`)
    }
    printWindow.document.write('</body></html>')
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => { printWindow.print(); setIsPrinting(false) }, 500)
  }

  async function handleDownload() {
    if (!pdfRef.current) return
    try {
      const { jsPDF } = await import('jspdf')
      const total = pdfRef.current.numPages
      let pdf: InstanceType<typeof jsPDF> | null = null
      for (let p = 1; p <= total; p++) {
        const page = await pdfRef.current.getPage(p)
        const viewport = page.getViewport({ scale: 2 })
        const pdfC = globalThis.document.createElement('canvas')
        pdfC.width = viewport.width; pdfC.height = viewport.height
        await page.render({ canvas: pdfC, viewport }).promise
        const annotC = globalThis.document.createElement('canvas')
        annotC.width = viewport.width; annotC.height = viewport.height
        drawAnnotations(annotC, annotations.get(p) ?? { strokes: [], texts: [] }, 2, 2)
        const merged = globalThis.document.createElement('canvas')
        merged.width = viewport.width; merged.height = viewport.height
        const mctx = merged.getContext('2d')!
        mctx.drawImage(pdfC, 0, 0); mctx.drawImage(annotC, 0, 0)
        const imgData = merged.toDataURL('image/jpeg', 0.92)
        const w = viewport.width / 2
        const h = viewport.height / 2
        if (!pdf) {
          pdf = new jsPDF({ orientation: w > h ? 'l' : 'p', unit: 'pt', format: [w, h] })
        } else {
          pdf.addPage([w, h], w > h ? 'l' : 'p')
        }
        pdf.addImage(imgData, 'JPEG', 0, 0, w, h)
      }
      if (pdf) {
        const filename = doc.title.endsWith('.pdf') ? doc.title : doc.title + '.pdf'
        pdf.save(filename)
      }
    } catch (e) {
      console.error('Download error:', e)
    }
  }

  // Ctrl+wheel zoom + pinch zoom via native listeners (so preventDefault works on iOS)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setScale(s => Math.min(3, Math.max(0.5, Math.round((s - e.deltaY * 0.001) * 10) / 10)))
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        pinchStartDist.current = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
        pinchStartScale.current = scaleRef.current
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2 && pinchStartDist.current !== null) {
        e.preventDefault()
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
        const ratio = dist / pinchStartDist.current
        if (Math.abs(ratio - 1) < 0.04) return
        const next = Math.min(3, Math.max(0.5, pinchStartScale.current * ratio))
        setScale(Math.round(next * 20) / 20)
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) pinchStartDist.current = null
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200 shadow-sm">
        <Link href="/" className="text-blue-600 hover:text-blue-800 text-sm font-medium transition-colors whitespace-nowrap">
          📝 PDF Note
        </Link>
        <div className="h-4 w-px bg-gray-200" />
        <h1 className="font-semibold text-gray-800 truncate flex-1 text-sm">{doc.title}</h1>
        <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full whitespace-nowrap">閲覧のみ</span>
      </header>

      {/* Reader controls */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-2 bg-white border-b border-gray-100">
        {/* Row 1: page nav + zoom */}
        <div className="flex items-center gap-2">
          <button onClick={() => scrollToPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1}
            className="px-3 py-1.5 text-sm bg-gray-100 rounded-md disabled:opacity-40 hover:bg-gray-200 transition-colors font-medium" title="前のページ">↑</button>
          <span className="text-sm font-medium text-gray-700 min-w-[4rem] text-center">{currentPage} / {totalPages}</span>
          <button onClick={() => scrollToPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}
            className="px-3 py-1.5 text-sm bg-gray-100 rounded-md disabled:opacity-40 hover:bg-gray-200 transition-colors font-medium" title="次のページ">↓</button>
          <div className="w-px h-5 bg-gray-200 mx-1" />
          <button onClick={() => setScale(s => Math.max(0.4, Math.round((s - 0.2) * 10) / 10))} className="px-2 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200">－</button>
          <span className="text-xs text-gray-500 w-10 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(s => Math.min(3, Math.round((s + 0.2) * 10) / 10))} className="px-2 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200">＋</button>
        </div>

        {/* Row 2 (mobile) / right side (desktop): actions */}
        <div className="flex items-center gap-2 sm:ml-auto">
          <button
            onClick={() => setStudyMode(m => !m)}
            title="暗記モード：蛍光ペンで書いた箇所を隠します。タップして個別に表示/隠し。"
            className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${studyMode ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            {studyMode ? `🟥 暗記中${revealedStrokes.size > 0 ? ` (${revealedStrokes.size}表示中)` : ''}` : '📕 暗記'}
          </button>
          <button onClick={handlePrint} disabled={isPrinting}
            className="px-3 py-1.5 text-sm bg-gray-800 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 transition-colors">
            {isPrinting ? '準備中...' : '🖨 印刷'}
          </button>
          <Link href={`/highlights/${token}`}
            className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors">
            📋 一覧
          </Link>
          <button onClick={handleDownload}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
            ⬇ DL
          </button>
        </div>
      </div>

      {/* PDF area - continuous scroll */}
      <div ref={containerRef} className="flex-1 overflow-auto bg-gray-100 pdf-scroll-area">
        <div className="flex flex-col items-center py-6 gap-6 min-w-max px-6">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
            <div
              key={p}
              ref={el => { pageRefs.current[p - 1] = el }}
              data-page={p}
              className="relative shadow-xl"
              style={{ minHeight: 200, cursor: studyMode ? 'pointer' : 'default' }}
              onClick={e => handlePageClick(e, p)}
            >
              <canvas ref={el => { pdfCanvasRefs.current[p - 1] = el }} className="block" />
              <canvas ref={el => { annotCanvasRefs.current[p - 1] = el }} className="absolute top-0 left-0" style={{ pointerEvents: 'none' }} />
            </div>
          ))}
        </div>
      </div>

      {/* Page thumbnail strip */}
      <div className="bg-white border-t border-gray-200 overflow-x-auto">
        <div className="flex gap-2 px-4 py-2 min-w-max">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => scrollToPage(p)}
              className={`w-10 h-10 rounded text-xs font-medium transition-all ${currentPage === p ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
