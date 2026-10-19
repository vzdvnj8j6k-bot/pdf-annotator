'use client'

import React, { useState, useRef, useEffect } from 'react'
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
  studyMode?: boolean
  revealedCount?: number
  onStudyModeToggle?: () => void
  onPrint?: () => void
}

const COLORS = [
  '#000000', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899',
]
const SIZES = [2, 4, 8, 12]
const FONT_SIZES = [12, 16, 24, 36]

// SVG icons for consistent, crisp rendering
function PenIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17l1.5-4.5L13 4a1.5 1.5 0 012 2L6.5 14.5 3 17z" />
      <path d="M11 6l3 3" />
    </svg>
  )
}
function HighlighterIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 16h12" strokeWidth="3" strokeOpacity="0.35" />
      <path d="M7 13L13 5" />
      <path d="M5 15L9 11" />
      <path d="M11 5.5l2.5 2.5" />
    </svg>
  )
}
function TextIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor">
      <path d="M4 5h12M10 5v10M8 15h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  )
}
function EraserIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5L7 13l-3 2 2-3 8-8 1 1z" />
      <path d="M4 16h12" />
      <path d="M7 13l3-3" />
    </svg>
  )
}
function UndoIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9a6 6 0 111 4.5" />
      <path d="M4 5v4h4" />
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 7h10l-1 9H6L5 7z" />
      <path d="M3 7h14" />
      <path d="M8 7V5h4v2" />
    </svg>
  )
}
function LineIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="17" x2="17" y2="3" />
    </svg>
  )
}
function StudyIcon({ active }: { active: boolean }) {
  return active ? (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor">
      <rect x="2" y="2" width="16" height="16" rx="2" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="12" height="16" rx="1" />
      <path d="M7 7h6M7 10h4" />
    </svg>
  )
}
function PrintIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="7" width="12" height="8" rx="1" />
      <path d="M7 7V4h6v3" />
      <path d="M7 12h6" />
      <path d="M7 15h3" />
    </svg>
  )
}

