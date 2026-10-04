// app/booking/success/[id]/page.jsx
'use client';

import Link from 'next/link';
import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { useAuth } from 'src/context/AuthContext';

export default function BookingSuccessPage({ params }) {
  const unwrappedParams = use(params);
  const bookingId = unwrappedParams.id;

  const router = useRouter();
  const { user } = useAuth();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);

  useEffect(() => {
    if (bookingId) fetchBooking();
  }, [bookingId]);

  // GET /api/bookings/[id] is admin-only, so this page never asks it. The receipt comes from the booking this tab saved
  // right after checkout (booking/verify and booking/payment write sessionStorage.lastBooking before they open the page),
  // or, for a signed-in owner, from their own booking-details; anything else gets the same fixed message.
  const fetchBooking = async () => {
    try {
      let saved = null;
      try {
        saved = JSON.parse(sessionStorage.getItem('lastBooking'));
      } catch {
        saved = null; // no saved booking, or one that does not parse
      }
      if (saved && String(saved.booking_id) === String(bookingId)) {
        // The saved booking names the customer fields first_name, last_name, email and phone; the markup reads customer_*.
        setBooking({
          ...saved,
          customer_first_name: saved.first_name,
          customer_last_name: saved.last_name,
          customer_email: saved.email,
          customer_phone: saved.phone,
        });
        return;
      }

      // The session cookie rides along on a same-origin fetch, as it does on the my-bookings page; the route answers an array.
      const res = await fetch(`/api/customer/booking-details?bookingId=${encodeURIComponent(bookingId)}`);
      const data = await res.json();
      if (data.success && data.data?.[0]) {
        setBooking(data.data[0]);
      } else {
        // Never the response's own message: a refusal and a missing booking read the same here.
        setError("We can't show this booking here. If you have an account, sign in and open My Bookings.");
      }
    } catch (err) {
      console.error('Error:', err);
      setError('Failed to load booking details');
    } finally {
      setLoading(false);
    }
  };

  const formatTimeSlot = (slot) => {
    if (!slot) return '';
    const map = {
      morning: '🌅 Morning (8am–12pm)',
      afternoon: '☀️ Afternoon (12pm–4pm)',
      evening: '🌙 Evening (4pm–8pm)',
    };
    if (Array.isArray(slot)) return slot.map((s) => map[s] || s).join(', ');
    return map[slot] || slot;
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f4f0] flex items-center justify-center">
        <div className="text-center">
          <div className="w-14 h-14 rounded-full border-4 border-green-700 border-t-transparent animate-spin mx-auto mb-4" />
          <p className="text-gray-500 text-sm tracking-wide">Loading your receipt…</p>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error || !booking) {
    return (
      <div className="min-h-screen bg-[#f5f4f0] font-sans">
        <Header />
        <div className="container mx-auto px-4 py-20 max-w-md">
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Booking Not Found</h2>
            <p className="text-gray-500 text-sm mb-6">{error || "This booking doesn't exist."}</p>
            <Link href="/" className="bg-green-700 text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-green-800 transition">
              Return Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Price calculations ───────────────────────────────────────────────────────
  const basePrice   = parseFloat(booking.service_price   || 0);
  const hourlyRate  = parseFloat(booking.additional_price || 0);
  const totalPaid   = basePrice;

  return (
    <div className="min-h-screen bg-[#f5f4f0] font-sans antialiased">
      <Header />

      <div className="container mx-auto px-4 py-10 md:py-16 max-w-2xl">

        {/* ── Success banner ────────────────────────────────────────────────── */}
        <div className="bg-gradient-to-br from-green-800 via-green-700 to-green-600 rounded-2xl px-6 py-10 text-center mb-6 shadow-xl relative overflow-hidden">
          {/* decorative rings */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-64 h-64 rounded-full border border-white/10" />
          </div>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-96 h-96 rounded-full border border-white/5" />
          </div>

          <div className="relative z-10">
            <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center mx-auto mb-4 ring-4 ring-white/30">
              <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight mb-1">
              Booking Confirmed!
            </h1>
            <p className="text-green-100 text-base">Your job request has been submitted successfully</p>

            {/* Booking number pill */}
            <div className="mt-5 inline-block bg-white/15 backdrop-blur border border-white/25 rounded-full px-5 py-2">
              <span className="text-xs text-green-100 uppercase tracking-widest block mb-0.5">Booking Number</span>
              <span className="text-white font-bold text-lg tracking-wider">{booking.booking_number}</span>
            </div>
          </div>
        </div>

        {/* ── Invoice card ─────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden mb-6">

          {/* Invoice header strip */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-700" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
              </svg>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Invoice Summary</span>
            </div>
            <span className="text-xs text-gray-400">
              {booking.job_date 
                ? (booking.job_date.includes(',') 
                    ? booking.job_date.split(',').map(d => new Date(d.trim()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })).join(', ')
                    : new Date(booking.job_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))
                : '—'}
            </span>
          </div>

          <div className="px-6 py-6 space-y-5">

            {/* ── Service details rows ─────────────────────────────────────── */}
            <div className="space-y-3">
              {[
                { label: 'Service',  value: booking.service_name },
                { label: 'Date',     value: booking.job_date 
                                            ? (booking.job_date.includes(',') 
                                                ? booking.job_date.split(',').map(d => new Date(d.trim()).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })).join(', ')
                                                : new Date(booking.job_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))
                                            : '—' },
                { label: 'Time',     value: formatTimeSlot(booking.job_time_slot) },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-start py-2 border-b border-dashed border-gray-100">
                  <span className="text-sm text-gray-500 min-w-[90px]">{label}</span>
                  <span className="text-sm font-semibold text-gray-800 text-right">{value}</span>
                </div>
              ))}
            </div>

            {/* ── Price breakdown (invoice-style) ─────────────────────────── */}
            <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
              
              {/* Header */}
              <div className="bg-gray-100 px-4 py-2.5">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Payment Breakdown</span>
              </div>

              <div className="px-4 py-3 space-y-1">

                {/* Base price row */}
                <div className="flex justify-between items-center py-2.5 border-b border-gray-200">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Base Service Price</p>
                    <p className="text-xs text-gray-400">Flat rate for {booking.service_name}</p>
                  </div>
                  <span className="text-sm font-bold text-gray-900">${basePrice.toFixed(2)}</span>
                </div>

                {/* Paid total */}
                <div className="flex justify-between items-center pt-3 pb-1">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Total Paid</p>
                    <p className="text-xs text-gray-400">Card charged successfully</p>
                  </div>
                  <span className="text-xl font-extrabold text-green-700">${totalPaid.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Overtime rate info box */}
            {hourlyRate > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3 items-start">
                <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-blue-800">⏱️ Overtime Rate: ${hourlyRate.toFixed(2)}/hour</p>
                  <p className="text-xs text-blue-700 mt-1 leading-relaxed">
                    If the job runs longer than estimated, you&apos;ll be billed at <strong>${hourlyRate.toFixed(2)}/hr</strong> for extra time. 
                    You must approve any additional hours <em>before</em> they are worked.
                  </p>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* ── Info cards row ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">

          {/* Customer info */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
              </div>
              <h4 className="text-sm font-semibold text-gray-800">Your Information</h4>
            </div>
            <div className="space-y-1 text-sm text-gray-600">
              <p className="font-semibold text-gray-800">{booking.customer_first_name} {booking.customer_last_name}</p>
              <p>{booking.customer_email}</p>
              {booking.customer_phone && <p>{booking.customer_phone}</p>}
            </div>
          </div>

          {/* Location */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center">
                <svg className="w-4 h-4 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                </svg>
              </div>
              <h4 className="text-sm font-semibold text-gray-800">Service Location</h4>
            </div>
            <div className="space-y-0.5 text-sm text-gray-600">
              <p>{booking.address_line1}</p>
              {booking.address_line2 && <p>{booking.address_line2}</p>}
              <p>{booking.city}{booking.postal_code ? `, ${booking.postal_code}` : ''}</p>
            </div>
          </div>
        </div>

        {/* ── What's next ───────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
              <svg className="w-4 h-4 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
              </svg>
            </div>
            <h4 className="text-sm font-semibold text-gray-800">What happens next?</h4>
          </div>

          <div className="space-y-3">
            {[
              { step: '1', text: "We're matching you with trusted pros in your area" },
              { step: '2', text: "You'll get notified when pros show interest in your job" },
              { step: '3', text: 'Review profiles and choose the best pro for your job' },
              { step: '4', text: 'Payment is released only after job is completed & approved' },
            ].map(({ step, text }) => (
              <div key={step} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-green-700 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {step}
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Photos ───────────────────────────────────────────────────────── */}
        {booking.photos && booking.photos.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center">
                <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                </svg>
              </div>
              <h4 className="text-sm font-semibold text-gray-800">Attached Photos ({booking.photos.length})</h4>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {booking.photos.slice(0, 6).map((photo, i) => (
                <div 
                  key={i} 
                  className="relative group cursor-pointer overflow-hidden rounded-xl border border-gray-100"
                  onClick={() => setSelectedImage(photo)}
                >
                  <img 
                    src={photo} 
                    alt={`Photo ${i + 1}`} 
                    className="w-full h-24 object-contain transition-transform duration-300 group-hover:scale-110" 
                  />
                  <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Action buttons ────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/"
            className="flex-1 flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 text-white py-3.5 rounded-xl font-semibold text-sm transition shadow-md"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Return Home
          </Link>
          <Link
            href="/my-bookings"
            className="flex-1 flex items-center justify-center gap-2 border-2 border-green-700 text-green-700 hover:bg-green-50 py-3.5 rounded-xl font-semibold text-sm transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            View My Bookings
          </Link>
        </div>

        {/* ── Trust badge + support ─────────────────────────────────────────── */}
        <div className="mt-6 flex flex-col items-center gap-3">
          <div className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-full px-4 py-2 shadow-sm">
            <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-xs text-gray-600 font-medium">Protected by WorkOnTap Guarantee</span>
          </div>
          <p className="text-xs text-gray-400">
            Need help?{' '}
            <Link href="/contact" className="text-green-700 hover:underline font-medium">
              Contact Support
            </Link>
          </p>
        </div>

      </div>

      {/* ── Photo Lightbox ────────────────────────────────────────────────── */}
      {selectedImage && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 md:p-10 animate-in fade-in duration-300"
          onClick={() => setSelectedImage(null)}
        >
          <button 
            onClick={() => setSelectedImage(null)}
            className="absolute top-6 right-6 w-12 h-12 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors group"
          >
            <svg className="w-6 h-6 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          
          <div className="relative max-w-5xl w-full h-full flex items-center justify-center">
            <img 
              src={selectedImage} 
              alt="Full size" 
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}