'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import Swal from 'sweetalert2';
import { toast } from 'react-hot-toast';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import PriceBox, { HOURS_MESSAGE_ID, formatMoney } from '@/components/booking/PriceBox';
import WhenAndWhereStep from '@/components/booking/WhenAndWhereStep';
import { answersWithoutDate, bookingAnswers, hoursAnswer } from '@/lib/booking-answers';
import { useLivePrice } from '@/lib/use-live-price';
import { EMPTY_WHEN_AND_WHERE, checkWhenAndWhere, whenAndWhereBooking } from '@/lib/when-and-where';

const STEPS = [
  { number: 1, name: 'About the job', kinds: ['unit', 'property_type'] },
  { number: 2, name: 'The option', kinds: ['option'] },
  { number: 3, name: "What's included", kinds: ['extra'] },
  { number: 4, name: 'When and where', kinds: null },
];

const EMPTY_SELECTIONS = { units: {}, propertyType: null, option: null, hours: '', extras: {} };
const NO_ADDRESS = 'Please enter your service location';

const ofKind = (choices, kind) => (choices || []).filter((item) => item && item.kind === kind);
const shownStepsOf = (choices) => STEPS.filter((step) => !step.kinds || step.kinds.some((kind) => ofKind(choices, kind).length > 0));
const isHourly = (item) => Boolean(item) && Number(item.is_hourly) === 1;

function stepComplete(number, choices, selections) {
  if (number === 1) {
    const types = ofKind(choices, 'property_type');
    return types.length === 0 || types.some((item) => item.code === selections.propertyType);
  }
  if (number === 2) {
    const options = ofKind(choices, 'option');
    if (options.length === 0) return true;
    const chosen = options.find((item) => item.code === selections.option);
    return Boolean(chosen) && (!isHourly(chosen) || hoursAnswer(selections.hours) !== null);
  }
  return true;
}

function resolveStep(requested, choices, selections) {
  const shown = shownStepsOf(choices).map((step) => step.number);
  const wanted = shown.find((number) => number >= requested) ?? shown[shown.length - 1];
  return shown.find((number) => number < wanted && !stepComplete(number, choices, selections)) ?? wanted;
}

function readSelections(saved) {
  const value = saved && typeof saved === 'object' ? saved : {};
  return {
    units: value.units && typeof value.units === 'object' ? value.units : {},
    propertyType: typeof value.propertyType === 'string' ? value.propertyType : null,
    option: typeof value.option === 'string' ? value.option : null,
    hours: typeof value.hours === 'string' ? value.hours : '',
    extras: value.extras && typeof value.extras === 'object' ? value.extras : {},
  };
}

function wholeCount(text) {
  const count = Number.parseInt(text, 10);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.min(count, Number.MAX_SAFE_INTEGER);
}

function Stepper({ item, value, onChange }) {
  const id = `count-${item.kind}-${item.code}`;
  return (
    <div role="group" aria-label={item.label} className="flex items-center justify-between gap-4 py-4 border-b border-gray-100 last:border-b-0">
      <div>
        <p className="font-semibold text-gray-800">{item.label}</p>
        <p className="text-sm text-gray-600">{formatMoney(item.amount)} each</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Remove one ${item.label}`}
          disabled={value === 0}
          onClick={() => onChange(Math.max(0, value - 1))}
          className="w-10 h-10 rounded-full border-2 border-gray-300 text-lg font-bold text-gray-700 hover:border-green-600 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
        >
          −
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          aria-label={item.label}
          value={value}
          onChange={(e) => onChange(wholeCount(e.target.value))}
          className="w-16 p-2 text-center border-2 border-gray-200 rounded-lg text-gray-800 focus:outline-none focus:border-green-600 focus:ring-2 focus:ring-green-200"
        />
        <button
          type="button"
          aria-label={`Add one ${item.label}`}
          onClick={() => onChange(Math.min(Number.MAX_SAFE_INTEGER, value + 1))}
          className="w-10 h-10 rounded-full border-2 border-gray-300 text-lg font-bold text-gray-700 hover:border-green-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
        >
          +
        </button>
      </div>
    </div>
  );
}

function RadioGroup({ legend, name, items, value, onChange }) {
  return (
    <fieldset className="mt-2">
      <legend className="font-semibold text-gray-800 mb-3">{legend}</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((item) => {
          const amount = Number(item.amount) > 0 ? `${isHourly(item) ? '' : '+'}${formatMoney(item.amount)}${isHourly(item) ? ' an hour' : ''}` : '';
          const checked = value === item.code;
          return (
            <label
              key={item.code}
              className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition focus-within:ring-2 focus-within:ring-green-600 ${checked ? 'border-green-700 bg-green-50' : 'border-gray-200 hover:border-green-500'}`}
            >
              <input type="radio" name={name} value={item.code} checked={checked} onChange={() => onChange(item)} className="w-4 h-4 accent-green-700" />
              <span className="font-medium text-gray-800">{item.label}</span>
              {amount && <span className="ml-auto text-sm text-gray-600">{amount}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="motion-safe:animate-spin rounded-full h-16 w-16 border-4 border-green-500 border-t-transparent"></div>
    </div>
  );
}

