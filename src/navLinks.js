import { LayoutDashboard, FileText, Settings } from 'lucide-react'

// Sidebar links. `roles` limits a link to specific contract roles (see AppLayout).
export function getLinks() {
  return [
    { to: '/dashboard', label: 'Coming due', icon: LayoutDashboard },
    { to: '/contracts', label: 'Contracts', icon: FileText },
    {
      label: 'Admin', icon: Settings, roles: ['admin', 'auditor'],
      children: [
        { to: '/admin/users', label: 'Users & roles', roles: ['admin'] },
        { to: '/admin/settings', label: 'Settings', roles: ['admin'] },
        { to: '/admin/reminders', label: 'Reminder log', roles: ['admin', 'auditor'] },
        { to: '/admin/audit', label: 'Audit log', roles: ['admin', 'auditor'] },
      ],
    },
  ]
}
