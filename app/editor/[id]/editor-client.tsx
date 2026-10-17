'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import PDFAnnotator from '@/components/PDFAnnotator'
import { createCollabLink, createShareLink, deleteCollabLink, getCollabLink, getDocument, getPdfUrl, saveLastSession } from '@/lib/db'
import { Document } from '@/types'

export default function EditorPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = params.id as string
  const initialPage = Number(searchParams.get('page') ?? '1') || 1

  const [document, setDocument] = useState<Document | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(initialPage)
  const saveTimer = useRef<NodeJS.Timeout | null>(null)

  // Share menu state
  const [showShareMenu, setShowShareMenu] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [collabUrl, setCollabUrl] = useState<string | null>(null)
  const [isLoadingLinks, setIsLoadingLinks] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [copiedShare, setCopiedShare] = useState(false)
  const [copiedCollab, setCopiedCollab] = useState(false)
  const [highlightsUrl, setHighlightsUrl] = useState<string | null>(null)
  const [isLoadingHighlights, setIsLoadingHighlights] = useState(false)

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      const doc = await getDocument(id)
      if (!doc) {
        router.replace('/')
        return
      }
      setDocument(doc)
      setPdfUrl(getPdfUrl(doc.pdf_path))
      setIsLoading(false)
    }
    load()
  }, [id, router])

  // Debounced save of last session
  useEffect(() => {
    if (!document) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveLastSession(document.id, document.title, currentPage).catch(() => {})
    }, 1500)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [document, currentPage])

  async function openShareMenu() {
    if (!document) return
    setShowShareMenu(true)
    setIsLoadingLinks(true)
    setShareError(null)
    try {
      const origin = window.location.origin
      const [shareLink, existingCollab] = await Promise.all([
        createShareLink(document.id).catch(() => null),
        getCollabLink(document.id).catch(() => null),
      ])
      if (shareLink) {
        setShareUrl(`${origin}/share/${shareLink.token}`)
        setHighlightsUrl(`${origin}/highlights/${shareLink.token}`)
      }
      if (existingCollab) setCollabUrl(`${origin}/collab/${existingCollab.token}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e)
      setShareError(msg)
    } finally {
      setIsLoadingLinks(false)
    }
  }

  async function handleCreateCollabLink() {
    if (!document) return
    setIsLoadingLinks(true)
    try {
      const link = await createCollabLink(document.id)
      setCollabUrl(`${window.location.origin}/collab/${link.token}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e)
      setShareError(msg)
    } finally {
      setIsLoadingLinks(false)
    }
  }

  async function handleDeleteCollabLink() {
    if (!document) return
    if (!confirm('共同編集リンクを削除しますか？このリンクは使えなくなります。')) return
    setIsLoadingLinks(true)
    try {
      await deleteCollabLink(document.id)
      setCollabUrl(null)
    } finally {
      setIsLoadingLinks(false)
    }
  }

  async function copyUrl(url: string, which: 'share' | 'collab') {
    await navigator.clipboard.writeText(url)
    if (which === 'share') {
      setCopiedShare(true)
      setTimeout(() => setCopiedShare(false), 2000)
    } else {
      setCopiedCollab(true)
      setTimeout(() => setCopiedCollab(false), 2000)
    }
  }

  async function openHighlights() {
    if (highlightsUrl) { window.open(highlightsUrl, '_blank'); return }
    if (!document) return
    setIsLoadingHighlights(true)
    try {
      const shareLink = await createShareLink(document.id)
      const url = `${window.location.origin}/highlights/${shareLink.token}`
      setHighlightsUrl(url)
      setShareUrl(`${window.location.origin}/share/${shareLink.token}`)
      window.open(url, '_blank')
    } finally {
      setIsLoadingHighlights(false)
    }
  }

  function closeShareMenu() {
    setShowShareMenu(false)
    setShareError(null)
  }

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-lg">読み込み中...</div>
      </div>
    )
  }

  if (!document || !pdfUrl) return null

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200 shadow-sm">
        <Link href="/" className="text-blue-600 hover:text-blue-800 text-sm font-medium transition-colors">
          ← ホーム
        </Link>
        <div className="h-4 w-px bg-gray-200" />
        <h1 className="font-semibold text-gray-800 truncate flex-1 text-sm">
          {document.title}
        </h1>
        <button
          onClick={openHighlights}
          disabled={isLoadingHighlights}
          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
        >
          {isLoadingHighlights ? '...' : '📋 一覧'}
        </button>
        <button
          onClick={openShareMenu}
          className="px-4 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
        >
          🔗 共有
        </button>
      </header>

      {/* PDF Annotator */}
      <div className="flex-1 overflow-hidden">
        <PDFAnnotator
          pdfUrl={pdfUrl}
          documentId={document.id}
          initialPage={initialPage}
          onPageChange={setCurrentPage}
          onShare={openShareMenu}
        />
      </div>

      {/* Share menu sheet */}
      {showShareMenu && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center"
          onClick={closeShareMenu}
        >
          <div
            className="bg-white rounded-t-2xl shadow-2xl w-full max-w-lg pb-safe animate-slide-up"
            onClick={e => e.stopPropagation()}
          >
            {/* Handle bar */}
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mt-3 mb-4" />

            <div className="px-6 pb-6">
              <h2 className="text-lg font-bold text-gray-800 mb-1">共有</h2>
              <p className="text-sm text-gray-500 mb-5">リンクを持つ人がアクセスできます</p>

              {shareError && (
                <div className="mb-4 p-3 bg-red-50 rounded-lg text-xs text-red-600 font-mono break-all">
                  {shareError}
                </div>
              )}

              {/* View-only link */}
              <section className="mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold text-gray-700">👁 閲覧専用リンク</span>
                  <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">書き込み不可</span>
                </div>
                {isLoadingLinks && !shareUrl ? (
                  <div className="h-9 bg-gray-100 rounded-lg animate-pulse" />
                ) : shareUrl ? (
                  <div className="flex gap-2">
                    <input
                      value={shareUrl}
                      readOnly
                      className="flex-1 px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-600 font-mono min-w-0"
                    />
                    <button
                      onClick={() => copyUrl(shareUrl, 'share')}
                      className={`px-3 py-2 text-sm rounded-lg font-medium whitespace-nowrap transition-colors
                        ${copiedShare ? 'bg-green-500 text-white' : 'bg-gray-800 text-white hover:bg-gray-700'}`}
                    >
                      {copiedShare ? '✓' : 'コピー'}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">リンクの作成に失敗しました</p>
                )}
              </section>

              <div className="w-full h-px bg-gray-100 mb-5" />

              {/* Collab edit link */}
              <section className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold text-gray-700">🤝 共同編集リンク</span>
                  <span className="px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded">書き込み可</span>
                </div>
                <p className="text-xs text-gray-400 mb-3">このリンクを持つ人はログイン不要で書き込みできます</p>

                {isLoadingLinks && !collabUrl ? (
                  <div className="h-9 bg-gray-100 rounded-lg animate-pulse" />
                ) : collabUrl ? (
                  <>
                    <div className="flex gap-2 mb-2">
                      <input
                        value={collabUrl}
                        readOnly
                        className="flex-1 px-3 py-2 text-xs bg-gray-50 border border-green-200 rounded-lg text-gray-600 font-mono min-w-0"
                      />
                      <button
                        onClick={() => copyUrl(collabUrl, 'collab')}
                        className={`px-3 py-2 text-sm rounded-lg font-medium whitespace-nowrap transition-colors
                          ${copiedCollab ? 'bg-green-500 text-white' : 'bg-green-600 text-white hover:bg-green-700'}`}
                      >
                        {copiedCollab ? '✓' : 'コピー'}
                      </button>
                    </div>
                    <button
                      onClick={handleDeleteCollabLink}
                      disabled={isLoadingLinks}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors"
                    >
                      リンクを削除して無効化
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleCreateCollabLink}
                    disabled={isLoadingLinks}
                    className="w-full py-2.5 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors font-medium border border-green-200 disabled:opacity-50"
                  >
                    {isLoadingLinks ? '作成中...' : '+ 共同編集リンクを作成'}
                  </button>
                )}
              </section>

              <button
                onClick={closeShareMenu}
                className="w-full py-2.5 text-sm text-gray-500 hover:text-gray-700 transition-colors rounded-lg hover:bg-gray-50"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
