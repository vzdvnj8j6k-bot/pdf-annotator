'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getDocumentByToken, getPdfUrl } from '@/lib/db'
import { Document } from '@/types'

let pdfjsLib: typeof import('pdfjs-dist') | null = null

interface PdfTextItem {
  str: string
  transform: number[]
  width: number
  height: number
}

interface HighlightEntry {
  id: string
  pageNum: number
  color: string
  text: string
}

const DEFAULT_PROMPT = `以下のテキストを詳しく解説してください。重要なポイントや背景知識も含めて説明してください：`

export default function HighlightsClient() {
  const params = useParams()
  const token = params.token as string

  const [doc, setDoc] = useState<Document | null>(null)
  const [highlights, setHighlights] = useState<HighlightEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [progress, setProgress] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [promptTemplate, setPromptTemplate] = useState(DEFAULT_PROMPT)
  const [showPrompt, setShowPrompt] = useState(false)

  useEffect(() => {
    async function load() {
      const result = await getDocumentByToken(token)
      if (!result) { setNotFound(true); setIsLoading(false); return }

      setDoc(result.document)

      if (!pdfjsLib) {
        pdfjsLib = await import('pdfjs-dist')
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
      }

      const pdfUrl = getPdfUrl(result.document.pdf_path)
      const pdf = await pdfjsLib.getDocument({ url: pdfUrl }).promise
      const entries: HighlightEntry[] = []

      for (let p = 1; p <= pdf.numPages; p++) {
        setProgress(`テキスト抽出中... ${p} / ${pdf.numPages} ページ`)
        const pa = result.annotations.get(p)
        const strokesOnPage = (pa?.strokes ?? []).filter(
          s => s.tool === 'highlighter' || s.tool === 'highlighter-line'
        )
        if (strokesOnPage.length === 0) continue

        const page = await pdf.getPage(p)
        const viewport = page.getViewport({ scale: 1 })
        const textContent = await page.getTextContent()

        for (const stroke of strokesOnPage) {
          if (stroke.points.length < 2) continue
          const halfSize = stroke.size / 2
          const xs = stroke.points.map(pt => pt.x)
          const ys = stroke.points.map(pt => pt.y)
          const minX = Math.min(...xs) - halfSize
          const maxX = Math.max(...xs) + halfSize
          const minY = Math.min(...ys) - halfSize
          const maxY = Math.max(...ys) + halfSize

          const words: string[] = []
          for (const rawItem of textContent.items) {
            if (!('str' in rawItem)) continue
            const item = rawItem as PdfTextItem
            if (!item.str.trim()) continue
            const [a, b, c, d, e, f] = viewport.transform
            const px = item.transform[4]
            const py = item.transform[5]
            const vx = a * px + c * py + e
            const vy = b * px + d * py + f
            const itemW = item.width * viewport.scale
            const itemH = (item.height || 8) * viewport.scale
            const iMinX = vx
            const iMaxX = vx + itemW
            const iMinY = vy - itemH
            const iMaxY = vy
            if (iMaxX > minX && iMinX < maxX && iMaxY > minY && iMinY < maxY) {
              words.push(item.str)
            }
          }

          if (words.length > 0) {
            entries.push({ id: stroke.id, pageNum: p, color: stroke.color, text: words.join('') })
          }
        }
      }

      setHighlights(entries)
      setIsLoading(false)
      setProgress('')
    }
    load()
  }, [token])

  function buildMessage(text: string) {
    return promptTemplate.trim() ? `${promptTemplate.trim()}\n\n${text}` : text
  }

  function openChatGPT(text: string) {
    const msg = buildMessage(text)
    window.open(`https://chatgpt.com/?q=${encodeURIComponent(msg)}`, '_blank')
  }

  function openGemini(text: string) {
    const msg = buildMessage(text)
    window.open(`https://gemini.google.com/app?q=${encodeURIComponent(msg)}`, '_blank')
  }

  function openAllInChatGPT() {
    const allText = highlights.map(h => `[p.${h.pageNum}] ${h.text}`).join('\n')
    openChatGPT(allText)
  }

  function openAllInGemini() {
    const allText = highlights.map(h => `[p.${h.pageNum}] ${h.text}`).join('\n')
    openGemini(allText)
  }

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
  }

  function copyAll() {
    const text = highlights.map(h => `[p.${h.pageNum}] ${h.text}`).join('\n')
    navigator.clipboard.writeText(text)
    setCopied('all')
    setTimeout(() => setCopied(null), 1500)
  }

  function downloadCsv() {
    const rows = [['ページ', '色', 'テキスト'], ...highlights.map(h => [String(h.pageNum), h.color, h.text])]
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${doc?.title ?? 'highlights'}_マーカー一覧.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  if (notFound) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-5xl mb-4">🔍</div>
          <h1 className="text-xl font-bold text-gray-700 mb-2">ページが見つかりません</h1>
          <p className="text-gray-400 text-sm mb-6">共有リンクが無効か、削除されています</p>
          <Link href="/" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">ホームへ戻る</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm px-4 py-3 flex items-center gap-3 flex-wrap">
        <Link href={`/share/${token}`} className="text-blue-600 hover:text-blue-800 text-sm font-medium shrink-0">
          ← PDFに戻る
        </Link>
        <div className="h-4 w-px bg-gray-200" />
        <h1 className="font-semibold text-gray-800 text-sm truncate flex-1 min-w-0">
          {doc?.title ?? '...'} — マーカー一覧
        </h1>
        {!isLoading && highlights.length > 0 && (
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <button
              onClick={copyAll}
              className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700 transition-colors"
            >
              {copied === 'all' ? '✓ コピー済' : '📋 全コピー'}
            </button>
            <button
              onClick={downloadCsv}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 rounded-md text-white transition-colors"
            >
              ⬇ CSV
            </button>
          </div>
        )}
      </header>

      {/* Content */}
      <div className="flex-1 p-4 max-w-4xl mx-auto w-full">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-500 text-sm">{progress || '読み込み中...'}</p>
          </div>
        ) : highlights.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-5xl mb-4">🖊️</div>
            <p className="text-gray-500">蛍光ペンのマーカーが見つかりませんでした</p>
            <p className="text-gray-400 text-sm mt-1">スキャンPDFはテキスト抽出できません</p>
          </div>
        ) : (
          <>
            {/* AI Section */}
            <div className="bg-white rounded-xl shadow-sm mb-4 overflow-hidden">
              {/* AI Header */}
              <div className="px-4 py-3 flex items-center gap-3 border-b border-gray-100">
                <span className="text-sm font-medium text-gray-700">🤖 AIに質問する</span>
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    onClick={openAllInChatGPT}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#10a37f] hover:bg-[#0d8a6a] text-white rounded-md transition-colors font-medium"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.843-3.369 2.02-1.168a.076.076 0 0 1 .071 0l4.83 2.786a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.402-.676zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>
                    全件 ChatGPT
                  </button>
                  <button
                    onClick={openAllInGemini}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-md transition-colors font-medium"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 2c1.62 0 3.154.463 4.466 1.264L5.264 14.466A9.945 9.945 0 0 1 2 12C2 6.477 6.477 2 12 2zm0 20c-1.62 0-3.154-.463-4.466-1.264L18.736 9.534A9.945 9.945 0 0 1 22 12c0 5.523-4.477 10-10 10z"/></svg>
                    全件 Gemini
                  </button>
                  <button
                    onClick={() => setShowPrompt(v => !v)}
                    className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-md text-gray-600 transition-colors"
                  >
                    ✏️ プロンプト{showPrompt ? ' ▲' : ' ▼'}
                  </button>
                </div>
              </div>

              {/* Prompt Editor */}
              {showPrompt && (
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                  <label className="block text-xs text-gray-500 mb-1.5 font-medium">プロンプトテンプレート（テキストの前に付加されます）</label>
                  <textarea
                    value={promptTemplate}
                    onChange={e => setPromptTemplate(e.target.value)}
                    rows={3}
                    placeholder="例：以下のテキストを詳しく解説してください："
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => setPromptTemplate('以下のテキストを詳しく解説してください。重要なポイントや背景知識も含めて説明してください：')}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      解説
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={() => setPromptTemplate('以下のテキストを小学生でもわかるように、やさしく説明してください：')}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      やさしく
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={() => setPromptTemplate('以下のテキストの要点を箇条書きでまとめてください：')}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      箇条書き
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={() => setPromptTemplate('以下のテキストに関する試験問題を3問作成してください：')}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      試験問題
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={() => setPromptTemplate('')}
                      className="text-xs text-gray-400 hover:underline"
                    >
                      クリア
                    </button>
                  </div>
                </div>
              )}
            </div>

            <p className="text-sm text-gray-500 mb-3">{highlights.length} 件のマーカーが見つかりました</p>

            {/* Table */}
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="py-3 px-4 text-left font-medium text-gray-500 w-14">ページ</th>
                    <th className="py-3 px-3 text-left font-medium text-gray-500 w-8">色</th>
                    <th className="py-3 px-4 text-left font-medium text-gray-500">テキスト</th>
                    <th className="py-3 px-2 text-center font-medium text-gray-500 w-28">AI</th>
                    <th className="py-3 px-2 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {highlights.map((h, i) => (
                    <tr key={h.id} className={`border-b border-gray-50 hover:bg-blue-50/30 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                      <td className="py-3 px-4 text-gray-400 font-medium text-center">{h.pageNum}</td>
                      <td className="py-3 px-3">
                        <div
                          className="w-5 h-5 rounded-full border border-gray-200 mx-auto"
                          style={{ backgroundColor: h.color }}
                          title={h.color}
                        />
                      </td>
                      <td className="py-3 px-4 text-gray-800 leading-relaxed">{h.text}</td>
                      <td className="py-2 px-2">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openChatGPT(h.text)}
                            title="ChatGPTで解説"
                            className="flex items-center gap-1 px-2 py-1 text-xs bg-[#10a37f]/10 hover:bg-[#10a37f] text-[#10a37f] hover:text-white rounded-md transition-colors font-medium"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.843-3.369 2.02-1.168a.076.076 0 0 1 .071 0l4.83 2.786a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.402-.676zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>
                            GPT
                          </button>
                          <button
                            onClick={() => openGemini(h.text)}
                            title="Geminiで解説"
                            className="flex items-center gap-1 px-2 py-1 text-xs bg-[#1a73e8]/10 hover:bg-[#1a73e8] text-[#1a73e8] hover:text-white rounded-md transition-colors font-medium"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 2c1.62 0 3.154.463 4.466 1.264L5.264 14.466A9.945 9.945 0 0 1 2 12C2 6.477 6.477 2 12 2zm0 20c-1.62 0-3.154-.463-4.466-1.264L18.736 9.534A9.945 9.945 0 0 1 22 12c0 5.523-4.477 10-10 10z"/></svg>
                            Gem
                          </button>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-center">
                        <button
                          onClick={() => copyText(h.text, h.id)}
                          className="p-1.5 hover:bg-gray-100 rounded transition-colors text-gray-400 hover:text-gray-600"
                          title="コピー"
                        >
                          {copied === h.id ? '✓' : '📋'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
