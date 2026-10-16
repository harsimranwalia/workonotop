// The price of the answers on screen, from POST /api/pricing. A figure is shown only for the answers it was worked out for; a newer
// change hides it until its own response arrives.

import { useCallback, useEffect, useRef, useState } from 'react';

const QUIET_MS = 250;
const TIMEOUT_MS = 10000;
const CHOICE_FIELDS = ['units', 'option', 'property_type', 'extras'];
const EMPTY_KEY = '{}';

// `answers` is the answers object, or a function from the latest `choices` (null before the first price) to it.
// Returns { status, price, lines, visits, quotedMinutes, field, message, choices, choicesChanged, answers, retry }; status is one of
// loading, updating, priced, refused, too_large, stale_choices, unavailable, failed. A null serviceId waits in loading.
// `visits` is the { date, price, lines } of each visit of a booking that repeats, the first visit first; it is [] when the answer has none.
export function useLivePrice(serviceId, answers) {
  const [choices, setChoices] = useState(null);
  const [settled, setSettled] = useState({ status: 'loading', key: null });
  const [choicesChanged, setChoicesChanged] = useState(false);
  const [nonce, setNonce] = useState(0);

  const current = (typeof answers === 'function' ? answers(choices) : answers) || {};
  const key = JSON.stringify(current);

  const sequence = useRef(0);
  const inFlight = useRef(null);
  const sentKey = useRef(null);
  const handledNonce = useRef(0);
  const staleOnce = useRef(false);

  const send = useCallback((requestKey, requestAnswers, purpose) => {
    const number = ++sequence.current;
    if (inFlight.current) inFlight.current.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TIMEOUT_MS);
    if (purpose === 'price') {
      sentKey.current = requestKey;
      setSettled((prev) => (prev.status === 'loading' ? prev : { status: 'updating', key: requestKey }));
    }

    const apply = (status, body) => {
      if (status === 200 && body && body.success && Array.isArray(body.choices) && Array.isArray(body.lines) && body.price != null) {
        setChoices(body.choices);
        if (purpose === 'reload' && requestKey !== EMPTY_KEY) {
          setNonce((n) => n + 1);
          return;
        }
        staleOnce.current = false;
        setSettled({
          status: 'priced',
          key: requestKey,
          price: body.price,
          lines: body.lines,
          visits: Array.isArray(body.visits) ? body.visits : [],
          quotedMinutes: body.quoted_minutes,
        });
        return;
      }
      if (status === 400 && body && typeof body === 'object') {
        const field = body.field;
        if (field == null) {
          setSettled({ status: 'unavailable', key: requestKey });
          return;
        }
        if (field === 'answers') {
          setSettled({ status: 'too_large', key: requestKey });
          return;
        }
        if (purpose === 'price' && CHOICE_FIELDS.includes(field) && !staleOnce.current) {
          staleOnce.current = true;
          setChoicesChanged(true);
          setSettled({ status: 'stale_choices', key: requestKey });
          send(requestKey, {}, 'reload');
          return;
        }
        setSettled({ status: 'refused', key: requestKey, field, message: typeof body.message === 'string' ? body.message : '' });
        return;
      }
      setSettled({ status: 'failed', key: requestKey });
    };

    fetch('/api/pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: serviceId, answers: requestAnswers }),
      signal: controller.signal,
    })
      .then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }))
      .then(({ status, body }) => {
        clearTimeout(timer);
        if (number !== sequence.current) return;
        inFlight.current = null;
        if (controller.signal.aborted) {
          setSettled({ status: 'failed', key: requestKey });
          return;
        }
        apply(status, body);
      })
      .catch(() => {
        clearTimeout(timer);
        if (number !== sequence.current) return;
        inFlight.current = null;
        if (controller.signal.aborted && !timedOut) return;
        setSettled({ status: 'failed', key: requestKey });
      });
  }, [serviceId]);

  useEffect(() => {
    if (!serviceId) return undefined;
    const now = sentKey.current === null || handledNonce.current !== nonce;
    if (!now && sentKey.current === key) return undefined;
    if (!now && choicesChanged && !staleOnce.current) setChoicesChanged(false);
    handledNonce.current = nonce;
    if (now) {
      send(key, current, 'price');
      return undefined;
    }
    const timer = setTimeout(() => send(key, current, 'price'), QUIET_MS);
    return () => clearTimeout(timer);
    // `key` stands for `current`; the request is keyed by the answers' JSON.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, key, nonce, send]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  let status = settled.status;
  if (!serviceId || status === 'loading') status = 'loading';
  else if (settled.key !== key) status = 'updating';

  const priced = status === 'priced';
  return {
    status,
    price: priced ? settled.price : null,
    lines: priced ? settled.lines : [],
    visits: priced ? settled.visits : [],
    quotedMinutes: priced ? settled.quotedMinutes : null,
    field: status === 'refused' ? settled.field : null,
    message: status === 'refused' ? settled.message : '',
    choices,
    choicesChanged,
    answers: current,
    retry,
  };
}
