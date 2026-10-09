'use client'

import { useState, useEffect } from 'react'
import { useAuth } from 'src/context/AuthContext'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/Header'
import {
  Calendar, MapPin, User, ArrowLeft, CreditCard,
  AlertCircle, Clock, CheckCircle, Image as ImageIcon, Star, X,
  PartyPopper, AlertTriangle, Check
} from 'lucide-react'

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ message, type, onClose }) {
  useEffect(() => {
    if (!message) return
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [message, onClose])
  if (!message) return null
  return (
    <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-2xl text-white text-sm max-w-sm
      ${type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-blue-600'}`}>
      {message}
    </div>
  )
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
function Lightbox({ src, onClose }) {
  if (!src) return null
  return (
    <div className="fixed inset-0 bg-black/90 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <button className="absolute top-4 right-6 text-white text-4xl font-light" onClick={onClose}>×</button>
      <img src={src} alt="Full size" className="max-w-full max-h-[90vh] object-contain rounded-xl"
        onClick={e => e.stopPropagation()} />
    </div>
  )
}

// ── Photo grid ────────────────────────────────────────────────────────────────
function PhotoGrid({ photos, onOpen }) {
  const [errors, setErrors] = useState({})
  if (!photos?.length) return null
  const getPhotoSrc = (url) => {
    if (!url) return null
    if (url.startsWith('http')) return url
    return `${process.env.NEXT_PUBLIC_API_URL || ''}${url}`
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
      {photos.map((photo, i) => {
        const src = getPhotoSrc(typeof photo === 'string' ? photo : photo?.url)
        if (!src) return null
        return (
          <div key={i} onClick={() => onOpen(src)}
            className="aspect-square rounded-xl overflow-hidden border border-gray-200 cursor-pointer hover:opacity-90 transition shadow-sm bg-gray-50">
            {errors[i]
              ? <div className="w-full h-full flex items-center justify-center text-2xl">🖼️</div>
              : <img src={src} alt={`Photo ${i + 1}`} className="w-full h-full object-cover"
                onError={() => setErrors(p => ({ ...p, [i]: true }))} />
            }
          </div>
        )
      })}
    </div>
  )
}

// ── Review Modal ──────────────────────────────────────────────────────────────
function ReviewModal({ isOpen, onClose, booking, customerId, onSubmit }) {
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [review, setReview] = useState('')
  const [isAnonymous, setIsAnonymous] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  if (!isOpen) return null
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (rating === 0) { setError('Please select a rating'); return }
    setSubmitting(true); setError('')
    try {
      await onSubmit({ booking_id: booking.id, provider_id: booking.provider_id, customer_id: customerId, rating, review, is_anonymous: isAnonymous ? 1 : 0 })
      setRating(0); setReview(''); setIsAnonymous(false); onClose()
    } catch (err) {
      setError(err.message || 'Failed to submit review')
    } finally { setSubmitting(false) }
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">Rate Your Experience</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-sm text-gray-500">Service</p>
            <p className="font-semibold">{booking.service_name}</p>
            <p className="text-sm text-gray-600 mt-1">with {booking.provider_name}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Your Rating <span className="text-red-500">*</span></label>
            <div className="flex gap-1 justify-center">
              {[1, 2, 3, 4, 5].map(star => (
                <button key={star} type="button" onClick={() => setRating(star)} onMouseEnter={() => setHoverRating(star)} onMouseLeave={() => setHoverRating(0)} className="p-1">
                  <Star className={`w-8 h-8 transition-colors ${star <= (hoverRating || rating) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />
                </button>
              ))}
            </div>
            <p className="text-xs text-center text-gray-500 mt-1">
              {['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][rating]}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Write a Review (Optional)</label>
            <textarea value={review} onChange={e => setReview(e.target.value)} rows={4} placeholder="Share your experience..." className="w-full border rounded-xl p-3 text-sm outline-none focus:border-teal-500 resize-none" maxLength={500} />
            <p className="text-xs text-gray-400 text-right mt-1">{review.length}/500</p>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="anonymous" checked={isAnonymous} onChange={e => setIsAnonymous(e.target.checked)} className="w-4 h-4 text-teal-600 rounded" />
            <label htmlFor="anonymous" className="text-sm text-gray-600">Post anonymously</label>
          </div>
          {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-3 border rounded-xl text-sm font-medium">Cancel</button>
            <button type="submit" disabled={submitting || rating === 0} className="flex-1 py-3 bg-teal-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">
              {submitting ? 'Submitting...' : 'Submit Review'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CustomerBookingDetails() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const bookingId = params.id
  const actionParam = searchParams.get('action')

  const [booking, setBooking] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lightbox, setLightbox] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [showDisputeModal, setShowDisputeModal] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [hasReviewed, setHasReviewed] = useState(false)
  const [disputeReason, setDisputeReason] = useState('')
  const [toast, setToast] = useState({ message: '', type: '' })

  const isPaymentProcessing = (searchParams.get('payment') === 'success' || searchParams.get('overtime_payment') === 'success') && booking?.status === 'awaiting_approval'

  useEffect(() => {
    if (authLoading) return // Wait for authentication check to finish
    if (!user) { router.push('/'); return }
    
    loadBooking()
    // Poll frequently (every 3s) if we are waiting for a payment webhook to process, otherwise every 10s
    const isWaiting = searchParams.get('payment') === 'success' || searchParams.get('overtime_payment') === 'success'
    const interval = setInterval(() => {
      loadBooking(true) // true = silent load (no spinner)
    }, isWaiting ? 3000 : 10000)
    
    return () => clearInterval(interval)
  }, [user?.id, authLoading, bookingId])

  const loadBooking = async (silent = false) => {
    try {
      if (!silent) { setLoading(true); setError('') }
      const res = await fetch(`/api/customer/booking-details?bookingId=${bookingId}`)
      const data = await res.json()
      if (data.success && data.data?.length > 0) {
        setBooking(data.data[0])
        if (data.data[0].status === 'completed') checkExistingReview(data.data[0].id)
      } else {
        setError(data.message || 'Booking not found')
      }
    } catch (err) {
      setError(err.message || 'Failed to load booking')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!loading && booking && booking.status === 'awaiting_approval') {
      if (actionParam === 'approve') {
        setShowConfirmModal(true)
      } else if (actionParam === 'dispute') {
        setShowDisputeModal(true)
      }
    }
  }, [loading, booking, actionParam])

  const checkExistingReview = async (id) => {
    try {
      const res = await fetch(`/api/reviews?booking_id=${id}`)
      const data = await res.json()
      setHasReviewed(data.success && data.data.length > 0)
    } catch { setHasReviewed(false) }
  }

  const notify = (message, type = 'success') => setToast({ message, type })

  const handleApprove = async () => {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/customer/bookings/${bookingId}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' })
      })
      const data = await res.json()
      if (data.success) { 
        const url = data.checkout_url || data.data?.checkout_url
        if (url) {
          window.location.href = url
        } else {
          notify(data.message)
          setTimeout(() => router.push('/my-bookings'), 2000) 
        }
      } else { 
        notify(data.message || 'Action failed', 'error') 
      }
    } catch { notify('Something went wrong', 'error') }
    finally { setActionLoading(false); setShowConfirmModal(false) }
  }

  const handleDispute = async () => {
    if (!disputeReason.trim()) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/customer/bookings/${bookingId}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dispute', dispute_reason: disputeReason })
      })
      const data = await res.json()
      if (data.success) { setShowDisputeModal(false); setDisputeReason(''); notify(data.message, 'warning'); loadBooking() }
      else notify(data.message || 'Failed', 'error')
    } catch { notify('Something went wrong', 'error') }
    finally { setActionLoading(false) }
  }

  const handleReviewSubmit = async (reviewData) => {
    const res = await fetch('/api/reviews', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reviewData)
    })
    const data = await res.json()
    if (!data.success) throw new Error(data.message || 'Failed')
    setHasReviewed(true); notify('Thank you for your review!'); setShowReviewModal(false); loadBooking()
  }

  const fmt = (n) => `$${parseFloat(n || 0).toFixed(2)}`
  const formatDate = (d) => !d ? 'N/A' : new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const formatDuration = (m) => { if (!m) return '0 min'; if (m < 60) return `${m} min`; const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h ${r}m` : `${h}h` }
  const statusColor = (s) => ({ pending: 'bg-yellow-50 text-yellow-700 border-yellow-200', confirmed: 'bg-blue-50 text-blue-700 border-blue-200', in_progress: 'bg-purple-50 text-purple-700 border-purple-200', awaiting_approval: 'bg-amber-50 text-amber-700 border-amber-200', completed: 'bg-green-50 text-green-700 border-green-200', disputed: 'bg-red-50 text-red-700 border-red-200', cancelled: 'bg-gray-50 text-gray-700 border-gray-200' }[s] || 'bg-gray-50 text-gray-700 border-gray-200')

  const cleanNotes = (notes) => {
    if (!notes) return null
    return notes
      .replace(/Commission set to .*?\(.*?\)/gi, '')
      .replace(/\| Platform: .*? \| Provider: .*?$/gi, '')
      .trim()
  }

  if (loading) return (<><Header /><div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" /></div></>)
  if (error || !booking) return (<><Header /><div className="min-h-screen bg-gray-50 py-8"><div className="max-w-7xl mx-auto px-4 lg:px-8"><div className="bg-white rounded-2xl p-8 text-center border"><AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" /><h2 className="text-2xl font-bold mb-2">Booking Not Found</h2><p className="text-gray-500 mb-6">{error}</p><Link href="/my-bookings" className="inline-flex items-center gap-2 bg-teal-600 text-white px-6 py-3 rounded-xl"><ArrowLeft className="w-4 h-4" /> Back</Link></div></div></div></>)

  // ── Calculations ─────────────────────────────────────────────────────────────
  const wCount = parseInt(booking.submitted_headcount || booking.worker_count || 1)
  const basePrice = parseFloat(booking.service_price || 0)
  const actualMinutes = parseInt(booking.submitted_duration_minutes || booking.actual_duration_minutes || 0)
  const standardMinutes = parseInt(booking.standard_duration_minutes || booking.duration_minutes || 60)
  const customerTotal = basePrice
  const originalBasePrice = parseFloat(booking.service_price || 0) // What they actually paid upfront
  const totalAuthorized = parseFloat(booking.authorized_amount || originalBasePrice)
  const allPhotos = [...(booking.before_photos || []), ...(booking.after_photos || []), ...(booking.photos || []).map(url => ({ url }))]

  return (
    <>
      <Header />
      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: '' })} />
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />

      <div className="min-h-screen bg-gray-50 py-6 md:py-8">
        <div className="max-w-7xl mx-auto px-4">
          
          {isPaymentProcessing && (
            <div className="mb-6 bg-teal-50 border border-teal-200 text-teal-800 px-6 py-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <p className="font-medium text-sm">Payment successful! Processing your transaction... (This may take a moment)</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button 
                  onClick={() => {
                    const url = new URL(window.location.href);
                    url.searchParams.delete('payment');
                    url.searchParams.delete('overtime_payment');
                    window.history.replaceState({}, '', url);
                    loadBooking();
                  }} 
                  className="px-4 py-2 bg-white border border-teal-200 text-teal-700 text-xs font-bold rounded-lg hover:bg-teal-50 transition disabled:opacity-50"
                >
                  Cancel & Retry
                </button>
                <button onClick={() => loadBooking()} disabled={loading} className="px-4 py-2 bg-teal-600 text-white text-xs font-bold rounded-lg hover:bg-teal-700 transition disabled:opacity-50">
                  {loading ? 'Refreshing...' : 'Refresh Status'}
                </button>
              </div>
            </div>
          )}

          {/* Top nav */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <Link href="/my-bookings" className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
              <ArrowLeft className="w-4 h-4" /><span className="text-sm font-medium">Back to Bookings</span>
            </Link>
            <span className={`px-4 py-1.5 rounded-full text-xs font-semibold border ${statusColor(booking.status)}`}>
              {(booking.status || '').replace(/_/g, ' ').toUpperCase()}
            </span>
          </div>

          <div className="mb-6">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-1">{booking.service_name}</h1>
            <p className="text-sm text-gray-500">Booking #{booking.booking_number}</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
            <div className="lg:col-span-7 xl:col-span-8 space-y-6">

          {/* Rating section */}
          {booking.status === 'completed' && (
            <div className="mb-6">
              {!hasReviewed ? (
                <div className="bg-white rounded-2xl border-2 border-teal-300 shadow-lg p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-teal-100 rounded-full flex items-center justify-center text-2xl">⭐</div>
                    <div><h2 className="text-lg font-bold">How was your experience?</h2><p className="text-sm text-gray-500">Share your feedback</p></div>
                  </div>
                  <button onClick={() => setShowReviewModal(true)} className="w-full bg-teal-600 hover:bg-teal-700 text-white py-4 rounded-xl font-bold">Write a Review</button>
                </div>
              ) : (
                <div className="bg-green-50 rounded-2xl border border-green-200 p-4">
                  <div className="flex items-center gap-2 text-green-700"><CheckCircle className="w-5 h-5" /><p className="text-sm font-medium">Thank you! Your review has been submitted.</p></div>
                </div>
              )}
            </div>
          )}

          {/* Awaiting approval banner */}
          {booking.status === 'awaiting_approval' && !isPaymentProcessing && (
            <div className="bg-white rounded-2xl border-2 border-teal-500 shadow-lg p-6 mb-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-teal-50 rounded-full flex items-center justify-center">
                  <PartyPopper className="w-6 h-6 text-teal-600" />
                </div>
                <div><h2 className="text-lg font-bold">Job Completed!</h2><p className="text-sm text-gray-500">Review the work and approve payment or raise a dispute.</p></div>
              </div>
              {booking.end_time && (
                <div className="bg-gray-50 rounded-xl p-4 mb-4 text-sm space-y-2">
                  <div className="flex justify-between"><span className="text-gray-500">Started:</span><span className="font-medium">{formatDate(booking.start_time)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Completed:</span><span className="font-medium">{formatDate(booking.end_time)}</span></div>
                  <div className="flex justify-between pt-2 border-t">
                    <span className="text-gray-500">Duration:</span>
                    <span className="font-bold text-gray-900">
                      {formatDuration(actualMinutes)}<span className="text-xs text-gray-400 ml-2">(standard: {formatDuration(standardMinutes)})</span>
                    </span>
                  </div>
                </div>
              )}
              <div className="rounded-xl p-4 mb-5 bg-gray-50 border border-gray-200">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm font-medium text-gray-700">Job Total:</span>
                  <span className="text-xl font-bold text-gray-900">{fmt(customerTotal)}</span>
                </div>
                <div className="text-xs border-t pt-3 space-y-2">
                  <div className="flex justify-between text-gray-600">
                    <div>
                      <span>Base price ({standardMinutes}min):</span>
                      <p className="text-[10px] text-gray-400 mt-0.5">Base Service (x{wCount} worker{wCount > 1 ? 's' : ''})</p>
                    </div>
                    <span>{fmt(basePrice)}</span>
                  </div>
                  
                  <div className="flex justify-between font-bold pt-2 mt-2 border-t text-red-600">
                    <span>Already Paid (Base Price):</span>
                    <span>-{fmt(originalBasePrice)}</span>
                  </div>
                  <div className="flex justify-between font-bold pt-2 mt-1 border-t text-teal-700 text-sm">
                    <span>Remaining Balance (You Pay Now):</span>
                    <span>{fmt(customerTotal - originalBasePrice)}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <button 
                  onClick={() => setShowConfirmModal(true)} 
                  disabled={actionLoading || isPaymentProcessing} 
                  className="w-full sm:flex-[2] flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white py-4 rounded-xl font-bold disabled:opacity-50"
                >
                  {actionLoading || isPaymentProcessing ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-5 h-5 flex-shrink-0" />
                      <span className="truncate">Approve & Release Payment</span>
                    </>
                  )}
                </button>
                <button onClick={() => setShowDisputeModal(true)} disabled={actionLoading} className="w-full sm:flex-1 flex items-center justify-center gap-2 bg-white hover:bg-gray-50 text-gray-700 border-2 border-gray-200 py-4 rounded-xl font-bold disabled:opacity-50">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                  <span>Dispute</span>
                </button>
              </div>
              <p className="text-xs text-center text-gray-400 mt-3">Auto-approval in 12 hours if no action taken</p>
            </div>
          )}

          {/* Details Section */}

            {/* 1. Planned Schedule */}
            <div className="bg-white rounded-2xl p-6 border shadow-sm">
              <h2 className="text-base font-bold mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-teal-600" /> Job Schedule
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Service Date</p>
                  <p className="text-gray-900 font-semibold text-lg">
                    {booking.job_date 
                      ? (booking.job_date.includes(',') 
                          ? booking.job_date.split(',').map(d => new Date(d.trim()).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })).join(' • ')
                          : new Date(booking.job_date).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }))
                      : 'TBD'}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Time Window</p>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-teal-600" />
                    <p className="text-gray-900 font-semibold text-lg capitalize">
                      {Array.isArray(booking.job_time_slot) ? booking.job_time_slot.join(', ') : (booking.job_time_slot || 'Anytime')}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Job Description */}
            <div className="bg-white rounded-2xl p-6 border shadow-sm">
              <h2 className="text-base font-bold mb-4 flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-teal-600" /> Job Description
              </h2>
              <div className="bg-teal-50/30 rounded-xl p-5 border border-teal-100/50">
                <p className="text-gray-800 whitespace-pre-wrap break-all leading-relaxed text-base font-medium">
                  {booking.job_description || "No specific description provided."}
                </p>
              </div>
              
              {booking.timing_constraints && (
                <div className="mt-5 p-4 bg-amber-50 rounded-xl border border-amber-100 flex gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-amber-800 uppercase font-bold tracking-wider mb-1">Special Instructions / Timing</p>
                    <p className="text-amber-900 text-sm italic font-medium break-all">{booking.timing_constraints}</p>
                  </div>
                </div>
              )}
            </div>

            {/* 4. Service Location */}
            {booking.address_line1 && (
              <div className="bg-white rounded-2xl p-6 border shadow-sm">
                <h2 className="text-base font-bold mb-4 flex items-center gap-2"><MapPin className="w-5 h-5 text-teal-600" /> Service Location</h2>
                <div className="flex items-start gap-3">
                  <div className="bg-gray-100 p-2 rounded-lg">
                    <MapPin className="w-5 h-5 text-gray-500" />
                  </div>
                  <div>
                    <p className="text-gray-900 font-bold text-lg leading-tight">{booking.address_line1}{booking.address_line2 && `, ${booking.address_line2}`}</p>
                    <p className="text-gray-600 font-medium mt-1">{booking.city}{booking.postal_code && `, ${booking.postal_code}`}</p>
                  </div>
                </div>
                
                {(booking.parking_access || booking.elevator_access || booking.has_pets) && (
                  <div className="mt-5 pt-5 border-t border-gray-100 flex flex-wrap gap-3">
                    {booking.parking_access === 1 && (
                      <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-xl border border-blue-100">
                        <span className="text-sm font-bold">🅿️</span>
                        <span className="text-xs font-bold uppercase tracking-wide">Free Parking</span>
                      </div>
                    )}
                    {booking.elevator_access === 1 && (
                      <div className="flex items-center gap-2 bg-purple-50 text-purple-700 px-3 py-1.5 rounded-xl border border-purple-100">
                        <span className="text-sm font-bold">🛗</span>
                        <span className="text-xs font-bold uppercase tracking-wide">Elevator</span>
                      </div>
                    )}
                    {booking.has_pets === 1 && (
                      <div className="flex items-center gap-2 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-xl border border-amber-100">
                        <span className="text-sm font-bold">🐕</span>
                        <span className="text-xs font-bold uppercase tracking-wide">Pets Home</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 6. Photos & Media */}
            {allPhotos.length > 0 && (
              <div className="space-y-6">
                {booking.before_photos?.length > 0 && (
                  <div className="bg-white rounded-2xl p-6 border shadow-sm">
                    <h2 className="text-base font-bold mb-4 flex items-center gap-2">
                      <ImageIcon className="w-5 h-5 text-orange-500" /> 
                      Work Started
                      <span className="text-[10px] font-black bg-orange-100 text-orange-600 rounded-full px-2 py-0.5 ml-auto">BEFORE</span>
                    </h2>
                    <PhotoGrid photos={booking.before_photos} onOpen={setLightbox} />
                  </div>
                )}
                {booking.after_photos?.length > 0 && (
                  <div className="bg-white rounded-2xl p-6 border shadow-sm">
                    <h2 className="text-base font-bold mb-4 flex items-center gap-2">
                      <ImageIcon className="w-5 h-5 text-green-600" /> 
                      Work Completed
                      <span className="text-[10px] font-black bg-green-100 text-green-700 rounded-full px-2 py-0.5 ml-auto">AFTER</span>
                    </h2>
                    <PhotoGrid photos={booking.after_photos} onOpen={setLightbox} />
                  </div>
                )}
                {booking.photos?.length > 0 && (
                  <div className="bg-white rounded-2xl p-6 border shadow-sm">
                    <h2 className="text-base font-bold mb-4 flex items-center gap-2">
                      <ImageIcon className="w-5 h-5 text-blue-500" /> 
                      Your Uploads
                      <span className="text-[10px] font-black bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 ml-auto">{booking.photos.length}</span>
                    </h2>
                    <PhotoGrid photos={booking.photos} onOpen={setLightbox} />
                  </div>
                )}
              </div>
            )}

            </div>
            
            {/* Right Sidebar Column */}
            <div className="lg:col-span-5 xl:col-span-4">
              <div className="sticky top-6 space-y-6">
            {/* 3. Provider Details (if assigned) */}
            {booking.provider_name && (
              <div className="bg-white rounded-2xl p-6 border shadow-sm">
                <h2 className="text-base font-bold mb-4 flex items-center gap-2"><User className="w-5 h-5 text-teal-600" /> Your Professional</h2>
                <div className="flex items-center gap-5">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-teal-200/50 overflow-hidden">
                      {booking.provider_avatar ? (
                        <img src={booking.provider_avatar} alt={booking.provider_name} className="w-full h-full object-cover" />
                      ) : booking.provider_name[0]?.toUpperCase()}
                    </div>
                    <div className="absolute -bottom-1 -right-1 bg-green-500 w-4 h-4 rounded-full border-2 border-white shadow-sm" />
                  </div>
                  <div>
                    <h3 className="font-bold text-xl text-gray-900">{booking.provider_name}</h3>
                    {booking.provider_rating > 0 ? (
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex bg-yellow-50 px-2 py-0.5 rounded-lg border border-yellow-100">
                          <Star className="w-4 h-4 fill-yellow-400 text-yellow-400 mr-1.5" />
                          <span className="text-sm font-bold text-yellow-700">{parseFloat(booking.provider_rating).toFixed(1)}</span>
                        </div>
                        <span className="text-sm text-gray-500 font-medium">({booking.provider_reviews || 0} reviews)</span>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 mt-1">New Professional</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 5. Payment Breakdown */}
            <div className="bg-white rounded-2xl p-6 border shadow-sm">
              <h2 className="text-base font-bold mb-4 flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-teal-600" /> Payment Summary
              </h2>

              <div className="bg-gray-50 rounded-2xl border border-gray-200 overflow-hidden">
                <div className="bg-white/50 backdrop-blur-sm px-5 py-3.5 flex items-center justify-between border-b border-gray-200">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Billing Details</span>
                  <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${
                    booking.payment_status === 'paid' ? 'bg-green-100 text-green-700' :
                    booking.payment_status === 'authorized' ? 'bg-blue-100 text-blue-700' :
                    'bg-yellow-100 text-yellow-700'}`}>
                    {(booking.payment_status || 'PENDING').toUpperCase()}
                  </span>
                </div>

                <div className="p-5 space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-bold text-gray-800">Base Service {wCount > 1 ? `(x${wCount} workers)` : ''}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Fixed rate for first {standardMinutes} minutes</p>
                    </div>
                    <span className="text-base font-bold text-gray-900">{fmt(basePrice)}</span>
                  </div>

                  <div className="pt-2">
                    <div className="flex justify-between items-center gap-3 bg-teal-600 p-5 rounded-2xl shadow-lg shadow-teal-100">
                      <div className="min-w-0">
                        <p className="text-teal-100 text-xs font-bold uppercase tracking-wider truncate">Final Amount</p>
                        <p className="text-white text-[10px] mt-0.5 font-medium opacity-80 leading-tight">
                          {booking.status === 'completed' ? 'Paid in full' : 'Base amount charged'}
                        </p>
                      </div>
                      <span className="text-2xl sm:text-3xl font-black text-white shrink-0">{fmt(customerTotal)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 7. Timeline */}
            {booking.status_history?.length > 0 && (
              <div className="bg-white rounded-2xl p-6 border shadow-sm">
                <h2 className="text-base font-bold mb-6 flex items-center gap-2"><Clock className="w-5 h-5 text-teal-600" /> Booking Timeline</h2>
                <div className="space-y-0">
                  {booking.status_history.map((item, i) => (
                    <div key={i} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div className={`w-3 h-3 rounded-full mt-1.5 ${i === 0 ? 'bg-teal-600 ring-4 ring-teal-100' : 'bg-gray-300'}`} />
                        {i !== booking.status_history.length - 1 && <div className="w-0.5 h-full bg-gray-100 my-1" />}
                      </div>
                      <div className="pb-8">
                        <p className={`text-sm font-bold capitalize ${i === 0 ? 'text-teal-700' : 'text-gray-600'}`}>
                          {item.status?.replace(/_/g, ' ')}
                        </p>
                        <p className="text-xs text-gray-400 mt-1 font-medium">{new Date(item.created_at).toLocaleString('en-US', {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}</p>
                        {cleanNotes(item.notes) && (
                          <p className="text-xs text-gray-500 mt-2 bg-gray-50 p-2 rounded-lg border border-gray-100 italic">
                            {cleanNotes(item.notes)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Confirm Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold mb-4">Confirm Payment</h3>
            <div className="rounded-xl p-4 mb-4 bg-gray-50 border border-gray-200">
              <div className="flex justify-between text-sm mb-2">
                <span>Job Total:</span>
                <span className="font-bold text-gray-900">{fmt(customerTotal)}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500 mb-3">
                <span>Base price ({standardMinutes}min):</span>
                <span>{fmt(basePrice)}</span>
              </div>
              <div className="flex justify-between text-sm mb-2 text-red-600 font-bold border-t pt-3">
                <span>Already Paid (Base Price):</span>
                <span>-{fmt(originalBasePrice)}</span>
              </div>
              <div className="border-t pt-3 mt-1 flex justify-between">
                <span className="font-bold text-teal-700 text-base">Remaining Balance (You Pay Now):</span>
                <span className="font-bold text-teal-700 text-lg">{fmt(customerTotal - originalBasePrice)}</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowConfirmModal(false)} className="flex-1 py-2.5 border rounded-xl text-sm font-medium">Cancel</button>
              <button onClick={handleApprove} disabled={actionLoading} className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                {actionLoading ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dispute Modal */}
      {showDisputeModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold mb-2">Raise a Dispute</h3>
            <p className="text-sm text-gray-500 mb-4">Describe the issue clearly so we can help resolve it.</p>
            <textarea value={disputeReason} onChange={e => setDisputeReason(e.target.value)} placeholder="Describe the issue..." rows={4} className="w-full border rounded-xl p-3 text-sm mb-4 outline-none focus:border-red-400" />
            <div className="flex gap-3">
              <button onClick={handleDispute} disabled={actionLoading || !disputeReason.trim()} className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold text-sm disabled:opacity-50">
                {actionLoading ? 'Submitting...' : 'Submit Dispute'}
              </button>
              <button onClick={() => { setShowDisputeModal(false); setDisputeReason('') }} className="flex-1 bg-gray-100 py-3 rounded-xl font-bold text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <ReviewModal isOpen={showReviewModal} onClose={() => setShowReviewModal(false)} booking={booking} customerId={user?.id} onSubmit={handleReviewSubmit} />
    </>
  )
}