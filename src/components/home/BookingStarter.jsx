'use client';

// The homepage's way into the guided booking flow: pick a service, go straight to step 1 with the price on screen.
// Services come from the catalog (the ones marked for the homepage, else all active ones), so nothing here names a service.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';

const MAX_SHOWN = 8;

const popularFirst = (a, b) => (b.is_popular || 0) - (a.is_popular || 0) || (b.is_trending || 0) - (a.is_trending || 0);

async function loadServices(signal) {
  for (const url of ['/api/services?homepage=true', '/api/services']) {
    const res = await fetch(url, { signal });
    if (!res.ok) continue;
    const body = await res.json();
    if (body?.success && Array.isArray(body.data) && body.data.length) return body.data;
  }
  return [];
}

export default function BookingStarter() {
  // null while loading; an empty list means the catalog could not be read and the button leads to the services page.
  const [services, setServices] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    loadServices(controller.signal)
      .then((list) => {
        const shown = [...list].sort(popularFirst).slice(0, MAX_SHOWN);
        setServices(shown);
        setSelectedId(shown[0]?.id ?? null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setServices([]);
      });
    return () => controller.abort();
  }, []);

  const href = selectedId ? `/booking/schedule?service=${encodeURIComponent(selectedId)}` : '/services';

  return (
    <div id="book" className="scroll-mt-28 relative max-w-2xl lg:mx-0 mx-auto bg-white rounded-3xl border border-slate-200 shadow-xl shadow-emerald-900/5 p-5 sm:p-6 text-left">
      <p id="book-label" className="text-sm font-bold text-slate-900 mb-3">What do you need done?</p>

      {services === null ? (
        <div className="flex flex-wrap gap-2 mb-5" aria-hidden="true">
          {[112, 144, 96, 128].map((width) => (
            <span key={width} className="h-11 rounded-xl bg-slate-100 animate-pulse" style={{ width }} />
          ))}
        </div>
      ) : services.length > 0 ? (
        <div role="radiogroup" aria-labelledby="book-label" className="flex flex-wrap gap-2 mb-5">
          {services.map((service) => {
            const selected = service.id === selectedId;
            return (
              <label key={service.id} className="relative flex cursor-pointer">
                <input
                  type="radio"
                  name="book-service"
                  value={service.id}
                  checked={selected}
                  onChange={() => setSelectedId(service.id)}
                  className="peer sr-only"
                />
                <span
                  className={`inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl border text-sm font-semibold transition peer-focus-visible:ring-2 peer-focus-visible:ring-green-700 peer-focus-visible:ring-offset-2 ${
                    selected
                      ? 'bg-emerald-50 border-[#16A34A] text-[#15803D] ring-1 ring-[#16A34A]'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-400'
                  }`}
                >
                  {selected && <Check className="w-4 h-4" aria-hidden="true" />}
                  {service.name}
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-600 mb-5">Choose a service to see its price.</p>
      )}

      <Link
        href={href}
        className="flex items-center justify-center gap-2 w-full min-h-[56px] rounded-2xl bg-[#16A34A] hover:bg-[#15803D] text-white text-lg font-bold shadow-lg shadow-green-600/25 transition active:scale-[0.99]"
      >
        See my price <ArrowRight className="w-5 h-5" aria-hidden="true" />
      </Link>

      <p className="mt-3 text-center text-sm text-slate-500">
        Price shown before you book. Your card is held, not charged, until the job is done.
      </p>
    </div>
  );
}
