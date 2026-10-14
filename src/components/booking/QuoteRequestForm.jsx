// The form for a job the price rule will not price from a few taps (ENG-012): the customer's contact details and a few words about the job, sent
// with the answers the quote was for to POST /api/quote-requests. It books nothing, takes no money and promises no time or e-mail. A request that
// fails to send keeps what was typed, so the customer does not write it twice.
'use client';

import { useEffect, useId, useRef, useState } from 'react';

const SEND_TIMEOUT_MS = 15000;

// The widths of the columns the request is saved in (the server refuses anything longer).
const NAME_MAX = 120;
const EMAIL_MAX = 254;
const PHONE_MAX = 40;
const ADDRESS_MAX = 255;
const MESSAGE_MAX = 1000;

const SENDING_TEXT = 'Sending your request…';
const ERROR_TEXT = "We couldn't send your request. Please try again.";
const BUSY_TEXT = "We've had a lot of requests just now. Please try again in a little while.";

// The one-line fields, in the order of the form. The server names one of these (or `message`) when it refuses a request.
const FIELD_SPECS = [
  { key: 'name', label: 'Your name', type: 'text', max: NAME_MAX, required: true, autoComplete: 'name' },
  { key: 'email', label: 'Email', type: 'email', max: EMAIL_MAX, required: true, autoComplete: 'email' },
  { key: 'phone', label: 'Phone (optional)', type: 'tel', max: PHONE_MAX, required: false, autoComplete: 'tel' },
  { key: 'address', label: 'Where is the job? (optional)', type: 'text', max: ADDRESS_MAX, required: false, autoComplete: 'street-address' },
];
const REFUSABLE_FIELDS = [...FIELD_SPECS.map((spec) => spec.key), 'message'];

const FIELD_CLASS = 'w-full p-3 border-2 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-200';

// `answers` is the answers the quote was for (the live price's `answers`), sent as they are.
export default function QuoteRequestForm({ serviceId, answers }) {
  const uid = useId();
  const idOf = (key) => `${uid}-${key}`;

  const [values, setValues] = useState({ name: '', email: '', phone: '', address: '', message: '' });
  const [phase, setPhase] = useState('idle');
  const [statusText, setStatusText] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [focusKey, setFocusKey] = useState(null);
  const [sentTo, setSentTo] = useState('');
  const sending = useRef(false);
  const inputs = useRef({});
  const sentHeading = useRef(null);

  // Focus follows the screen: to the field the server refused, once it shows its message, and to the thank-you when the form is replaced by it.
  useEffect(() => {
    if (!focusKey) return;
    inputs.current[focusKey]?.focus();
    setFocusKey(null);
  }, [focusKey]);
  useEffect(() => {
    if (phase === 'sent') sentHeading.current?.focus();
  }, [phase]);

  const change = (key) => (event) => {
    const { value } = event.target;
    setValues((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: '' } : prev));
  };

  async function submit(event) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setPhase('sending');
    setStatusText(SENDING_TEXT);
    setFieldErrors({});

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch('/api/quote-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_id: serviceId, answers, ...values }),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => null);
      if (res.status === 201 && body && body.success) {
        setSentTo(values.email.trim());
        setStatusText('');
        setPhase('sent');
        return;
      }
      setPhase('error');
      if (res.status === 400 && body && REFUSABLE_FIELDS.includes(body.field) && typeof body.message === 'string') {
        setFieldErrors({ [body.field]: body.message });
        setFocusKey(body.field);
        setStatusText('');
        return;
      }
      setStatusText(res.status === 429 ? BUSY_TEXT : ERROR_TEXT);
    } catch {
      setPhase('error');
      setStatusText(ERROR_TEXT);
    } finally {
      clearTimeout(timer);
      sending.current = false;
    }
  }

  if (phase === 'sent') {
    return (
      <section aria-labelledby={idOf('heading')} data-testid="quote-request-sent" className="mt-8 bg-white rounded-2xl shadow-lg border border-gray-100 p-6 md:p-8">
        <h2
          id={idOf('heading')}
          ref={sentHeading}
          tabIndex={-1}
          aria-describedby={idOf('sent')}
          className="text-2xl font-bold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600 rounded"
        >
          Request sent
        </h2>
        <p id={idOf('sent')} className="mt-2 text-gray-700">Thanks, we have your request. We&apos;ll be in touch at {sentTo}.</p>
      </section>
    );
  }

  const messageError = fieldErrors.message;
  return (
    <section aria-labelledby={idOf('heading')} data-testid="quote-request-form" className="mt-8 bg-white rounded-2xl shadow-lg border border-gray-100 p-6 md:p-8">
      <h2 id={idOf('heading')} className="text-2xl font-bold text-gray-900">Ask for a quote</h2>
      <p className="mt-2 text-gray-700">Tell us about the job and we&apos;ll come back to you with a price.</p>

      <form onSubmit={submit} className="mt-6 space-y-5">
        {FIELD_SPECS.map(({ key, label, type, max, required, autoComplete }) => {
          const error = fieldErrors[key];
          return (
            <div key={key}>
              <label htmlFor={idOf(key)} className="block text-sm font-semibold text-gray-800 mb-2">
                {label}{required && <span aria-hidden="true" className="text-red-600"> *</span>}
              </label>
              <input
                id={idOf(key)}
                ref={(element) => { inputs.current[key] = element; }}
                name={key}
                type={type}
                value={values[key]}
                onChange={change(key)}
                maxLength={max}
                required={required}
                autoComplete={autoComplete}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? idOf(`${key}-error`) : undefined}
                className={`${FIELD_CLASS} ${error ? 'border-red-400' : 'border-gray-200 focus:border-green-600'}`}
              />
              {error && <p id={idOf(`${key}-error`)} className="mt-2 text-sm font-medium text-red-700">{error}</p>}
            </div>
          );
        })}

        <div>
          <label htmlFor={idOf('message')} className="block text-sm font-semibold text-gray-800 mb-2">
            About the job<span aria-hidden="true" className="text-red-600"> *</span>
          </label>
          <textarea
            id={idOf('message')}
            ref={(element) => { inputs.current.message = element; }}
            name="message"
            rows={5}
            value={values.message}
            onChange={change('message')}
            maxLength={MESSAGE_MAX}
            required
            aria-invalid={messageError ? 'true' : undefined}
            aria-describedby={messageError ? idOf('message-error') : undefined}
            className={`${FIELD_CLASS} resize-y ${messageError ? 'border-red-400' : 'border-gray-200 focus:border-green-600'}`}
          />
          {messageError && <p id={idOf('message-error')} className="mt-2 text-sm font-medium text-red-700">{messageError}</p>}
        </div>

        <div>
          <button
            type="submit"
            disabled={phase === 'sending'}
            className="px-6 py-3 rounded-xl font-bold text-lg shadow-lg transition bg-gradient-to-r from-green-700 to-green-600 text-white hover:from-green-800 hover:to-green-700 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-green-600"
          >
            {phase === 'sending' ? 'Sending…' : 'Send request'}
          </button>
          <p
            role="status"
            aria-live="polite"
            data-testid="quote-request-status"
            className={`mt-3 text-sm font-medium ${phase === 'error' ? 'text-red-700' : 'text-gray-700'}`}
          >
            {statusText}
          </p>
        </div>
      </form>
    </section>
  );
}
