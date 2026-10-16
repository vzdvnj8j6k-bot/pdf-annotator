'use client'

import React, { useState } from 'react'
import { Tool } from '@/types'

interface ToolbarProps {
  tool: Tool
  color: string
  size: number
  fontSize: number
  onToolChange: (tool: Tool) => void
  onColorChange: (color: string) => void
  onSizeChange: (size: number) => void
  onFontSizeChange: (size: number) => void
  onUndo: () => void
  onClearPage: () => void
  canUndo: boolean
}

function Tooltip({ label }: { label: string }) {
  return (
    <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 pointer-events-none">
      <div className="bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap shadow-lg">
        {label}
        <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-800" />
      </div>
    </div>
  )
}

const COLORS = [
  '#000000', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899',
]

const LineSvg = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="3" y1="17" x2="17" y2="3" />
  </svg>
)

const UTIL_TOOLS: { id: Tool; label: string; icon: React.ReactNode }[] = [
  { id: 'text', label: 'テキスト', icon: 'T' },
  { id: 'eraser', label: '消しゴム', icon: '◻' },
]

const FONT_SIZES = [12, 16, 24, 36]

export default function Toolbar({
  tool, color, size, fontSize,
  onToolChange, onColorChange, onSizeChange, onFontSizeChange,
  onUndo, onClearPage, canUndo,
}: ToolbarProps) {
  const [hoveredTool, setHoveredTool] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-3 p-3 bg-white border-r border-gray-200 shadow-sm w-16 items-center">
      {/* Tools */}
      <div className="flex flex-col gap-1 w-full">
        {/* Pen button — active for pen or pen-line */}
        {(() => {
          const isPenBase = tool === 'pen' || tool === 'line'
          const isLineMode = tool === 'line' || tool === 'highlighter-line'
          function handlePenClick() {
            if (isPenBase) { onToolChange('none') }
            else if (isLineMode) { onToolChange('line') }
            else { onToolChange('pen') }
            setHoveredTool(null)
          }
          return (
            <div className="relative mx-auto">
              <button onClick={handlePenClick} onMouseEnter={() => setHoveredTool('pen')} onMouseLeave={() => setHoveredTool(null)}
                className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold transition-all
                  ${isPenBase ? 'bg-blue-600 text-white shadow-md scale-105' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                ✏️
              </button>
              {hoveredTool === 'pen' && <Tooltip label={isPenBase ? 'ペン（解除）' : 'ペン'} />}
            </div>
          )
        })()}
        {/* Highlighter button — active for highlighter or highlighter-line */}
        {(() => {
          const isHlBase = tool === 'highlighter' || tool === 'highlighter-line'
          const isLineMode = tool === 'line' || tool === 'highlighter-line'
          function handleHlClick() {
            if (isHlBase) { onToolChange('none') }
            else if (isLineMode) { onToolChange('highlighter-line') }
            else { onToolChange('highlighter') }
            setHoveredTool(null)
          }
          return (
            <div className="relative mx-auto">
              <button onClick={handleHlClick} onMouseEnter={() => setHoveredTool('highlighter')} onMouseLeave={() => setHoveredTool(null)}
                className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold transition-all
                  ${isHlBase ? 'bg-yellow-400 text-white shadow-md scale-105' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                🖊️
              </button>
              {hoveredTool === 'highlighter' && <Tooltip label={isHlBase ? 'マーカー（解除）' : 'マーカー'} />}
            </div>
          )
        })()}
        {/* Straight line modifier — active for both pen-line and highlighter-line */}
        {(() => {
          const isLineMode = tool === 'line' || tool === 'highlighter-line'
          function handleLineClick() {
            if (tool === 'pen') { onToolChange('line') }
            else if (tool === 'highlighter') { onToolChange('highlighter-line') }
            else if (tool === 'line') { onToolChange('pen') }
            else if (tool === 'highlighter-line') { onToolChange('highlighter') }
            else { onToolChange('line') }
            setHoveredTool(null)
          }
          const label = isLineMode ? '直線モード（解除）' : '直線モード'
          return (
            <div className="relative mx-auto">
              <button onClick={handleLineClick} onMouseEnter={() => setHoveredTool('line-mode')} onMouseLeave={() => setHoveredTool(null)}
                className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold transition-all
                  ${isLineMode ? 'bg-blue-600 text-white shadow-md scale-105' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                <LineSvg />
              </button>
              {hoveredTool === 'line-mode' && <Tooltip label={label} />}
            </div>
          )
        })()}
        {/* Text and eraser */}
        {UTIL_TOOLS.map(t => (
          <div key={t.id} className="relative mx-auto">
            <button
              onClick={() => { onToolChange(tool === t.id ? 'none' : t.id); setHoveredTool(null) }}
              onMouseEnter={() => setHoveredTool(t.id)}
              onMouseLeave={() => setHoveredTool(null)}
              className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold transition-all
                ${tool === t.id ? 'bg-blue-600 text-white shadow-md scale-105' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {t.icon}
            </button>
            {hoveredTool === t.id && <Tooltip label={tool === t.id ? `${t.label}（解除）` : t.label} />}
          </div>
        ))}
        {/* Undo */}
        <div className="relative mx-auto">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            onMouseEnter={() => setHoveredTool('undo')}
            onMouseLeave={() => setHoveredTool(null)}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg disabled:opacity-30
              bg-gray-100 hover:bg-gray-200 disabled:cursor-not-allowed transition-colors"
          >
            ↩
          </button>
          {hoveredTool === 'undo' && <Tooltip label="元に戻す (Ctrl+Z)" />}
        </div>
      </div>

      <div className="w-8 h-px bg-gray-200" />

      {/* Font size (text tool only) */}
      {tool === 'text' && (
        <>
          <div className="flex flex-col gap-1 w-full items-center">
            <span className="text-xs text-gray-400">文字</span>
            {FONT_SIZES.map(s => (
              <button
                key={s}
                title={`${s}px`}
                onClick={() => onFontSizeChange(s)}
                className={`w-9 h-7 rounded text-xs font-bold transition-all
                  ${fontSize === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="w-8 h-px bg-gray-200" />
        </>
      )}

      {/* Colors */}
      <div className="flex flex-col gap-1 w-full items-center">
        {COLORS.map(c => (
          <button
            key={c}
            title={c}
            onClick={() => onColorChange(c)}
            className={`w-6 h-6 rounded-full border-2 transition-all hover:scale-110
              ${color === c ? 'border-blue-500 scale-110' : 'border-transparent'}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      <div className="w-8 h-px bg-gray-200" />

      {/* Brush size */}
      <div className="flex flex-col gap-1 items-center">
        {[2, 4, 8, 12].map(s => (
          <button
            key={s}
            title={`サイズ ${s}`}
            onClick={() => onSizeChange(s)}
            className={`rounded-full transition-all hover:scale-110
              ${size === s ? 'bg-blue-600' : 'bg-gray-400'}`}
            style={{ width: Math.max(s * 2, 6), height: Math.max(s * 2, 6) }}
          />
        ))}
      </div>

      <div className="w-8 h-px bg-gray-200" />

      {/* Clear */}
      <div className="relative">
        <button
          onClick={onClearPage}
          onMouseEnter={() => setHoveredTool('clear')}
          onMouseLeave={() => setHoveredTool(null)}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-sm
            bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
        >
          🗑
        </button>
        {hoveredTool === 'clear' && <Tooltip label="このページをクリア" />}
      </div>

    </div>
  )
}
