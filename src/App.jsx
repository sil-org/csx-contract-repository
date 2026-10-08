import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import AuthCallback from './pages/AuthCallback'
import NoAccess from './pages/NoAccess'
import Dashboard from './pages/Dashboard'
import Contracts from './pages/Contracts'
import ContractForm from './pages/ContractForm'
import ContractDetail from './pages/ContractDetail'
import AdminUsers from './pages/admin/Users'
import AdminSettings from './pages/admin/Settings'
import ReminderLog from './pages/admin/ReminderLog'
import AuditLog from './pages/admin/AuditLog'
import RequireAuth from './components/RequireAuth'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/no-access" element={<NoAccess />} />

      <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/contracts" element={<RequireAuth><Contracts /></RequireAuth>} />
      <Route path="/contracts/new" element={<RequireAuth roles={['contributor', 'admin']}><ContractForm /></RequireAuth>} />
      <Route path="/contracts/:id" element={<RequireAuth><ContractDetail /></RequireAuth>} />
      <Route path="/contracts/:id/edit" element={<RequireAuth roles={['contributor', 'admin']}><ContractForm /></RequireAuth>} />

      <Route path="/admin/users" element={<RequireAuth roles={['admin']}><AdminUsers /></RequireAuth>} />
      <Route path="/admin/settings" element={<RequireAuth roles={['admin']}><AdminSettings /></RequireAuth>} />
      <Route path="/admin/reminders" element={<RequireAuth roles={['admin', 'auditor']}><ReminderLog /></RequireAuth>} />
      <Route path="/admin/audit" element={<RequireAuth roles={['admin', 'auditor']}><AuditLog /></RequireAuth>} />
    </Routes>
  )
}
