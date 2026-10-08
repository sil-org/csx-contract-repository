import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { getContract, getDirectory, listContracts } from '../lib/contracts'
import { fmtDate, fmtMoney, BINDING_LABELS, RENEWAL_LABELS, PROVISIONS, daysUntil } from '../lib/format'
import { Page, Card, StatusBadge, ErrorMsg, Loading, btnSecondary } from '../components/ui'
import { DocumentsPanel, DecisionPanel, MilestonesPanel, LinksPanel, AccessPanel, RelationshipsPanel, HistoryPanel } from '../components/contract/panels'
import { useAuth, useCan } from '../context/AuthContext'

function Row({ label, children }) {
  if (children == null || children === '' || children === false) return null
  return <div className="py-1.5 flex gap-3 text-sm"><dt className="w-44 flex-shrink-0 text-gray-500">{label}</dt><dd className="text-gray-900 min-w-0 break-words">{children}</dd></div>
}

export default function ContractDetail() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { profile, contractRole } = useAuth()
  const can = useCan()
  const [state, setState] = useState({ loading: true })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    Promise.all([getContract(id), getDirectory(), listContracts()])
      .then(([contract, directory, all]) => setState({ loading: false, contract, directory, all }))
      .catch(error => setState({ loading: false, error }))
  }, [id, version])

  useEffect(() => {
    if (!state.contract) return
    if (params.get('decide')) document.getElementById('decision')?.scrollIntoView({ behavior: 'smooth' })
  }, [state.contract, params])

  if (state.loading) return <Page title="Contract"><Loading /></Page>
  const { contract: c, directory, all } = state
  if (state.error || !c) return <Page title="Contract"><ErrorMsg error={state.error || new Error('Contract not found, or you do not have access to it.')} /></Page>

  const name = pid => directory.find(p => p.id === pid)?.display_name
  const canEdit = contractRole === 'admin' || (contractRole === 'contributor' && (c.owner_id === profile?.id || c.backup_owner_id === profile?.id))
  const d = c.details || {}
  const provisions = PROVISIONS.filter(([k]) => c.provisions?.[k]).map(([, l]) => l)
  const days = daysUntil(c.notice_deadline)

  return (
    <Page title={c.title} actions={canEdit && <Link to={`/contracts/${c.id}/edit`} className={btnSecondary}><Pencil size={14} /> Edit</Link>}>
      <div className="flex flex-wrap items-center gap-2 mb-4 -mt-2">
        <StatusBadge status={c.status} />
        <span className="text-sm text-gray-500">{c.type?.name} · {c.counterparty?.name}</span>
        {c.sensitivity === 'restricted' && <span className="text-[11px] font-semibold text-red-700 bg-red-50 rounded px-1.5 py-0.5">Restricted</span>}
        {c.status === 'active' && c.notice_deadline && days <= 60 && (
          <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${days < 0 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
            {days < 0 ? `Notice deadline passed ${-days} days ago` : `Notice deadline in ${days} days`}
          </span>
        )}
      </div>

      <DecisionPanel contract={c} canEdit={canEdit} directory={directory} profileId={profile?.id} autoOpen={!!params.get('decide')} />

      <Card title="Details">
        <dl className="divide-y divide-gray-50">
          <Row label="Owner">{name(c.owner_id)}</Row>
          <Row label="Backup owner">{name(c.backup_owner_id)}</Row>
          <Row label="Department">{c.department}</Row>
          <Row label="Binding status">{BINDING_LABELS[c.binding_status]}</Row>
          <Row label="Signed">{fmtDate(c.signed_date)}</Row>
          <Row label="Effective">{fmtDate(c.effective_date)}</Row>
          <Row label="Expires">{c.evergreen ? 'Evergreen — no fixed end date' : fmtDate(c.expiration_date)}</Row>
          <Row label="Renewal">{RENEWAL_LABELS[c.renewal_type]}{c.renewal_term ? ` · ${c.renewal_term}` : ''}</Row>
          <Row label="Notice period">{c.notice_period_days ? `${c.notice_period_days} days` : c.expiration_date ? 'None (deadline is the expiry)' : null}</Row>
          <Row label="Notice deadline">{c.notice_deadline && <strong>{fmtDate(c.notice_deadline)}</strong>}</Row>
          <Row label="Termination for convenience">{c.termination_for_convenience == null ? null : c.termination_for_convenience ? `Yes${c.termination_notice_days != null ? ` · ${c.termination_notice_days} days' notice` : ''}` : 'No'}</Row>
          <Row label="Governing law">{c.governing_law}</Row>
          <Row label="Reminders">{c.reminders_enabled ? 'On' : 'Off'}</Row>
          <Row label="Tags">{c.tags?.join(', ')}</Row>
          <Row label="Notes"><span className="whitespace-pre-wrap">{c.notes}</span></Row>
        </dl>
      </Card>

      {(c.value_amount != null || c.payment_terms || c.billing_frequency || c.budget_code) && (
        <Card title="Financial"><dl className="divide-y divide-gray-50">
          <Row label="Value">{c.value_amount != null && fmtMoney(c.value_amount, c.currency)}</Row>
          <Row label="Payment terms">{c.payment_terms}</Row><Row label="Billing frequency">{c.billing_frequency}</Row><Row label="Budget code">{c.budget_code}</Row>
        </dl></Card>
      )}

      {Object.values(d).some(Boolean) && (
        <Card title={`${c.type?.name?.split(' (')[0] || 'Type'} details`}><dl className="divide-y divide-gray-50">
          <Row label="Purpose">{d.purpose}</Row><Row label="Next step">{d.next_step}</Row><Row label="Target date">{d.target_date && fmtDate(d.target_date)}</Row>
          <Row label="Binding clauses">{d.binding_clauses}</Row><Row label="Project">{d.project_name}</Row><Row label="Deliverables">{d.deliverables}</Row>
          <Row label="Vendor contact">{d.vendor_contact}</Row><Row label="SLA summary">{d.sla_summary}</Row>
          <Row label="Certificate expiry">{d.insurance_expiry && fmtDate(d.insurance_expiry)}</Row>
          <Row label="Data-protection terms">{d.data_protection_terms ? 'Present' : null}</Row>
        </dl></Card>
      )}
      {provisions.length > 0 && <Card title="Provisions present"><p className="text-sm">{provisions.join(' · ')}</p></Card>}

      <DocumentsPanel contract={c} canEdit={canEdit} directory={directory} onChange={() => setVersion(v => v + 1)} />
      <MilestonesPanel contract={c} canEdit={canEdit} />
      <LinksPanel contract={c} canEdit={canEdit} profileId={profile?.id} />
      <AccessPanel contract={c} canEdit={canEdit} directory={directory} profileId={profile?.id} />
      <RelationshipsPanel contract={c} allContracts={all} />
      {can.seeAudit && <HistoryPanel contract={c} directory={directory} />}
    </Page>
  )
}
