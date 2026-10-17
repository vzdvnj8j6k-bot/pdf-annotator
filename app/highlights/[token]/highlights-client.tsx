'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getDocumentByToken, getPdfUrl } from '@/lib/db'
import { Document } from '@/types'

let pdfjsLib: typeof import('pdfjs-dist') | null = null

interface HighlightEntry {
  id: string
  pageNum: number
  color: string
  text: string
}

export default function HighlightsClient() {
  const params = useParams()
  const token = params.token as string

  const [doc, setDoc] = useState<Document | null>(null)
  const [highlights, setHighlights] = useState<HighlightEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [progress, setProgress] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

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
      const pdf = await pdfjsLib.getDocument(pdfUrl).promise
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
          for (const item of textContent.items as any[]) {
            if (!item.str?.trim()) continue
            // Convert PDF user space -> viewport coordinates (y from top)
            const [vx, vy] = (pdfjsLib!.Util as any).applyTransform(
              [item.transform[4], item.transform[5]],
              viewport.transform
            )
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
      <header className="bg-white border-b border-gray-200 shadow-sm px-4 py-3 flex items-center gap-3">
        <Link href={`/share/${token}`} className="text-blue-600 hover:text-blue-800 text-sm font-medium">
          ← PDFに戻る
        </Link>
        <div className="h-4 w-px bg-gray-200" />
        <h1 className="font-semibold text-gray-800 text-sm truncate flex-1">
          {doc?.title ?? '...'} — マーカー一覧
        </h1>
        {!isLoading && highlights.length > 0 && (
          <div className="flex items-center gap-2 ml-auto">
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
            <p className="text-sm text-gray-500 mb-3">{highlights.length} 件のマーカーが見つかりました</p>
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="py-3 px-4 text-left font-medium text-gray-500 w-16">ページ</th>
                    <th className="py-3 px-4 text-left font-medium text-gray-500 w-10">色</th>
                    <th className="py-3 px-4 text-left font-medium text-gray-500">テキスト</th>
                    <th className="py-3 px-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {highlights.map((h, i) => (
                    <tr key={h.id} className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                      <td className="py-3 px-4 text-gray-400 font-medium text-center">{h.pageNum}</td>
                      <td className="py-3 px-4">
                        <div
                          className="w-5 h-5 rounded-full border border-gray-200"
                          style={{ backgroundColor: h.color }}
                          title={h.color}
                        />
                      </td>
                      <td className="py-3 px-4 text-gray-800 leading-relaxed">{h.text}</td>
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