export default function Toolbar({
  tool, color, size, fontSize,
  onToolChange, onColorChange, onSizeChange, onFontSizeChange,
  onUndo, onClearPage, canUndo,
  studyMode = false, revealedCount = 0, onStudyModeToggle, onPrint,
}: ToolbarProps) {
  const isPenBase = tool === 'pen' || tool === 'line'
  const isHlBase = tool === 'highlighter' || tool === 'highlighter-line'
  const isLineMode = tool === 'line' || tool === 'highlighter-line'

  const activePanel: 'pen' | 'highlighter' | 'text' | 'eraser' | null =
    isPenBase ? 'pen' : isHlBase ? 'highlighter' : tool === 'text' ? 'text' : tool === 'eraser' ? 'eraser' : null

  const panelRef = useRef<HTMLDivElement>(null)

  // Close panel when clicking outside toolbar+panel
  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (!panelRef.current) return
      const toolbar = panelRef.current.closest('[data-toolbar]')
      if (toolbar && toolbar.contains(e.target as Node)) return
      if (panelRef.current.contains(e.target as Node)) return
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [])

  function ToolBtn({
    id, label, active, onClick, children, accent = 'blue'
  }: {
    id: string; label: string; active: boolean; onClick: () => void; children: React.ReactNode
    accent?: 'blue' | 'yellow' | 'red'
  }) {
    const accentCls =
      accent === 'yellow' ? 'bg-amber-400 text-white shadow-sm' :
      accent === 'red'    ? 'bg-red-500 text-white shadow-sm' :
                            'bg-blue-600 text-white shadow-sm'
    return (
      <button
        title={label}
        onClick={onClick}
        className={`relative w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all duration-150 group
          ${active
            ? accentCls
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
          }`}
      >
        {children}
        <span className="text-[9px] font-medium leading-none">{label}</span>
        {/* Tooltip on hover (only when not active) */}
        {!active && (
          <span className="pointer-events-none absolute left-full ml-2.5 top-1/2 -translate-y-1/2
            bg-gray-900 text-white text-xs rounded-md px-2 py-1 whitespace-nowrap shadow-lg
            opacity-0 group-hover:opacity-100 transition-opacity delay-300 z-50">
            {label}
            <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
          </span>
        )}
      </button>
    )
  }

  // Sub-panel shown alongside toolbar
  const panelContent = (() => {
    if (!activePanel) return null
    const isPen = activePanel === 'pen'
    const isHl = activePanel === 'highlighter'
    const isText = activePanel === 'text'
    const isEraser = activePanel === 'eraser'
    const accent = isHl ? 'border-amber-300' : 'border-blue-200'
    const ring = isHl ? 'ring-amber-400' : 'ring-blue-500'
    const activeDot = isHl ? 'bg-amber-400' : 'bg-blue-600'
    const activeBtn = isHl ? 'bg-amber-400 text-white' : 'bg-blue-600 text-white'

    return (
      <div
        ref={panelRef}
        className={`absolute left-full top-0 ml-1.5 bg-white border ${accent} rounded-2xl shadow-xl z-40 p-3 flex flex-col gap-3 w-36`}
      >
        {/* Straight-line toggle (pen / highlighter) */}
        {(isPen || isHl) && (
          <div>
            <p className="text-[10px] text-gray-400 font-medium mb-1.5">モード</p>
            <button
              onClick={() => onToolChange(isLineMode
                ? (isPen ? 'pen' : 'highlighter')
                : (isPen ? 'line' : 'highlighter-line')
              )}
              className={`w-full h-8 rounded-lg flex items-center justify-center gap-1.5 text-xs font-medium transition-colors
                ${isLineMode ? activeBtn : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              title={isLineMode ? '直線モード解除' : '直線モード'}
            >
              <LineIcon />
              直線
            </button>
          </div>
        )}

        {/* Color swatches */}
        {!isEraser && (
          <div>
            <p className="text-[10px] text-gray-400 font-medium mb-1.5">カラー</p>
            <div className="grid grid-cols-4 gap-1.5">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => onColorChange(c)}
                  className={`w-6 h-6 rounded-full transition-all hover:scale-110 ${
                    color === c ? `ring-2 ring-offset-1 ${ring} scale-110` : ''
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>
        )}

        {/* Font sizes (text tool) */}
        {isText && (
          <div>
            <p className="text-[10px] text-gray-400 font-medium mb-1.5">サイズ</p>
            <div className="flex flex-col gap-1">
              {FONT_SIZES.map(s => (
                <button
                  key={s}
                  onClick={() => onFontSizeChange(s)}
                  className={`h-7 rounded-lg text-xs font-bold transition-colors
                    ${fontSize === s ? activeBtn : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {s}px
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Stroke / eraser size */}
        {(isPen || isHl || isEraser) && (
          <div>
            <p className="text-[10px] text-gray-400 font-medium mb-1.5">太さ</p>
            <div className="flex items-center justify-between px-1">
              {SIZES.map(s => (
                <button
                  key={s}
                  onClick={() => onSizeChange(s)}
                  title={`${s}px`}
                  className={`rounded-full transition-all hover:scale-125 ${size === s ? activeDot : 'bg-gray-300'}`}
                  style={{ width: Math.max(s * 2.5, 6), height: Math.max(s * 2.5, 6) }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    )
  })()

  return (
    <div data-toolbar className="relative flex flex-col items-center gap-1 py-2 px-1.5 bg-white border-r border-gray-100 shadow-sm w-14 flex-shrink-0">

      {/* Drawing tools group */}
      <div className="flex flex-col gap-1 w-full items-center">
        <ToolBtn id="pen" label="ペン" active={isPenBase}
          onClick={() => onToolChange(isPenBase ? 'none' : 'pen')}>
          <PenIcon />
        </ToolBtn>
        <ToolBtn id="highlighter" label="蛍光" active={isHlBase} accent="yellow"
          onClick={() => onToolChange(isHlBase ? 'none' : 'highlighter')}>
          <HighlighterIcon />
        </ToolBtn>
        <ToolBtn id="text" label="テキスト" active={tool === 'text'}
          onClick={() => onToolChange(tool === 'text' ? 'none' : 'text')}>
          <TextIcon />
        </ToolBtn>
        <ToolBtn id="eraser" label="消去" active={tool === 'eraser'}
          onClick={() => onToolChange(tool === 'eraser' ? 'none' : 'eraser')}>
          <EraserIcon />
        </ToolBtn>
      </div>

      {/* Active sub-panel */}
      {panelContent}

      {/* Divider */}
      <div className="w-7 h-px bg-gray-150 my-0.5" style={{ backgroundColor: '#e8e8e8' }} />

      {/* Utility actions */}
      <div className="flex flex-col gap-1 w-full items-center">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="元に戻す (Ctrl+Z)"
          className="w-11 h-9 rounded-xl flex flex-col items-center justify-center gap-0.5
            text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-25
            disabled:cursor-not-allowed transition-all group relative"
        >
          <UndoIcon />
          <span className="text-[9px] font-medium leading-none">元に戻す</span>
          <span className="pointer-events-none absolute left-full ml-2.5 top-1/2 -translate-y-1/2
            bg-gray-900 text-white text-xs rounded-md px-2 py-1 whitespace-nowrap shadow-lg
            opacity-0 group-hover:opacity-100 transition-opacity delay-300 z-50">
            元に戻す
            <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
          </span>
        </button>

        <button
          onClick={onClearPage}
          title="このページをクリア"
          className="w-11 h-9 rounded-xl flex flex-col items-center justify-center gap-0.5
            text-red-400 hover:bg-red-50 hover:text-red-600 transition-all group relative"
        >
          <TrashIcon />
          <span className="text-[9px] font-medium leading-none">クリア</span>
          <span className="pointer-events-none absolute left-full ml-2.5 top-1/2 -translate-y-1/2
            bg-gray-900 text-white text-xs rounded-md px-2 py-1 whitespace-nowrap shadow-lg
            opacity-0 group-hover:opacity-100 transition-opacity delay-300 z-50">
            ページをクリア
            <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
          </span>
        </button>
      </div>

      {/* Optional: study mode & print at bottom */}
      {(onStudyModeToggle || onPrint) && (
        <>
          <div className="w-7 h-px my-0.5" style={{ backgroundColor: '#e8e8e8' }} />
          <div className="flex flex-col gap-1 w-full items-center">
            {onStudyModeToggle && (
              <button
                onClick={onStudyModeToggle}
                title={studyMode ? `暗記モード解除${revealedCount > 0 ? ` (${revealedCount}表示中)` : ''}` : '暗記モード'}
                className={`w-11 h-9 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all group relative
                  ${studyMode ? 'bg-red-500 text-white shadow-sm' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'}`}
              >
                <StudyIcon active={studyMode} />
                <span className="text-[9px] font-medium leading-none">暗記</span>
                <span className="pointer-events-none absolute left-full ml-2.5 top-1/2 -translate-y-1/2
                  bg-gray-900 text-white text-xs rounded-md px-2 py-1 whitespace-nowrap shadow-lg
                  opacity-0 group-hover:opacity-100 transition-opacity delay-300 z-50">
                  {studyMode ? '暗記モード解除' : '暗記モード'}
                  <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
                </span>
              </button>
            )}
            {onPrint && (
              <button
                onClick={onPrint}
                title="印刷"
                className="w-11 h-9 rounded-xl flex flex-col items-center justify-center gap-0.5
                  text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all group relative"
              >
                <PrintIcon />
                <span className="text-[9px] font-medium leading-none">印刷</span>
                <span className="pointer-events-none absolute left-full ml-2.5 top-1/2 -translate-y-1/2
                  bg-gray-900 text-white text-xs rounded-md px-2 py-1 whitespace-nowrap shadow-lg
                  opacity-0 group-hover:opacity-100 transition-opacity delay-300 z-50">
                  印刷
                  <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
                </span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
