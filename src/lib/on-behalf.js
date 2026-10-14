// The on-behalf mode of the booking screens (ENG-013): an admin runs the customer's flow for a customer who phoned in. The mode is a flag on the
// booking flow kept in sessionStorage, and it only changes what the screens show. Every refusal is the server's: the admin routes check the
// session, so a flag set by hand in a customer's browser opens nothing.

import { useEffect, useState } from 'react';

const FLOW_KEY = 'bookingFlow';

export function readFlow() {
  try {
    return JSON.parse(sessionStorage.getItem(FLOW_KEY) || 'null');
  } catch (error) {
    console.error('The stored booking flow could not be read:', error);
    return null;
  }
}

// The fields of a stored flow that belong to the mode, for a page that rebuilds the flow to keep: the flag, the contact a quote request carried
// and the quote request's id. {} when the flow is not in the mode.
export function onBehalfFields(flow) {
  if (!flow || typeof flow !== 'object' || flow.onBehalf !== true) return {};
  const kept = { onBehalf: true };
  if (flow.contact && typeof flow.contact === 'object' && !Array.isArray(flow.contact)) kept.contact = flow.contact;
  if (Number.isSafeInteger(flow.quote_request_id) && flow.quote_request_id > 0) kept.quote_request_id = flow.quote_request_id;
  return kept;
}

// Turns the mode off and leaves the rest of the flow as it is, so the screens go on as a customer's own.
export function clearOnBehalf() {
  const flow = readFlow();
  if (!flow || typeof flow !== 'object') return;
  delete flow.onBehalf;
  delete flow.contact;
  delete flow.quote_request_id;
  sessionStorage.setItem(FLOW_KEY, JSON.stringify(flow));
}

// The screen's selections for the answers a quote request kept: the inverse of the schedule page's `readSelections` over `bookingAnswers`.
export function selectionsFromAnswers(answers) {
  const value = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  const extras = {};
  if (Array.isArray(value.extras)) {
    for (const extra of value.extras) {
      if (extra && typeof extra.code === 'string' && Number.isSafeInteger(extra.quantity) && extra.quantity > 0) extras[extra.code] = extra.quantity;
    }
  }
  return {
    units: value.units && typeof value.units === 'object' && !Array.isArray(value.units) ? value.units : {},
    propertyType: typeof value.property_type === 'string' ? value.property_type : null,
    option: typeof value.option === 'string' ? value.option : null,
    hours: value.hours === undefined || value.hours === null ? '' : String(value.hours),
    extras,
  };
}

// Opens the mode at a service and returns the address of its first step. A quote request brings its `selections` (from `selectionsFromAnswers`),
// the `contact` to fill in ({ first_name, last_name, email, phone }) and its own id, which the booking is made against.
export function startOnBehalf({ serviceId, serviceName, selections, contact, quoteRequestId }) {
  const flow = { service_id: serviceId, service_name: serviceName || '', onBehalf: true };
  if (selections && typeof selections === 'object') flow.selections = selections;
  if (contact && typeof contact === 'object') flow.contact = contact;
  if (Number.isSafeInteger(quoteRequestId) && quoteRequestId > 0) flow.quote_request_id = quoteRequestId;
  sessionStorage.setItem(FLOW_KEY, JSON.stringify(flow));
  return `/booking/schedule?service=${encodeURIComponent(serviceId)}&step=1`;
}

// { checking, active }. `active` is true only when the flow carries the flag AND /api/admin/me says the session is an admin's; a flag that fails
// the check is cleared, so the screens behave as for a customer. A page waits while `checking` so a customer-mode screen never flashes first.
export function useOnBehalf() {
  const [state, setState] = useState({ checking: true, active: false });

  useEffect(() => {
    let alive = true;
    const flow = readFlow();
    if (!flow || flow.onBehalf !== true) {
      setState({ checking: false, active: false });
      return undefined;
    }
    const off = () => {
      if (!alive) return;
      clearOnBehalf();
      setState({ checking: false, active: false });
    };
    fetch('/api/admin/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!alive) return;
        if (body && body.success === true) setState({ checking: false, active: true });
        else off();
      })
      .catch((error) => {
        console.error('The admin check could not be made:', error);
        off();
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
