import { Suspense } from 'react'
import HighlightsClient from './highlights-client'

export default function HighlightsPage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-lg">読み込み中...</div>
      </div>
    }>
      <HighlightsClient />
    </Suspense>
  )
}
