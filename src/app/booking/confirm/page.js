'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Info, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import CustomerAuthModal from '@/components/CustomerAuthModal';
import OnBehalfConfirm from '@/components/booking/OnBehalfConfirm';
import OnBehalfDone from '@/components/booking/OnBehalfDone';
import PriceBox from '@/components/booking/PriceBox';
import SeriesConsent from '@/components/booking/SeriesConsent';
import VisitSchedule from '@/components/booking/VisitSchedule';
import { dayLabel } from '@/lib/booking-answers';
import { useOnBehalf } from '@/lib/on-behalf';
import { useLivePrice } from '@/lib/use-live-price';
import { checkWhenAndWhere, isRepeating } from '@/lib/when-and-where';
import { useAuth } from 'src/context/AuthContext';

const ADMIN_PRICING = '/api/admin/pricing';
const CUSTOMER_STEPS = ['Schedule', 'Details', 'Confirm', 'Payment'];
const ON_BEHALF_STEPS = ['Schedule', 'Details', 'Confirm', 'Card link'];

export default function BookingConfirmPage() {
  const router = useRouter();
  const { user, login } = useAuth();
  const onBehalf = useOnBehalf();
  const [created, setCreated] = useState(null);
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
    // A booking made for a customer clears the flow, which is not a reason to leave the page: its done screen is shown.
    if (onBehalf.checking || created) return;
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

      // The place in the session is the one the person using this browser picked; an admin's booking for a customer is typed in its form.
      if (!onBehalf.active) {
        const locName = sessionStorage.getItem('selectedLocationName');
        const userCity = sessionStorage.getItem('userCity');
        setCity(userCity || locName || '');
        setPostalCode(sessionStorage.getItem('userPostalCode') || '');
        setLat(sessionStorage.getItem('userLat') ? parseFloat(sessionStorage.getItem('userLat')) : null);
        setLng(sessionStorage.getItem('userLng') ? parseFloat(sessionStorage.getItem('userLng')) : null);
      }
    } else {
      router.push(onBehalf.active ? '/admin/book' : '/services');
    }

    if (user && !onBehalf.active) {
      setCurrentUser(user);
      setIsAuthenticated(true);
      setFirstName(user.first_name);
      setLastName(user.last_name);
      setEmail(user.email);
      setPhone(user.phone || '');
    }

    setLoading(false);
  }, [router, user, onBehalf.checking, onBehalf.active, created]);

  const answers = flow && flow.answers && typeof flow.answers === 'object' ? flow.answers : {};
  const live = useLivePrice(flow ? flow.service_id : null, answers, onBehalf.active ? ADMIN_PRICING : undefined);
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
        <div className="motion-safe:animate-spin rounded-full h-10 w-10 border-[3px] border-brand-500/20 border-t-brand-500"></div>
      </div>
    );
  }

  if (created) {
    return (
      <div className="min-h-screen bg-paper font-sans antialiased text-ink">
        <Header />
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl py-8 md:py-12">
          <OnBehalfDone created={created} />
        </div>
        <Footer />
      </div>
    );
  }

  const jobDates = flow.schedule.job_date;
  const savedTimes = flow.whenAndWhere && flow.whenAndWhere.selectedTimes;
  const times = savedTimes && typeof savedTimes === 'object' ? savedTimes : {};
  // A booking that repeats holds one date, its first visit's, which the notice below calls its start.
  const repeating = isRepeating(answers.frequency);

  return (
    <div className="min-h-screen bg-paper font-sans antialiased text-ink">
      <Header />

      <div className="container mx-auto px-5 sm:px-6 max-w-7xl py-8 md:py-12">
        <div className="max-w-6xl mx-auto">

          {/* Progress Bar */}
          <div className="mb-6 sm:mb-8 md:mb-12">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <span className="text-xs font-semibold tracking-[0.12em] text-brand-700 bg-brand-50 border border-brand-100 px-3 sm:px-3.5 py-1 sm:py-1.5 rounded-full">
                REVIEW
              </span>
              <span className="text-xs sm:text-sm text-ink-muted font-medium">Almost there!</span>
            </div>
            <div className="relative">
              <div className="h-1.5 sm:h-2 bg-paper-deep rounded-full overflow-hidden">
                <div className="h-full bg-brand-500 rounded-full" style={{ width: '75%' }}></div>
              </div>
              <div className="flex justify-between mt-1 sm:mt-2">
                {(onBehalf.active ? ON_BEHALF_STEPS : CUSTOMER_STEPS).map((step, i) => (
                  <div key={step} className="flex items-center">
                    <div aria-hidden="true" className={`w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold
                      ${i < 3 ? 'bg-brand-500 text-white' : 'bg-line text-ink-muted'}`}>
                      {i < 2 ? <Check className="w-2.5 h-2.5 sm:w-3 sm:h-3" strokeWidth={3} /> : ''}
                    </div>
                    <span className={`ml-1 sm:ml-2 text-[10px] sm:text-xs md:text-sm font-semibold ${i < 3 ? 'text-brand-700' : 'text-ink-muted'}`}>
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
              <div className="bg-white rounded-[28px] shadow-card border border-line overflow-hidden">
                <div className="px-5 sm:px-6 md:px-8 pt-6 pb-5 border-b border-line">
                  <h2 className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-ink flex items-center">
                    <Sparkles aria-hidden="true" className="mr-2.5 sm:mr-3 h-5 w-5 shrink-0 text-brand-600" />
                    {onBehalf.active ? 'Create the booking' : isAuthenticated ? 'Confirm Your Booking' : 'Create an account to continue'}
                  </h2>
                </div>

                <div className="p-5 sm:p-6 md:p-8">
                  {onBehalf.active ? (
                    <OnBehalfConfirm flow={flow} answers={answers} live={live} onCreated={setCreated} />
                  ) : isAuthenticated ? (
                    <div>
                      {/* User Info */}
                      <div className="bg-brand-50 rounded-2xl p-4 sm:p-5 border border-brand-100 mb-4 sm:mb-6">
                        <div className="flex items-center">
                          <div className="shrink-0 w-10 h-10 sm:w-12 sm:h-12 bg-brand-700 rounded-full flex items-center justify-center text-white text-base sm:text-xl font-bold">
                            {firstName?.[0]}{lastName?.[0]}
                          </div>
                          <div className="ml-3 sm:ml-4 min-w-0">
                            <p className="font-semibold text-ink text-sm sm:text-base">{firstName} {lastName}</p>
                            <p className="text-xs sm:text-sm text-ink-soft break-all">{email}</p>
                            <p className="text-xs sm:text-sm text-ink-soft">{phone}</p>
                          </div>
                        </div>
                      </div>

                      {/* Address */}
                      <div className="mb-4 sm:mb-6 bg-paper border border-line rounded-2xl p-3 sm:p-4">
                        <div className="flex items-start">
                          <svg className="shrink-0 w-4 h-4 sm:w-5 sm:h-5 text-brand-600 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                          </svg>
                          <div className="min-w-0">
                            <h4 className="font-semibold text-ink text-sm sm:text-base mb-1">Service Address</h4>
                            <p className="text-xs sm:text-sm text-ink-soft break-words">{address}</p>
                          </div>
                        </div>
                      </div>

                      {/* Info Notice */}
                      <div className="mb-4 sm:mb-6 bg-amber-50 border border-amber-200 rounded-2xl p-3 sm:p-4">
                        <div className="flex justify-between gap-2">
                          <span className="text-ink-soft text-xs sm:text-sm">{repeating ? 'Starts:' : 'Dates:'}</span>
                          <span className="font-medium text-ink text-right text-xs sm:text-sm flex flex-col items-end">
                            {jobDates.map((date) => (
                              <span key={date}>{dayLabel(date, 'long')}</span>
                            ))}
                          </span>
                        </div>
                        <div className="flex items-start gap-2 mt-3">
                          <Info aria-hidden="true" className="shrink-0 h-4 w-4 sm:h-5 sm:w-5 mt-0.5 text-amber-600" />
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
                        className="mb-4 sm:mb-6 p-3 sm:p-4 bg-paper border border-line rounded-2xl"
                      />

                      {/* Terms */}
                      <div className="mb-4 sm:mb-6">
                        <div className="flex items-start">
                          <input
                            id="terms"
                            type="checkbox"
                            checked={acceptTerms}
                            onChange={(e) => setAcceptTerms(e.target.checked)}
                            className="shrink-0 w-4 h-4 sm:w-5 sm:h-5 mt-0.5 accent-brand-600 text-brand-600 border border-line rounded focus:ring-brand-500"
                          />
                          <label htmlFor="terms" className="ml-2 sm:ml-3 text-xs sm:text-sm text-ink-soft">
                            I agree to WorkOnTap&apos;s{' '}
                            <Link href="/terms" className="text-brand-700 hover:text-brand-800 font-medium underline">Terms of Service</Link>
                            {' '}and{' '}
                            <Link href="/privacy" className="text-brand-700 hover:text-brand-800 font-medium underline">Privacy Policy</Link>
                          </label>
                        </div>
                      </div>

                      {/* CTA Button */}
                      <button
                        onClick={handleProceedToPayment}
                        disabled={!canProceed}
                        className={`w-full py-3 sm:py-4 min-h-[52px] rounded-2xl font-bold text-base sm:text-lg
                          flex items-center justify-center transition-all duration-300
                          ${!canProceed
                            ? 'bg-paper-deep text-ink-muted cursor-not-allowed'
                            : 'bg-brand-500 text-white hover:bg-brand-600 shadow-lg shadow-brand-600/20 active:scale-[0.99]'}`}
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
                      <span aria-hidden="true" className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 border border-brand-100">
                        <LockKeyhole className="h-7 w-7 text-brand-600" />
                      </span>
                      <h3 className="font-display text-2xl font-semibold tracking-tight text-ink mb-2">Ready to book?</h3>
                      <p className="text-sm sm:text-base text-ink-soft mb-5 sm:mb-6">Create an account or log in to continue</p>
                      <div className="space-y-3 sm:space-y-4 max-w-sm mx-auto">
                        <Link
                          href="/signup?redirect=/booking/confirm"
                          className="w-full min-h-[52px] bg-brand-500 text-white py-3 sm:py-4 rounded-2xl font-bold text-base sm:text-lg shadow-lg shadow-brand-600/20 hover:bg-brand-600 transition flex items-center justify-center shrink-0"
                        >Sign Up</Link>
                        <Link
                          href="/login?redirect=/booking/confirm"
                          className="w-full min-h-[52px] border border-line bg-white text-ink py-3 sm:py-4 rounded-2xl font-bold text-base sm:text-lg hover:border-ink/40 transition flex items-center justify-center shrink-0"
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
                <div className="rounded-[28px] border border-line overflow-hidden shadow-card lg:rounded-none lg:border-0 lg:shadow-none lg:overflow-visible">
                  <PriceBox
                    live={live}
                    serviceName={flow.service_name}
                    firstDate={jobDates.length > 1 ? jobDates[0] : null}
                    dates={jobDates}
                    times={times}
                  />
                </div>

                <div className="bg-white rounded-[28px] border border-line shadow-card p-5 sm:p-6">
                  <div className="flex items-start">
                    <svg aria-hidden="true" className="shrink-0 w-4 h-4 sm:w-5 sm:h-5 text-brand-600 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                    </svg>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted mb-1">Service Location</p>
                      <p className="text-sm text-ink break-words">{address}</p>
                    </div>
                  </div>
                </div>

                <div className="relative overflow-hidden bg-brand-900 rounded-[28px] p-5 sm:p-6 text-white">
                  <div className="relative flex items-start space-x-4">
                    <div className="shrink-0 h-11 w-11 rounded-2xl bg-white/10 flex items-center justify-center"><ShieldCheck aria-hidden="true" className="h-6 w-6 text-brand-200" /></div>
                    <div>
                      <h4 className="font-display font-semibold text-lg mb-1.5">You&apos;re Protected</h4>
                      <p className="text-white/75 text-xs sm:text-sm leading-relaxed">We back every job with our Homeowner Protection Promise.</p>
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