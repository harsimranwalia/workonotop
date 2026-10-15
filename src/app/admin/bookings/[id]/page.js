'use client'
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle } from 'lucide-react'
import CardLinkPanel from '@/components/admin/CardLinkPanel'
import JobLinkAdminPanel from '@/components/admin/JobLinkAdminPanel'
import { useAdminTheme } from '../../layout'

export default function BookingDetailsPage({ params }) {
  const router = useRouter()
  const { isDarkMode } = useAdminTheme()
  const [booking, setBooking] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [toast, setToast] = useState(null)
  const [tradespeople, setTradespeople] = useState([])
  const [selectedProvider, setSelectedProvider] = useState('')
  const [commissionPct, setCommissionPct] = useState('')
  const [isEditingCommission, setIsEditingCommission] = useState(false)
  const [savingCommission, setSavingCommission] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [showOverrideModal, setShowOverrideModal] = useState(false)
  const [overrideData, setOverrideData] = useState({ worker_count: 1, actual_duration_minutes: 0, reason: '' })
  const [overriding, setOverriding] = useState(false)

  const unwrappedParams = React.use(params)
  const bookingId = unwrappedParams.id

  useEffect(() => {
    fetchBooking()
    loadTradespeople()
  }, [bookingId])

  const fetchBooking = async () => {
    try {
      const res = await fetch(`/api/bookings/${bookingId}`)
      const data = await res.json()
      if (data.success) {
        setBooking(data.data)
        setSelectedProvider(data.data.provider_id || '')
        if (data.data.commission_percent != null) setCommissionPct(String(data.data.commission_percent))
      } else {
        notify('error', 'Booking not found')
      }
    } catch {
      notify('error', 'Failed to load booking')
    } finally {
      setLoading(false)
    }
  }

  const loadTradespeople = async () => {
    try {
      const res = await fetch('/api/provider?status=active')
      const data = await res.json()
      if (data.success) setTradespeople(data.data || [])
    } catch { }
  }

  const notify = (type, message) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3500)
  }

  const updateBooking = async (body, successMsg) => {
    setUpdating(true)
    try {
      const res = await fetch(`/api/bookings?id=${booking.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (data.success) {
        notify('success', successMsg)
        fetchBooking()
      } else {
        notify('error', data.message || 'Failed to update')
      }
    } catch {
      notify('error', 'Request failed')
    } finally {
      setUpdating(false)
    }
  }

  const saveCommission = async () => {
    const pct = parseFloat(commissionPct)
    if (isNaN(pct) || pct < 0 || pct > 100) {
      notify('error', 'Enter a valid percentage (0–100)')
      return
    }
    setSavingCommission(true)
    try {
      const res = await fetch(`/api/bookings?id=${booking.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commission_percent: pct })
      })
      const data = await res.json()
      if (data.success) {
        notify('success', `Commission set to ${pct}%`)
        fetchBooking()
      } else {
        notify('error', data.message || 'Failed to set commission')
      }
    } catch {
      notify('error', 'Request failed')
    } finally {
      setSavingCommission(false)
      setIsEditingCommission(false)
    }
  }

  const handleOverrideSubmit = async () => {
    if (!overrideData.reason) {
      notify('error', 'A reason is required to update final details')
      return
    }
    setOverriding(true)
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/override`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(overrideData)
      })
      const data = await res.json()
      if (data.success) {
        notify('success', 'Job details updated successfully')
        setShowOverrideModal(false)
        fetchBooking()
      } else {
        notify('error', data.message || 'Failed to update details')
      }
    } catch {
      notify('error', 'Request failed')
    } finally {
      setOverriding(false)
    }
  }

  const assignProvider = async () => {
    if (!selectedProvider) {
      notify('error', 'Please select a provider')
      return
    }
    if (booking.commission_percent == null) {
      notify('error', '⚠️ Set commission first before assigning provider')
      return
    }
    await updateBooking(
      { provider_id: selectedProvider, status: 'matching' },
      'Provider assigned & status set to Matching'
    )
  }

  // Restart: clears provider, resets all job fields, photos & timer via PUT
  const restartBooking = async () => {
    if (!confirm('Restart booking? This will remove the current provider and reset all job data.')) return
    await updateBooking(
      { provider_id: null, status: 'pending' },
      'Booking restarted — set commission and assign a new provider'
    )
  }

  const fmt = (n) => parseFloat(n || 0).toFixed(2)
  const commissionSet = booking?.commission_percent != null

  const getPhotoSrc = (url) => url?.startsWith('http') ? url : `${process.env.NEXT_PUBLIC_API_URL || ''}${url}`

  const formatDateTime = (d) => {
    if (!d) return '—'
    try {
      const date = new Date(d)
      if (isNaN(date.getTime())) return '—'
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch { return '—' }
  }

  const getStatusLabel = (s) => {
    const map = {
      in_progress: 'In Progress',
      awaiting_approval: 'Awaiting Approval',
      not_started: 'Not Started'
    }
    return map[s] || (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  const card = isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-gray-200'
  const lbl = isDarkMode ? 'text-slate-400' : 'text-gray-500'
  const val = isDarkMode ? 'text-white' : 'text-gray-900'
  const muted = isDarkMode ? 'bg-slate-800' : 'bg-gray-50'
  const divCls = isDarkMode ? 'border-slate-700' : 'border-gray-100'
  const inputCls = isDarkMode
    ? 'bg-slate-800 text-white border-slate-700 focus:border-teal-500'
    : 'bg-white text-gray-900 border-gray-300 focus:border-teal-500'

  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    matching: 'bg-orange-100 text-orange-800 border-orange-200',
    confirmed: 'bg-blue-100 text-blue-800 border-blue-200',
    in_progress: 'bg-purple-100 text-purple-800 border-purple-200',
    awaiting_approval: 'bg-amber-100 text-amber-800 border-amber-200',
    completed: 'bg-green-100 text-green-800 border-green-200',
    disputed: 'bg-red-100 text-red-800 border-red-200',
    cancelled: 'bg-red-100 text-red-800 border-red-200',
  }

  const payColors = {
    pending: 'bg-yellow-100 text-yellow-800',
    authorized: 'bg-blue-100 text-blue-800',
    paid: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    refunded: 'bg-purple-100 text-purple-800'
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-teal-500 border-t-transparent" />
    </div>
  )

  if (!booking) return (
    <div className="p-6 text-center">
      <p className="text-gray-500 mb-4">Booking not found</p>
      <button onClick={() => router.back()} className="px-4 py-2 bg-teal-500 text-white rounded-lg text-sm">Go Back</button>
    </div>
  )

  return (
    <div className="p-3 sm:p-4 lg:p-6 max-w-[1400px] mx-auto">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-xl text-sm font-medium flex items-center gap-2 max-w-xs sm:max-w-sm ${toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'} text-white`}>
          {toast.type === 'success' ? '✓' : '✕'} {toast.message}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-6 text-white text-4xl font-light" onClick={() => setLightbox(null)}>×</button>
          <img src={lightbox} alt="Full size" className="max-w-full max-h-full object-contain rounded-xl" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {/* Override Modal */}
      {showOverrideModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-2xl p-6 ${card}`}>
            <h3 className={`text-lg font-bold mb-4 ${val}`}>Edit Final Job Details</h3>
            <div className="space-y-4">
              <div>
                <label className={`block text-sm mb-1 ${lbl}`}>Cleaners Count</label>
                <input type="number" min="1" value={overrideData.worker_count} onChange={e => setOverrideData({...overrideData, worker_count: parseInt(e.target.value) || 1})} className={`w-full p-2.5 rounded-lg border ${inputCls}`} />
              </div>
              <div>
                <label className={`block text-sm mb-1 ${lbl}`}>Actual Duration (Minutes)</label>
                <input type="number" min="0" value={overrideData.actual_duration_minutes} onChange={e => setOverrideData({...overrideData, actual_duration_minutes: parseInt(e.target.value) || 0})} className={`w-full p-2.5 rounded-lg border ${inputCls}`} />
              </div>
              <div>
                <label className={`block text-sm mb-1 ${lbl}`}>Reason for change (Required for Audit Log)</label>
                <textarea rows="3" value={overrideData.reason} onChange={e => setOverrideData({...overrideData, reason: e.target.value})} className={`w-full p-2.5 rounded-lg border ${inputCls}`} placeholder="E.g. Correcting forgot to stop timer..."></textarea>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowOverrideModal(false)} className={`px-4 py-2 rounded-lg font-medium text-sm border ${divCls} ${lbl} hover:bg-gray-100`}>Cancel</button>
              <button onClick={handleOverrideSubmit} disabled={overriding || !overrideData.reason} className="px-4 py-2 rounded-lg bg-teal-600 text-white font-medium text-sm hover:bg-teal-700 disabled:opacity-50">{overriding ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Page Header */}
      <div className="mb-5 flex items-start gap-3 flex-wrap">
        <button onClick={() => router.back()} className={`p-2 rounded-lg transition flex-shrink-0 ${isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-gray-100'}`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className={`text-xl sm:text-2xl font-bold ${val} truncate`}>Booking Details</h1>
          <p className={`text-xs font-mono mt-0.5 ${lbl}`}>{booking.booking_number}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${statusColors[booking.status] || 'bg-gray-100 text-gray-800 border-gray-200'}`}>
            {getStatusLabel(booking.status)}
          </span>
          <span className={`px-3 py-1.5 rounded-full text-xs font-semibold ${payColors[booking.payment_status] || 'bg-gray-100 text-gray-800'}`}>
            {(booking.payment_status || 'pending').toUpperCase()}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-5">

        {/* ── Main Column ── */}
        <div className="xl:col-span-2 space-y-4 sm:space-y-5">

          {/* Customer Info */}
          <Card card={card} icon="👤" title="Customer Information" val={val}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Full Name" value={`${booking.customer_first_name} ${booking.customer_last_name}`} lbl={lbl} val={val} />
              <Field label="Email" value={booking.customer_email} lbl={lbl} val={val} />
              <Field label="Phone" value={booking.customer_phone || '—'} lbl={lbl} val={val} />
              <Field label="User ID" value={`#${booking.user_id || 'Guest'}`} lbl={lbl} val={val} />
            </div>
          </Card>

          {/* Service & Pricing */}
          <Card card={card} icon="🔧" title="Service & Pricing" val={val}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Service" value={booking.service_name} lbl={lbl} val={val} />
              <Field label="Category" value={booking.category_name || '—'} lbl={lbl} val={val} />
              <Field label="Base Price" value={`$${fmt(booking.service_price)}`} lbl={lbl} val={val} />
              <Field label="Overtime Rate" value={booking.additional_price > 0 ? `$${fmt(booking.additional_price)}/hr` : 'Not set'} lbl={lbl} val={val} />
              <Field label="Standard Duration" value={booking.standard_duration_minutes ? `${booking.standard_duration_minutes} min` : (booking.service_duration ? `${booking.service_duration} min` : '—')} lbl={lbl} val={val} />
              <Field label="Authorized Amount" value={booking.authorized_amount ? `$${fmt(booking.authorized_amount)}` : '—'} lbl={lbl} val={val} />
            </div>
          </Card>

          {/* Job Description */}
          {(booking.job_description || booking.timing_constraints || booking.instructions) && (
            <Card card={card} icon="📝" title="Job Description & Instructions" val={val}>
              <div className="space-y-3">
                {booking.job_description && (
                  <div>
                    <p className={`text-xs font-medium mb-1 ${lbl}`}>Description</p>
                    <div className={`p-3 rounded-xl border ${divCls} ${muted} text-sm ${val} leading-relaxed break-all break-words`}>{booking.job_description}</div>
                  </div>
                )}
                {booking.timing_constraints && (
                  <div>
                    <p className={`text-xs font-medium mb-1 ${lbl}`}>Timing Constraints</p>

                    <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-800 flex gap-2">
                      <span className="flex-shrink-0">⏰</span>
                      <span className="break-all break-words min-w-0">
                        {booking.timing_constraints}
                      </span>
                    </div>
                  </div>
                )}
                {booking.instructions && (
                  <div>
                    <p className={`text-xs font-medium mb-1 ${lbl}`}>Special Instructions</p>
                    <div className="p-3 rounded-xl border border-blue-200 bg-blue-50 text-sm text-blue-800 flex gap-2 break-all break-words">
                      <span className="flex-shrink-0">📌</span><span>{booking.instructions}</span>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Payment Information */}
          <Card card={card} icon="💳" title="Payment Information" val={val}>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className={`text-sm ${lbl}`}>Payment Status</span>
                <span className={`px-3 py-1.5 rounded-full text-xs font-semibold ${payColors[booking.payment_status] || 'bg-gray-100 text-gray-800'}`}>
                  {(booking.payment_status || 'pending').toUpperCase()}
                </span>
              </div>
              <div className={`rounded-xl border ${divCls} ${muted} p-3 sm:p-4 space-y-2`}>
                <Row label="Service Base Price" value={`$${fmt(booking.service_price)}`} lbl={lbl} valCls={val} />
                {commissionSet && (
                  <>
                    <Row label={`Platform Commission (${booking.commission_percent}%)`} value={`$${fmt(booking.platform_amount || (booking.service_price * booking.commission_percent / 100))}`} lbl={lbl} valCls="text-teal-600" />
                    <Row label="Provider Base Amount" value={`$${fmt(booking.provider_amount || (booking.service_price * (1 - booking.commission_percent / 100)))}`} lbl={lbl} valCls={val} />
                  </>
                )}
                <div className={`pt-2 mt-1 border-t ${divCls} flex justify-between`}>
                  <span className={`text-sm font-semibold ${val}`}>Provider Earns (Final)</span>
                  <span className="text-sm font-bold text-green-600">${fmt(booking.final_provider_amount || booking.provider_amount || booking.service_price)}</span>
                </div>
                <div className={`pt-2 border-t ${divCls} flex justify-between`}>
                  <span className={`text-sm font-semibold ${val}`}> customer authorized</span>
                  <span className={`text-sm font-bold ${val}`}>${fmt(booking.authorized_amount || booking.service_price)}</span>
                </div>
              </div>
              {booking.payment_intent_id && (
                <div>
                  <p className={`text-xs mb-1.5 ${lbl}`}>Stripe Payment Intent ID</p>
                  <div className={`p-2.5 rounded-lg font-mono text-xs ${muted} ${val} break-all border ${divCls}`}>{booking.payment_intent_id}</div>
                </div>
              )}
            </div>
          </Card>

          <CardLinkPanel bookingId={bookingId} isDarkMode={isDarkMode} />

          <JobLinkAdminPanel bookingId={bookingId} isDarkMode={isDarkMode} />

          {/* Schedule */}
          <Card card={card} icon="📅" title="Schedule" val={val}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field
                label="Job Dates"
                value={booking.job_date
                  ? (booking.job_date.includes(',')
                    ? booking.job_date.split(',').map(d => new Date(d.trim()).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })).join(' • ')
                    : new Date(booking.job_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))
                  : '—'}
                lbl={lbl} val={val}
              />
              <div>
                <p className={`text-xs mb-1 ${lbl}`}>Time Slots</p>
                <div className="flex flex-wrap gap-1">
                  {(Array.isArray(booking.job_time_slot) ? booking.job_time_slot : [booking.job_time_slot])
                    .filter(Boolean).map((s, i) => (
                      <span key={i} className="px-2 py-1 bg-teal-100 text-teal-800 rounded-lg text-xs font-medium capitalize">{s}</span>
                    ))}
                </div>
              </div>
            </div>
            <div className={`mt-4 pt-4 border-t ${divCls} grid grid-cols-2 sm:grid-cols-3 gap-3`}>
              <SmallField label="Accepted At" value={formatDateTime(booking.accepted_at)} lbl={lbl} val={val} />
              <SmallField label="Start Time" value={formatDateTime(booking.start_time)} lbl={lbl} val={val} />
              <SmallField label="End Time" value={booking.end_time ? formatDateTime(booking.end_time) : (['running', 'paused'].includes(booking.job_timer_status) ? 'In Progress' : '—')} lbl={lbl} val={val} />
              <SmallField label="Timer Status" value={getStatusLabel(booking.job_timer_status)} lbl={lbl} val={val} />
              <SmallField
                label="Actual Duration"
                value={booking.actual_duration_minutes > 0 ? `${booking.actual_duration_minutes} min` : '—'}
                lbl={lbl}
                val={booking.actual_duration_minutes > 0 ? 'text-teal-600 font-bold' : val}
              />
              <SmallField
                label="Standard Duration"
                value={booking.standard_duration_minutes ? `${booking.standard_duration_minutes} min` : (booking.service_duration ? `${booking.service_duration} min` : '—')}
                lbl={lbl} val={val}
              />
            </div>
          </Card>

          {/* Time Tracking Audit */}
          {booking.status !== 'pending' && booking.status !== 'matching' && booking.status !== 'confirmed' && (
            <Card card={card} icon="⏱️" title="Time Tracking & Headcount Audit" val={val}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className={`p-4 rounded-xl border ${divCls} ${muted}`}>
                  <h3 className={`text-sm font-semibold mb-3 ${val}`}>System Recorded (Immutable)</h3>
                  <div className="space-y-2">
                    <Row label="Worker Count" value={booking.worker_count || 1} lbl={lbl} valCls={val} />
                    <Row label="Timer Duration" value={booking.actual_duration_minutes ? `${booking.actual_duration_minutes} min` : '—'} lbl={lbl} valCls={val} />
                  </div>
                </div>
                <div className={`p-4 rounded-xl border ${divCls} ${muted}`}>
                  <h3 className={`text-sm font-semibold mb-3 ${val}`}>Provider Submitted</h3>
                  <div className="space-y-2">
                    <Row label="Worker Count" value={booking.submitted_headcount || booking.worker_count || 1} lbl={lbl} valCls={val} />
                    <Row label="Timer Duration" value={booking.submitted_duration_minutes ? `${booking.submitted_duration_minutes} min` : (booking.actual_duration_minutes ? `${booking.actual_duration_minutes} min` : '—')} lbl={lbl} valCls={val} />
                  </div>
                </div>
              </div>
              {booking.adjustment_reason && (
                <div className="mt-4 p-3 rounded-xl border border-amber-200 bg-amber-50">
                  <p className="text-xs font-semibold text-amber-800 mb-1">Reason for adjustment:</p>
                  <p className="text-sm text-amber-900">{booking.adjustment_reason}</p>
                </div>
              )}
            </Card>
          )}

          {/* Location */}
          <Card card={card} icon="📍" title="Location & Access" val={val}>
            <div className={`p-3 rounded-xl border ${divCls} bg-teal-50 mb-4`}>
              <p className={`text-sm font-medium ${val}`}>
                {[booking.address_line1, booking.address_line2, booking.city, booking.postal_code].filter(Boolean).join(', ')}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[['🅿️ Parking', booking.parking_access], ['🛗 Elevator', booking.elevator_access], ['🐕 Pets', booking.has_pets]].map(([label, active]) => (
                <div key={label} className={`p-2 sm:p-2.5 rounded-xl border text-center text-xs font-medium
                  ${active ? 'bg-green-50 border-green-200 text-green-700' : isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-500' : 'bg-gray-50 border-gray-200 text-gray-400'}`}>
                  {label} {active ? '✓' : '✗'}
                </div>
              ))}
            </div>
          </Card>

          {/* Photos */}
          <Card card={card} icon="📷" title="Job Photos" val={val}>
            <div className="space-y-5">
              <div className="flex gap-2 flex-wrap">
                {[['Before Photos', booking.before_photos_uploaded], ['After Photos', booking.after_photos_uploaded]].map(([label, done]) => (
                  <div key={label} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${done ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                    {done ? '✓' : '○'} {label}
                  </div>
                ))}
              </div>
              <PhotoSection label="BEFORE" count={booking.before_photos?.length || 0} color="orange" photos={booking.before_photos || []} getPhotoSrc={getPhotoSrc} setLightbox={setLightbox} isDarkMode={isDarkMode} />
              <PhotoSection label="AFTER" count={booking.after_photos?.length || 0} color="green" photos={booking.after_photos || []} getPhotoSrc={getPhotoSrc} setLightbox={setLightbox} isDarkMode={isDarkMode} />
              {booking.photos?.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${isDarkMode ? 'bg-slate-700 text-slate-300' : 'bg-gray-100 text-gray-600'}`}>
                      CUSTOMER UPLOADS ({booking.photos.length})
                    </span>
                    <div className={`flex-1 h-px ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {booking.photos.map((url, i) => (
                      <PhotoThumb key={i} src={getPhotoSrc(url)} alt={`Upload ${i + 1}`} onClick={() => setLightbox(getPhotoSrc(url))} isDarkMode={isDarkMode} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* ── Sidebar Column ── */}
        <div className="space-y-4 sm:space-y-5">

          {/* Commission */}
          <div className={`rounded-xl shadow-sm border p-4 sm:p-5 ${card}`}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">💰</span>
              <h2 className={`text-base font-semibold ${val}`}>Commission</h2>
              {commissionSet && !isEditingCommission && (
                <span className="ml-auto flex items-center gap-1 text-xs text-green-600 font-medium">
                  <span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Live
                </span>
              )}
            </div>

            {commissionSet && !isEditingCommission ? (
              <div className="rounded-lg bg-green-50 border border-green-200 p-4 relative overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-sm ${lbl}`}>Commission Rate</span>
                  <button
                    onClick={() => setIsEditingCommission(true)}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white text-teal-600 border border-teal-200 text-[10px] font-bold uppercase tracking-wider hover:bg-teal-50 transition-colors"
                  >
                    ✏️ Edit
                  </button>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl font-bold text-green-600">{booking.commission_percent}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-xs ${lbl}`}>Platform earns</span>
                  <span className="text-sm font-semibold text-green-600">${fmt(booking.platform_amount || (booking.service_price * booking.commission_percent / 100))}</span>
                </div>
              </div>
            ) : (
              <div>
                <p className={`text-xs mb-3 ${lbl}`}>
                  {isEditingCommission ? 'Update commission for this booking.' : 'Set commission to make this job visible to providers.'}
                </p>
                <div className="flex gap-2 mb-3">
                  <div className="relative flex-1">
                    <input
                      type="number" min="0" max="100" step="0.5"
                      value={commissionPct} onChange={e => setCommissionPct(e.target.value)}
                      placeholder="e.g. 20"
                      className={`w-full pl-3 pr-8 py-2.5 rounded-xl border text-sm outline-none transition focus:ring-2 focus:ring-teal-200 ${inputCls}`}
                    />
                    <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-sm ${lbl}`}>%</span>
                  </div>
                  <div className="flex gap-2">
                    {isEditingCommission && (
                      <button onClick={() => { setIsEditingCommission(false); setCommissionPct(String(booking.commission_percent)) }}
                        className={`p-2.5 rounded-xl border ${divCls} ${lbl} hover:bg-gray-100 transition`}>
                        ✕
                      </button>
                    )}
                    <button onClick={saveCommission} disabled={savingCommission || commissionPct === ''}
                      className="px-4 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-semibold hover:bg-teal-700 transition disabled:opacity-50">
                      {savingCommission ? '…' : (isEditingCommission ? 'Update' : 'Save')}
                    </button>
                  </div>
                </div>
                {!commissionSet && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex gap-2">
                    <span className="text-amber-600 flex-shrink-0">⚠️</span>
                    <div>
                      <p className="text-xs font-semibold text-amber-800">Commission not set</p>
                      <p className="text-xs text-amber-700 mt-0.5">Job is hidden from providers.</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Provider Assignment */}
          <div className={`rounded-xl shadow-sm border p-4 sm:p-5 ${card}`}>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">👷</span>
              <h2 className={`text-base font-semibold ${val}`}>Provider Assignment</h2>
            </div>
            {booking.provider_name ? (
              <div className="bg-teal-50 p-3 rounded-xl border border-teal-200 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {booking.provider_name?.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold ${val} truncate`}>{booking.provider_name}</p>
                    <p className={`text-xs ${lbl}`}>
                      {booking.accepted_at ? `Accepted ${formatDateTime(booking.accepted_at)}` : 'Manually assigned'}
                    </p>
                  </div>
                </div>
                <div className={`pt-2 border-t border-teal-200 space-y-1`}>
                  {booking.provider_email && <p className={`text-xs ${lbl} truncate`}>📧 {booking.provider_email}</p>}
                  {booking.provider_phone && <p className={`text-xs ${lbl}`}>📱 {booking.provider_phone}</p>}
                  {booking.provider_rating > 0 && <p className={`text-xs ${lbl}`}>⭐ {parseFloat(booking.provider_rating).toFixed(1)} rating</p>}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className={`text-xs ${lbl}`}>Providers can self-assign once commission is set, or assign manually.</p>
                {!commissionSet && (
                  <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-xs text-amber-700 flex items-center gap-1"><span>⚠️</span> Set commission first</p>
                  </div>
                )}
                <select value={selectedProvider} onChange={e => setSelectedProvider(e.target.value)} disabled={updating}
                  className={`w-full px-3 py-2.5 rounded-xl border text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-200 ${inputCls}`}>
                  <option value="">Select a provider</option>
                  {tradespeople.map(p => (
                    <option key={p.id} value={p.id}>{p.name} {p.rating ? `(${p.rating})` : ''}</option>
                  ))}
                </select>
                <button onClick={assignProvider} disabled={!selectedProvider || updating || !commissionSet}
                  className={`w-full py-2.5 rounded-xl text-sm font-semibold transition
                    ${!commissionSet ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-teal-600 text-white hover:bg-teal-700'}`}>
                  {!commissionSet ? 'Set Commission First' : (updating ? 'Assigning…' : 'Assign Provider')}
                </button>
              </div>
            )}
          </div>

          {/* Status Timeline */}
          <div className={`rounded-xl shadow-sm border p-4 sm:p-5 ${card}`}>
            <h2 className={`text-base font-semibold mb-4 ${val}`}>Status Timeline</h2>
            {booking.status_history?.length > 0 ? (
              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {booking.status_history.map((item, i) => (
                  <div key={i} className="relative pl-4 pb-3 border-l-2 border-teal-500 last:pb-0">
                    <div className="absolute -left-1.5 top-0 w-3 h-3 rounded-full bg-teal-500" />
                    <p className={`text-xs font-semibold ${val}`}>{getStatusLabel(item.status)}</p>
                    {item.notes && <p className={`text-xs italic mt-0.5 ${lbl} break-words`}>{item.notes}</p>}
                    <p className={`text-[10px] mt-0.5 ${lbl}`}>{new Date(item.created_at).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className={`text-sm ${lbl}`}>No history yet</p>
            )}
          </div>

          {/* Update Status — Disputed only */}
          <div className={`rounded-xl shadow-sm border p-4 sm:p-5 ${card}`}>
            <h2 className={`text-base font-semibold mb-3 ${val}`}>Update Status</h2>

            {booking.status === 'disputed' ? (
              <div className="space-y-3">
                {/* Dispute info banner */}
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-xs font-semibold text-red-800 mb-0.5">⚠️ Booking Disputed</p>
                  <p className="text-xs text-red-600">
                    Restart to remove the current provider. The booking will return to pending and a new provider can accept it from Available Jobs.
                  </p>
                </div>

                {/* Single Restart button */}
                <button
                  onClick={restartBooking}
                  disabled={updating}
                  className="w-full px-4 py-3 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {updating ? (
                    <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Restarting…</>
                  ) : (
                    <>↺ Restart Booking</>
                  )}
                </button>

                <p className={`text-xs text-center ${lbl}`}>
                  This will clear the provider, reset all photos & timer, and set status back to Pending.
                </p>
              </div>
            ) : (
              <p className={`text-sm ${lbl}`}>
                Dispute resolution is only available when the booking status is <span className="font-medium text-red-500">Disputed</span>.
              </p>
            )}
          </div>

          {/* Booking Meta */}
          <div className={`rounded-xl shadow-sm border p-4 sm:p-5 ${card}`}>
            <h2 className={`text-base font-semibold mb-3 ${val}`}>Booking Meta</h2>
            <div className="space-y-2">
              <Field label="Booking ID" value={`#${booking.id}`} lbl={lbl} val={val} />
              <Field label="Service ID" value={`#${booking.service_id}`} lbl={lbl} val={val} />
              <Field label="Created" value={formatDateTime(booking.created_at)} lbl={lbl} val={val} />
              <Field label="Last Updated" value={formatDateTime(booking.updated_at)} lbl={lbl} val={val} />
              </div>
              {booking.status === 'completed' && (
              <button 
                onClick={() => {
                  setOverrideData({ worker_count: booking.worker_count || 1, actual_duration_minutes: booking.actual_duration_minutes || 0, reason: '' });
                  setShowOverrideModal(true);
                }}
                className="w-full mt-4 py-2.5 rounded-xl border border-teal-500 text-teal-600 text-sm font-semibold hover:bg-teal-50 transition"
              >
                ✏️ Edit Final Job Details
              </button>
              )}
            </div>

        </div>
      </div>
    </div>
  )
}

// ── Helper Components ─────────────────────────────────────────────────────────

function Card({ card, icon, title, val, children }) {
  return (
    <div className={`rounded-xl shadow-sm border p-4 sm:p-5 ${card}`}>
      <h2 className={`text-base font-semibold mb-4 flex items-center gap-2 ${val}`}>
        <span>{icon}</span> {title}
      </h2>
      {children}
    </div>
  )
}

function Field({ label, value, lbl, val }) {
  return (
    <div>
      <p className={`text-xs mb-0.5 ${lbl}`}>{label}</p>
      <p className={`text-sm font-medium ${val} break-all break-words`}>{value || '—'}</p>
    </div>
  )
}

function SmallField({ label, value, lbl, val }) {
  return (
    <div>
      <p className={`text-[10px] uppercase tracking-wide mb-0.5 ${lbl}`}>{label}</p>
      <p className={`text-xs font-medium ${val}`}>{value || '—'}</p>
    </div>
  )
}

function Row({ label, value, lbl, valCls }) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span className={`text-sm ${lbl} flex-1`}>{label}</span>
      <span className={`text-sm font-semibold ${valCls} flex-shrink-0`}>{value}</span>
    </div>
  )
}

function PhotoSection({ label, count, color, photos, getPhotoSrc, setLightbox, isDarkMode }) {
  const colorMap = {
    orange: 'bg-orange-100 text-orange-700',
    green: 'bg-green-100 text-green-700',
  }
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${colorMap[color]}`}>{label} ({count})</span>
        <div className={`flex-1 h-px ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`} />
      </div>
      {photos.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map((p, i) => (
            <PhotoThumb key={i} src={getPhotoSrc(p.url || p)} alt={`${label} ${i + 1}`}
              uploadedAt={p.uploaded_at} capturedAt={p.captured_at} onClick={() => setLightbox(getPhotoSrc(p.url || p))} isDarkMode={isDarkMode} />
          ))}
        </div>
      ) : (
        <div className={`flex items-center justify-center h-20 rounded-xl border-2 border-dashed text-xs ${isDarkMode ? 'border-slate-700 text-slate-500' : 'border-gray-200 text-gray-400'}`}>
          No {label.toLowerCase()} photos uploaded
        </div>
      )}
    </div>
  )
}

function PhotoThumb({ src, alt, onClick, uploadedAt, capturedAt, isDarkMode }) {
  const [error, setError] = useState(false)
  return (
    <div onClick={onClick}
      className={`group relative aspect-square rounded-xl overflow-hidden cursor-pointer border-2 border-transparent hover:border-teal-400 transition-all ${isDarkMode ? 'bg-slate-800' : 'bg-gray-100'}`}>
      {error
        ? <div className="w-full h-full flex items-center justify-center text-2xl">🖼️</div>
        : <img src={src} alt={alt} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" onError={() => setError(true)} />
      }
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-all flex items-center justify-center">
        <span className="opacity-0 group-hover:opacity-100 text-white text-xl">🔍</span>
      </div>
      {(uploadedAt || capturedAt) && (
        <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] px-1.5 py-1 flex flex-col gap-0.5">
          {capturedAt && <span className="truncate">Captured: {new Date(capturedAt).toLocaleString()}</span>}
          {uploadedAt && <span className="truncate">Uploaded: {new Date(uploadedAt).toLocaleString()}</span>}
        </div>
      )}
    </div>
  )
}