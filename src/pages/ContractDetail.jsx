import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { getContract, getDirectory, listContracts } from '../lib/contracts'
import { fmtDate, fmtDateTime, fmtMoney, RENEWAL_LABELS, SIGN_ON_LABELS, PROVISIONS, daysUntil } from '../lib/format'
import { Page, Card, SectionNav, StatusBadge, ErrorMsg, Loading, ConfidentialNote, btnSecondary } from '../components/ui'
import { DocumentsPanel, DecisionPanel, MilestonesPanel, LinksPanel, AccessPanel, RelationshipsPanel, SignatoriesPanel, HistoryPanel } from '../components/contract/panels'
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
  // Milestones/links/relationships decide for themselves whether they have anything to
  // show (depends on data they load async), so they report back here for the section nav.
  const [sectionVisible, setSectionVisible] = useState({})
  const setVisible = key => v => setSectionVisible(s => (s[key] === v ? s : { ...s, [key]: v }))

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

  const hasDecision = c.status === 'active' && !!c.notice_deadline
  const hasFinancial = c.annual_amount != null || c.annual_amount_note || c.value_amount != null || c.payment_terms || c.billing_frequency || c.budget_code
  const hasTypeDetails = Object.values(d).some(Boolean)
  const hasSystemDetails = c.mission_justification || c.administrators || c.pricing_info || c.vendor_contact_note || c.corporate_license != null || c.sign_on_methods?.length > 0 || c.custom_msa
  const navItems = [
    { id: 'decision', label: 'Renewal decision', show: hasDecision },
    { id: 'overview', label: 'Overview' },
    { id: 'dates', label: 'Dates & renewal' },
    { id: 'financial', label: 'Financial', show: hasFinancial },
    { id: 'type-details', label: c.type?.name?.split(' (')[0] || 'Type details', show: hasTypeDetails },
    { id: 'system', label: 'System & subscription', show: hasSystemDetails },
    { id: 'provisions', label: 'Provisions', show: provisions.length > 0 },
    { id: 'documents', label: 'Documents' },
    { id: 'milestones', label: 'Milestones', show: sectionVisible.milestones ?? true },
    { id: 'links', label: 'Working-copy links', show: sectionVisible.links ?? true },
    { id: 'access', label: 'Access', show: c.sensitivity === 'restricted' },
    { id: 'signatories', label: 'Signatory history', show: sectionVisible.signatories ?? true },
    { id: 'relationships', label: 'Related contracts', show: sectionVisible.relationships ?? true },
    { id: 'history', label: 'History', show: can.seeAudit },
  ]

  return (
    <Page title={c.title} actions={canEdit && <Link to={`/contracts/${c.id}/edit`} className={btnSecondary}><Pencil size={14} /> Edit</Link>}>
      <div className="flex flex-wrap items-center gap-2 mb-4 -mt-2">
        <StatusBadge status={c.status} />
        <span className="text-sm text-gray-500">{c.type?.name} · {c.counterparty?.name}</span>
        {c.sensitivity === 'restricted' && <span className="text-[11px] font-semibold text-red-700 bg-red-50 rounded px-1.5 py-0.5" title="Restricted: only the owner, backup owner, named people, admins and auditors can see this contract.">Restricted</span>}
        {c.no_original_exception && (
          <span className="text-[11px] font-semibold text-amber-800 bg-amber-100 rounded px-1.5 py-0.5" title={`Admin exception: no executed original is on file. Reason: ${c.no_original_reason}`}>
            Original not on file
          </span>
        )}
        {c.custom_msa && (
          <span className="text-[11px] font-semibold text-blue-800 bg-blue-50 rounded px-1.5 py-0.5" title='This contract has a custom MSA: a signed copy must be attached (document type "MSA copy") before it can go Active.'>Custom MSA</span>
        )}
        {c.status === 'active' && c.notice_deadline && days <= 60 && (
          <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${days < 0 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
            {days < 0 ? `Notice deadline passed ${-days} days ago` : `Notice deadline in ${days} days`}
          </span>
        )}
      </div>

      <div className="md:flex md:gap-8 md:items-start">
        <SectionNav items={navItems} orientation="left" />
        <div className="flex-1 min-w-0">

      <DecisionPanel contract={c} canEdit={canEdit} directory={directory} profileId={profile?.id} autoOpen={!!params.get('decide')} />

      <Card title="Overview" id="overview">
        <dl className="divide-y divide-gray-50">
          <Row label="System">{c.system_name}</Row>
          <Row label="Owner">{name(c.owner_id)}</Row>
          <Row label="Department manager">{c.department_manager}</Row>
          <Row label="Department manager email">{c.department_manager_email}</Row>
          <Row label="Backup owner">{name(c.backup_owner_id)}</Row>
          <Row label="Department">{c.department}</Row>
          <Row label="Reminders">{c.reminders_enabled ? 'On' : 'Off'}</Row>
          <Row label="Original not on file">{c.no_original_exception && (
            <span className="text-amber-800">
              {c.no_original_reason}
              {c.no_original_exception_set_by && ` — set by ${name(c.no_original_exception_set_by)}`}
              {c.no_original_exception_set_at && ` on ${fmtDateTime(c.no_original_exception_set_at)}`}
            </span>
          )}</Row>
          <Row label="Tags">{c.tags?.join(', ')}</Row>
          <Row label="Notes"><span className="whitespace-pre-wrap">{c.notes}</span></Row>
        </dl>
      </Card>

      <Card title="Dates & renewal" id="dates">
        <dl className="divide-y divide-gray-50">
          <Row label="Initial contract date">{c.initial_contract_date && fmtDate(c.initial_contract_date)}</Row>
          <Row label="Current signatory">{c.signatory_name}</Row>
          <Row label="Signatory email">{c.signatory_email}</Row>
          <Row label="Last renewed">{c.last_renewal_date && fmtDate(c.last_renewal_date)}</Row>
          <Row label="Signed (current term)">{c.signed_date && fmtDate(c.signed_date)}</Row>
          <Row label="Effective">{fmtDate(c.effective_date)}</Row>
          <Row label="Expires / next renewal">{c.evergreen ? 'Evergreen — no fixed end date' : fmtDate(c.expiration_date)}</Row>
          <Row label="Contract length">{c.contract_length_years != null && `${c.contract_length_years} year${c.contract_length_years == 1 ? '' : 's'}`}</Row>
          <Row label="Renewal">{RENEWAL_LABELS[c.renewal_type]}{c.renewal_term ? ` · ${c.renewal_term}` : ''}</Row>
          <Row label="Notice period">{c.notice_period_days ? `${c.notice_period_days} days` : c.expiration_date ? 'None (deadline is the expiry)' : null}</Row>
          <Row label="Notice terms">{c.notice_terms}</Row>
          <Row label="Last day to cancel">{c.notice_deadline && <strong>{fmtDate(c.notice_deadline)}</strong>}</Row>
          <Row label="Termination for convenience">{c.termination_for_convenience == null ? null : c.termination_for_convenience ? `Yes${c.termination_notice_days != null ? ` · ${c.termination_notice_days} days' notice` : ''}` : 'No'}</Row>
          <Row label="Termination date">{c.termination_date ? fmtDate(c.termination_date)
            : (c.expiration_date && c.expiration_date < new Date().toISOString().slice(0, 10) && !c.evergreen
                ? <span className="text-amber-700">Not yet recorded — end date has passed</span> : null)}</Row>
          <Row label="Amended">{c.amended_date && `${fmtDate(c.amended_date)}${c.amendment_description ? ` · ${c.amendment_description}` : ''}`}{!c.amended_date && c.amendment_description}</Row>
        </dl>
      </Card>

      {hasFinancial && (
        <Card title="Financial" id="financial"><ConfidentialNote /><dl className="divide-y divide-gray-50">
          <Row label="Annual amount">{c.annual_amount != null && `${fmtMoney(c.annual_amount, c.currency)} (≈ $${Math.round(c.annual_amount / 1000)}k)`}</Row>
          <Row label="Annual amount: notes">{c.annual_amount_note}</Row>
          <Row label="Total contract value">{c.value_amount != null && fmtMoney(c.value_amount, c.currency)}</Row>
          <Row label="Payment terms">{c.payment_terms}</Row><Row label="Billing frequency">{c.billing_frequency}</Row><Row label="Budget code">{c.budget_code}</Row>
        </dl></Card>
      )}

      {hasTypeDetails && (
        <Card title={`${c.type?.name?.split(' (')[0] || 'Type'} details`} id="type-details"><dl className="divide-y divide-gray-50">
          <Row label="Purpose">{d.purpose}</Row><Row label="Next step">{d.next_step}</Row><Row label="Target date">{d.target_date && fmtDate(d.target_date)}</Row>
          <Row label="Binding clauses">{d.binding_clauses}</Row><Row label="Project">{d.project_name}</Row><Row label="Deliverables">{d.deliverables}</Row>
          <Row label="Vendor contact">{d.vendor_contact}</Row>
        </dl></Card>
      )}
      {hasSystemDetails && (
        <Card title="System and subscription details" id="system"><dl className="divide-y divide-gray-50">
          <Row label="Rationale"><span className="whitespace-pre-wrap">{c.mission_justification}</span></Row>
          <Row label="Administrator(s)">{c.administrators}</Row>
          <Row label="More information / pricing">{c.pricing_info}</Row>
          <Row label="Corporate license">{c.corporate_license == null ? null : c.corporate_license ? 'Yes' : 'No'}</Row>
          <Row label="Sign-on method">{c.sign_on_methods?.length > 0 ? c.sign_on_methods.map(m => SIGN_ON_LABELS[m] || m).join(', ') : null}</Row>
          <Row label="Custom MSA">{c.custom_msa ? 'Yes' : null}</Row>
          <Row label="Vendor contact rule">{c.vendor_contact_note && <strong className="text-amber-800">{c.vendor_contact_note}</strong>}</Row>
        </dl></Card>
      )}
      {provisions.length > 0 && <Card title="Provisions present" id="provisions"><p className="text-sm">{provisions.join(' · ')}</p></Card>}

      <DocumentsPanel contract={c} canEdit={canEdit} directory={directory} onChange={() => setVersion(v => v + 1)} />
      <MilestonesPanel contract={c} canEdit={canEdit} onVisible={setVisible('milestones')} />
      <LinksPanel contract={c} canEdit={canEdit} profileId={profile?.id} onVisible={setVisible('links')} />
      <AccessPanel contract={c} canEdit={canEdit} directory={directory} profileId={profile?.id} />
      <SignatoriesPanel contract={c} canEdit={canEdit} profileId={profile?.id} onVisible={setVisible('signatories')} />
      <RelationshipsPanel contract={c} allContracts={all} onVisible={setVisible('relationships')} />
      {can.seeAudit && <HistoryPanel contract={c} directory={directory} />}
        </div>
      </div>
    </Page>
  )
}
