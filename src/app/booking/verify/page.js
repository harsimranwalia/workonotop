'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

function VerifyPaymentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState('processing'); // processing, success, error
  const [message, setMessage] = useState('Verifying your payment authorization...');
  const [paymentReference, setPaymentReference] = useState(null);
  const bookingCreatedRef = useRef(false);

  useEffect(() => {
    const clientSecret = searchParams.get('payment_intent_client_secret');
    if (!clientSecret) {
      router.push('/services');
      return;
    }

    const verifyPayment = async () => {
      const stripe = await stripePromise;
      if (!stripe) return;

      const { paymentIntent, error } = await stripe.retrievePaymentIntent(clientSecret);

      if (error) {
        setStatus('error');
        setMessage(error.message || 'Failed to verify payment.');
        return;
      }

      if (paymentIntent.status === 'requires_capture' || paymentIntent.status === 'succeeded') {
        // Payment authorized! Now create the booking if we haven't already
        await createBooking(paymentIntent.id);
      } else {
        setStatus('error');
        setMessage(`Payment status: ${paymentIntent.status}. Please try again.`);
      }
    };

    verifyPayment();
  }, [searchParams, router]);

  const createBooking = async (paymentIntentId) => {
    if (bookingCreatedRef.current) return;
    bookingCreatedRef.current = true;

    try {
      const pending = sessionStorage.getItem('pendingBooking');
      if (!pending) {
        setStatus('error');
        setMessage('Booking details not found in session. Please contact support.');
        return;
      }

      const pendingData = JSON.parse(pending);
      
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...pendingData,
          payment_intent_id: paymentIntentId,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (data.success) {
        setStatus('success');
        setMessage('Booking confirmed! Redirecting...');
        
        sessionStorage.setItem('lastBooking', JSON.stringify({
          ...pendingData,
          booking_id: data.booking_id,
          booking_number: data.booking_number,
          service_price: data.service_price,
          additional_price: data.overtime_rate,
        }));
        sessionStorage.removeItem('pendingBooking');
        sessionStorage.removeItem('bookingFlow');

        // Redirect to success page
        setTimeout(() => {
          router.push(`/booking/success/${data.booking_id}`);
        }, 1500);
      } else {
        setStatus('error');
        setMessage(data.message || 'Payment authorized but booking creation failed.');
        setPaymentReference(paymentIntentId);
      }
    } catch (err) {
      console.error('Verify booking error:', err);
      setStatus('error');
      setMessage('Something went wrong while confirming your booking.');
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-4 py-12">
      <div className="max-w-md w-full bg-white rounded-[28px] shadow-lift p-6 sm:p-8 text-center border border-line">
        {status === 'processing' && (
          <>
            <div className="w-12 h-12 border-[3px] border-brand-500/20 border-t-brand-500 rounded-full motion-safe:animate-spin mx-auto mb-6"></div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink mb-2">Verifying Payment</h1>
            <p className="text-ink-muted text-sm">{message}</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-16 h-16 bg-brand-50 border border-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink mb-2">Payment Authorized!</h1>
            <p className="text-ink-muted text-sm">{message}</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="w-16 h-16 bg-red-50 border border-red-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink mb-2">Verification Failed</h1>
            <div role="alert" className="text-red-700 text-sm mb-6">
              <p>{message}</p>
              {paymentReference && <p className="mt-1 break-all">Payment reference: {paymentReference}</p>}
            </div>
            <button
              onClick={() => router.push('/booking/payment')}
              className="w-full min-h-[52px] bg-brand-500 text-white py-3.5 rounded-2xl font-bold hover:bg-brand-600 transition shadow-lg shadow-brand-600/20"
            >
              Try Again
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyPaymentPage() {
  return (
    <div className="min-h-screen bg-paper flex flex-col">
      <Header />
      <Suspense fallback={
        <div className="flex-1 flex items-center justify-center p-4 py-12">
          <div className="max-w-md w-full bg-white rounded-[28px] shadow-lift p-6 sm:p-8 text-center border border-line">
            <div className="w-12 h-12 border-[3px] border-brand-500/20 border-t-brand-500 rounded-full motion-safe:animate-spin mx-auto mb-6"></div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink mb-2">Loading Verification</h1>
            <p className="text-ink-muted text-sm">Please wait...</p>
          </div>
        </div>
      }>
        <VerifyPaymentContent />
      </Suspense>
      <Footer />
    </div>
  );
}

