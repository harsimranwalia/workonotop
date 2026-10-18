'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAdminTheme } from '../layout'
import { FiSearch, FiFilter, FiChevronDown, FiX, FiCheck, FiTrash2, FiFileText, FiDownload, FiEye, FiMapPin, FiClock } from 'react-icons/fi'
import QuoteRequests from '@/components/admin/QuoteRequests'
import OnSiteReports from '@/components/admin/OnSiteReports'

const PAGE_SIZE = 6

function Pagination({ total, page, setPage, isDarkMode }) {
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const pages = []
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
      pages.push(i)
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...')
    }
  }
  return (
    <div className="flex items-center justify-between mt-6 flex-wrap gap-3">
      <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
        {total === 0 ? 'No results' : totalPages <= 1 ? `${total} total` : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total} total`}
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className={`px-3 py-1.5 rounded-lg text-sm disabled:opacity-40 transition ${isDarkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>‹</button>
          {pages.map((p, i) => (
            p === '...'
              ? <span key={`e-${i}`} className="px-2 text-slate-400 text-sm">…</span>
              : <button key={p} onClick={() => setPage(p)}
                className={`w-8 h-8 rounded-lg text-sm font-medium transition ${page === p ? 'bg-teal-600 text-white shadow-sm' : isDarkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>{p}</button>
          ))}
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className={`px-3 py-1.5 rounded-lg text-sm disabled:opacity-40 transition ${isDarkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>›</button>
        </div>
      )}
    </div>
  )
}

const STATUS_CONFIG = {
  pending: { label: 'Pending', dot: 'bg-amber-400', badge: 'bg-amber-50 text-amber-700 ring-amber-200', dark: 'bg-amber-900/20 text-amber-400 ring-amber-800' },
  matching: { label: 'Matching', dot: 'bg-orange-400', badge: 'bg-orange-50 text-orange-700 ring-orange-200', dark: 'bg-orange-900/20 text-orange-400 ring-orange-800' },
  confirmed: { label: 'Confirmed', dot: 'bg-blue-400', badge: 'bg-blue-50 text-blue-700 ring-blue-200', dark: 'bg-blue-900/20 text-blue-400 ring-blue-800' },
  in_progress: { label: 'In Progress', dot: 'bg-violet-400', badge: 'bg-violet-50 text-violet-700 ring-violet-200', dark: 'bg-violet-900/20 text-violet-400 ring-violet-800' },
  awaiting_approval: { label: 'Awaiting Approval', dot: 'bg-yellow-400', badge: 'bg-yellow-50 text-yellow-700 ring-yellow-200', dark: 'bg-yellow-900/20 text-yellow-400 ring-yellow-800' },
  completed: { label: 'Completed', dot: 'bg-emerald-400', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dark: 'bg-emerald-900/20 text-emerald-400 ring-emerald-800' },
}

const getStatusConfig = (status) => STATUS_CONFIG[status] || STATUS_CONFIG.pending

// The three places a booking waits in the job queue, in the order an admin works them; `state` is the queue_state the server puts on each row.
const QUEUE_SECTIONS = [
  { state: 'waiting', label: 'Waiting for a provider', dot: 'bg-amber-400' },
  { state: 'on_marketplace', label: 'On the marketplace', dot: 'bg-teal-400' },
  { state: 'assigned', label: 'Assigned, not yet accepted', dot: 'bg-blue-400' },
]

// A job_date is one date or several joined by commas. A date-only string reads as UTC midnight, so it is shown in UTC; the viewer's own zone would show it a day early west of Greenwich.
const formatQueueDates = (jobDate) => {
  if (!jobDate) return '—'
  return String(jobDate).split(',').map(part => {
    const date = new Date(part.trim())
    return isNaN(date.getTime()) ? part.trim() : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
  }).join(', ')
}

function QueueRow({ row, isDarkMode }) {
  return (
    <li>
      <Link href={`/admin/bookings/${row.id}`}
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-xl text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${isDarkMode ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-50'}`}>
        <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded-lg ${isDarkMode ? 'text-teal-400 bg-teal-900/30' : 'text-teal-700 bg-teal-50'}`}>{row.booking_number}</span>
        <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{row.service_name}</span>
        <span>{formatQueueDates(row.job_date)}</span>
        {row.city && <span>{row.city}</span>}
        {row.queue_state === 'assigned' && row.provider_name && <span>Assigned to {row.provider_name}</span>}
      </Link>
    </li>
  )
}

export default function JobRequests() {
  const router = useRouter()
  const { isDarkMode } = useAdminTheme()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedProvider, setSelectedProvider] = useState('all')
  const [selectedService, setSelectedService] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [showMobileFilters, setShowMobileFilters] = useState(false)
  const [showSuccessMessage, setShowSuccessMessage] = useState('')
  const [showErrorMessage, setShowErrorMessage] = useState('')
  const [page, setPage] = useState(1)
  const [selectedCustomer, setSelectedCustomer] = useState('all')
  const [customers, setCustomers] = useState([])
  const [providersList, setProvidersList] = useState([])
  const [servicesList, setServicesList] = useState([])
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [currentInvoice, setCurrentInvoice] = useState(null)
  const [invoicesList, setInvoicesList] = useState([])
  const [generatingInvoice, setGeneratingInvoice] = useState(null)
  const [downloadingInvoice, setDownloadingInvoice] = useState(null)
  // The job queue strip reads GET /api/bookings?queue=1 on its own, a page at a time; `next` is the offset after the rows held.
  const [queue, setQueue] = useState({ status: 'loading', rows: [], total: 0, next: 0, more: 'idle' })

  useEffect(() => {
    checkAuth()
    loadJobs()
  }, [])

  useEffect(() => {
    setPage(1)
  }, [filter, selectedCustomer, selectedProvider, selectedService, search, sortBy])

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/admin/me')
      if (!res.ok) {
        router.push('/admin/login')
        return
      }
      loadJobs() // ✅ auth pass hone ke baad hi load karo
      loadQueue()
    } catch {
      router.push('/admin/login')
    }
  }

  // A page after the first is read at the offset already held. If the queue's total moved meanwhile, a row ahead of that offset may have left it and offset paging would skip one, so the screen reads again from offset 0.
  const loadQueue = async (offset = 0) => {
    setQueue(q => offset === 0 ? { ...q, status: 'loading' } : { ...q, more: 'loading' })
    try {
      const res = await fetch(`/api/bookings?queue=1&offset=${offset}`)
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error('The job queue was not returned')
      if (offset > 0 && data.total !== queue.total) return loadQueue(0)
      setQueue(q => ({
        status: 'ready',
        rows: offset === 0 ? data.data : [...q.rows, ...data.data.filter(row => !q.rows.some(held => held.id === row.id))],
        total: data.total,
        next: data.offset + data.data.length,
        more: 'idle',
      }))
    } catch {
      setQueue(q => offset === 0 ? { ...q, status: 'error' } : { ...q, more: 'error' })
    }
  }
  const loadJobs = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/bookings')
      const data = await res.json()
      if (data.success) setJobs(data.data || [])
    } catch {
      showMessage('error', 'Failed to load jobs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (jobs.length > 0) {
      const customerMap = new Map()
      const providerSet = new Set()
      const serviceSet = new Set()

      jobs.forEach(job => {
        const customerId = job.customer_id || `${job.customer_first_name}-${job.customer_last_name}-${job.customer_email}`
        if (!customerMap.has(customerId)) {
          customerMap.set(customerId, {
            id: customerId,
            first_name: job.customer_first_name,
            last_name: job.customer_last_name,
            email: job.customer_email,
            fullName: `${job.customer_first_name || ''} ${job.customer_last_name || ''}`.trim()
          })
        }

        if (job.provider_name) {
          providerSet.add(job.provider_name)
        }
        if (job.service_name) {
          serviceSet.add(job.service_name)
        }
      })

      setCustomers(Array.from(customerMap.values()))
      setProvidersList(Array.from(providerSet))
      setServicesList(Array.from(serviceSet))
    }
  }, [jobs])

  const showMessage = (type, message) => {
    if (type === 'success') {
      setShowSuccessMessage(message)
      setTimeout(() => setShowSuccessMessage(''), 3000)
    } else {
      setShowErrorMessage(message)
      setTimeout(() => setShowErrorMessage(''), 3000)
    }
  }

  const generateInvoice = async (bookingId) => {
    setGeneratingInvoice(bookingId)
    try {
      const res = await fetch('/api/admin/invoices/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: bookingId })
      })
      const data = await res.json()
      if (data.success) {
        showMessage('success', 'Invoice generated successfully!')
        loadJobs()
      } else {
        showMessage('error', data.message || 'Failed to generate invoice')
      }
    } catch {
      showMessage('error', 'Failed to generate invoice')
    } finally {
      setGeneratingInvoice(null)
    }
  }

  const downloadInvoice = async (invoiceId, invoiceNumber) => {
    setDownloadingInvoice(invoiceId)
    try {
      const response = await fetch(`/api/admin/invoices/${invoiceId}/preview`)
      if (!response.ok) throw new Error('Download failed')
      const html = await response.text()
      const blob = new Blob([html], { type: 'text/html' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `invoice-${invoiceNumber || invoiceId}.html`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      showMessage('success', 'Invoice downloaded successfully!')
    } catch (error) {
      showMessage('error', 'Failed to download invoice')
    } finally {
      setDownloadingInvoice(null)
    }
  }

  const viewInvoice = async (bookingId) => {
    try {
      const res = await fetch(`/api/admin/invoices?booking_id=${bookingId}`)
      const data = await res.json()
      if (data.success && data.data.length > 0) {
        setInvoicesList(data.data)
        // Prefer customer invoice initially, or just first one
        const custInv = data.data.find(i => i.invoice_type === 'customer') || data.data[0]
        setCurrentInvoice(custInv)
        setShowInvoiceModal(true)
      } else {
        showMessage('error', 'No invoice found for this booking')
      }
    } catch {
      showMessage('error', 'Failed to load invoice')
    }
  }

  const updateInvoiceStatus = async (invoiceId, newStatus) => {
    try {
      const res = await fetch('/api/admin/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: invoiceId, status: newStatus })
      })
      const data = await res.json()
      if (data.success) {
        showMessage('success', `Invoice marked as ${newStatus}`)
        if (currentInvoice) setCurrentInvoice({ ...currentInvoice, status: newStatus })
        loadJobs()
      }
    } catch {
      showMessage('error', 'Failed to update invoice')
    }
  }

  const hasActiveFilters = filter !== 'all' || selectedCustomer !== 'all' || selectedProvider !== 'all' || selectedService !== 'all' || search.trim() !== '' || sortBy !== 'newest'

  const clearAllFilters = () => {
    setFilter('all')
    setSelectedCustomer('all')
    setSelectedProvider('all')
    setSelectedService('all')
    setSearch('')
    setSortBy('newest')
  }

  const filteredJobs = jobs.filter(job => {
    if (filter !== 'all' && job.status !== filter) return false

    if (selectedCustomer !== 'all') {
      const customerId = job.customer_id || `${job.customer_first_name}-${job.customer_last_name}-${job.customer_email}`
      if (customerId !== selectedCustomer) return false
    }

    if (selectedProvider !== 'all') {
      if (selectedProvider === 'unassigned') {
        if (job.provider_name) return false
      } else if (job.provider_name !== selectedProvider) {
        return false
      }
    }

    if (selectedService !== 'all' && job.service_name !== selectedService) {
      return false
    }

    if (search.trim()) {
      const q = search.toLowerCase().trim()
      const bookingNo = (job.booking_number || '').toString().toLowerCase()
      const custName = `${job.customer_first_name || ''} ${job.customer_last_name || ''}`.toLowerCase()
      const custEmail = (job.customer_email || '').toLowerCase()
      const custPhone = (job.customer_phone || '').toLowerCase()
      const servName = (job.service_name || '').toLowerCase()
      const provName = (job.provider_name || '').toLowerCase()
      const city = (job.city || '').toLowerCase()
      const address = (job.address_line1 || '').toLowerCase()

      const matches = bookingNo.includes(q) ||
        custName.includes(q) ||
        custEmail.includes(q) ||
        custPhone.includes(q) ||
        servName.includes(q) ||
        provName.includes(q) ||
        city.includes(q) ||
        address.includes(q)

      if (!matches) return false
    }

    return true
  }).sort((a, b) => {
    if (sortBy === 'oldest') {
      return new Date(a.created_at || 0) - new Date(b.created_at || 0)
    }
    if (sortBy === 'price_high') {
      return parseFloat(b.service_price || 0) - parseFloat(a.service_price || 0)
    }
    if (sortBy === 'price_low') {
      return parseFloat(a.service_price || 0) - parseFloat(b.service_price || 0)
    }
    return new Date(b.created_at || 0) - new Date(a.created_at || 0)
  })

  const pagedJobs = filteredJobs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)


  const formatDuration = (minutes) => {
    if (!minutes || minutes < 1) return '—'
    if (minutes < 60) return `${minutes}m`
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }

  const statusCount = (s) => jobs.filter(j => s === 'all' ? true : j.status === s).length

  const filterTabs = ['all', 'pending', 'matching', 'confirmed', 'in_progress', 'awaiting_approval', 'completed']

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-14 h-14">
            <div className="absolute inset-0 rounded-full border-4 border-teal-100 dark:border-teal-900"></div>
            <div className="absolute inset-0 rounded-full border-4 border-teal-500 border-t-transparent animate-spin"></div>
          </div>
          <p className="text-sm text-gray-400 font-medium tracking-wide">Loading jobs…</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`min-h-screen p-4 sm:p-6 transition-colors ${isDarkMode ? 'bg-slate-950' : 'bg-slate-50'}`}>

      {/* Toast */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {showSuccessMessage && (
          <div className="flex items-center gap-3 bg-emerald-600 text-white pl-4 pr-5 py-3 rounded-xl shadow-xl text-sm font-medium">
            <span>✓</span>{showSuccessMessage}
          </div>
        )}
        {showErrorMessage && (
          <div className="flex items-center gap-3 bg-red-600 text-white pl-4 pr-5 py-3 rounded-xl shadow-xl text-sm font-medium">
            <span>✕</span>{showErrorMessage}
          </div>
        )}
      </div>

      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <div className="flex items-start sm:items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className={`text-2xl sm:text-3xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Job Requests</h1>
              <p className={`mt-1 text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{jobs.length} total booking{jobs.length !== 1 ? 's' : ''}</p>
            </div>
            {/* <div className="hidden md:flex items-center gap-3 flex-wrap">
              {['pending', 'awaiting_approval', 'in_progress', 'completed'].map(s => {
                const cfg = getStatusConfig(s)
                return (
                  <div key={s} className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium ${isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-300' : 'bg-white border-slate-200 text-slate-700'}`}>
                    <span className={`w-2 h-2 rounded-full ${cfg.dot}`}></span>
                    {statusCount(s)} {cfg.label}
                  </div>
                )
              })}
            </div> */}
          </div>
          <QuoteRequests isDarkMode={isDarkMode} />
          <OnSiteReports isDarkMode={isDarkMode} />
        </div>

        {/* Job queue: every booking waiting for a provider, on the marketplace, or assigned and not yet accepted */}
        <section aria-labelledby="job-queue-heading" className={`p-4 sm:p-5 rounded-2xl border mb-6 shadow-sm ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
        }`}>
          <h2 id="job-queue-heading" className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Job queue</h2>

          {queue.status === 'loading' && (
            <p role="status" className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Loading the job queue…</p>
          )}

          {queue.status === 'error' && (
            <div role="alert" className="flex items-center gap-3 flex-wrap">
              <p className={`text-sm ${isDarkMode ? 'text-red-400' : 'text-red-700'}`}>Couldn’t load the job queue.</p>
              <button type="button" onClick={() => loadQueue()}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${isDarkMode ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                Try again
              </button>
            </div>
          )}

          {queue.status === 'ready' && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {QUEUE_SECTIONS.map(section => {
                  const rows = queue.rows.filter(row => row.queue_state === section.state)
                  return (
                    <div key={section.state}>
                      <h3 className={`flex items-center gap-2 text-sm font-semibold mb-2 ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>
                        <span aria-hidden="true" className={`w-2 h-2 rounded-full ${section.dot}`}></span>
                        {section.label}
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>{rows.length}</span>
                      </h3>
                      {rows.length > 0 ? (
                        <ul className="space-y-1">
                          {rows.map(row => <QueueRow key={row.id} row={row} isDarkMode={isDarkMode} />)}
                        </ul>
                      ) : section.state === 'waiting' && queue.next >= queue.total && (
                        <p className={`px-3 text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Nothing is waiting for a provider.</p>
                      )}
                    </div>
                  )
                })}
              </div>

              {queue.next < queue.total && (
                <div className="flex items-center gap-3 flex-wrap mt-4">
                  <p className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Showing {queue.rows.length} of {queue.total} in the queue.</p>
                  <button type="button" onClick={() => loadQueue(queue.next)} disabled={queue.more === 'loading'}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${isDarkMode ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                    {queue.more === 'loading' ? 'Loading…' : 'Load more'}
                  </button>
                  {queue.more === 'error' && (
                    <p role="alert" className={`text-sm ${isDarkMode ? 'text-red-400' : 'text-red-700'}`}>Couldn’t load more of the queue.</p>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        {/* Filters and Search Container */}
        <div className={`p-4 sm:p-5 rounded-2xl border mb-6 transition-all shadow-sm ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
        }`}>
          {/* Top Row: Search Input & Mobile Filter Toggle */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 mb-4">
            {/* Search Bar */}
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Search by ID (BKG-...), Customer, Provider, Service, City..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`w-full pl-10 pr-9 py-2.5 rounded-xl text-sm border focus:outline-none focus:ring-2 focus:ring-teal-500 transition ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-400'
                    : 'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400'
                }`}
              />
              <FiSearch className={`w-4 h-4 absolute left-3.5 top-3.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-400'}`} />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className={`absolute right-3 top-3 text-xs p-0.5 rounded-full ${
                    isDarkMode ? 'text-slate-400 hover:text-white' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <FiX className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Mobile Filter Toggle Button */}
            <div className="flex items-center gap-2 lg:hidden">
              <button
                type="button"
                onClick={() => setShowMobileFilters(!showMobileFilters)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border transition ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-slate-200'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
              >
                <FiFilter className="w-4 h-4" />
                <span>Filter Options</span>
                {hasActiveFilters && (
                  <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                )}
                <FiChevronDown className={`w-4 h-4 transition-transform ${showMobileFilters ? 'rotate-180' : ''}`} />
              </button>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="px-3 py-2.5 rounded-xl text-xs font-semibold bg-red-50 text-red-600 hover:bg-red-100 transition whitespace-nowrap"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* Status Tabs (Horizontally scrollable on mobile) */}
          <div className="overflow-x-auto pb-2 -mx-1 px-1 lg:mx-0 lg:px-0 mb-3 scrollbar-hide">
            <div className="flex items-center gap-1.5 min-w-max">
              {filterTabs.map((s) => {
                const cfg = getStatusConfig(s)
                const active = filter === s
                const count = statusCount(s)
                const label = s === 'in_progress' ? 'In Progress' : s === 'awaiting_approval' ? 'Awaiting' : s.charAt(0).toUpperCase() + s.slice(1)
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setFilter(s)}
                    className={`relative flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200 whitespace-nowrap ${
                      active
                        ? 'bg-teal-600 text-white shadow-md shadow-teal-600/20'
                        : isDarkMode
                          ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    {s !== 'all' && cfg && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? 'bg-white/70' : cfg.dot}`}></span>}
                    <span>{label}</span>
                    <span className={`text-[10px] sm:text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                      active ? 'bg-white/20 text-white' : isDarkMode ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'
                    }`}>{count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Dropdown Filters Grid (Desktop visible, Mobile collapsible) */}
          <div className={`${showMobileFilters ? 'block' : 'hidden'} lg:block pt-3 border-t ${isDarkMode ? 'border-slate-800' : 'border-slate-100'}`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Customer Filter */}
              <div>
                <label className={`block text-[11px] font-semibold uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  Customer
                </label>
                <select
                  value={selectedCustomer}
                  onChange={(e) => setSelectedCustomer(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl text-xs border ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-900'
                  } focus:outline-none focus:ring-2 focus:ring-teal-500 transition`}
                >
                  <option value="all">All Customers ({customers.length})</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName || c.email}
                    </option>
                  ))}
                </select>
              </div>

              {/* Provider Filter */}
              <div>
                <label className={`block text-[11px] font-semibold uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  Provider
                </label>
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl text-xs border ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-900'
                  } focus:outline-none focus:ring-2 focus:ring-teal-500 transition`}
                >
                  <option value="all">All Providers ({providersList.length})</option>
                  <option value="unassigned">⚠️ Unassigned Jobs</option>
                  {providersList.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              {/* Service Filter */}
              <div>
                <label className={`block text-[11px] font-semibold uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  Service
                </label>
                <select
                  value={selectedService}
                  onChange={(e) => setSelectedService(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl text-xs border ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-900'
                  } focus:outline-none focus:ring-2 focus:ring-teal-500 transition`}
                >
                  <option value="all">All Services ({servicesList.length})</option>
                  {servicesList.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Sort By */}
              <div>
                <label className={`block text-[11px] font-semibold uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  Sort By
                </label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl text-xs border ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-900'
                  } focus:outline-none focus:ring-2 focus:ring-teal-500 transition`}
                >
                  <option value="newest">📅 Newest First</option>
                  <option value="oldest">📅 Oldest First</option>
                  <option value="price_high">💵 Rate: High to Low</option>
                  <option value="price_low">💵 Rate: Low to High</option>
                </select>
              </div>
            </div>

            {/* Active Filter Badges & Reset Bar */}
            {hasActiveFilters && (
              <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-dashed dark:border-slate-800 border-slate-200 flex-wrap">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-xs font-semibold ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Active Filters:</span>

                  {search && (
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${isDarkMode ? 'bg-slate-800 text-teal-400 border border-slate-700' : 'bg-teal-50 text-teal-700 border border-teal-200'}`}>
                      Search: &quot;{search}&quot;
                      <button onClick={() => setSearch('')} className="hover:opacity-80"><FiX className="w-3 h-3" /></button>
                    </span>
                  )}

                  {filter !== 'all' && (
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${isDarkMode ? 'bg-slate-800 text-teal-400 border border-slate-700' : 'bg-teal-50 text-teal-700 border border-teal-200'}`}>
                      Status: {filter}
                      <button onClick={() => setFilter('all')} className="hover:opacity-80">✕</button>
                    </span>
                  )}

                  {selectedCustomer !== 'all' && (
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${isDarkMode ? 'bg-slate-800 text-teal-400 border border-slate-700' : 'bg-teal-50 text-teal-700 border border-teal-200'}`}>
                      Customer: {customers.find(c => c.id === selectedCustomer)?.fullName || selectedCustomer}
                      <button onClick={() => setSelectedCustomer('all')} className="hover:opacity-80">✕</button>
                    </span>
                  )}

                  {selectedProvider !== 'all' && (
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${isDarkMode ? 'bg-slate-800 text-teal-400 border border-slate-700' : 'bg-teal-50 text-teal-700 border border-teal-200'}`}>
                      Provider: {selectedProvider}
                      <button onClick={() => setSelectedProvider('all')} className="hover:opacity-80">✕</button>
                    </span>
                  )}

                  {selectedService !== 'all' && (
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${isDarkMode ? 'bg-slate-800 text-teal-400 border border-slate-700' : 'bg-teal-50 text-teal-700 border border-teal-200'}`}>
                      Service: {selectedService}
                      <button onClick={() => setSelectedService('all')} className="hover:opacity-80">✕</button>
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="text-xs font-semibold text-red-600 hover:text-red-700 dark:text-red-400 hover:underline flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Clear All Filters
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Results Counter Bar */}
        <div className="mb-4 flex items-center justify-between text-xs sm:text-sm">
          <p className={isDarkMode ? 'text-slate-400' : 'text-slate-500'}>
            Showing <strong className={isDarkMode ? 'text-white' : 'text-slate-900'}>{filteredJobs.length}</strong> of {jobs.length} job request{jobs.length !== 1 ? 's' : ''}
          </p>
          {hasActiveFilters && (
            <button onClick={clearAllFilters} className="text-xs text-teal-600 hover:underline font-medium">
              Reset Filters
            </button>
          )}
        </div>

        {filteredJobs.length === 0 ? (
          <div className={`flex flex-col items-center justify-center py-24 rounded-2xl border-2 border-dashed ${isDarkMode ? 'border-slate-800 text-slate-600' : 'border-slate-200 text-slate-400'}`}>
            <div className="text-5xl mb-4 opacity-50">📋</div>
            <p className="text-lg font-medium">No jobs found</p>
            <p className="text-sm mt-1">{selectedCustomer !== 'all' ? 'No jobs for this customer' : 'Try a different filter'}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {pagedJobs.map((job) => {
                const cfg = getStatusConfig(job.status)
                const hasOvertime = parseFloat(job.additional_price || 0) > 0

                return (
                  <div key={job.id}
                    className={`group relative flex flex-col rounded-2xl border transition-all duration-200 ${isDarkMode ? 'bg-slate-900 border-slate-800 hover:border-slate-700 hover:shadow-xl hover:shadow-black/30'
                      : 'bg-white border-slate-200 hover:border-teal-300 hover:shadow-lg hover:shadow-teal-500/5'
                      }`}
                  >
                    <div className={`absolute top-0 left-6 right-6 h-0.5 rounded-b-full ${cfg.dot} opacity-60`}></div>

                    <div className="p-4 sm:p-5 flex flex-col flex-1">
                      <div className="flex items-center justify-between mb-4">
                        <button onClick={() => router.push(`/admin/bookings/${job.id}`)}
                          className={`font-mono text-xs font-bold px-2.5 py-1 rounded-lg transition-colors ${isDarkMode ? 'text-teal-400 bg-teal-900/30 hover:bg-teal-900/60' : 'text-teal-700 bg-teal-50 hover:bg-teal-100'}`}>
                          {job.booking_number}
                        </button>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ${isDarkMode ? cfg.dark : cfg.badge}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`}></span>
                          {cfg.label}
                        </span>
                      </div>

                      <div className="mb-4 cursor-pointer" onClick={() => router.push(`/admin/bookings/${job.id}`)}>
                        <p className={`text-base font-semibold leading-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{job.customer_first_name} {job.customer_last_name}</p>
                        <p className={`text-xs mt-0.5 truncate ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{job.customer_email}</p>
                      </div>

                      <div className={`grid grid-cols-3 gap-2 mb-4 p-3 rounded-xl cursor-pointer ${isDarkMode ? 'bg-slate-800/60' : 'bg-slate-50'}`}
                        onClick={() => router.push(`/admin/bookings/${job.id}`)}>
                        <div>
                          <p className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Service</p>
                          <p className={`text-xs font-medium leading-tight ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>{job.service_name}</p>
                        </div>
                        <div>
                          <p className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Date</p>
                          <p className={`text-xs font-medium ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>
                            {job.job_date 
                              ? (job.job_date.includes(',') 
                                  ? job.job_date.split(',').map(d => new Date(d.trim()).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })).join(', ')
                                  : new Date(job.job_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }))
                              : '—'}
                          </p>
                        </div>
                        <div>
                          <p className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Duration</p>
                          <p className={`text-xs font-medium ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>{formatDuration(job.service_duration || 60)}</p>
                        </div>
                      </div>

                      <div className="flex items-end justify-between gap-3 mb-4">
                        <div className="flex-1 min-w-0">
                          <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Provider</p>
                          {job.provider_name ? (
                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium w-fit ${isDarkMode ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700'}`}>
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                              {job.provider_name}
                            </div>
                          ) : (
                            <div className={`text-xs italic ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Unassigned</div>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Rate</p>
                          <p className="text-xl font-bold text-teal-500 leading-tight">
                            ${parseFloat(job.service_price).toFixed(2)}
                            <span className={`text-xs font-normal ml-0.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>/hr</span>
                          </p>
                          {hasOvertime && <p className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>+${parseFloat(job.additional_price).toFixed(2)}/hr OT</p>}
                        </div>
                      </div>

                      <div className={`flex items-center gap-1.5 text-[11px] mb-4 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                        {job.commission_percent ? (
                          <><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0"></span>Commission {job.commission_percent}% — provider gets ${parseFloat(job.provider_amount || 0).toFixed(2)}</>
                        ) : (
                          <><span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0"></span>Commission not set</>
                        )}
                      </div>

                      <div className={`flex items-center gap-1.5 text-[11px] mb-4 truncate ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                        <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                        </svg>
                        <span className="truncate">{job.address_line1}</span>
                      </div>

                      {job.status === 'awaiting_approval' && (
                        <div className="mb-3 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-xl text-xs text-yellow-700 font-medium flex items-center gap-2">
                          ⏳ Awaiting customer approval — payment held
                        </div>
                      )}
                      {job.status === 'disputed' && (
                        <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium flex items-center gap-2">
                          ⚠️ Dispute raised — admin review required
                        </div>
                      )}

                      {/* ✅ Quick Assign removed — use View Details to set commission first */}
                      <div className="mt-auto space-y-2">
                        <div className="flex gap-2">
                          <button onClick={() => router.push(`/admin/bookings/${job.id}`)}
                            className="flex-1 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-semibold transition-colors">
                            View Details
                          </button>
                        </div>

                        {job.status === 'completed' && (
                          <div className="flex gap-2">
                            <button onClick={() => generateInvoice(job.id)} disabled={generatingInvoice === job.id}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50">
                              {generatingInvoice === job.id ? (
                                <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>Generating…</>
                              ) : (
                                <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>Generate Invoice</>
                              )}
                            </button>
                            {job.invoice_id ? (
                              <button onClick={() => downloadInvoice(job.invoice_id, job.booking_number)} disabled={downloadingInvoice === job.invoice_id}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-colors ${downloadingInvoice === job.invoice_id ? 'opacity-50 cursor-not-allowed bg-emerald-600 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}>
                                {downloadingInvoice === job.invoice_id ? (
                                  <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>Downloading...</>
                                ) : (
                                  <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                  </svg>Download Invoice</>
                                )}
                              </button>
                            ) : (
                              <button onClick={() => viewInvoice(job.id)}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-colors ${isDarkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>View
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <Pagination total={filteredJobs.length} page={page} setPage={setPage} isDarkMode={isDarkMode} />
          </>
        )}
      </div>

      {/* Invoice Modal */}
      {showInvoiceModal && currentInvoice && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowInvoiceModal(false) }}>
          <div className={`w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden ${isDarkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white'}`}>
            <div className={`flex items-center justify-between px-4 sm:px-6 py-4 border-b flex-wrap gap-3 ${isDarkMode ? 'border-slate-800' : 'border-slate-100'}`}>
              <div>
                <p className={`text-xs font-semibold uppercase tracking-widest mb-0.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Invoice Preview</p>
                <h2 className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{currentInvoice.invoice_number}</h2>
                
                {invoicesList.length > 1 && (
                  <div className="flex gap-2 mt-3">
                    {invoicesList.map(inv => (
                      <button 
                        key={inv.id}
                        onClick={() => setCurrentInvoice(inv)}
                        className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${currentInvoice.id === inv.id ? 'bg-teal-600 text-white' : (isDarkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300')}`}
                      >
                        {inv.invoice_type === 'customer' ? '📄 Customer Invoice' : '📄 Provider Invoice'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select value={currentInvoice.status} onChange={e => updateInvoiceStatus(currentInvoice.id, e.target.value)}
                  className={`px-3 py-2 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-teal-500 transition ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                </select>
                <button onClick={() => downloadInvoice(currentInvoice.id, currentInvoice.invoice_number)} disabled={downloadingInvoice === currentInvoice.id}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${downloadingInvoice === currentInvoice.id ? 'opacity-50 cursor-not-allowed bg-gray-400' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}>
                  {downloadingInvoice === currentInvoice.id ? (
                    <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>Downloading...</>
                  ) : (
                    <><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>Download Invoice</>
                  )}
                </button>
                <button onClick={() => setShowInvoiceModal(false)}
                  className={`flex items-center justify-center w-9 h-9 rounded-xl transition-colors ${isDarkMode ? 'bg-slate-800 hover:bg-slate-700 text-slate-400' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <iframe src={`/api/admin/invoices/${currentInvoice.id}/preview`} className="w-full h-[500px] sm:h-[600px] rounded-xl border-0" title="Invoice Preview" />
            </div>
          </div>
        </div>
      )}

      {/* Custom scrollbar hide style */}
      <style jsx>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  )
}










