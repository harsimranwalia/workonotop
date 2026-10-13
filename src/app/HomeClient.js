'use client';

import Footer from '@/components/Footer';
import Header from '@/components/Header';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, CalendarCheck, CreditCard, ListChecks, MapPin, ShieldCheck, SlidersHorizontal, Tag } from 'lucide-react';
import AnimatedSearchBar from '@/components/AnimatedSearchBar';
import BookingStarter from '@/components/home/BookingStarter';

export default function HomeClient() {
  const [openFaq, setOpenFaq] = useState(null);
  const [starterInView, setStarterInView] = useState(true);

  // The phone-width bar at the foot of the screen appears once the hero's booking box has scrolled away.
  useEffect(() => {
    const starter = document.getElementById('book');
    if (!starter || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setStarterInView(entry.isIntersecting));
    observer.observe(starter);
    return () => observer.disconnect();
  }, []);

  const services = [
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
    <div className="min-h-screen bg-slate-50 font-sans antialiased text-slate-900 overflow-x-hidden">
      <Header />

      {/* Hero Section */}
      <section className="relative flex items-center overflow-hidden bg-white">
        <div className="container mx-auto px-6 max-w-7xl relative z-10 py-12 lg:py-20">
          <div className="flex flex-col lg:flex-row items-center gap-16">
            <div className="flex-1 text-center lg:text-left relative z-10">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[#15803D] text-sm font-medium mb-6 backdrop-blur-sm animate-fadeIn">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                Metro Vancouver
              </div>

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold font-[family-name:var(--font-outfit)] leading-[1.1] mb-5 tracking-tight">
                Cleaning, Moving & Handyman Services in Vancouver <br className="hidden lg:block" />
                <span className="text-[#16A34A]">— All in One Place</span>
              </h1>

              <p className="text-lg md:text-xl mb-8 max-w-xl lg:mx-0 mx-auto leading-relaxed text-slate-600">
                See your price in about a minute and book online. No quotes to wait for, no phone calls, and your card is not charged until the job is done.
              </p>

              <BookingStarter />

              <div className="mt-10">
                <p className="text-sm font-medium text-slate-500 mb-3">Looking for something else? Search every service.</p>
                <AnimatedSearchBar services={services} />
              </div>

            </div>

            <div className="absolute inset-0 z-0 lg:relative lg:flex-1 lg:z-10 mt-12 lg:mt-0 opacity-25 lg:opacity-100 flex items-center justify-end lg:-mr-20">
              <div className="relative z-10 w-full lg:w-[115%] transition-all duration-500 group flex items-center justify-end">
                <img
                  src="/hero.png"
                  alt="Quality Service Guaranteed"
                  className="w-full h-auto object-contain lg:object-cover transition-transform duration-700"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What you can count on */}
      <section className="bg-slate-900 text-white">
        <div className="container mx-auto px-6 max-w-7xl py-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {promises.map(({ icon: PromiseIcon, title, desc, href }) => (
            <div key={title} className="flex gap-4">
              <PromiseIcon className="w-7 h-7 text-emerald-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <h3 className="font-bold mb-1">{title}</h3>
                <p className="text-sm text-slate-300 leading-relaxed">
                  {desc}{href && <> <Link href={href} className="underline underline-offset-2 hover:text-white">How it works</Link></>}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How booking works */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-6 max-w-7xl">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-5 font-[family-name:var(--font-outfit)]">Booked in Four Short Steps</h2>
            <p className="text-lg text-slate-600 leading-relaxed">
              You see the price the whole way through, so there are no surprises when you confirm.
            </p>
          </div>

          <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {bookingSteps.map(({ icon: StepIcon, title, desc }, i) => (
              <li key={title} className="bg-slate-50 rounded-3xl p-7 border border-slate-100">
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-9 h-9 rounded-full bg-[#16A34A] text-white font-bold flex items-center justify-center">{i + 1}</span>
                  <StepIcon className="w-6 h-6 text-[#16A34A]" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">{title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{desc}</p>
              </li>
            ))}
          </ol>

          <div className="text-center mt-12">
            <a href="#book" className="inline-flex items-center gap-2 px-10 py-4 bg-[#16A34A] text-white rounded-2xl text-lg font-bold hover:bg-[#15803D] transition shadow-lg shadow-green-500/20">
              See my price <ArrowRight className="w-5 h-5" aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      {/* Main Categories Intro */}
      <section className="py-24 bg-slate-50 border-t border-slate-100">
        <div className="container mx-auto px-6 max-w-7xl">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6 font-[family-name:var(--font-outfit)]">One Place for the Services You Need Most</h2>
            <p className="text-lg text-slate-600 leading-relaxed">
              Finding reliable help for different jobs can take time. Work On Tap keeps things simple by bringing three essential service categories together: Cleaning Services, Moving Services, and Handyman Services. Whether you need help with one task or several jobs around your property, you can find a service that matches your needs without searching across multiple platforms.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Link href="/services?category=cleaning" className="group bg-white rounded-3xl p-8 border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col h-full">
              <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center text-3xl mb-6 group-hover:bg-[#16A34A] group-hover:text-white transition-colors">🧹</div>
              <h3 className="text-2xl font-bold text-slate-900 mb-3">Cleaning Services</h3>
              <p className="text-slate-600 mb-6 flex-1">Routine house cleaning, deep cleaning, move-out cleaning, and carpet cleaning.</p>
              <div className="text-[#16A34A] font-medium flex items-center gap-2">Explore Cleaning <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg></div>
            </Link>
            <Link href="/services?category=movers" className="group bg-white rounded-3xl p-8 border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col h-full">
              <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center text-3xl mb-6 group-hover:bg-blue-600 group-hover:text-white transition-colors">📦</div>
              <h3 className="text-2xl font-bold text-slate-900 mb-3">Moving Services</h3>
              <p className="text-slate-600 mb-6 flex-1">Packing & unpacking, loading & unloading, and full moving help without the truck.</p>
              <div className="text-blue-600 font-medium flex items-center gap-2">Explore Moving <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg></div>
            </Link>
            <Link href="/services?category=handyman" className="group bg-white rounded-3xl p-8 border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col h-full">
              <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center text-3xl mb-6 group-hover:bg-amber-500 group-hover:text-white transition-colors">🛠️</div>
              <h3 className="text-2xl font-bold text-slate-900 mb-3">Handyman Services</h3>
              <p className="text-slate-600 mb-6 flex-1">Wall repair, painting touch-ups, furniture assembly, TV mounting, and shelving installation.</p>
              <div className="text-amber-600 font-medium flex items-center gap-2">Explore Handyman <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg></div>
            </Link>
          </div>
        </div>
      </section>

      {/* Deep Dive: Cleaning */}
      <section className="py-24 bg-white overflow-hidden">
        <div className="container mx-auto px-6 max-w-7xl">
          <div className="flex flex-col lg:flex-row items-center gap-16">
            <div className="flex-1">
              <div className="inline-block px-4 py-1.5 rounded-full bg-emerald-50 text-[#16A34A] text-sm font-bold tracking-wider uppercase mb-4">Cleaning Services in Vancouver</div>
              <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6 font-[family-name:var(--font-outfit)]">A Cleaner Space Starts With the Right Service</h2>
              <p className="text-lg text-slate-600 mb-6 leading-relaxed">
                Keeping your home clean takes time, consistency and attention to detail.
              </p>
              <p className="text-lg text-slate-600 mb-8 leading-relaxed">
                Work On Tap offers practical cleaning services in Vancouver for customers who need help maintaining, preparing or refreshing their homes.
              </p>
              <h4 className="font-bold text-slate-900 mb-4">Our Cleaning Services Include:</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
                {['Regular House Cleaning', 'Deep Cleaning', 'Move-In Cleaning', 'Move-Out Cleaning', 'Carpet Cleaning'].map(item => (
                  <div key={item} className="flex items-center gap-2 text-slate-700">
                    <svg className="w-5 h-5 text-[#16A34A] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> {item}
                  </div>
                ))}
              </div>
              <p className="text-slate-600 mb-8 italic">Whether you need regular cleaning, a more thorough deep clean, carpet cleaning, or help preparing a home before moving in or after moving out, choose the service that best fits your needs.</p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                <a href="#book" className="inline-flex items-center gap-2 px-8 py-4 bg-[#16A34A] text-white rounded-xl font-bold hover:bg-[#15803D] transition shadow-lg shadow-green-500/20">
                  Get a cleaning price <ArrowRight className="w-5 h-5" aria-hidden="true" />
                </a>
                <Link href="/services?category=cleaning" className="font-semibold text-[#15803D] underline underline-offset-4 hover:no-underline">
                  Explore Cleaning Services
                </Link>
              </div>
            </div>
            <div className="flex-1 relative">
              <div className="aspect-square md:aspect-[4/5] rounded-[3rem] overflow-hidden shadow-2xl relative z-10 bg-emerald-100 flex items-center justify-center">
                <img src="/cleaning_services.jpg" alt="Cleaning Services" className="w-full h-full object-cover" />
              </div>
              <div className="absolute -bottom-8 -left-8 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl -z-10"></div>
            </div>
          </div>
        </div>
      </section>

      {/* Deep Dive: Moving */}
      <section className="py-24 bg-slate-50 overflow-hidden">
        <div className="container mx-auto px-6 max-w-7xl">
          <div className="flex flex-col-reverse lg:flex-row items-center gap-16">
            <div className="flex-1 relative">
              <div className="aspect-square md:aspect-[4/5] rounded-[3rem] overflow-hidden shadow-2xl relative z-10 bg-blue-100 flex items-center justify-center">
                <img src="/moving_services.jpg" alt="Moving Services" className="w-full h-full object-cover" />
              </div>
              <div className="absolute -top-8 -right-8 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -z-10"></div>
            </div>
            <div className="flex-1">
              <div className="inline-block px-4 py-1.5 rounded-full bg-blue-50 text-blue-600 text-sm font-bold tracking-wider uppercase mb-4">Moving Services in Vancouver</div>
              <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6 font-[family-name:var(--font-outfit)]">Moving Help Without the Truck</h2>
              <p className="text-lg text-slate-600 mb-6 leading-relaxed">
                Moving can involve a lot of physical work, from preparing boxes to loading furniture and getting everything safely organized.
              </p>
              <p className="text-lg text-slate-600 mb-8 leading-relaxed">
                Work On Tap provides moving help without a truck, giving you practical assistance with the hands-on work involved in your move.
              </p>
              <h4 className="font-bold text-slate-900 mb-4">Moving Services Include:</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
                {['Packing & Unpacking', 'Loading & Unloading', 'Full Moving Help'].map(item => (
                  <div key={item} className="flex items-center gap-2 text-slate-700">
                    <svg className="w-5 h-5 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> {item}
                  </div>
                ))}
              </div>
              <p className="text-slate-600 mb-8 italic">Our moving assistance is designed for customers who already have their own transportation or truck and need reliable help with the physical moving work. When requesting moving help, provide details such as the pickup location, destination, property type, stairs or elevators, larger furniture items and preferred moving date.</p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                <a href="#book" className="inline-flex items-center gap-2 px-8 py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition shadow-lg shadow-blue-500/20">
                  Get a moving price <ArrowRight className="w-5 h-5" aria-hidden="true" />
                </a>
                <Link href="/services?category=movers" className="font-semibold text-blue-700 underline underline-offset-4 hover:no-underline">
                  Explore Moving Services
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Deep Dive: Handyman */}
      <section className="py-24 bg-white overflow-hidden">
        <div className="container mx-auto px-6 max-w-7xl">
          <div className="flex flex-col lg:flex-row items-center gap-16">
            <div className="flex-1">
              <div className="inline-block px-4 py-1.5 rounded-full bg-amber-50 text-amber-600 text-sm font-bold tracking-wider uppercase mb-4">Handyman Services in Vancouver</div>
              <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6 font-[family-name:var(--font-outfit)]">Get Those Small Jobs Off Your To-Do List</h2>
              <p className="text-lg text-slate-600 mb-6 leading-relaxed">
                A damaged wall, piece of furniture waiting to be assembled, TV that needs mounting or storage that needs installing can quickly become another task on your list.
              </p>
              <p className="text-lg text-slate-600 mb-8 leading-relaxed">
                Work On Tap provides practical handyman services in Vancouver for homeowners, renters, landlords and property managers.
              </p>
              <h4 className="font-bold text-slate-900 mb-4">Our Handyman Services Include:</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8 text-sm">
                {['Wall & Drywall Repair', 'Painting & Touch-Ups', 'General Home Repairs', 'Furniture Assembly', 'TV & Wall Mounting', 'Shelving & Storage Installation'].map(item => (
                  <div key={item} className="flex items-center gap-2 text-slate-700">
                    <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> {item}
                  </div>
                ))}
              </div>
              <p className="text-slate-600 mb-8 italic">From repairing wall damage and touching up paint to assembling furniture and installing shelves, choose the handyman service that matches the job you need completed.</p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                <a href="#book" className="inline-flex items-center gap-2 px-8 py-4 bg-amber-500 text-white rounded-xl font-bold hover:bg-amber-600 transition shadow-lg shadow-amber-500/20">
                  Get a handyman price <ArrowRight className="w-5 h-5" aria-hidden="true" />
                </a>
                <Link href="/services?category=handyman" className="font-semibold text-amber-700 underline underline-offset-4 hover:no-underline">
                  Explore Handyman Services
                </Link>
              </div>
            </div>
            <div className="flex-1 relative">
              <div className="aspect-square md:aspect-[4/5] rounded-[3rem] overflow-hidden shadow-2xl relative z-10 bg-amber-100 flex items-center justify-center">
                <img src="/handyman_services.jpg" alt="Handyman Services" className="w-full h-full object-cover" />
              </div>
              <div className="absolute -bottom-8 -left-8 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl -z-10"></div>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Repair Packages */}
      <section className="py-24 bg-indigo-50 overflow-hidden">
        <div className="container mx-auto px-6 max-w-7xl">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6 font-[family-name:var(--font-outfit)]">Featured Repair Packages</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            <div className="bg-white rounded-3xl p-10 border border-slate-100 shadow-md">
              <h3 className="text-2xl font-bold text-indigo-900 mb-2">Move-Out Repair Package</h3>
              <p className="text-indigo-600 font-medium mb-6">Prepare Your Home for Handover.</p>
              <p className="text-slate-600 mb-6">
                Moving out can leave behind small repairs that need attention before an inspection or handover. It is designed for tenants moving out and property managers preparing rental units.
              </p>
              <h4 className="font-bold text-slate-900 mb-4">Package combines:</h4>
              <ul className="space-y-3 mb-8">
                {['Wall & drywall repair', 'Patching', 'Touch-up paint', 'General small repairs'].map(item => (
                  <li key={item} className="flex items-center gap-3 text-slate-700">
                    <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">✓</div>
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/services/move-out-repair-package-in-vancouver" className="inline-block text-indigo-600 font-bold hover:text-indigo-800 transition">Explore Move-Out Repair Package →</Link>
            </div>
            <div className="bg-white rounded-3xl p-10 border border-slate-100 shadow-md">
              <h3 className="text-2xl font-bold text-emerald-900 mb-2">Move-In Repair Package</h3>
              <p className="text-emerald-600 font-medium mb-6">Settle Into Your New Place.</p>
              <p className="text-slate-600 mb-6">
                Getting comfortable in a new home often means assembling furniture, mounting your TV and organizing your space. A practical option for customers getting their new home ready.
              </p>
              <h4 className="font-bold text-slate-900 mb-4">Package combines:</h4>
              <ul className="space-y-3 mb-8">
                {['TV & wall mounting', 'Furniture assembly', 'Shelving & storage installation', 'General small repairs'].map(item => (
                  <li key={item} className="flex items-center gap-3 text-slate-700">
                    <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">✓</div>
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/services/move-in-repair-package-in-vancouver" className="inline-block text-emerald-600 font-bold hover:text-emerald-800 transition">Explore Move-In Repair Package →</Link>
            </div>
          </div>
        </div>
      </section>

      {/* Target Audiences */}
      <section className="py-24 bg-slate-900 text-white">
        <div className="container mx-auto px-6 max-w-7xl">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-6 font-[family-name:var(--font-outfit)]">Home Services for Homes & Rentals</h2>
            <p className="text-lg text-slate-400">
              Work On Tap is designed to support different types of customers across Vancouver and surrounding Metro Vancouver areas.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: <svg className="w-10 h-10 text-[#16A34A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>, title: 'For Homeowners', desc: 'Get help with cleaning, repairs, installations, furniture assembly, moving assistance and everyday household tasks.' },
              { icon: <svg className="w-10 h-10 text-[#16A34A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l9-5-9-5-9 5 9 5z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14v7" /></svg>, title: 'For Renters', desc: 'Find help with move-in and move-out cleaning, moving assistance, furniture assembly, wall repairs and other household jobs.' },
              { icon: <svg className="w-10 h-10 text-[#16A34A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>, title: 'For Landlords & Property Managers', desc: 'Arrange move-out cleaning, move-in cleaning, repair work and handyman services when preparing properties for new occupants.' },
              { icon: <svg className="w-10 h-10 text-[#16A34A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>, title: 'For People Moving Into a New Home', desc: 'Get practical help with packing, unloading, furniture assembly, TV mounting, shelving installation and other setup tasks.' }
            ].map((card, i) => (
              <div key={i} className="bg-slate-800 p-8 rounded-3xl border border-slate-700 hover:border-[#16A34A]/50 transition-colors">
                <div className="mb-4">{card.icon}</div>
                <h3 className="text-xl font-bold mb-3">{card.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Choose Us */}
      <section className="py-24 bg-white">
        <div className="container mx-auto px-6 max-w-7xl">
          <div className="flex flex-col lg:flex-row items-center gap-16">
            <div className="flex-1">
              <span className="text-emerald-600 font-bold tracking-widest uppercase text-sm mb-4 block">Benefits</span>
              <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-8 font-[family-name:var(--font-outfit)]">Why Choose Work On Tap?</h2>

              <div className="space-y-6">
                {[
                  { title: 'Multiple Services in One Place', desc: 'Find cleaning, moving assistance and handyman services without searching across multiple websites.' },
                  { title: 'Practical Services for Everyday Needs', desc: 'Choose from focused services designed around common cleaning, moving and home-repair tasks.' },
                  { title: 'Services Based on Your Actual Needs', desc: 'Select the specific type of cleaning, moving assistance or handyman work required instead of relying on a one-size-fits-all service.' },
                  { title: 'Simple Service Discovery', desc: 'Start with the main service category, choose the service you need and provide details about your job.' },
                  { title: 'Vancouver & Metro Vancouver Service Area', desc: 'Find service options for customers across Vancouver and surrounding Metro Vancouver areas, subject to service availability.' },
                ].map((item, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0 mt-1">✓</div>
                    <div>
                      <h4 className="text-lg font-bold text-slate-900">{item.title}</h4>
                      <p className="text-slate-600">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-1 relative w-full mt-10 lg:mt-0">
              <div className="aspect-square md:aspect-[4/5] rounded-[3rem] overflow-hidden shadow-2xl relative z-10 bg-emerald-100 flex items-center justify-center">
                <img src="/why-choose-us.jpg" alt="Why Choose Us" className="w-full h-full object-cover" />
              </div>
              <div className="absolute -bottom-8 -left-8 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl -z-10"></div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQs */}
      <section className="py-24 bg-slate-50 border-t border-slate-100">
        <div className="container mx-auto px-6 max-w-3xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-4 font-[family-name:var(--font-outfit)]">Frequently Asked Questions</h2>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <div key={index} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm transition-all">
                <button
                  className="w-full px-6 py-5 flex items-center justify-between text-left focus:outline-none"
                  onClick={() => setOpenFaq(openFaq === index ? null : index)}
                >
                  <span className="font-bold text-slate-900 text-lg">{faq.q}</span>
                  <span className={`transform transition-transform text-slate-400 ${openFaq === index ? 'rotate-180' : ''}`}>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </span>
                </button>
                <div
                  className={`px-6 transition-all duration-300 ease-in-out ${openFaq === index ? 'max-h-96 pb-6 opacity-100' : 'max-h-0 opacity-0 overflow-hidden'}`}
                >
                  <p className="text-slate-600 whitespace-pre-line">{faq.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 bg-[#16A34A] text-center px-6">
        <div className="container mx-auto max-w-4xl relative z-10">
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6 font-[family-name:var(--font-outfit)]">One Platform. Multiple Jobs. Less Hassle.</h2>
          <p className="text-xl text-emerald-100 mb-12 leading-relaxed">
            Cleaning the house? Planning a move? Need repairs completed?<br />
            Work On Tap helps you find the service that matches your job without making the process unnecessarily complicated.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8">
            <a href="#book" className="inline-flex items-center gap-3 bg-white text-[#15803D] px-10 py-5 rounded-2xl font-bold hover:bg-slate-50 transition-all shadow-xl active:scale-95 group text-lg">
              See my price
              <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" aria-hidden="true" />
            </a>
            <Link href="/services" className="text-white font-semibold underline underline-offset-4 hover:no-underline">
              Explore All Services
            </Link>
          </div>
          <p className="mt-8 text-emerald-100">Your price in about a minute. Your card is not charged until the job is done.</p>
        </div>
      </section>

      <Footer />

      {/* Phone-width booking bar */}
      <div
        className={`md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] transition-transform duration-300 ${starterInView ? 'translate-y-full' : 'translate-y-0'}`}
        aria-hidden={starterInView}
      >
        <a
          href="#book"
          tabIndex={starterInView ? -1 : 0}
          className="flex items-center justify-center gap-2 w-full min-h-[52px] rounded-2xl bg-[#16A34A] text-white text-base font-bold active:scale-[0.99]"
        >
          See my price <ArrowRight className="w-5 h-5" aria-hidden="true" />
        </a>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.8s ease-out forwards; }
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
