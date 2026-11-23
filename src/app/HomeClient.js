'use client';

import Footer from '@/components/Footer';
import Header from '@/components/Header';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, Building2, CalendarCheck, ChevronLeft, ChevronRight, CreditCard, GraduationCap, Home as HomeIcon,
  KeyRound, ListChecks, MapPin, Minus, Plus, ShieldCheck, SlidersHorizontal, Tag, Truck,
} from 'lucide-react';
import AnimatedSearchBar from '@/components/AnimatedSearchBar';
import BookingStarter from '@/components/home/BookingStarter';

const IMG = '/images/services';

// A row of cards that scrolls sideways on its own, with arrow buttons from `md` up.
function Rail({ label, children }) {
  const ref = useRef(null);
  const nudge = (direction) => {
    const rail = ref.current;
    if (rail) rail.scrollBy({ left: direction * Math.max(rail.clientWidth * 0.8, 280), behavior: 'smooth' });
  };
  return (
    <div className="relative">
      <div
        ref={ref}
        role="list"
        aria-label={label}
        className="-mx-5 px-5 sm:mx-0 sm:px-0 flex gap-4 sm:gap-5 overflow-x-auto snap-x snap-mandatory scroll-px-5 sm:scroll-px-0 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      <div className="hidden md:flex absolute -top-16 right-0 gap-2">
        <button type="button" onClick={() => nudge(-1)} aria-label={`Scroll ${label} back`} className="h-10 w-10 rounded-full border border-line bg-white flex items-center justify-center text-ink hover:border-ink/40 transition">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => nudge(1)} aria-label={`Scroll ${label} on`} className="h-10 w-10 rounded-full border border-line bg-white flex items-center justify-center text-ink hover:border-ink/40 transition">
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function ServiceCard({ name, desc, slug, image }) {
  return (
    <Link
      href={`/services/${slug}`}
      role="listitem"
      className="group snap-start shrink-0 w-[68%] sm:w-[42%] lg:w-[calc((100%-4*1.25rem)/5)] flex flex-col"
    >
      <span className="block aspect-[4/5] overflow-hidden rounded-3xl bg-paper-deep">
        <img src={image} alt="" loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" />
      </span>
      <span className="mt-3 flex items-start justify-between gap-2">
        <span className="font-semibold text-ink leading-snug">{name}</span>
        <ArrowUpRight className="h-4 w-4 mt-1 shrink-0 text-ink-muted transition group-hover:text-brand-600 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
      <span className="mt-1 text-sm text-ink-muted leading-relaxed">{desc}</span>
    </Link>
  );
}

function Eyebrow({ children, tone = 'brand' }) {
  const look = tone === 'light' ? 'text-brand-200' : 'text-brand-600';
  return <p className={`text-xs font-bold tracking-[0.16em] uppercase mb-3 ${look}`}>{children}</p>;
}

function PriceButton({ children, tone = 'brand' }) {
  const look = tone === 'light'
    ? 'bg-white text-brand-900 hover:bg-brand-50'
    : 'bg-brand-500 text-white hover:bg-brand-600 shadow-lg shadow-brand-600/20';
  return (
    <a href="#book" className={`group inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl font-bold transition active:scale-[0.98] ${look}`}>
      {children} <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </a>
  );
}

export default function HomeClient() {
  const [openFaq, setOpenFaq] = useState(0);
  const [starterInView, setStarterInView] = useState(true);

  // The phone-width bar at the foot of the screen appears once the hero's booking box has scrolled away.
  useEffect(() => {
    const starter = document.getElementById('book');
    if (!starter || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setStarterInView(entry.isIntersecting));
    observer.observe(starter);
    return () => observer.disconnect();
  }, []);

  const searchHints = [
    'house cleaning', 'apartment moving', 'furniture assembly',
    'deep cleaning', 'move out cleaning', 'handyman repairs',
    'tv mounting', 'carpet cleaning'
  ];

  const bookingSteps = [
    { icon: SlidersHorizontal, title: 'Tell us about the job', desc: 'A few quick questions about your home or the task. No phone call, no waiting for a quote.' },
    { icon: Tag, title: 'Pick your option', desc: 'Choose the level of service that fits. The price on screen changes with every answer.' },
    { icon: ListChecks, title: "See what's included", desc: 'Check exactly what is covered and add any extras you want.' },
    { icon: CalendarCheck, title: 'Choose when and where', desc: 'Pick a date and time, add your address and confirm. Your card is held, not charged.' },
  ];

  const promises = [
    { icon: Tag, title: 'Your price before you book', desc: 'Worked out from your answers, on screen at every step.' },
    { icon: CreditCard, title: 'Pay when the job is done', desc: 'Your card is held at booking and charged only after the work is finished.' },
    { icon: ShieldCheck, title: 'Protection Promise', desc: 'Not happy with the work? Tell us within 48 hours and we will make it right.', href: '/guarantee' },
    { icon: MapPin, title: 'Metro Vancouver', desc: 'Vancouver and surrounding areas, subject to service availability.' },
  ];

  const spotlight = [
    { title: 'Moving out?', line: 'Leave the place spotless for the handover inspection.', href: '/services/move-out-cleaning', image: `${IMG}/move-cleaning.jpg`, cta: 'Move-out cleaning' },
    { title: 'Settle in faster', line: 'TV up, furniture built, shelves on the wall, in one visit.', href: '/services/move-in-repair-package', image: `${IMG}/move-in-repair-package.jpg`, cta: 'Move-In Repair Package' },
    { title: 'Get your deposit back', line: 'Patching, drywall and touch-up paint before you hand back the keys.', href: '/services/move-out-repair-package', image: `${IMG}/move-out-repair-package.jpg`, cta: 'Move-Out Repair Package' },
  ];

  const cleaning = [
    { name: 'Regular House Cleaning', slug: 'regular-house-cleaning', desc: 'Routine upkeep for kitchens, bathrooms and living areas.', image: `${IMG}/regular-house-cleaning.jpg` },
    { name: 'Deep Cleaning', slug: 'deep-cleaning', desc: 'Buildup, baseboards and the corners a routine clean skips.', image: `${IMG}/deep-cleaning.jpg` },
    { name: 'Move-Out Cleaning', slug: 'move-out-cleaning', desc: 'An empty home made ready for handover.', image: `${IMG}/move-cleaning.jpg` },
    { name: 'Move-In Cleaning', slug: 'move-in-cleaning', desc: 'A fresh start before the boxes come in.', image: `${IMG}/counter-clean.jpg` },
    { name: 'Carpet Cleaning', slug: 'carpet-cleaning', desc: 'Hot water extraction for stains, dirt and odours.', image: `${IMG}/carpet-cleaning.jpg` },
  ];

  const handyman = [
    { name: 'TV & Wall Mounting', slug: 'tv-and-wall-mounting', desc: 'Level, secure and the cables tidied away.', image: `${IMG}/tv-and-wall-mounting.jpg` },
    { name: 'Furniture Assembly', slug: 'furniture-assembly', desc: 'Flat-pack built properly, without the all-day project.', image: `${IMG}/furniture-assembly.jpg` },
    { name: 'Wall & Drywall Repair', slug: 'wall-and-drywall-repair', desc: 'Holes, dents and cracks patched smooth.', image: `${IMG}/move-out-repair-package.jpg` },
    { name: 'General Home Repairs', slug: 'general-home-repairs', desc: 'The small fixes that keep piling up.', image: `${IMG}/general-home-repairs.jpg` },
    { name: 'Painting & Touch-Ups', slug: 'painting-touch-ups', desc: 'Scuffs and marks gone before guests or inspections.', image: `${IMG}/painting-touch-ups.jpg` },
    { name: 'Shelving & Storage Installation', slug: 'shelving-and-storage-installation', desc: 'Shelves, racks and storage fixed where you want them.', image: `${IMG}/shelving-and-storage.jpg` },
  ];

  const audiences = [
    { icon: HomeIcon, title: 'For Homeowners', desc: 'Get help with cleaning, repairs, installations, furniture assembly, moving assistance and everyday household tasks.' },
    { icon: GraduationCap, title: 'For Renters', desc: 'Find help with move-in and move-out cleaning, moving assistance, furniture assembly, wall repairs and other household jobs.' },
    { icon: KeyRound, title: 'For Landlords & Property Managers', desc: 'Arrange move-out cleaning, move-in cleaning, repair work and handyman services when preparing properties for new occupants.' },
    { icon: Building2, title: 'For People Moving Into a New Home', desc: 'Get practical help with packing, unloading, furniture assembly, TV mounting, shelving installation and other setup tasks.' },
  ];

  const benefits = [
    { title: 'Multiple Services in One Place', desc: 'Find cleaning, moving assistance and handyman services without searching across multiple websites.' },
    { title: 'Practical Services for Everyday Needs', desc: 'Choose from focused services designed around common cleaning, moving and home-repair tasks.' },
    { title: 'Services Based on Your Actual Needs', desc: 'Select the specific type of cleaning, moving assistance or handyman work required instead of relying on a one-size-fits-all service.' },
    { title: 'Simple Service Discovery', desc: 'Start with the main service category, choose the service you need and provide details about your job.' },
    { title: 'Vancouver & Metro Vancouver Service Area', desc: 'Find service options for customers across Vancouver and surrounding Metro Vancouver areas, subject to service availability.' },
  ];

  const areas = [
    'Vancouver', 'Burnaby', 'Richmond', 'Surrey', 'Coquitlam', 'North Vancouver', 'West Vancouver', 'New Westminster',
    'Delta', 'Langley', 'Port Coquitlam', 'Port Moody', 'Maple Ridge', 'Pitt Meadows', 'White Rock',
  ];

  const faqs = [
    {
      q: "How do I get a price?",
      a: "Choose a service and answer a few short questions about the job. Your price is shown on screen and updates with every answer, so you see what the job costs before you book. There is no call and no waiting for a quote."
    },
    {
      q: "When am I charged?",
      a: "Your card is held when you book, not charged. Payment is taken once the job is done."
    },
    {
      q: "What services does Work On Tap provide?",
      a: "Work On Tap focuses on three main service categories:\n\nCleaning\nMoving\nHandyman\n\nAvailable services include regular house cleaning, deep cleaning, move-in and move-out cleaning, carpet cleaning, packing and unpacking, loading and unloading, full moving help, wall and drywall repair, furniture assembly, TV mounting, shelving installation and general home repairs."
    },
    {
      q: "Do you provide cleaning services in Vancouver?",
      a: "Yes. Work On Tap offers cleaning services in Vancouver and surrounding Metro Vancouver areas, subject to service availability.\n\nCleaning services include:\n\nRegular House Cleaning\nDeep Cleaning\nMove-In Cleaning\nMove-Out Cleaning\nCarpet Cleaning"
    },
    {
      q: "What handyman services are available?",
      a: "Our handyman services include:\n\nWall & Drywall Repair\nPainting & Touch-Ups\nGeneral Home Repairs\nFurniture Assembly\nTV & Wall Mounting\nShelving & Storage Installation\n\nWe also offer featured Move-In Repair and Move-Out Repair packages."
    },
    {
      q: "Do you provide moving services?",
      a: "Yes. Work On Tap provides:\n\nPacking & Unpacking\nLoading & Unloading\nFull Moving Help\n\nMoving services are provided without a truck. Customers should arrange their own truck or transportation when required and can use Work On Tap for the hands-on moving assistance."
    },
    {
      q: "Do you offer move-in and move-out services?",
      a: "Yes. Work On Tap offers separate services for different parts of the moving process.\n\nFor cleaning:\nMove-In Cleaning\nMove-Out Cleaning\n\nFor repairs:\nMove-In Repair Package\nMove-Out Repair Package\n\nMoving assistance is also available through packing, loading, unloading and full moving help."
    },
    {
      q: "What is the Move-Out Repair Package?",
      a: "The Move-Out Repair Package is designed for tenants moving out and property managers preparing rental units.\n\nIt combines:\nWall & drywall repair\nPatching\nTouch-up paint\nGeneral small repairs\n\nIts tagline is \"Get your deposit back.\""
    },
    {
      q: "What is the Move-In Repair Package?",
      a: "The Move-In Repair Package is designed for customers settling into a new home.\n\nIt combines:\nTV & wall mounting\nFurniture assembly\nShelving & storage installation\nGeneral small repairs\n\nIts tagline is \"Settle into your new place.\""
    },
    {
      q: "How do I choose the right service?",
      a: "Start with the main category that matches your job:\n\nCleaning → Moving → Handyman\n\nThen select the specific service that best matches your requirements and provide as much information about the job as possible."
    }
  ];

  return (
    <div className="min-h-screen bg-white font-sans antialiased text-ink overflow-x-hidden">
      <Header />

      {/* Hero: the booking box is the page's main action; the photographs say what the service looks like */}
      <section className="relative bg-white">
        <div className="absolute inset-x-0 top-0 h-[520px] bg-gradient-to-b from-paper to-white pointer-events-none" aria-hidden="true" />
        <div className="relative container mx-auto px-5 sm:px-6 max-w-7xl pt-8 pb-14 lg:pt-14 lg:pb-20">
          <div className="grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] gap-10 lg:gap-14 items-start">
            <div className="text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-line text-ink-soft text-[13px] font-medium mb-5 shadow-sm">
                <MapPin className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
                Metro Vancouver
              </div>

              <h1 className="font-display text-[34px] leading-[1.08] sm:text-5xl lg:text-[56px] font-semibold tracking-[-0.025em] text-ink mb-4 text-balance">
                Cleaning, Moving & Handyman Services <span className="text-brand-600">in Vancouver</span>
              </h1>
              <p className="text-base sm:text-lg text-ink-soft leading-relaxed max-w-xl lg:mx-0 mx-auto mb-7">
                See your price and book online. No quotes to wait for, no phone calls, and your card is not charged until the job is done.
              </p>

              <BookingStarter />

              <div className="mt-6 max-w-2xl lg:mx-0 mx-auto">
                <p className="text-[13px] font-medium text-ink-muted mb-2.5 text-left">Looking for something else? Search every service.</p>
                <AnimatedSearchBar services={searchHints} />
              </div>
            </div>

            {/* Photo collage, from `lg` up */}
            <div className="hidden lg:block relative h-full min-h-[640px]" aria-hidden="true">
              <div className="absolute inset-0 grid grid-cols-2 grid-rows-[1.15fr_1fr] gap-4">
                <div className="row-span-2 overflow-hidden rounded-[32px]">
                  <img src={`${IMG}/regular-house-cleaning.jpg`} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="overflow-hidden rounded-[32px]">
                  <img src={`${IMG}/tv-and-wall-mounting.jpg`} alt="" className="h-full w-full object-cover object-top" />
                </div>
                <div className="overflow-hidden rounded-[32px]">
                  <img src={`${IMG}/moving-help.jpg`} alt="" className="h-full w-full object-cover" />
                </div>
              </div>
              <div className="absolute -left-8 bottom-16 w-64 rounded-2xl bg-white/95 backdrop-blur border border-line shadow-lift p-4 flex gap-3">
                <span className="h-10 w-10 shrink-0 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
                  <CreditCard className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink">Card held, not charged</span>
                  <span className="block text-xs text-ink-muted mt-0.5 leading-relaxed">You pay once the job is done.</span>
                </span>
              </div>
              <div className="absolute right-6 top-6 rounded-full bg-white/95 backdrop-blur border border-line shadow-card pl-2 pr-4 py-2 flex items-center gap-2">
                <span className="h-7 w-7 rounded-full bg-brand-500 text-white flex items-center justify-center"><Tag className="h-3.5 w-3.5" /></span>
                <span className="text-sm font-semibold text-ink">Price on screen before you book</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What you can count on */}
      <section className="border-y border-line bg-paper">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl py-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-7">
          {promises.map(({ icon: PromiseIcon, title, desc, href }) => (
            <div key={title} className="flex gap-4">
              <span className="h-11 w-11 shrink-0 rounded-2xl bg-white border border-line text-brand-600 flex items-center justify-center">
                <PromiseIcon className="w-5 h-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-semibold text-ink mb-1">{title}</h3>
                <p className="text-sm text-ink-muted leading-relaxed">
                  {desc}{href && <> <Link href={href} className="font-medium text-brand-700 underline underline-offset-2 hover:no-underline">How it works</Link></>}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* In the spotlight */}
      <section className="pt-16 lg:pt-20 bg-white" aria-labelledby="spotlight-heading">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <h2 id="spotlight-heading" className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-ink mb-6">In the spotlight</h2>
          <div className="-mx-5 px-5 sm:mx-0 sm:px-0 flex lg:grid lg:grid-cols-3 gap-4 sm:gap-5 overflow-x-auto snap-x snap-mandatory scroll-px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {spotlight.map((item) => (
              <Link key={item.title} href={item.href} className="group snap-start shrink-0 w-[84%] sm:w-[60%] lg:w-auto relative overflow-hidden rounded-[28px] aspect-[5/4] sm:aspect-[16/11] bg-brand-900">
                <img src={item.image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" />
                <span className="absolute inset-0 bg-gradient-to-t from-brand-950/90 via-brand-950/35 to-transparent" aria-hidden="true" />
                <span className="absolute inset-x-0 bottom-0 p-5 sm:p-6 text-white">
                  <span className="block font-display text-2xl sm:text-[28px] font-semibold tracking-tight">{item.title}</span>
                  <span className="block mt-1.5 text-sm text-white/85 leading-relaxed max-w-xs">{item.line}</span>
                  <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white text-ink text-sm font-semibold px-4 py-2 transition group-hover:bg-brand-50">
                    {item.cta} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* How booking works */}
      <section className="py-16 lg:py-24 bg-white">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <div className="rounded-[36px] bg-brand-900 text-white px-6 py-12 sm:px-10 lg:px-14 lg:py-16 relative overflow-hidden">
            <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl" aria-hidden="true" />
            <div className="relative grid lg:grid-cols-[0.8fr_1.2fr] gap-10 lg:gap-16 items-start">
              <div>
                <Eyebrow tone="light">How it works</Eyebrow>
                <h2 className="font-display text-3xl sm:text-4xl lg:text-[44px] leading-tight font-semibold tracking-tight mb-4">Booked in Four Short Steps</h2>
                <p className="text-white/75 text-lg leading-relaxed mb-8 max-w-md">
                  You see the price the whole way through, so there are no surprises when you confirm.
                </p>
                <PriceButton tone="light">See my price</PriceButton>
              </div>
              <ol className="grid sm:grid-cols-2 gap-4">
                {bookingSteps.map(({ icon: StepIcon, title, desc }, i) => (
                  <li key={title} className="rounded-3xl bg-white/[0.06] border border-white/10 p-6 backdrop-blur-sm">
                    <div className="flex items-center justify-between mb-5">
                      <span className="font-display text-sm font-semibold text-brand-200">0{i + 1}</span>
                      <StepIcon className="w-5 h-5 text-brand-200" aria-hidden="true" />
                    </div>
                    <h3 className="text-lg font-semibold mb-1.5">{title}</h3>
                    <p className="text-white/70 text-sm leading-relaxed">{desc}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* The three categories */}
      <section className="pb-16 lg:pb-24 bg-white">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <div className="max-w-3xl mb-10">
            <h2 className="font-display text-3xl sm:text-4xl lg:text-[44px] leading-tight font-semibold tracking-tight text-ink mb-4">One Place for the Services You Need Most</h2>
            <p className="text-lg text-ink-soft leading-relaxed">
              Work On Tap brings three essential service categories together: cleaning, moving and handyman services. Whether you need help with one task or several jobs around your property, you find the service that fits without searching across multiple platforms.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              { href: '/services?category=cleaning', title: 'Cleaning Services', desc: 'Routine house cleaning, deep cleaning, move-out cleaning, and carpet cleaning.', image: `${IMG}/cleaning-banner.jpg` },
              { href: '/services?category=movers', title: 'Moving Services', desc: 'Packing & unpacking, loading & unloading, and full moving help without the truck.', image: `${IMG}/moving-help.jpg` },
              { href: '/services?category=handyman', title: 'Handyman Services', desc: 'Wall repair, painting touch-ups, furniture assembly, TV mounting, and shelving installation.', image: `${IMG}/general-home-repairs.jpg` },
            ].map((category) => (
              <Link key={category.href} href={category.href} className="group relative overflow-hidden rounded-[28px] bg-paper aspect-[4/3] md:aspect-[4/5]">
                <img src={category.image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" />
                <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" aria-hidden="true" />
                <span className="absolute inset-x-0 bottom-0 p-6 text-white">
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-display text-2xl font-semibold tracking-tight">{category.title}</span>
                    <span className="h-10 w-10 shrink-0 rounded-full bg-white text-ink flex items-center justify-center transition group-hover:bg-brand-500 group-hover:text-white">
                      <ArrowUpRight className="h-5 w-5" aria-hidden="true" />
                    </span>
                  </span>
                  <span className="block mt-2 text-sm text-white/80 leading-relaxed">{category.desc}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Cleaning */}
      <section className="py-16 lg:py-24 bg-paper overflow-hidden">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <div className="grid lg:grid-cols-[1fr_auto] gap-6 items-end mb-16 md:mb-20 lg:mb-20">
            <div className="max-w-2xl">
              <Eyebrow>Cleaning Services in Vancouver</Eyebrow>
              <h2 className="font-display text-3xl sm:text-4xl lg:text-[44px] leading-tight font-semibold tracking-tight text-ink mb-4">A Cleaner Space Starts With the Right Service</h2>
              <p className="text-lg text-ink-soft leading-relaxed">
                Keeping your home clean takes time, consistency and attention to detail. Work On Tap offers practical cleaning services in Vancouver for customers who need help maintaining, preparing or refreshing their homes.
              </p>
            </div>
          </div>
          <Rail label="Cleaning services">
            {cleaning.map((service) => <ServiceCard key={service.slug} {...service} />)}
          </Rail>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
            <PriceButton>Get a cleaning price</PriceButton>
            <Link href="/services?category=cleaning" className="font-semibold text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
              Explore Cleaning Services
            </Link>
          </div>
        </div>
      </section>

      {/* Moving */}
      <section className="py-16 lg:py-24 bg-white overflow-hidden">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div className="relative order-last lg:order-first">
              <div className="grid grid-cols-5 gap-4">
                <div className="col-span-3 overflow-hidden rounded-[28px] aspect-[3/4]">
                  <img src={`${IMG}/moving.jpg`} alt="A Work On Tap mover carrying a box through a bright living room" loading="lazy" className="h-full w-full object-cover" />
                </div>
                <div className="col-span-2 flex flex-col gap-4 pt-12">
                  <div className="overflow-hidden rounded-[24px] aspect-square">
                    <img src={`${IMG}/moving-help.jpg`} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </div>
                  <div className="rounded-[24px] bg-brand-50 border border-brand-100 p-5">
                    <Truck className="h-6 w-6 text-brand-600 mb-3" aria-hidden="true" />
                    <p className="text-sm font-semibold text-ink leading-snug">You bring the truck. We bring the hands.</p>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <Eyebrow>Moving Services in Vancouver</Eyebrow>
              <h2 className="font-display text-3xl sm:text-4xl lg:text-[44px] leading-tight font-semibold tracking-tight text-ink mb-5">Moving Help Without the Truck</h2>
              <p className="text-lg text-ink-soft leading-relaxed mb-6">
                Moving can involve a lot of physical work, from preparing boxes to loading furniture and getting everything safely organized. Work On Tap provides moving help without a truck, giving you practical assistance with the hands-on work involved in your move.
              </p>
              <ul className="divide-y divide-line border-y border-line mb-6">
                {['Packing & Unpacking', 'Loading & Unloading', 'Full Moving Help'].map((item) => (
                  <li key={item} className="flex items-center justify-between py-3.5 font-semibold text-ink">
                    {item}
                    <span className="h-6 w-6 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center text-xs" aria-hidden="true">✓</span>
                  </li>
                ))}
              </ul>
              <p className="text-ink-muted text-sm leading-relaxed mb-8">
                Moving help is for customers who already have their own truck or transportation. When you ask for it, tell us the pickup location, destination, property type, stairs or elevators, larger furniture items and your preferred date.
              </p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                <PriceButton>Get a moving price</PriceButton>
                <Link href="/services?category=movers" className="font-semibold text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
                  Explore Moving Services
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Handyman */}
      <section className="py-16 lg:py-24 bg-paper overflow-hidden">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <div className="max-w-2xl mb-16 md:mb-20">
            <Eyebrow>Handyman Services in Vancouver</Eyebrow>
            <h2 className="font-display text-3xl sm:text-4xl lg:text-[44px] leading-tight font-semibold tracking-tight text-ink mb-4">Get Those Small Jobs Off Your To-Do List</h2>
            <p className="text-lg text-ink-soft leading-relaxed">
              A damaged wall, furniture waiting to be assembled, a TV that needs mounting: Work On Tap provides practical handyman services for homeowners, renters, landlords and property managers.
            </p>
          </div>
          <Rail label="Handyman services">
            {handyman.map((service) => <ServiceCard key={service.slug} {...service} />)}
          </Rail>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
            <PriceButton>Get a handyman price</PriceButton>
            <Link href="/services?category=handyman" className="font-semibold text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
              Explore Handyman Services
            </Link>
          </div>
        </div>
      </section>

      {/* Featured Repair Packages */}
      <section className="py-16 lg:py-24 bg-white">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <div className="max-w-2xl mb-10">
            <Eyebrow>Bundled for moving day</Eyebrow>
            <h2 className="font-display text-3xl sm:text-4xl lg:text-[44px] leading-tight font-semibold tracking-tight text-ink">Featured Repair Packages</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[
              {
                title: 'Move-Out Repair Package', tag: 'Prepare your home for handover.', href: '/services/move-out-repair-package-in-vancouver', image: `${IMG}/move-out-repair-package.jpg`,
                desc: 'Small repairs that need attention before an inspection or handover. For tenants moving out and property managers preparing rental units.',
                items: ['Wall & drywall repair', 'Patching', 'Touch-up paint', 'General small repairs'],
              },
              {
                title: 'Move-In Repair Package', tag: 'Settle into your new place.', href: '/services/move-in-repair-package-in-vancouver', image: `${IMG}/move-in-repair-package.jpg`,
                desc: 'Assembling furniture, mounting your TV and organizing your space: a practical way to get a new home ready.',
                items: ['TV & wall mounting', 'Furniture assembly', 'Shelving & storage installation', 'General small repairs'],
              },
            ].map((pkg) => (
              <article key={pkg.title} className="group grid sm:grid-cols-[0.9fr_1.1fr] overflow-hidden rounded-[28px] border border-line bg-white hover:shadow-lift transition-shadow">
                <div className="aspect-[16/10] sm:aspect-auto overflow-hidden bg-paper">
                  <img src={pkg.image} alt="" loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" />
                </div>
                <div className="p-6 sm:p-7 flex flex-col">
                  <h3 className="font-display text-2xl font-semibold tracking-tight text-ink">{pkg.title}</h3>
                  <p className="text-brand-700 font-medium mt-1 mb-3">{pkg.tag}</p>
                  <p className="text-sm text-ink-muted leading-relaxed mb-4">{pkg.desc}</p>
                  <ul className="flex flex-wrap gap-2 mb-6">
                    {pkg.items.map((item) => (
                      <li key={item} className="rounded-full bg-paper border border-line px-3 py-1 text-xs font-medium text-ink-soft">{item}</li>
                    ))}
                  </ul>
                  <Link href={pkg.href} className="mt-auto inline-flex items-center gap-1.5 font-semibold text-ink hover:text-brand-700 transition">
                    Explore {pkg.title} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Who it is for */}
      <section className="py-16 lg:py-24 bg-paper">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <div className="max-w-2xl mb-10">
            <h2 className="font-display text-3xl sm:text-4xl lg:text-[44px] leading-tight font-semibold tracking-tight text-ink mb-4">Home Services for Homes & Rentals</h2>
            <p className="text-lg text-ink-soft leading-relaxed">
              Work On Tap is designed to support different types of customers across Vancouver and surrounding Metro Vancouver areas.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {audiences.map(({ icon: AudienceIcon, title, desc }) => (
              <div key={title} className="rounded-3xl bg-white border border-line p-6">
                <span className="h-11 w-11 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-5">
                  <AudienceIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="text-lg font-semibold text-ink mb-2 leading-snug">{title}</h3>
                <p className="text-ink-muted text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Choose Us */}
      <section className="py-16 lg:py-24 bg-white">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div>
              <Eyebrow>Benefits</Eyebrow>
              <h2 className="font-display text-3xl sm:text-4xl lg:text-[44px] leading-tight font-semibold tracking-tight text-ink mb-8">Why Choose Work On Tap?</h2>
              <div className="divide-y divide-line border-y border-line">
                {benefits.map((item, i) => (
                  <div key={item.title} className="flex gap-5 py-5">
                    <span className="font-display text-sm font-semibold text-brand-600 pt-0.5 w-6 shrink-0">0{i + 1}</span>
                    <div>
                      <h4 className="text-lg font-semibold text-ink">{item.title}</h4>
                      <p className="text-ink-muted mt-1 leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative">
              <div className="overflow-hidden rounded-[32px] aspect-[4/5]">
                <img src={`${IMG}/counter-clean.jpg`} alt="A Work On Tap cleaner wiping down a kitchen counter" loading="lazy" className="h-full w-full object-cover" />
              </div>
              <div className="absolute -bottom-6 left-6 right-6 sm:left-auto sm:-left-6 sm:right-auto sm:w-72 rounded-2xl bg-white border border-line shadow-lift p-5">
                <ShieldCheck className="h-6 w-6 text-brand-600 mb-2" aria-hidden="true" />
                <p className="text-sm font-semibold text-ink">Not happy with the work?</p>
                <p className="text-sm text-ink-muted mt-1 leading-relaxed">Tell us within 48 hours and we will make it right.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Where we work */}
      <section className="py-14 lg:py-16 bg-white border-t border-line" aria-labelledby="areas-heading">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl grid lg:grid-cols-[0.6fr_1.4fr] gap-6 lg:gap-12 items-start">
          <div>
            <h2 id="areas-heading" className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-ink">Across Metro Vancouver</h2>
            <p className="text-ink-muted mt-2 leading-relaxed">Subject to service availability in your area.</p>
          </div>
          <ul className="flex flex-wrap gap-2">
            {areas.map((area) => (
              <li key={area} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 py-1.5 text-sm font-medium text-ink-soft">
                <MapPin className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" /> {area}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQs */}
      <section className="py-16 lg:py-24 bg-paper">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl grid lg:grid-cols-[0.8fr_1.2fr] gap-10 lg:gap-16">
          <div className="lg:sticky lg:top-28 self-start">
            <h2 className="font-display text-3xl sm:text-4xl lg:text-[44px] leading-tight font-semibold tracking-tight text-ink mb-4">Frequently Asked Questions</h2>
            <p className="text-ink-muted leading-relaxed mb-6">Anything else? The <Link href="/help" className="font-semibold text-ink underline underline-offset-4 decoration-ink/30 hover:decoration-ink">Help Center</Link> has the rest.</p>
          </div>

          <div className="divide-y divide-line border-y border-line">
            {faqs.map((faq, index) => {
              const open = openFaq === index;
              return (
                <div key={faq.q}>
                  <button
                    className="w-full py-5 flex items-center justify-between gap-6 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-lg"
                    aria-expanded={open}
                    onClick={() => setOpenFaq(open ? null : index)}
                  >
                    <span className="font-semibold text-ink text-base sm:text-lg">{faq.q}</span>
                    <span className={`h-8 w-8 shrink-0 rounded-full border flex items-center justify-center transition ${open ? 'bg-ink border-ink text-white' : 'border-line text-ink'}`} aria-hidden="true">
                      {open ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    </span>
                  </button>
                  <div className={`grid transition-all duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100 pb-6' : 'grid-rows-[0fr] opacity-0'}`}>
                    <div className="overflow-hidden">
                      <p className="text-ink-soft whitespace-pre-line leading-relaxed pr-12">{faq.a}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-16 lg:py-20 bg-white">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <div className="relative overflow-hidden rounded-[36px] bg-brand-900 px-6 py-14 sm:px-12 lg:px-16 lg:py-20">
            <img src={`${IMG}/move-in-repair-package.jpg`} alt="" className="absolute inset-y-0 right-0 hidden lg:block h-full w-1/2 object-cover opacity-90" aria-hidden="true" />
            <span className="absolute inset-y-0 right-0 hidden lg:block w-1/2 bg-gradient-to-r from-brand-900 via-brand-900/40 to-transparent" aria-hidden="true" />
            <div className="relative max-w-xl">
              <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-white leading-tight mb-5">One Platform. Multiple Jobs. Less Hassle.</h2>
              <p className="text-lg text-white/75 leading-relaxed mb-9">
                Cleaning the house? Planning a move? Need repairs completed? Work On Tap helps you find the service that matches your job without making the process unnecessarily complicated.
              </p>
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
                <PriceButton tone="light">See my price</PriceButton>
                <Link href="/services" className="text-white font-semibold underline decoration-white/40 underline-offset-4 hover:decoration-white">
                  Explore All Services
                </Link>
              </div>
              <p className="mt-8 text-sm text-white/60">Your price before you book. Your card is not charged until the job is done.</p>
            </div>
          </div>
        </div>
      </section>

      <Footer />

      {/* Phone-width booking bar */}
      <div
        className={`md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-line px-4 py-3 shadow-[0_-8px_24px_rgba(15,26,20,0.08)] transition-transform duration-300 ${starterInView ? 'translate-y-full' : 'translate-y-0'}`}
        aria-hidden={starterInView}
      >
        <a
          href="#book"
          tabIndex={starterInView ? -1 : 0}
          className="flex items-center justify-center gap-2 w-full min-h-[52px] rounded-2xl bg-brand-500 text-white text-base font-bold active:scale-[0.99]"
        >
          See my price <ArrowRight className="w-5 h-5" aria-hidden="true" />
        </a>
      </div>

      <style jsx>{`
        :global(html, body) {
          overflow-x: hidden;
        }
        :global(html) {
          scroll-behavior: smooth;
        }
        @media (prefers-reduced-motion: reduce) {
          :global(html) {
            scroll-behavior: auto;
          }
        }
      `}</style>
    </div>
  );
}
