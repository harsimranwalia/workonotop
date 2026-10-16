'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import React from 'react'
import TimeTracker from '../TimeTracker'
import JobPhotoUpload from '../JobPhotoUpload'
import JobCrewPanel from '@/components/provider/JobCrewPanel'

export default function ProviderJobDetail({ params }) {
  const router = useRouter()
  const { id } = React.use(params)

  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [photos, setPhotos] = useState({ before: [], after: [] })
  const [toast, setToast] = useState(null)
  const [mounted, setMounted] = useState(false)
  const [showContact, setShowContact] = useState(false)
  const [selectedPhoto, setSelectedPhoto] = useState(null)

  useEffect(() => {
    setMounted(true)
    checkAuth()
    loadJob()
    loadPhotos()
  }, [id])

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/provider/me')
      if (!res.ok) {
        router.push('/provider/login')
      }
    } catch {
      router.push('/provider/login')
    }
  }

  const loadJob = async () => {
    try {
      const res = await fetch(`/api/provider/jobs/${id}?_t=${Date.now()}`)
      const data = await res.json()
      if (data.success) {
        console.log('✅ [DEBUG] Fetched accepted job data:', data.data)
        setJob(data.data)
      } else {
        if (res.status === 401) {
          router.push('/provider/login')
        }
        showToast('error', data.message || 'Failed to load job')
      }
    } catch {
      showToast('error', 'Failed to load job')
    } finally {
      setLoading(false)
    }
  }

  const loadPhotos = useCallback(async () => {
    try {
      const res = await fetch(`/api/provider/jobs/photos?booking_id=${id}&_t=${Date.now()}`)
      const data = await res.json()
      if (data.success) setPhotos(data.data)
    } catch (error) {
      console.error('Failed to load photos:', error)
    }
  }, [id])

  const showToast = (type, text) => {
    setToast({ type, text })
    setTimeout(() => setToast(null), 4000)
  }

  const handleJobStart = async () => {
    await loadJob()
  }

  const handleJobComplete = async (jobData) => {
    showToast('success', `Job completed! Duration: ${formatDuration(jobData.total_minutes)}`)
    await loadJob()
    await loadPhotos()
  }

  const handlePhotoUpload = async (type) => {
    showToast('success', `${type === 'before' ? 'Before' : 'After'} photos uploaded!`)
    await loadPhotos()
  }

  const formatDate = (dateString) => {
    if (!dateString) return ''
    if (typeof dateString === 'string' && dateString.includes(',')) {
      return dateString.split(',').map(d => new Date(d.trim()).toLocaleDateString('en-US', {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
      })).join(' • ')
    }
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })
  }

  const formatDateTime = (date) => {
    if (!date) return ''
    return new Date(date).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    })
  }

  const formatDuration = (minutes) => {
    if (!minutes || minutes === 0) return 'Not started'
    if (minutes < 60) return `${minutes} min`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  }

  if (!mounted || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 rounded-full border-4 border-green-100"></div>
            <div className="absolute inset-0 rounded-full border-4 border-green-600 border-t-transparent animate-spin"></div>
          </div>
          <p className="text-sm text-gray-400 font-medium">Loading job…</p>
        </div>
      </div>
    )
  }

  if (!job) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-3">
          <p className="text-gray-500 text-lg">Job not found</p>
          <Link href="/provider/jobs" className="text-green-600 underline text-sm">← Back to Jobs</Link>
        </div>
      </div>
    )
  }

  const hasBeforePhotos = photos.before.length > 0
  const hasAfterPhotos = photos.after.length > 0
  const duration = job.duration_minutes || 60
  const overtimeRate = parseFloat(job.additional_price || 0)
  const isCompleted = job.status === 'completed' || job.status === 'awaiting_approval'
  const isInProgress = job.status === 'in_progress'
  const isConfirmed = job.status === 'confirmed'

  return (
    <div className="min-h-screen bg-gray-50 pb-24">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium
          ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-500'}`}>
          <span>{toast.type === 'success' ? '✓' : '✕'}</span>
          {toast.text}
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* Back Button */}
        <div>
          <Link href="/provider/jobs" className="inline-flex items-center gap-1.5 text-sm text-gray-500 font-medium hover:text-green-600 transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Jobs
          </Link>
        </div>

        {/* Job Title */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm text-gray-400 font-semibold uppercase tracking-wider">#{job.booking_number}</p>
            <StatusBadge status={job.status} />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{job.service_name}</h1>
              <p className="text-gray-500 mt-1.5 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {formatDate(job.job_date)}
              </p>
            </div>
            
            <div className="bg-green-50 rounded-xl px-4 py-2.5 border border-green-100 flex flex-col items-end sm:items-center justify-center min-w-[140px]">
              <span className="text-[10px] font-bold uppercase tracking-widest text-green-600 mb-0.5">Your Payout</span>
              <span className="text-2xl font-extrabold text-green-700">
                ${(parseFloat(job.final_provider_amount) > 0 
                    ? parseFloat(job.final_provider_amount) 
                    : (parseFloat(job.pricing?.total_provider_amount || job.provider_amount || 0) + parseFloat(job.overtime_earnings || 0))
                  ).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* 2-Column Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          
          {/* Main Action Flow (Left Column) */}
          <div className="lg:col-span-2 space-y-5">

        {/* Step Progress Bar */}
        {!isCompleted && (
          <div className="bg-white rounded-2xl border border-gray-200 px-5 py-4">
            <div className="flex items-center justify-between">
              {[
                { num: 1, label: 'Before Photos', done: hasBeforePhotos, active: !hasBeforePhotos },
                { num: 2, label: isInProgress ? 'In Progress' : 'Start Job', done: isInProgress || isCompleted, active: hasBeforePhotos && isConfirmed },
                { num: 3, label: 'After Photos', done: hasAfterPhotos, active: isInProgress && !hasAfterPhotos },
                { num: 4, label: 'Complete', done: isCompleted, active: isInProgress && hasAfterPhotos },
              ].map((step, i, arr) => (
                <React.Fragment key={step.num}>
                  <div className="flex flex-col items-center gap-1">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${step.done ? 'bg-green-500 text-white' :
                      step.active ? 'bg-green-600 text-white ring-4 ring-green-100' :
                        'bg-gray-100 text-gray-400'
                      }`}>
                      {step.done ? (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : step.num}
                    </div>
                    <span className={`text-[9px] font-semibold text-center leading-tight max-w-[52px] ${step.active ? 'text-green-700' : step.done ? 'text-green-500' : 'text-gray-400'
                      }`}>{step.label}</span>
                  </div>
                  {i < arr.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-1 mb-4 rounded ${step.done ? 'bg-green-400' : 'bg-gray-200'}`} />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {/* STEP 1: Before Photos */}
        {!isCompleted && !isInProgress && photos.before.length < 10 && (
          <div className="bg-white rounded-2xl border border-green-300 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-green-50 border border-green-200 flex items-center justify-center text-lg flex-shrink-0">📷</div>
              <div>
                <p className="text-[10px] text-green-600 font-bold uppercase tracking-widest">Step 1 — {photos.before.length > 0 ? 'Add More Photos' : 'Required'}</p>
                <h2 className="font-bold text-gray-900">{photos.before.length > 0 ? 'Upload More Before Photos' : 'Upload Before Photos'}</h2>
                <p className="text-xs text-gray-400 mt-0.5">Take photos of the area before starting work ({photos.before.length}/10)</p>
              </div>
            </div>
            <JobPhotoUpload
              bookingId={job.id}
              photoType="before"
              existingCount={Array.isArray(photos?.before) ? photos.before.length : 0}
              onUploadComplete={() => handlePhotoUpload('before')}
            />
          </div>
        )}

        {/* STEP 2: Timer (Only when NOT in progress) */}
        {!isCompleted && hasBeforePhotos && !isInProgress && (
          <div className="bg-white rounded-2xl border border-green-300 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-green-50 border border-green-200 flex items-center justify-center text-lg flex-shrink-0">
                ▶️
              </div>
              <div>
                <p className="text-[10px] text-green-600 font-bold uppercase tracking-widest">
                  Step 2 — Ready to Start
                </p>
                <h2 className="font-bold text-gray-900">
                  Start the Job
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Before photos done. Begin when ready.
                </p>
              </div>
            </div>

            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Before Photos ({photos.before.length})</p>
              <PhotoGrid photos={photos.before} label="Before" cols={5} onPhotoClick={setSelectedPhoto} />
            </div>

            <TimeTracker
              bookingId={job.id}
              onStart={handleJobStart}
              onComplete={handleJobComplete}
              standardDuration={duration}
              overtimeRate={overtimeRate}
              hasBeforePhotos={hasBeforePhotos}
              hasAfterPhotos={hasAfterPhotos}
            />
          </div>
        )}

         {/* STEP 4: Active Timer & Finish (Only when in progress) */}
        {!isCompleted && hasBeforePhotos && isInProgress && (
          <div className="bg-white rounded-2xl border border-green-300 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-green-50 border border-green-200 flex items-center justify-center text-lg flex-shrink-0">
                ⏱️
              </div>
              <div>
                <p className="text-[10px] text-green-600 font-bold uppercase tracking-widest">
                  Step 4 — Finish Job
                </p>
                <h2 className="font-bold text-gray-900">
                  Job In Progress
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Click Finish Job below when all work is done.
                </p>
              </div>
            </div>

            <TimeTracker
              bookingId={job.id}
              onStart={handleJobStart}
              onComplete={handleJobComplete}
              standardDuration={duration}
              overtimeRate={overtimeRate}
              hasBeforePhotos={hasBeforePhotos}
              hasAfterPhotos={hasAfterPhotos}
            />
          </div>
        )}

        {/* STEP 3: After Photos — shown the moment job is in_progress */}
        {isInProgress && (
          <div className={`bg-white rounded-2xl border p-5 ${!hasAfterPhotos ? 'border-amber-300 shadow-sm' : 'border-green-200'}`}>
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${!hasAfterPhotos ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'
                }`}>
                {hasAfterPhotos ? '✅' : '📸'}
              </div>
              <div>
                <p className={`text-[10px] font-bold uppercase tracking-widest ${!hasAfterPhotos ? 'text-amber-500' : 'text-green-600'}`}>
                  {!hasAfterPhotos ? 'Step 3 — Upload to Complete' : 'Step 3 — Done!'}
                </p>
                <h2 className="font-bold text-gray-900">After Work Photos</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {!hasAfterPhotos
                    ? 'Upload completed work photos — then scroll up and hit Complete ↑'
                    : `${photos.after.length} photo${photos.after.length > 1 ? 's' : ''} uploaded — scroll up and hit Complete ↑`}
                </p>
              </div>
            </div>

            {hasAfterPhotos && (
              <div className="mb-4">
                <PhotoGrid photos={photos.after} label="After" cols={5} onPhotoClick={setSelectedPhoto} />
              </div>
            )}
            
            {photos.after.length < 10 ? (
              <JobPhotoUpload
                bookingId={job.id}
                photoType="after"
                existingCount={Array.isArray(photos?.after) ? photos.after.length : 0}
                onUploadComplete={() => handlePhotoUpload('after')}
              />
            ) : (
              <div className="flex flex-col items-center justify-center p-6 bg-green-50 rounded-xl border border-green-200 text-green-700 mt-2">
                <span className="text-3xl mb-2">🎉</span>
                <p className="font-bold text-sm">Maximum 10 photos reached</p>
                <p className="text-xs opacity-80 mt-1 text-center max-w-xs">You have successfully uploaded the maximum allowed photos for this job.</p>
              </div>
            )}
          </div>
        )}

        {/* STEP 4: Active Timer & Finish (Only when in progress) */}
        {/* {!isCompleted && hasBeforePhotos && isInProgress && (
          <div className="bg-white rounded-2xl border border-green-300 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-green-50 border border-green-200 flex items-center justify-center text-lg flex-shrink-0">
                ⏱️
              </div>
              <div>
                <p className="text-[10px] text-green-600 font-bold uppercase tracking-widest">
                  Step 4 — Finish Job
                </p>
                <h2 className="font-bold text-gray-900">
                  Job In Progress
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Click Finish Job below when all work is done.
                </p>
              </div>
            </div>

            <TimeTracker
              bookingId={job.id}
              onStart={handleJobStart}
              onComplete={handleJobComplete}
              standardDuration={duration}
              overtimeRate={overtimeRate}
              hasBeforePhotos={hasBeforePhotos}
              hasAfterPhotos={hasAfterPhotos}
            />
          </div>
        )} */}

        {/* Completed Summary */}
        {isCompleted && (
          <div className="bg-white rounded-2xl border border-green-200 p-5">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center text-xl">✓</div>
              <div>
                <h2 className="font-bold text-green-700">
                  {job.status === 'awaiting_approval' ? 'Job Submitted' : 'Job Completed'}
                </h2>
                <p className="text-xs text-gray-400">
                  {job.status === 'awaiting_approval' ? 'Awaiting customer approval' : 'Great work!'}
                </p>
              </div>
            </div>
            <div className="text-sm divide-y divide-gray-100">
              <div className="flex justify-between py-2.5">
                <span className="text-gray-500">Started</span>
                <span className="font-medium">{formatDateTime(job.start_time)}</span>
              </div>
              <div className="flex justify-between py-2.5">
                <span className="text-gray-500">Completed</span>
                <span className="font-medium">{formatDateTime(job.end_time)}</span>
              </div>
              <div className="flex justify-between py-2.5">
                <span className="text-gray-500">Total Time</span>
                <span className="font-bold text-green-700">{formatDuration(job.actual_duration_minutes)}</span>
              </div>
              {job.overtime_minutes > 0 && (
                <div className="flex justify-between py-2.5">
                  <span className="text-gray-500">Overtime</span>
                  <span className="font-semibold text-purple-600">{formatDuration(job.overtime_minutes)}</span>
                </div>
              )}
            </div>

            {(photos.before.length > 0 || photos.after.length > 0) && (
              <div className="mt-5 pt-4 border-t border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Job Photos</h3>
                <div className="grid grid-cols-2 gap-3">
                  {photos.before.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Before ({photos.before.length})</p>
                      <PhotoGrid photos={photos.before} label="Before" cols={2} onPhotoClick={setSelectedPhoto} />
                    </div>
                  )}
                  {photos.after.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1">After ({photos.after.length})</p>
                      <PhotoGrid photos={photos.after} label="After" cols={2} onPhotoClick={setSelectedPhoto} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
          </div> {/* End Main Action Flow Column */}

          {/* Context Sidebar (Right Column) */}
          <div className="space-y-5 lg:sticky lg:top-24">
            
            <JobDetailsCard
              job={job}
              showContact={showContact}
              setShowContact={setShowContact}
            />

            {/* The crew is the provider's to pick once the job is theirs; an open-pool job has no provider_id yet */}
            {job.provider_id && <JobCrewPanel bookingId={job.id} />}

            {/* Customer Photos Gallery */}
            {job.photos?.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">📸</span>
                    <h2 className="font-bold text-gray-900 text-sm">Customer Photos</h2>
                  </div>
                  <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-[10px] font-bold">
                    {job.photos.length}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {job.photos.map((url, i) => (
                    <div key={i} onClick={() => setSelectedPhoto(url)}
                      className="aspect-square rounded-xl overflow-hidden bg-gray-100 cursor-pointer hover:opacity-90 transition border border-gray-100">
                      <img src={url} alt={`Customer Photo ${i + 1}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-3 italic">* Click any photo to view full size</p>
              </div>
            )}

          </div> {/* End Context Sidebar */}

        </div> {/* End Grid Layout */}


        {/* Customer Photos */}
        {/* {job.photos?.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">📸</span>
              <h2 className="font-bold text-gray-900">Customer Photos ({job.photos.length})</h2>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {job.photos.map((url, i) => (
                <div key={i} onClick={() => setSelectedPhoto(url)}
                  className="aspect-square rounded-xl overflow-hidden bg-gray-100 cursor-pointer hover:opacity-90 transition border border-gray-100">
                  <img src={url} alt={`Customer Photo ${i + 1}`} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3 italic">* Click any photo to view full size</p>
          </div>
        )} */}

        {/* Job Details (collapsible) - Pass job as prop */}
        {/* <JobDetailsCard
          job={job}
          showContact={showContact}
          setShowContact={setShowContact}
        /> */}

        {/* Image Preview Modal */}
        {selectedPhoto && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm" onClick={() => setSelectedPhoto(null)}>
            <div className="relative max-w-4xl w-full h-full flex items-center justify-center">
              <button 
                onClick={(e) => { e.stopPropagation(); setSelectedPhoto(null); }}
                className="absolute top-4 right-4 w-10 h-10 bg-white/20 hover:bg-white/40 text-white rounded-full flex items-center justify-center transition backdrop-blur-md z-10"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <img 
                src={selectedPhoto} 
                className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl" 
                onClick={(e) => e.stopPropagation()} 
                alt="Enlarged view"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  const config = {
    confirmed: { label: 'Confirmed', classes: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
    in_progress: { label: 'In Progress', classes: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
    completed: { label: 'Completed', classes: 'bg-green-50 text-green-700 ring-1 ring-green-200' },
  }
  const cfg = config[status] || { label: status, classes: 'bg-gray-100 text-gray-600' }
  return <span className={`px-3 py-1 rounded-full text-xs font-semibold ${cfg.classes}`}>{cfg.label}</span>
}

function JobDetailsCard({ job, showContact, setShowContact }) {
  // Define these inside the component using job data
  const hasParking = job ? !!job.parking_access : false
  const hasElevator = job ? !!job.elevator_access : false
  const hasPets = job ? !!job.has_pets : false

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50 bg-gray-50/50">
        <span className="font-bold text-gray-900 text-sm flex items-center gap-2">
          <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Job Details
        </span>
      </div>
      <div className="px-5 pb-5 pt-4 space-y-4">
          {['confirmed', 'in_progress', 'completed'].includes(job.status) && (
            <div className="bg-green-50/50 rounded-xl p-4 border border-green-100">
              <div className="flex items-center gap-2 text-sm font-bold text-green-800 mb-3">
                <span>👤</span> Customer Contact
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-gray-400 w-12">Name</span>
                  <span className="font-semibold text-gray-900">{job.customer_first_name} {job.customer_last_name}</span>
                </div>
                  {job.customer_phone && (
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-gray-400 w-12">Phone</span>
                      <a href={`tel:${job.customer_phone}`} className="text-blue-600">{job.customer_phone}</a>
                    </div>
                  )}
                  {job.customer_email && (
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-gray-400 w-12">Email</span>
                      <a href={`mailto:${job.customer_email}`} className="text-blue-600 truncate">{job.customer_email}</a>
                    </div>
                  )}
                  <div className="flex gap-2 mt-3">
                    {job.customer_phone && (
                      <>
                        <a href={`tel:${job.customer_phone}`} className="flex-1 py-2 bg-green-600 text-white rounded-xl text-xs font-semibold text-center">Call</a>
                        <a href={`https://wa.me/${job.customer_phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex-1 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold text-center">WhatsApp</a>
                      </>
                    )}
                    {job.customer_email && (
                      <a href={`mailto:${job.customer_email}`} className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold text-center">Email</a>
                    )}
                  </div>
                </div>
              </div>
            )}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Date</p>
              <p className="font-medium">
                {job.job_date 
                  ? (job.job_date.includes(',') 
                      ? job.job_date.split(',').map(d => new Date(d.trim()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })).join(', ')
                      : new Date(job.job_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))
                  : '—'}
              </p>
            </div>
            {job.job_time_slot?.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Time</p>
                <div className="flex flex-wrap gap-1">
                  {job.job_time_slot.map((slot, i) => (
                    <span key={i} className="px-2 py-0.5 bg-green-100 text-green-800 rounded text-xs">{slot}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="text-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Location</p>
            <p className="font-medium">{job.address_line1}</p>
            {job.address_line2 && <p className="text-gray-500">{job.address_line2}</p>}
            {job.city && <p className="text-gray-500">{job.city} {job.postal_code}</p>}
          </div>

          {/* Fixed: hasParking, hasElevator, hasPets are now defined inside this component */}
          {(hasParking || hasElevator || hasPets) && (
            <div className="flex flex-wrap gap-2">
              {hasParking && <span className="text-xs bg-green-50 text-green-700 px-3 py-1 rounded-full border border-green-200">Parking</span>}
              {hasElevator && <span className="text-xs bg-green-50 text-green-700 px-3 py-1 rounded-full border border-green-200">Elevator</span>}
              {hasPets && <span className="text-xs bg-amber-50 text-amber-700 px-3 py-1 rounded-full border border-amber-200">Pets on site</span>}
            </div>
          )}

          {job.job_description && (
            <div className="text-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Description</p>
              <p className="text-gray-700 leading-relaxed whitespace-pre-wrap break-all break-words">{job.job_description}</p>
            </div>
          )}
          {job.instructions && (
            <div className="text-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Special Instructions</p>
              <p className="text-gray-700 leading-relaxed whitespace-pre-wrap break-all break-words">{job.instructions}</p>
            </div>
          )}
      </div>
    </div>
  )
}

function PhotoGrid({ photos, label, cols = 3, onPhotoClick }) {
  const gridClasses = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-2 sm:grid-cols-4',
    5: 'grid-cols-3 sm:grid-cols-5'
  };
  const gridClass = gridClasses[cols] || 'grid-cols-3';

  return (
    <div className={`grid ${gridClass} gap-2`}>
      {photos.map((photo, index) => (
        <div key={index} onClick={() => onPhotoClick?.(photo.photo_url)}
          className="aspect-square rounded-xl overflow-hidden bg-gray-100 cursor-pointer hover:opacity-90 border border-gray-200 transition-opacity">
          <img src={photo.photo_url} alt={`${label} ${index + 1}`} className="w-full h-full object-cover" />
        </div>
      ))}
    </div>
  )
}




















