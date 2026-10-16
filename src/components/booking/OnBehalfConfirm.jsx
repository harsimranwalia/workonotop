'use client';

// The confirm step of a booking an admin makes for a customer (ENG-013): who the customer is, the typed email read back, and "Create booking".
// The request is POST /api/admin/bookings. Nothing is charged here and the customer is sent nothing; the next screen gives the admin the link
// to send. The button is disabled while the request runs, which is the only guard against a double click.

import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import { dayLabel } from '@/lib/booking-answers';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELD_FOCUS = 'focus:outline-none focus:border-green-700 focus:ring-2 focus:ring-green-700/30';
const UNSURE = 'Something went wrong and the booking may not have been made. Check the bookings list, then try again.';
const FIELD_ORDER = ['first_name', 'last_name', 'email', 'phone', 'city', 'postal_code'];

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

function Field({ id, label, required, hint, error, inputRef, ...input }) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const described = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-gray-800 mb-1">
        {label}
        {required ? <span className="text-red-700"> *</span> : <span className="font-normal text-gray-600"> (optional)</span>}
      </label>
      <input
        id={id}
        ref={inputRef}
        aria-required={required ? 'true' : undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={described}
        className={`w-full p-3 border-2 rounded-xl text-gray-700 placeholder:text-gray-500 ${FIELD_FOCUS} ${error ? 'border-red-400' : 'border-gray-200'}`}
        {...input}
      />
      {hint && <p id={hintId} className="mt-1 text-xs text-gray-600">{hint}</p>}
      {error && <p id={errorId} className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}

// The booking screen's own fields from the saved flow, plus who the customer is. The price, the account and the payment are not sent: the server works them out.
function bookingBody(flow, answers, values) {
  const { schedule, details } = flow;
  const body = {
    service_id: flow.service_id,
    first_name: values.first_name.trim(),
    last_name: values.last_name.trim(),
    email: values.email.trim(),
    phone: values.phone.trim(),
    job_date: schedule.job_date,
    job_time_slot: schedule.job_time_slot,
    timing_constraints: schedule.timing_constraints || '',
    job_description: details.job_description || '',
    instructions: details.instructions || '',
    parking_access: details.parking_access || false,
    elevator_access: details.elevator_access || false,
    has_pets: details.has_pets || false,
    address_line1: details.address || '',
    address_line2: '',
    city: values.city.trim(),
    postal_code: values.postal_code.trim(),
    photos: details.photos || [],
    answers,
  };
  if (Number.isSafeInteger(flow.quote_request_id) && flow.quote_request_id > 0) body.quote_request_id = flow.quote_request_id;
  return body;
}

function problemsIn(values) {
  const found = {};
  if (!values.first_name.trim()) found.first_name = "Enter the customer's first name.";
  if (!values.last_name.trim()) found.last_name = "Enter the customer's last name.";
  if (!EMAIL_PATTERN.test(values.email.trim())) found.email = 'Enter a valid email address.';
  return found;
}

// `onCreated` is given { bookingId, bookingNumber, price, email, accountMatched, path, expiresAt } once the booking exists.
export default function OnBehalfConfirm({ flow, answers, live, onCreated }) {
  const base = useId();
  const refs = useRef({});
  const inFlight = useRef(false);
  const contact = flow.contact && typeof flow.contact === 'object' ? flow.contact : {};
  const [values, setValues] = useState({
    first_name: textOf(contact.first_name),
    last_name: textOf(contact.last_name),
    email: textOf(contact.email),
    phone: textOf(contact.phone),
    city: '',
    postal_code: '',
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const jobDates = Array.isArray(flow.schedule.job_date) ? flow.schedule.job_date : [];
  const shownEmail = values.email.trim().toLowerCase();
  const canCreate = live.status === 'priced' && !submitting;

  const change = (name) => (event) => {
    const { value } = event.target;
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
  };

  const focusField = (name) => {
    const node = refs.current[name];
    if (node) node.focus();
  };

  const submit = async (event) => {
    event.preventDefault();
    if (inFlight.current || live.status !== 'priced') return;
    setFormError('');
    const found = problemsIn(values);
    setErrors(found);
    const first = FIELD_ORDER.find((name) => found[name]);
    if (first) {
      focusField(first);
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    let data = null;
    let status = 0;
    try {
      const res = await fetch('/api/admin/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookingBody(flow, answers, values)),
      });
      status = res.status;
      data = await res.json().catch(() => null);
    } catch (error) {
      console.error('The booking request could not be sent:', error);
    }

    if (status === 201 && data && data.success === true && data.card_link && typeof data.card_link.path === 'string') {
      sessionStorage.removeItem('bookingFlow');
      onCreated({
        bookingId: data.booking_id,
        bookingNumber: data.booking_number,
        price: data.service_price,
        email: shownEmail,
        accountMatched: data.account_matched === true,
        path: data.card_link.path,
        expiresAt: data.card_link.expires_at,
      });
      return;
    }

    inFlight.current = false;
    setSubmitting(false);
    const message = data && typeof data.message === 'string' ? data.message : '';
    if (status === 401) {
      setFormError('Your admin session has ended. Sign in again, then return to this page.');
    } else if (status === 403) {
      setFormError("This account can't book for a customer.");
    } else if ((status === 400 || status === 409) && message) {
      const field = data && typeof data.field === 'string' ? data.field : '';
      if (FIELD_ORDER.includes(field)) {
        setErrors({ [field]: message });
        focusField(field);
      } else {
        setFormError(message);
      }
    } else {
      setFormError(UNSURE);
    }
  };

  const idOf = (name) => `${base}-${name}`;
  const refOf = (name) => (node) => {
    refs.current[name] = node;
  };
  const scheduleHref = `/booking/schedule?service=${encodeURIComponent(flow.service_id)}&step=4`;

  return (
    <form onSubmit={submit} noValidate aria-busy={submitting}>
      <div className="mb-4 sm:mb-6 bg-amber-50 border border-amber-200 rounded-lg sm:rounded-xl p-3 sm:p-4 text-xs sm:text-sm text-amber-900">
        <p className="font-semibold">Booking for a customer</p>
        <p className="mt-1">
          No payment is taken here. When the booking is made, you get a link to send the customer. The customer adds a card on it, and the card is charged when the job is done.
        </p>
      </div>

      <dl className="mb-4 sm:mb-6 bg-gray-50 border border-gray-200 rounded-lg sm:rounded-xl p-3 sm:p-4 text-xs sm:text-sm grid gap-2">
        <div className="flex justify-between gap-4">
          <dt className="text-gray-600">Service address</dt>
          <dd className="font-medium text-right text-gray-900">{flow.details.address}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-600">{jobDates.length > 1 ? 'Dates' : 'Date'}</dt>
          <dd className="font-medium text-right text-gray-900">
            {jobDates.map((date) => (
              <span key={date} className="block">{dayLabel(date, 'long')}</span>
            ))}
          </dd>
        </div>
      </dl>

      <fieldset className="mb-4 sm:mb-6">
        <legend className="text-base sm:text-lg font-bold text-gray-900 mb-3">Who is the customer?</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            id={idOf('first_name')} inputRef={refOf('first_name')} label="First name" required type="text" autoComplete="off"
            value={values.first_name} onChange={change('first_name')} error={errors.first_name}
          />
          <Field
            id={idOf('last_name')} inputRef={refOf('last_name')} label="Last name" required type="text" autoComplete="off"
            value={values.last_name} onChange={change('last_name')} error={errors.last_name}
          />
          <Field
            id={idOf('email')} inputRef={refOf('email')} label="Email" required type="email" autoComplete="off" inputMode="email"
            hint="The booking goes on this person's account when the email matches one." value={values.email} onChange={change('email')} error={errors.email}
          />
          <Field
            id={idOf('phone')} inputRef={refOf('phone')} label="Phone" type="tel" autoComplete="off" inputMode="tel"
            value={values.phone} onChange={change('phone')} error={errors.phone}
          />
          <Field
            id={idOf('city')} inputRef={refOf('city')} label="City" type="text" autoComplete="off"
            hint="Matches the job to providers in that area." value={values.city} onChange={change('city')} error={errors.city}
          />
          <Field
            id={idOf('postal_code')} inputRef={refOf('postal_code')} label="Postal code" type="text" autoComplete="off"
            value={values.postal_code} onChange={change('postal_code')} error={errors.postal_code}
          />
        </div>
      </fieldset>

      {formError && (
        <div role="alert" className="mb-4 sm:mb-6 rounded-lg sm:rounded-xl border border-red-200 bg-red-50 p-3 sm:p-4 text-sm text-red-800">
          {formError}
        </div>
      )}
      <p role="status" className="sr-only">{submitting ? 'Creating the booking' : ''}</p>

      <p className="mb-3 text-sm text-gray-700">
        Email on the booking: <strong className="font-semibold text-gray-900 break-all">{shownEmail || 'not entered yet'}</strong>
      </p>
      {live.status !== 'priced' && (
        <p className="mb-3 text-sm text-gray-600">The booking can be created once the price is shown.</p>
      )}

      <button
        type="submit"
        disabled={!canCreate}
        className={`w-full py-3 sm:py-4 rounded-lg sm:rounded-xl font-bold text-base sm:text-lg shadow-lg flex items-center justify-center motion-safe:transition-all motion-safe:duration-300
          focus:outline-none focus-visible:ring-4 focus-visible:ring-green-700/40
          ${canCreate
            ? 'bg-green-700 text-white hover:bg-green-800'
            : 'bg-gray-300 text-gray-700 cursor-not-allowed'}`}
      >
        {submitting ? (
          <>
            <svg aria-hidden="true" className="motion-safe:animate-spin -ml-1 mr-3 h-5 w-5 text-gray-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Creating booking...
          </>
        ) : 'Create booking'}
      </button>

      <p className="mt-4 text-center text-sm">
        <Link href={scheduleHref} className="text-green-700 hover:text-green-800 font-medium underline focus:outline-none focus-visible:ring-2 focus-visible:ring-green-700 rounded">
          Change the schedule or details
        </Link>
      </p>
    </form>
  );
}
