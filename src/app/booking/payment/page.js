'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Lock, Timer } from 'lucide-react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import SeriesConsent from '@/components/booking/SeriesConsent';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { dayLabel } from '@/lib/booking-answers';
import { isRepeating } from '@/lib/when-and-where';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });

// ✅ Payment success ke baad booking create hoti hai
function PaymentForm({ pendingBookingData, clientSecret, onSuccess, onBack }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [paymentReference, setPaymentReference] = useState(null);
  const bookingCreatedRef = useRef(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements || bookingCreatedRef.current) return;

    setProcessing(true);
    setError(null);

    try {
      // Step 1: Stripe payment authorize karo
      const { error: confirmError } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/booking/verify`,
        },
        redirect: 'if_required',
      });

      if (confirmError) {
        setError(confirmError.message);
        setProcessing(false);
        return;
      }

      // Step 2: Card payment (no redirect) ke liye direct booking create karo
      // Agar redirect hua, toh ye code nahi chalega (Verify page sambhal lega)
      const { paymentIntent } = await stripe.retrievePaymentIntent(clientSecret);

      if (paymentIntent && (paymentIntent.status === 'requires_capture' || paymentIntent.status === 'succeeded')) {

        bookingCreatedRef.current = true;

        const res = await fetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...pendingBookingData,
            payment_intent_id: paymentIntent.id,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (data.success) {
          sessionStorage.setItem('lastBooking', JSON.stringify({
            ...pendingBookingData,
            booking_id: data.booking_id,
            booking_number: data.booking_number,
            service_price: data.service_price,
            additional_price: data.overtime_rate,
          }));
          sessionStorage.removeItem('pendingBooking');
          sessionStorage.removeItem('bookingFlow');
          onSuccess(data.booking_id);
        } else {
          // bookingCreatedRef stays set: this form does not send the same payment with a booking again.
          setError(data.message || 'Payment authorized but booking creation failed.');
          setPaymentReference(paymentIntent.id);
          setProcessing(false);
        }
      }
    } catch (err) {
      console.error('Payment/Booking error:', err);
      setError('Something went wrong. Please try again.');
      bookingCreatedRef.current = false;
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
      <PaymentElement />

      {error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-xs sm:text-sm">
          <p>{error}</p>
          {paymentReference && (
            <>
              <p className="mt-1 break-all">Payment reference: {paymentReference}</p>
              <button
                type="button"
                onClick={onBack}
                className="mt-3 inline-block bg-white border border-line text-ink px-6 py-2.5 rounded-2xl font-semibold text-sm hover:border-ink/40 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >← Go Back</button>
            </>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || processing || paymentReference !== null}
        className="w-full min-h-[52px] bg-brand-500 text-white py-3 sm:py-4 px-4 rounded-2xl font-bold text-base sm:text-lg shadow-lg shadow-brand-600/20 hover:bg-brand-600 transition active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {processing ? (
          <>
            <svg className="motion-safe:animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Authorizing & Confirming Booking...
          </>
        ) : (
          'Authorize Payment & Confirm Booking'
        )}
      </button>

      <p className="text-xs text-center text-ink-muted px-2">
        <Lock aria-hidden="true" className="inline-block -mt-0.5 mr-1 h-3.5 w-3.5 text-brand-600" />Your booking is confirmed only after successful payment authorization.
      </p>
    </form>
  );
}

export default function PaymentPage() {
  const router = useRouter();
  const [pendingBookingData, setPendingBookingData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [clientSecret, setClientSecret] = useState(null);
  const [heldAmount, setHeldAmount] = useState(null);
  const [overtimeRate, setOvertimeRate] = useState(null);
  const [fetchingIntent, setFetchingIntent] = useState(false);
  const [intentError, setIntentError] = useState(null);

  const intentFetchedRef = useRef(false);

  useEffect(() => {
    if (intentFetchedRef.current) return;
    intentFetchedRef.current = true;
    sessionStorage.removeItem('prefetchedClientSecret');
    const pending = sessionStorage.getItem('pendingBooking');
    if (pending) {
      const parsed = JSON.parse(pending);
      setPendingBookingData(parsed);
      createPaymentIntent(parsed);
      loadOvertimeRate(parsed.service_id);
    } else {
      router.push('/services');
    }
    setLoading(false);
  }, [router]);

  // ✅ Sirf Stripe payment intent create karo — NO booking in DB yet
  const createPaymentIntent = async (bookingData) => {
    setFetchingIntent(true);
    setIntentError(null);
    try {
      // The hold is created here, once per visit, for the answers in the pending booking.
      const res = await fetch('/api/payment/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: bookingData.service_id,
          answers: bookingData.answers || {},
        }),
      });
      const data = await res.json().catch(() => ({}));
      const refused = res.status === 400 && data.success === false;
      if (data.success && data.client_secret) {
        setClientSecret(data.client_secret);
        setHeldAmount(Number.isFinite(data.amount) ? data.amount : null);
      } else if (res.status === 401) {
        setIntentError({ kind: 'session' });
      } else if (refused && !data.field) {
        setIntentError({ kind: 'unavailable' });
      } else if (refused && data.message) {
        setIntentError({ kind: 'answers', message: data.message });
      } else {
        setIntentError({ kind: 'failed' });
      }
    } catch (err) {
      console.error('Payment intent error:', err);
      setIntentError({ kind: 'failed' });
    } finally {
      setFetchingIntent(false);
    }
  };

  const loadOvertimeRate = async (serviceId) => {
    if (!serviceId) return;
    try {
      const res = await fetch(`/api/services?id=${encodeURIComponent(serviceId)}`);
      const data = await res.json();
      const row = data.success && data.data && !Array.isArray(data.data) ? data.data : null;
      const rate = row ? Number(row.additional_price) : NaN;
      if (rate > 0) setOvertimeRate(rate);
    } catch (err) {
      console.error('Service lookup error:', err);
    }
  };

  const handlePaymentSuccess = (bookingId) => {
    router.push(`/booking/success/${bookingId}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3">
          <div className="motion-safe:animate-spin rounded-full h-10 w-10 border-[3px] border-brand-500/20 border-t-brand-500"></div>
          <p className="text-sm sm:text-base text-ink-muted">Loading payment details...</p>
        </div>
      </div>
    );
  }

  if (!pendingBookingData) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <h2 className="font-display text-2xl font-semibold text-ink mb-2">Booking not found</h2>
          <Link href="/services" className="text-brand-700 font-semibold hover:underline text-sm sm:text-base">Browse services</Link>
        </div>
      </div>
    );
  }

  const jobDates = (Array.isArray(pendingBookingData.job_date)
    ? pendingBookingData.job_date
    : String(pendingBookingData.job_date || '').split(','))
    .map((d) => String(d).trim())
    .filter(Boolean);
  // A booking that repeats holds one date, its first visit's, which the summary calls its start.
  const repeating = isRepeating(pendingBookingData.answers?.frequency);

  return (
    <div className="min-h-screen bg-paper font-sans antialiased text-ink">
      <Header />

      <div className="container mx-auto px-5 sm:px-6 max-w-7xl py-8 md:py-12">
        <div className="max-w-2xl mx-auto">

          {/* Progress Bar - Payment */}
          <div className="mb-4 sm:mb-6 md:mb-8">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <span className="text-xs font-semibold tracking-[0.12em] text-brand-700 bg-brand-50 border border-brand-100 px-3 sm:px-3.5 py-1 sm:py-1.5 rounded-full">
                PAYMENT
              </span>
              <span className="text-xs sm:text-sm text-ink-muted font-medium">Authorize & Confirm</span>
            </div>
            <div className="h-1.5 sm:h-2 bg-paper-deep rounded-full overflow-hidden">
              <div className="h-full bg-brand-500 rounded-full" style={{ width: '100%' }}></div>
            </div>
          </div>

          {/* Main Card */}
          <div className="bg-white rounded-[28px] border border-line shadow-lift overflow-hidden">
            <div className="px-5 sm:px-6 md:px-8 pt-7 pb-6 border-b border-line text-center">
              <div className="w-14 h-14 bg-brand-50 border border-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-ink mb-2">Authorize & Confirm Booking</h1>
              <p className="text-ink-soft text-sm px-2">
                Your booking is confirmed only after successful payment authorization
              </p>
            </div>

            <div className="p-5 sm:p-6 md:p-8">
              {/* Booking Summary */}
              <div className="mb-5 sm:mb-6 p-4 sm:p-5 bg-paper rounded-2xl border border-line">
                <h3 className="font-display font-semibold text-ink text-base sm:text-lg mb-3">Booking Summary</h3>
                <div className="space-y-1.5 sm:space-y-2 text-xs sm:text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="shrink-0 text-ink-muted">Service:</span>
                    <span className="font-medium text-ink text-right break-words max-w-[60%]">{pendingBookingData.service_name}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="shrink-0 text-ink-muted">{repeating ? 'Starts:' : 'Dates:'}</span>
                    <span className="font-medium text-ink text-right flex flex-col items-end text-xs sm:text-sm">
                      {jobDates.map((d, i) => (
                        <span key={`${d}-${i}`}>{dayLabel(d, 'long')}</span>
                      ))}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="shrink-0 text-ink-muted">Address:</span>
                    <span className="font-medium text-ink text-right break-words max-w-[60%]">{pendingBookingData.address_line1}</span>
                  </div>

                  <div className="pt-2 border-t border-line">
                    {overtimeRate !== null && (
                      <div className="mt-2 sm:mt-3 p-2.5 sm:p-3 bg-white border border-line rounded-xl">
                        <p className="text-xs sm:text-sm font-medium text-ink-soft">
                          <Timer aria-hidden="true" className="inline-block -mt-0.5 mr-1.5 h-4 w-4 text-brand-600" />Overtime: {cad.format(overtimeRate)}/hr (Billed separately if used)
                        </p>
                      </div>
                    )}

                    {heldAmount !== null && (
                      <div className="flex justify-between items-baseline gap-2 pt-2 sm:pt-3 mt-2 border-t border-line">
                        <span className="font-semibold text-ink text-xs sm:text-sm">Amount held on your card</span>
                        <span className="font-display font-semibold text-ink text-lg sm:text-xl md:text-2xl">{cad.format(heldAmount)}</span>
                      </div>
                    )}

                    <SeriesConsent answers={pendingBookingData.answers} className="mt-2 sm:mt-3" />
                  </div>
                </div>
              </div>

              {/* Payment Element */}
              {fetchingIntent ? (
                <div className="flex flex-col items-center py-8 gap-3">
                  <div className="motion-safe:animate-spin rounded-full h-10 w-10 border-[3px] border-brand-500/20 border-t-brand-500"></div>
                  <p className="text-sm text-ink-muted">Setting up payment...</p>
                </div>
              ) : intentError ? (
                <div role="alert" className="text-center py-6">
                  {intentError.kind === 'session' ? (
                    <>
                      <p className="text-red-600 text-sm mb-4">Your session has expired. Please sign in again to finish your booking.</p>
                      <Link
                        href="/login?redirect=/booking/payment"
                        className="inline-block bg-brand-500 text-white px-6 py-2.5 rounded-2xl font-semibold text-sm shadow-lg shadow-brand-600/20 hover:bg-brand-600 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                      >Log In</Link>
                    </>
                  ) : intentError.kind === 'answers' ? (
                    <>
                      <p className="text-red-600 text-sm mb-4">{intentError.message}</p>
                      <Link
                        href={`/booking/schedule?service=${encodeURIComponent(pendingBookingData.service_id)}&step=1`}
                        className="inline-block bg-brand-500 text-white px-6 py-2.5 rounded-2xl font-semibold text-sm shadow-lg shadow-brand-600/20 hover:bg-brand-600 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                      >Change your answers</Link>
                    </>
                  ) : intentError.kind === 'unavailable' ? (
                    <>
                      <p className="text-red-600 text-sm mb-4">This service isn&apos;t available for booking right now.</p>
                      <Link
                        href="/services"
                        className="inline-block bg-brand-500 text-white px-6 py-2.5 rounded-2xl font-semibold text-sm shadow-lg shadow-brand-600/20 hover:bg-brand-600 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                      >Browse services</Link>
                    </>
                  ) : (
                    <>
                      <p className="text-red-600 text-sm mb-4">Could not initialize payment. Please go back and try again.</p>
                      <button
                        onClick={() => router.push('/booking/confirm')}
                        className="inline-block bg-white border border-line text-ink px-6 py-2.5 rounded-2xl font-semibold text-sm hover:border-ink/40 transition"
                      >← Go Back</button>
                    </>
                  )}
                </div>
              ) : clientSecret ? (
                <Elements stripe={stripePromise} options={{ 
                  clientSecret,
                  appearance: { theme: 'stripe' },
                  paymentMethodOrder: ['card', 'apple_pay', 'google_pay', 'amazon_pay', 'revolut_pay']
                }}>
                  <PaymentForm
                    pendingBookingData={pendingBookingData}
                    clientSecret={clientSecret}
                    onSuccess={handlePaymentSuccess}
                    onBack={() => router.push('/booking/confirm')}
                  />
                </Elements>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}