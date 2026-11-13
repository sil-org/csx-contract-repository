import { Link, useLocation } from 'react-router-dom'
import { useCan } from '../context/AuthContext'

// Horizontal subnav for Admin pages, matching license-manager's AdminTabs —
// replaces the sidebar's old nested Admin submenu (see navLinks.js), which
// had no way to open on click when the sidebar was collapsed.
const TABS = [
  { to: '/admin/users', label: 'Users & roles', adminOnly: true },
  { to: '/admin/settings', label: 'Settings', adminOnly: true },
  { to: '/admin/reminders', label: 'Reminder log' },
  { to: '/admin/audit', label: 'Audit log' },
]

export default function AdminTabs() {
  const { pathname } = useLocation()
  const { admin } = useCan()
  const tabs = TABS.filter(t => !t.adminOnly || admin)
  return (
    <div className="border-b border-gray-200 mb-6 pt-1">
      <nav className="flex gap-6 w-max">
        {tabs.map(tab => (
          <Link
            key={tab.to}
            to={tab.to}
            className={`py-3.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors
              ${pathname === tab.to
                ? 'border-brand text-brand'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