function FlowContent({ serviceId }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stepParam = searchParams.get('step');
  const parsedStep = Number.parseInt(stepParam ?? '', 10);
  const requestedStep = Number.isFinite(parsedStep) && parsedStep >= 1 ? parsedStep : 1;

  const [service, setService] = useState(null);
  const [serviceLoading, setServiceLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [selections, setSelections] = useState(EMPTY_SELECTIONS);
  const [whenAndWhere, setWhenAndWhere] = useState(EMPTY_WHEN_AND_WHERE);
  const [initialAnswers, setInitialAnswers] = useState({});
  const [showHints, setShowHints] = useState(false);
  const [uploading, setUploading] = useState(false);
  const headingRef = useRef(null);
  const shownStep = useRef(null);
  // The picked place that the address field was last filled from, kept with the flow so a restore can tell a new place from the customer's own edit.
  const addressFrom = useRef(null);

  useEffect(() => {
    sessionStorage.removeItem('bookingSchedule');
    sessionStorage.removeItem('bookingDetails');
    sessionStorage.removeItem('prefetchedClientSecret');
    if (!serviceId) {
      router.push('/services');
      return;
    }
    let flow = null;
    try {
      flow = JSON.parse(sessionStorage.getItem('bookingFlow') || 'null');
    } catch (error) {
      console.error('The stored booking flow could not be read:', error);
    }
    // The place the customer picked on the service page, which the address field is filled from; the confirm step pairs the field with that place's city and coordinates.
    const userAddress = sessionStorage.getItem('userAddress');
    const picked = userAddress && userAddress.trim() && userAddress !== NO_ADDRESS ? userAddress : null;
    if (flow && String(flow.service_id) === String(serviceId)) {
      setSelections(readSelections(flow.selections));
      const stored = { ...EMPTY_WHEN_AND_WHERE, ...(flow.whenAndWhere || {}) };
      // A place picked since the field was filled replaces the stored street; while the place is the same, the customer's own edit of the field stands.
      const placeChanged = picked !== null && picked !== flow.addressFrom;
      setWhenAndWhere(placeChanged ? { ...stored, address: picked } : stored);
      addressFrom.current = picked ?? flow.addressFrom ?? null;
      const saved = flow.answers && typeof flow.answers === 'object' ? flow.answers : {};
      setInitialAnswers(requestedStep >= 4 ? saved : answersWithoutDate(saved));
    } else {
      if (picked !== null) setWhenAndWhere({ ...EMPTY_WHEN_AND_WHERE, address: picked });
      addressFrom.current = picked;
    }
    setReady(true);
    // Restores once, at mount, for the service in the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  useEffect(() => {
    if (!serviceId) return undefined;
    let alive = true;
    fetch(`/api/services?id=${encodeURIComponent(serviceId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!alive) return;
        const row = data && data.success ? (Array.isArray(data.data) ? data.data[0] : data.data) : null;
        if (row) setService(row);
        else router.push('/services');
      })
      .catch((error) => {
        console.error('Error fetching service:', error);
        if (alive) router.push('/services');
      })
      .finally(() => {
        if (alive) setServiceLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [serviceId, router]);

  const live = useLivePrice(ready ? serviceId : null, (choices) => {
    if (!choices) return initialAnswers;
    const step = resolveStep(requestedStep, choices, selections);
    return bookingAnswers(selections, step === 4 ? whenAndWhere.selectedDates : [], choices);
  });
  const { choices } = live;
  const shown = choices ? shownStepsOf(choices) : null;
  const step = choices ? resolveStep(requestedStep, choices, selections) : null;
  const stepIndex = shown ? shown.findIndex((item) => item.number === step) : -1;
  const locked = live.status === 'unavailable';

  useEffect(() => {
    if (!choices) return;
    setSelections((prev) => {
      const codes = (kind) => new Set(ofKind(choices, kind).map((item) => item.code));
      const units = codes('unit');
      const extras = codes('extra');
      const keep = (counts, known) => Object.fromEntries(Object.entries(counts).filter(([code]) => known.has(code)));
      const next = {
        units: keep(prev.units, units),
        propertyType: codes('property_type').has(prev.propertyType) ? prev.propertyType : null,
        option: codes('option').has(prev.option) ? prev.option : null,
        hours: prev.hours,
        extras: keep(prev.extras, extras),
      };
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
  }, [choices]);

  useEffect(() => {
    if (!ready || !service) return;
    const booking = whenAndWhereBooking(whenAndWhere);
    const flow = {
      service_id: service.id,
      service_name: service.name,
      step: step ?? requestedStep,
      selections,
      whenAndWhere,
      addressFrom: addressFrom.current,
      schedule: { job_date: booking.job_date, job_time_slot: booking.job_time_slot, timing_constraints: booking.timing_constraints },
      details: {
        job_description: booking.job_description,
        instructions: booking.instructions,
        parking_access: booking.parking_access,
        elevator_access: booking.elevator_access,
        has_pets: booking.has_pets,
        photos: booking.photos,
        address: booking.address,
      },
      answers: choices ? bookingAnswers(selections, whenAndWhere.selectedDates, choices) : initialAnswers,
    };
    sessionStorage.setItem('bookingFlow', JSON.stringify(flow));
  }, [ready, service, step, requestedStep, selections, whenAndWhere, choices, initialAnswers]);

  useEffect(() => {
    if (step === null || stepParam === null || String(step) === stepParam) return;
    router.replace(`/booking/schedule?service=${encodeURIComponent(serviceId)}&step=${step}`);
  }, [step, stepParam, serviceId, router]);

  useEffect(() => {
    if (step === null) return;
    if (shownStep.current !== null && shownStep.current !== step && headingRef.current) headingRef.current.focus();
    shownStep.current = step;
  }, [step]);

  const goTo = useCallback((number) => {
    router.push(`/booking/schedule?service=${encodeURIComponent(serviceId)}&step=${number}`);
  }, [router, serviceId]);

  const setCount = (group, code, count) => setSelections((prev) => ({ ...prev, [group]: { ...prev[group], [code]: count } }));

  const chooseOption = (item) => setSelections((prev) => ({ ...prev, option: item.code, hours: isHourly(item) ? prev.hours : '' }));

  if (serviceLoading || !ready) return <Spinner />;

  if (!service) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Service not found</h2>
          <Link href="/services" className="text-green-700 hover:underline">Browse services</Link>
        </div>
      </div>
    );
  }

  const current = shown && stepIndex >= 0 ? shown[stepIndex] : null;
  const isLast = current && stepIndex === shown.length - 1;
  const ownInputsDone = current ? stepComplete(current.number, choices, selections) : false;
  const canContinue = Boolean(current) && live.status === 'priced' && ownInputsDone && !locked && !uploading;
  const chosenOption = ofKind(choices, 'option').find((item) => item.code === selections.option);
  const hoursRefused = live.status === 'refused' && live.field === 'hours';
  const weekend = ofKind(choices, 'weekend').find((item) => Number(item.amount) > 0);

  const handleContinue = () => {
    if (!current || !canContinue) return;
    if (!isLast) {
      goTo(shown[stepIndex + 1].number);
      return;
    }
    const problem = checkWhenAndWhere(whenAndWhere);
    if (problem) {
      if (problem.kind === 'dates' || problem.kind === 'slots') {
        Swal.fire({ icon: 'warning', title: problem.title, text: problem.text, confirmButtonColor: '#16a34a' });
      } else {
        toast.error(problem.text);
        setShowHints(true);
      }
      return;
    }
    router.push('/booking/confirm');
  };

  return (
    <>
      <Header />

      <div className="bg-white border-b border-gray-200 py-3">
        <div className="container mx-auto px-4">
          <div className="flex items-center text-sm text-gray-600">
            <Link href="/" className="hover:text-green-700 transition">Home</Link>
            <span className="mx-2">›</span>
            <Link href="/services" className="hover:text-green-700 transition">Services</Link>
            <span className="mx-2">›</span>
            <Link href={`/services/${service.slug}`} className="hover:text-green-700 transition">{service.name}</Link>
            {current && (
              <>
                <span className="mx-2">›</span>
                <span className="text-gray-900 font-medium">{current.name}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 md:py-12 pb-48 lg:pb-12">
        <div className="max-w-6xl mx-auto">
          <nav aria-label="Booking steps" className="mb-8 md:mb-10">
            {shown && shown.length > 1 && (
              <p className="mb-3 text-sm md:text-base font-bold text-green-700">
                <span className="bg-green-100 px-4 py-1.5 rounded-full inline-block">Step {stepIndex + 1} of {shown.length}</span>
                <span className="sm:hidden text-gray-700 font-medium" aria-hidden="true"> · {current?.name}</span>
              </p>
            )}
            {shown && shown.length > 1 && (
              <div aria-hidden="true" className="flex gap-1.5 sm:hidden">
                {shown.map((item, index) => (
                  <span key={item.number} className={`h-2 flex-1 rounded-full ${index <= stepIndex ? 'bg-green-600' : 'bg-gray-200'}`}></span>
                ))}
              </div>
            )}
            <ol className="sr-only sm:not-sr-only sm:flex sm:flex-wrap sm:gap-x-8 sm:gap-y-2">
              {shown ? shown.map((item, index) => (
                <li
                  key={item.number}
                  aria-current={item.number === step ? 'step' : undefined}
                  className={`flex items-center gap-2 text-sm ${item.number === step ? 'font-semibold text-green-700' : index < stepIndex ? 'text-green-700' : 'text-gray-600'}`}
                >
                  <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-full ${index <= stepIndex ? 'bg-green-600' : 'bg-gray-300'}`}></span>
                  {item.name}
                </li>
              )) : (
                <li aria-hidden="true"><span className="inline-block h-4 w-32 rounded bg-gray-200 motion-safe:animate-pulse"></span></li>
              )}
            </ol>
          </nav>

          <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 mb-8">Book {service.name}</h1>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12">
            <div className="lg:col-span-2">
              {!current ? (
                <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">
                  <div className="h-8 w-1/2 rounded bg-gray-200"></div>
                  <div className="h-24 rounded-2xl bg-gray-200"></div>
                  <div className="h-24 rounded-2xl bg-gray-200"></div>
                </div>
              ) : (
                <fieldset disabled={locked} className="min-w-0">
                  <h2 ref={headingRef} tabIndex={-1} className="text-2xl md:text-3xl font-bold text-gray-900 mb-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600 rounded">
                    {current.name}
                  </h2>

                  {current.number === 1 && (
                    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 md:p-8 space-y-6">
                      {ofKind(choices, 'unit').length > 0 && (
                        <div>
                          {ofKind(choices, 'unit').map((item) => (
                            <Stepper key={item.code} item={item} value={wholeCount(selections.units[item.code])} onChange={(count) => setCount('units', item.code, count)} />
                          ))}
                        </div>
                      )}
                      {ofKind(choices, 'property_type').length > 0 && (
                        <RadioGroup
                          legend="Type of property"
                          name="property-type"
                          items={ofKind(choices, 'property_type')}
                          value={selections.propertyType}
                          onChange={(item) => setSelections((prev) => ({ ...prev, propertyType: item.code }))}
                        />
                      )}
                    </div>
                  )}

                  {current.number === 2 && (
                    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 md:p-8 space-y-6">
                      <RadioGroup legend="Choose an option" name="option" items={ofKind(choices, 'option')} value={selections.option} onChange={chooseOption} />
                      {isHourly(chosenOption) && (
                        <div>
                          <label htmlFor="booking-hours" className="block font-semibold text-gray-800 mb-2">How many hours?</label>
                          <input
                            id="booking-hours"
                            type="number"
                            inputMode="decimal"
                            min={1}
                            max={24}
                            step={0.5}
                            value={selections.hours}
                            onChange={(e) => {
                              const hours = e.target.value;
                              setSelections((prev) => ({ ...prev, hours }));
                            }}
                            aria-invalid={hoursRefused ? 'true' : undefined}
                            aria-describedby={hoursRefused ? HOURS_MESSAGE_ID : undefined}
                            className={`w-32 p-3 border-2 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-200 ${hoursRefused ? 'border-amber-600' : 'border-gray-200 focus:border-green-600'}`}
                          />
                          <p className="mt-3 text-sm text-gray-600">Priced by the hour: the hours you choose set the price.</p>
                        </div>
                      )}
                    </div>
                  )}

                  {current.number === 3 && (
                    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 md:p-8">
                      {ofKind(choices, 'extra').map((item) => (
                        <Stepper key={item.code} item={item} value={wholeCount(selections.extras[item.code])} onChange={(count) => setCount('extras', item.code, count)} />
                      ))}
                    </div>
                  )}

                  {current.number === 4 && (
                    <WhenAndWhereStep value={whenAndWhere} onChange={setWhenAndWhere} showHints={showHints} onUploadingChange={setUploading} />
                  )}
                </fieldset>
              )}
            </div>

            <aside className="fixed inset-x-0 bottom-0 z-30 max-h-[50vh] overflow-y-auto border-t border-gray-200 bg-white shadow-lg lg:static lg:z-auto lg:max-h-none lg:overflow-visible lg:border-0 lg:bg-transparent lg:shadow-none lg:col-span-1">
              <div className="lg:sticky lg:top-24 lg:space-y-6">
                <PriceBox
                  live={live}
                  serviceName={service.name}
                  overtimeRate={service.additional_price}
                  weekendAmount={current && current.number < 4 && weekend ? weekend.amount : null}
                  firstDate={current && current.number === 4 && whenAndWhere.selectedDates.length > 1 ? whenAndWhere.selectedDates[0] : null}
                  dates={whenAndWhere.selectedDates}
                  times={whenAndWhere.selectedTimes}
                  proNote={current != null && current.number === 4}
                />
                <div className="flex gap-3 px-4 pb-4 lg:p-0">
                  {current && stepIndex > 0 && (
                    <button
                      type="button"
                      onClick={() => goTo(shown[stepIndex - 1].number)}
                      className="flex-1 px-6 py-3 border-2 border-gray-300 rounded-xl hover:bg-gray-100 transition font-medium text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
                    >
                      Back
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleContinue}
                    disabled={!canContinue}
                    className={`flex-1 px-6 py-3 rounded-xl font-bold text-lg shadow-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-green-600 ${canContinue ? 'bg-gradient-to-r from-green-700 to-green-600 text-white hover:from-green-800 hover:to-green-700' : 'bg-gray-300 text-gray-600 cursor-not-allowed'}`}
                  >
                    {uploading ? 'Uploading...' : 'Continue'}
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>

      <Footer />
    </>
  );
}

function ScheduleContent() {
  const serviceId = useSearchParams().get('service');
  return <FlowContent key={serviceId || 'none'} serviceId={serviceId} />;
}

export default function BookingSchedulePage() {
  return (
    <div className="min-h-screen bg-gray-50/50 font-sans antialiased">
      <Suspense>
        <ScheduleContent />
      </Suspense>
    </div>
  );
}
