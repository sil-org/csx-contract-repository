import { LayoutDashboard, FileText, Settings } from 'lucide-react'

// Sidebar links. `roles` limits a link to specific contract roles (see AppLayout).
export function getLinks() {
  return [
    { to: '/dashboard', label: 'Coming due', icon: LayoutDashboard },
    { to: '/contracts', label: 'Contracts', icon: FileText },
    // A single direct link, not an expandable submenu — switching between admin
    // views happens via the horizontal AdminTabs bar each admin page renders
    // instead, matching license-manager's layout (also avoids the submenu being
    // unreachable when the sidebar is collapsed, since there's no toggle to open).
    { to: '/admin', label: 'Admin', icon: Settings, roles: ['admin', 'auditor'] },
  ]
}
