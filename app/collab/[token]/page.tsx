import { Suspense } from 'react'
import CollabClient from './collab-client'

async function CollabPageInner({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <CollabClient token={token} />
}

export default function CollabPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-lg">読み込み中...</div>
      </div>
    }>
      <CollabPageInner params={params} />
    </Suspense>
  )
}
