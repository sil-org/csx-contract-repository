import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { inputCls } from './ui'

// Checkbox-list dropdown for filter sidebars. `value`/`onChange` deal in
// arrays of option values; an empty array means "no filter" (all match).
export default function MultiSelect({ options, value, onChange, placeholder = 'All' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const toggle = v => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])
  const label = !value.length ? placeholder
    : value.length === 1 ? (options.find(o => o.value === value[0])?.label ?? value[0])
    : `${value.length} selected`

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`${inputCls} flex items-center justify-between gap-1 text-left bg-white`}
      >
        <span className={`truncate ${value.length ? '' : 'text-gray-400'}`}>{label}</span>
        <ChevronDown size={14} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          {options.map(o => (
            <label key={o.value} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-brand focus:ring-brand/30"
                checked={value.includes(o.value)}
                onChange={() => toggle(o.value)}
              />
              <span className="truncate">{o.label}</span>
            </label>
          ))}
          {!options.length && <p className="px-3 py-1.5 text-xs text-gray-400">No options</p>}
        </div>
      )}
    </div>
  )
}
