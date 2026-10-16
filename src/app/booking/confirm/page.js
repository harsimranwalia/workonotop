'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import CustomerAuthModal from '@/components/CustomerAuthModal';
import PriceBox from '@/components/booking/PriceBox';
import SeriesConsent from '@/components/booking/SeriesConsent';
import VisitSchedule from '@/components/booking/VisitSchedule';
import { dayLabel } from '@/lib/booking-answers';
import { useLivePrice } from '@/lib/use-live-price';
import { checkWhenAndWhere, isRepeating } from '@/lib/when-and-where';
import { useAuth } from 'src/context/AuthContext';

export default function BookingConfirmPage() {
  const router = useRouter();
  const { user, login } = useAuth();
  const [flow, setFlow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [lat, setLat] = useState(null);
  const [lng, setLng] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem('bookingFlow') || 'null');
    } catch (error) {
      console.error('The stored booking flow could not be read:', error);
    }

    if (saved && saved.service_id && saved.schedule && saved.details) {
      // A booking goes on to the payment step only when its step-4 answers pass today's checks: the flow page keeps what is on screen, and that may be a step left half done.
      const hasDates = Array.isArray(saved.schedule.job_date) && saved.schedule.job_date.length > 0;
      if (!hasDates || checkWhenAndWhere(saved.whenAndWhere)) {
        router.push(`/booking/schedule?service=${encodeURIComponent(saved.service_id)}&step=4`);
        return;
      }
      setFlow(saved);
      if (saved.details.address) setAddress(saved.details.address);
      
      const locName = sessionStorage.getItem('selectedLocationName');
      const userCity = sessionStorage.getItem('userCity');
      setCity(userCity || locName || '');
      setPostalCode(sessionStorage.getItem('userPostalCode') || '');
      setLat(sessionStorage.getItem('userLat') ? parseFloat(sessionStorage.getItem('userLat')) : null);
      setLng(sessionStorage.getItem('userLng') ? parseFloat(sessionStorage.getItem('userLng')) : null);
    } else {
      router.push('/services');
    }

    if (user) {
      setCurrentUser(user);
      setIsAuthenticated(true);
      setFirstName(user.first_name);
      setLastName(user.last_name);
      setEmail(user.email);
      setPhone(user.phone || '');
    }

    setLoading(false);
  }, [router, user]);

  const answers = flow && flow.answers && typeof flow.answers === 'object' ? flow.answers : {};
  const live = useLivePrice(flow ? flow.service_id : null, answers);
  const canProceed = live.status === 'priced' && acceptTerms && !submitting;

  // ✅ NO booking creation here — just save to session and redirect to payment
  const handleProceedToPayment = async (e) => {
    e.preventDefault();
    if (!isAuthenticated) { 
      router.push('/login?redirect=/booking/confirm'); 
      return; 
    }
    if (!canProceed) return;
    setSubmitting(true);

    const { schedule, details } = flow;
    // The booking carries the answers its price was worked out for; the hold and the booking are priced from them on the server.
    const pendingBookingData = {
      service_id: flow.service_id,
      service_name: flow.service_name,
      first_name: firstName,
      last_name: lastName,
      email: email,
      phone: phone,
      job_date: Array.isArray(schedule.job_date) ? schedule.job_date.join(',') : schedule.job_date,
      job_time_slot: schedule.job_time_slot,
      timing_constraints: schedule.timing_constraints || '',
      job_description: details.job_description,
      instructions: details.instructions || '',
      parking_access: details.parking_access || false,
      elevator_access: details.elevator_access || false,
      has_pets: details.has_pets || false,
      address_line1: address,
      address_line2: '',
      city: city,
      postal_code: postalCode,
      latitude: lat,
      longitude: lng,
      photos: details.photos || [],
      user_id: currentUser?.id,
      answers,
    };

    sessionStorage.setItem('pendingBooking', JSON.stringify(pendingBookingData));
    sessionStorage.removeItem('prefetchedClientSecret');

    router.push('/booking/payment');
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: firstName, last_name: lastName, email, phone, password }),
      });
      const data = await res.json();
      if (data.success) {
        login(data.user);
        setCurrentUser(data.user);
        setIsAuthenticated(true);
        setShowAuthModal(false);
      } else {
        alert(data.message);
      }
    } catch { alert('Failed to create account'); }
    finally { setSubmitting(false); }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.success) {
        login(data.user);
        setCurrentUser(data.user);
        setIsAuthenticated(true);
        setFirstName(data.user.first_name);
        setLastName(data.user.last_name);
        setEmail(data.user.email);
        setPhone(data.user.phone || '');
        setShowAuthModal(false);
      } else {
        alert(data.message);
      }
    } catch { alert('Login failed'); }
    finally { setSubmitting(false); }
  };

  if (loading || !flow) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="motion-safe:animate-spin rounded-full h-12 w-12 border-4 border-green-500 border-t-transparent"></div>
      </div>
    );
  }

  const jobDates = flow.schedule.job_date;
  const savedTimes = flow.whenAndWhere && flow.whenAndWhere.selectedTimes;
  const times = savedTimes && typeof savedTimes === 'object' ? savedTimes : {};
  // A booking that repeats holds one date, its first visit's, which the notice below calls its start.
  const repeating = isRepeating(answers.frequency);

  return (
    <div className="min-h-screen bg-gray-50/50 font-sans antialiased">
      <Header />

      <div className="container mx-auto px-3 sm:px-4 py-6 sm:py-8 md:py-12">
        <div className="max-w-6xl mx-auto">

          {/* Progress Bar */}
          <div className="mb-6 sm:mb-8 md:mb-12">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <span className="text-xs sm:text-sm md:text-base font-bold text-green-700 bg-green-100 px-3 sm:px-4 py-1 sm:py-1.5 rounded-full">
                REVIEW
              </span>
              <span className="text-xs sm:text-sm text-gray-500 font-medium">Almost there!</span>
            </div>
            <div className="relative">
              <div className="h-2 sm:h-2.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-green-600 to-green-500 rounded-full" style={{ width: '75%' }}></div>
              </div>
              <div className="flex justify-between mt-1 sm:mt-2">
                {['Schedule', 'Details', 'Confirm', 'Payment'].map((step, i) => (
                  <div key={step} className="flex items-center">
                    <div aria-hidden="true" className={`w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold
                      ${i < 3 ? 'bg-green-600 text-white' : 'bg-gray-300 text-gray-500'}`}>
                      {i < 2 ? '✓' : ''}
                    </div>
                    <span className={`ml-1 sm:ml-2 text-[10px] sm:text-xs md:text-sm font-semibold ${i < 3 ? 'text-green-700' : 'text-gray-400'}`}>
                      {step}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 xl:gap-12">

            {/* Main Content */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
                <div className="bg-gradient-to-r from-green-800 to-green-700 px-4 sm:px-6 py-4 sm:py-5">
                  <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-white flex items-center">
                    <span className="mr-2 sm:mr-3 text-xl sm:text-2xl">✨</span>
                    {isAuthenticated ? 'Confirm Your Booking' : 'Create an account to continue'}
                  </h2>
                </div>

                <div className="p-4 sm:p-6 md:p-8">
                  {isAuthenticated ? (
                    <div>
                      {/* User Info */}
                      <div className="bg-green-50 rounded-lg sm:rounded-xl p-4 sm:p-6 border-2 border-green-200 mb-4 sm:mb-6">
                        <div className="flex items-center">
                          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-green-700 rounded-full flex items-center justify-center text-white text-base sm:text-xl font-bold">
                            {firstName?.[0]}{lastName?.[0]}
                          </div>
                          <div className="ml-3 sm:ml-4">
                            <p className="font-bold text-gray-900 text-sm sm:text-base">{firstName} {lastName}</p>
                            <p className="text-xs sm:text-sm text-gray-600">{email}</p>
                            <p className="text-xs sm:text-sm text-gray-600">{phone}</p>
                          </div>
                        </div>
                      </div>

                      {/* Address */}
                      <div className="mb-4 sm:mb-6 bg-blue-50 border border-blue-200 rounded-lg sm:rounded-xl p-3 sm:p-4">
                        <div className="flex items-start">
                          <svg className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                          </svg>
                          <div>
                            <h4 className="font-semibold text-gray-900 text-sm sm:text-base mb-1">Service Address</h4>
                            <p className="text-xs sm:text-sm text-gray-700">{address}</p>
                          </div>
                        </div>
                      </div>

                      {/* Info Notice */}
                      <div className="mb-4 sm:mb-6 bg-amber-50 border border-amber-200 rounded-lg sm:rounded-xl p-3 sm:p-4">
                        <div className="flex justify-between gap-2">
                          <span className="text-gray-600 text-xs sm:text-sm">{repeating ? 'Starts:' : 'Dates:'}</span>
                          <span className="font-medium text-right text-xs sm:text-sm flex flex-col items-end">
                            {jobDates.map((date) => (
                              <span key={date}>{dayLabel(date, 'long')}</span>
                            ))}
                          </span>
                        </div>
                        <div className="flex items-start gap-2 mt-3">
                          <span className="text-amber-500 text-lg">ℹ️</span>
                          <p className="text-xs sm:text-sm text-amber-800">
                            <span className="font-semibold">Next step:</span> Authorize payment on the next page.
                            Your booking is confirmed only after successful payment authorization.
                          </p>
                        </div>
                      </div>

                      {/* Visits of a booking that repeats */}
                      <VisitSchedule live={live} className="mb-4 sm:mb-6" />
                      <SeriesConsent
                        answers={answers}
                        className="mb-4 sm:mb-6 p-3 sm:p-4 bg-gray-50 border border-gray-200 rounded-lg sm:rounded-xl"
                      />

                      {/* Terms */}
                      <div className="mb-4 sm:mb-6">
                        <div className="flex items-start">
                          <input
                            id="terms"
                            type="checkbox"
                            checked={acceptTerms}
                            onChange={(e) => setAcceptTerms(e.target.checked)}
                            className="w-4 h-4 sm:w-5 sm:h-5 mt-0.5 text-green-600 border-2 border-gray-300 rounded focus:ring-green-500"
                          />
                          <label htmlFor="terms" className="ml-2 sm:ml-3 text-xs sm:text-sm text-gray-600">
                            I agree to WorkOnTap&apos;s{' '}
                            <Link href="/terms" className="text-green-700 hover:text-green-800 font-medium underline">Terms of Service</Link>
                            {' '}and{' '}
                            <Link href="/privacy" className="text-green-700 hover:text-green-800 font-medium underline">Privacy Policy</Link>
                          </label>
                        </div>
                      </div>

                      {/* CTA Button */}
                      <button
                        onClick={handleProceedToPayment}
                        disabled={!canProceed}
                        className={`w-full py-3 sm:py-4 rounded-lg sm:rounded-xl font-bold text-base sm:text-lg shadow-lg
                          flex items-center justify-center transition-all duration-300
                          ${!canProceed
                            ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                            : 'bg-gradient-to-r from-green-700 to-green-600 text-white hover:from-green-800 hover:to-green-700 motion-safe:hover:scale-[1.02]'}`}
                      >
                        {submitting ? (
                          <>
                            <svg aria-hidden="true" className="motion-safe:animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Redirecting...
                          </>
                        ) : (
                          <>
                            Proceed to Payment
                            <svg className="w-4 h-4 sm:w-5 sm:h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                            </svg>
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="text-center py-4 sm:py-6 md:py-8">
                      <span className="text-4xl sm:text-5xl md:text-6xl mb-3 sm:mb-4 block">🔐</span>
                      <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">Ready to book?</h3>
                      <p className="text-sm sm:text-base text-gray-600 mb-4 sm:mb-6">Create an account or log in to continue</p>
                      <div className="space-y-3 sm:space-y-4 max-w-sm mx-auto">
                        <Link
                          href="/signup?redirect=/booking/confirm"
                          className="w-full bg-gradient-to-r from-green-700 to-green-600 text-white py-3 sm:py-4 rounded-lg sm:rounded-xl font-bold text-base sm:text-lg shadow-lg hover:from-green-800 hover:to-green-700 transition flex items-center justify-center shrink-0"
                        >Sign Up</Link>
                        <Link
                          href="/login?redirect=/booking/confirm"
                          className="w-full border-2 border-green-700 text-green-700 py-3 sm:py-4 rounded-lg sm:rounded-xl font-bold text-base sm:text-lg hover:bg-green-50 transition flex items-center justify-center shrink-0"
                        >Log In</Link>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="lg:col-span-1">
              <div className="sticky top-24 space-y-4 sm:space-y-6">
                <div className="rounded-xl border-2 border-green-100 overflow-hidden shadow-lg lg:rounded-none lg:border-0 lg:shadow-none lg:overflow-visible">
                  <PriceBox
                    live={live}
                    serviceName={flow.service_name}
                    firstDate={jobDates.length > 1 ? jobDates[0] : null}
                    dates={jobDates}
                    times={times}
                  />
                </div>

                <div className="bg-white rounded-xl sm:rounded-2xl border-2 border-green-100 shadow-lg p-4 sm:p-6">
                  <div className="flex items-start">
                    <svg aria-hidden="true" className="w-4 h-4 sm:w-5 sm:h-5 text-green-700 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <p className="text-xs sm:text-sm text-gray-700 font-medium mb-1">Service Location</p>
                      <p className="text-xs text-gray-600">{address}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-green-800 to-green-700 rounded-xl sm:rounded-2xl p-4 sm:p-6 text-white shadow-lg">
                  <div className="flex items-start space-x-4">
                    <div className="text-3xl sm:text-4xl">🛡️</div>
                    <div>
                      <h4 className="font-bold text-base sm:text-lg mb-2">You&apos;re Protected</h4>
                      <p className="text-green-100 text-xs sm:text-sm">We back every job with our Homeowner Protection Promise.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}