'use client';

// The homepage's way into the guided booking flow: pick a service, go straight to step 1 with the price on screen.
// Services come from the catalog (the ones marked for the homepage, else all active ones), so nothing here names a service.
// Each choice is a photo tile (a radio underneath), the way a customer scans a catalog: picture first, name under it.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { serviceImage } from '@/lib/service-images';

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
    <div id="book" className="scroll-mt-28 relative w-full max-w-2xl lg:mx-0 mx-auto bg-white rounded-[28px] border border-line shadow-lift p-4 sm:p-6 text-left">
      <p id="book-label" className="font-display text-lg sm:text-xl font-semibold text-ink mb-4">What do you need done?</p>

      {services === null ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 sm:gap-3 mb-5" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className={`${i > 5 ? 'hidden sm:block' : ''} aspect-[4/5] rounded-2xl bg-paper-deep animate-pulse`} />
          ))}
        </div>
      ) : services.length > 0 ? (
        <div role="radiogroup" aria-labelledby="book-label" className="grid grid-cols-3 sm:grid-cols-4 gap-x-2.5 gap-y-3 sm:gap-x-3 sm:gap-y-4 mb-5">
          {services.map((service) => {
            const selected = service.id === selectedId;
            return (
              <label key={service.id} className="group relative flex flex-col cursor-pointer">
                <input
                  type="radio"
                  name="book-service"
                  value={service.id}
                  checked={selected}
                  onChange={() => setSelectedId(service.id)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className={`relative block aspect-square overflow-hidden rounded-2xl bg-paper-deep transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand-700 peer-focus-visible:ring-offset-2 ${
                    selected ? 'ring-[2.5px] ring-brand-500 ring-offset-2' : 'ring-1 ring-line group-hover:ring-ink/25'
                  }`}
                >
                  <img
                    src={serviceImage(service)}
                    alt=""
                    className={`h-full w-full object-cover transition duration-500 ${selected ? 'scale-105' : 'group-hover:scale-105'}`}
                  />
                  {selected && (
                    <span className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 text-white shadow">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className={`mt-2 px-0.5 text-[12.5px] sm:text-[13px] leading-snug font-semibold line-clamp-2 ${selected ? 'text-brand-700' : 'text-ink-soft'}`}>
                  {service.name}
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-ink-muted mb-5">Choose a service to see its price.</p>
      )}

      <Link
        href={href}
        className="group/cta flex items-center justify-center gap-2 w-full min-h-[56px] rounded-2xl bg-brand-500 hover:bg-brand-600 text-white text-lg font-bold shadow-lg shadow-brand-600/25 transition active:scale-[0.99]"
      >
        See my price <ArrowRight className="w-5 h-5 transition-transform group-hover/cta:translate-x-0.5" aria-hidden="true" />
      </Link>

      <p className="mt-3 text-center text-[13px] text-ink-muted">
        Price shown before you book. Your card is held, not charged, until the job is done.
      </p>
    </div>
  );
}
