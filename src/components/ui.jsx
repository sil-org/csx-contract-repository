import AppLayout from './AppLayout'
import { getLinks } from '../navLinks'
import { STATUS_LABELS } from '../lib/format'

export const APP_NAME = 'Contract Repository'

export function Page({ title, actions, children, wide, tabs }) {
  return (
    <AppLayout appName={APP_NAME} links={getLinks()}>
      <div className={`p-4 pt-14 md:pt-8 md:p-8 mx-auto ${wide ? 'max-w-[1600px]' : 'max-w-5xl'}`}>
        {tabs}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <h1 className="font-display text-2xl font-bold text-brand">{title}</h1>
          <div className="flex gap-2">{actions}</div>
        </div>
        {children}
      </div>
    </AppLayout>
  )
}

// `icon`: a lucide-react component rendered in a small rounded chip before the title,
// matching the contract pages' visual language. Omit it for a plain heading (unchanged look).
export function Card({ title, children, actions, id, icon: Icon, meta }) {
  return (
    <section id={id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-5 scroll-mt-4">
      {(title || actions) && (
        <div className="flex items-center gap-2.5 mb-3">
          {Icon && (
            <span className="w-7 h-7 rounded-lg bg-brand/[0.09] text-brand flex items-center justify-center flex-shrink-0">
              <Icon size={15} />
            </span>
          )}
          <h2 className="font-semibold text-gray-800">{title}</h2>
          {meta && <span className="text-xs text-gray-400 ml-1">{meta}</span>}
          <div className="flex gap-2 ml-auto">{actions}</div>
        </div>
      )}
      {children}
    </section>
  )
}

// A row of small stat tiles for an at-a-glance summary above a long record (e.g. status,
// counterparty, amount, next deadline). `facts`: [{ label, value, tone? }], tone 'warn' tints
// the value amber. Renders nothing for fewer than 2 facts.
export function KeyFacts({ facts }) {
  const visible = (facts || []).filter(f => f && f.value != null && f.value !== '')
  if (visible.length < 2) return null
  return (
    <div className="grid gap-px bg-gray-100 border border-gray-100 rounded-xl overflow-hidden mb-5" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(10rem, 1fr))` }}>
      {visible.map((f, i) => (
        <div key={i} className="bg-white px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-0.5">{f.label}</div>
          <div className={`text-sm font-bold ${f.tone === 'warn' ? 'text-amber-700' : 'text-gray-900'}`}>{f.value}</div>
        </div>
      ))}
    </div>
  )
}

// Jump-links to the id'd Card sections on a long page. Pass every possible
// section with `show`: only true ones render, so the nav never links to a
// section that isn't actually on the page. Renders nothing for 0-1 sections.
// orientation="left": a sticky vertical nav for a flex layout (md+), falling back to the
// horizontal bar below md. orientation="top" (default): always the horizontal bar.
// `title`, orientation="left" only: shown above the links, so it stays visible once the
// page's own <h1> has scrolled out of view.
export function SectionNav({ items, orientation = 'top', title }) {
  const visible = items.filter(i => i.show !== false)
  if (visible.length < 2) return null
  const jump = i => e => { e.preventDefault(); document.getElementById(i.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

  const topNav = (
    <nav aria-label="Jump to section" className={`flex flex-wrap gap-x-4 gap-y-1.5 mb-5 pb-3 border-b border-gray-200 text-sm ${orientation === 'left' ? 'md:hidden' : ''}`}>
      {visible.map(i => (
        <a key={i.id} href={`#${i.id}`} className="text-gray-500 hover:text-brand hover:underline" onClick={jump(i)}>{i.label}</a>
      ))}
    </nav>
  )
  if (orientation !== 'left') return topNav

  return (
    <>
      {topNav}
      <nav aria-label="Jump to section" className="hidden md:block w-44 flex-shrink-0 sticky top-8 self-start text-sm">
        {title && <p className="font-semibold text-gray-800 mb-2 truncate" title={title}>{title}</p>}
        <ul className="space-y-1.5 border-l border-gray-200">
          {visible.map(i => (
            <li key={i.id}>
              <a href={`#${i.id}`} className="block pl-3 -ml-px border-l-2 border-transparent text-gray-500 hover:text-brand hover:border-brand hover:bg-brand/[0.04] rounded-r transition-colors py-1" onClick={jump(i)}>
                {i.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  )
}

const STATUS_STYLE = {
  draft: 'bg-gray-100 text-gray-700', active: 'bg-green-100 text-green-800', expired: 'bg-amber-100 text-amber-800',
  terminated: 'bg-red-100 text-red-800', superseded: 'bg-purple-100 text-purple-800', completed: 'bg-blue-100 text-blue-800',
}
export function StatusBadge({ status }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status] || STATUS_STYLE.draft}`}>{STATUS_LABELS[status] || status}</span>
}

export const btnPrimary = 'inline-flex items-center gap-1.5 bg-brand hover:bg-brand-dark text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-50'
export const btnSecondary = 'inline-flex items-center gap-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-50'
export const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand'

// A small uppercase sub-heading for grouping related rows/fields inside one Card
// (e.g. "Term" vs "Notice & termination" inside Dates & renewal).
export function GroupHeading({ children, className = '' }) {
  return <p className={`text-[11px] uppercase tracking-wide text-gray-400 font-semibold mt-4 mb-1 first:mt-0 ${className}`}>{children}</p>
}

export function Field({ label, hint, required, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-semibold text-gray-600 mb-1">{label}{required && <span className="text-red-500"> *</span>}</span>
      {children}
      {hint && <span className="block text-xs text-gray-400 mt-1">{hint}</span>}
    </label>
  )
}

export function ErrorMsg({ error }) {
  if (!error) return null
  return <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">{error.message || String(error)}</div>
}

export function Loading({ what = 'Loading' }) {
  return <p className="text-gray-400 text-sm py-6">{what}…</p>
}

// Annual amounts were negotiated with vendors under confidentiality agreements.
export function ConfidentialNote() {
  return (
    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
      <strong>Confidential.</strong> Amounts here were negotiated under confidentiality agreements — not to be shared with vendors or outside SIL.
    </p>
  )
}
