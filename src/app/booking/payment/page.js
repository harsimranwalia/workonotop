'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { dayLabel } from '@/lib/booking-answers';

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
        <div role="alert" className="p-2 sm:p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs sm:text-sm">
          <p>{error}</p>
          {paymentReference && (
            <>
              <p className="mt-1 break-all">Payment reference: {paymentReference}</p>
              <button
                type="button"
                onClick={onBack}
                className="mt-3 inline-block bg-gray-200 text-gray-800 px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-gray-300 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
              >← Go Back</button>
            </>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || processing || paymentReference !== null}
        className="w-full bg-gradient-to-r from-green-700 to-green-600 text-white py-3 sm:py-4 rounded-xl font-bold text-base sm:text-lg shadow-lg hover:from-green-800 hover:to-green-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
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

      <p className="text-[10px] sm:text-xs text-center text-gray-500 px-2">
        🔒 Your booking is confirmed only after successful payment authorization.
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
          <div className="motion-safe:animate-spin rounded-full h-12 sm:h-16 w-12 sm:w-16 border-4 border-green-500 border-t-transparent"></div>
          <p className="text-sm sm:text-base text-gray-600">Loading payment details...</p>
        </div>
      </div>
    );
  }

  if (!pendingBookingData) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mb-2">Booking not found</h2>
          <Link href="/services" className="text-green-700 hover:underline text-sm sm:text-base">Browse services</Link>
        </div>
      </div>
    );
  }

  const jobDates = (Array.isArray(pendingBookingData.job_date)
    ? pendingBookingData.job_date
    : String(pendingBookingData.job_date || '').split(','))
    .map((d) => String(d).trim())
    .filter(Boolean);

  return (
    <div className="min-h-screen bg-gray-50/50 font-sans antialiased">
      <Header />

      <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 md:py-8">
        <div className="max-w-2xl mx-auto">

          {/* Progress Bar - Payment */}
          <div className="mb-4 sm:mb-6 md:mb-8">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <span className="text-[10px] sm:text-xs font-bold text-green-700 bg-green-100 px-2 sm:px-4 py-1 sm:py-1.5 rounded-full">
                PAYMENT
              </span>
              <span className="text-[10px] sm:text-xs text-gray-500 font-medium">Authorize & Confirm</span>
            </div>
            <div className="h-1.5 sm:h-2 md:h-2.5 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-green-600 to-green-500 rounded-full" style={{ width: '100%' }}></div>
            </div>
          </div>

          {/* Main Card */}
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg sm:shadow-xl overflow-hidden">
            <div className="bg-gradient-to-r from-green-800 to-green-700 px-4 sm:px-6 py-4 sm:py-6 md:py-8 text-center">
              <div className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-2 sm:mb-3 md:mb-4 backdrop-blur-sm">
                <svg className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-white mb-1 sm:mb-2">Authorize & Confirm Booking</h1>
              <p className="text-green-100 text-xs sm:text-sm px-2">
                Your booking is confirmed only after successful payment authorization
              </p>
            </div>

            <div className="p-4 sm:p-5 md:p-6">
              {/* Booking Summary */}
              <div className="mb-4 sm:mb-5 md:mb-6 p-3 sm:p-4 bg-gray-50 rounded-lg sm:rounded-xl border border-gray-200">
                <h3 className="font-semibold text-gray-900 text-sm sm:text-base mb-2 sm:mb-3">Booking Summary</h3>
                <div className="space-y-1.5 sm:space-y-2 text-xs sm:text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-600">Service:</span>
                    <span className="font-medium text-right break-words max-w-[60%]">{pendingBookingData.service_name}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-600">Dates:</span>
                    <span className="font-medium text-right flex flex-col items-end text-xs sm:text-sm">
                      {jobDates.map((d, i) => (
                        <span key={`${d}-${i}`}>{dayLabel(d, 'long')}</span>
                      ))}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-600">Address:</span>
                    <span className="font-medium text-right max-w-[60%]">{pendingBookingData.address_line1}</span>
                  </div>

                  <div className="pt-2 border-t border-gray-200">
                    {overtimeRate !== null && (
                      <div className="mt-2 sm:mt-3 p-2 sm:p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-xs sm:text-sm font-medium text-blue-800">
                          ⏱️ Overtime: {cad.format(overtimeRate)}/hr (Billed separately if used)
                        </p>
                      </div>
                    )}

                    {heldAmount !== null && (
                      <div className="flex justify-between pt-2 sm:pt-3 mt-2 border-t border-gray-300">
                        <span className="font-bold text-gray-900 text-xs sm:text-sm">Amount held on your card</span>
                        <span className="font-bold text-green-700 text-base sm:text-lg md:text-xl">{cad.format(heldAmount)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Payment Element */}
              {fetchingIntent ? (
                <div className="flex flex-col items-center py-8 gap-3">
                  <div className="motion-safe:animate-spin rounded-full h-10 w-10 border-4 border-green-500 border-t-transparent"></div>
                  <p className="text-sm text-gray-500">Setting up payment...</p>
                </div>
              ) : intentError ? (
                <div role="alert" className="text-center py-6">
                  {intentError.kind === 'session' ? (
                    <>
                      <p className="text-red-600 text-sm mb-4">Your session has expired. Please sign in again to finish your booking.</p>
                      <Link
                        href="/login?redirect=/booking/payment"
                        className="inline-block bg-green-700 text-white px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-green-800 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
                      >Log In</Link>
                    </>
                  ) : intentError.kind === 'answers' ? (
                    <>
                      <p className="text-red-600 text-sm mb-4">{intentError.message}</p>
                      <Link
                        href={`/booking/schedule?service=${encodeURIComponent(pendingBookingData.service_id)}&step=1`}
                        className="inline-block bg-green-700 text-white px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-green-800 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
                      >Change your answers</Link>
                    </>
                  ) : intentError.kind === 'unavailable' ? (
                    <>
                      <p className="text-red-600 text-sm mb-4">This service isn&apos;t available for booking right now.</p>
                      <Link
                        href="/services"
                        className="inline-block bg-green-700 text-white px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-green-800 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
                      >Browse services</Link>
                    </>
                  ) : (
                    <>
                      <p className="text-red-600 text-sm mb-4">Could not initialize payment. Please go back and try again.</p>
                      <button
                        onClick={() => router.push('/booking/confirm')}
                        className="inline-block bg-gray-200 text-gray-800 px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-gray-300 transition"
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