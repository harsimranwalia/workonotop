'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AlarmClock, CalendarDays, Camera, Clock, Hourglass, KeyRound, MapPin, Moon, NotebookPen, Repeat, Sun, Sunrise } from 'lucide-react';
import { dayLabel } from '@/lib/booking-answers';
import { FREQUENCIES } from '@/lib/visit-series';
import { MIN_DESCRIPTION_LENGTH, TIME_SLOTS, isRepeating, withDefaults } from '@/lib/when-and-where';

const MAX_DATES = 3;
const FREQUENCY_CHOICES = [
  { value: 'once', label: 'Once' },
  ...Object.entries(FREQUENCIES).map(([value, { label }]) => ({ value, label })),
];
const MAX_TIMING_LENGTH = 400;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_PHOTOS = 5;

const FLAGS = [
  { id: 'parking', field: 'parkingAccess', label: 'Free street parking available', help: 'Let pros know they can park without permits' },
  { id: 'elevator', field: 'elevatorAccess', label: 'Building has elevator', help: 'For apartments/condos' },
  { id: 'pets', field: 'hasPets', label: 'I have pets', help: 'Pros will take extra care when entering' },
];

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2';
const FIELD_FOCUS = 'focus:outline-none focus:border-ink/40 focus:ring-4 focus:ring-brand-500/10';
const SLOT_ICONS = { morning: Sunrise, afternoon: Sun, evening: Moon };

const toDateStr = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const describedBy = (...ids) => ids.filter(Boolean).join(' ') || undefined;

function isSlotAvailable(dateStr, slot) {
  const now = new Date();
  if (dateStr !== toDateStr(now.getFullYear(), now.getMonth() + 1, now.getDate())) return true;
  return now.getHours() < slot.closesAt;
}

function calendarDays(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDay = new Date(year, month - 1, 1).getDay();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = [];

  for (let i = 0; i < firstDay; i++) {
    days.push({ day: null, available: false });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push({ day: i, available: new Date(year, month - 1, i) >= startOfToday });
  }
  return days;
}

function initialView(selectedDates) {
  const [year, month] = (selectedDates[0] || '').split('-').map(Number);
  if (year && month) return { year, month };
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function Card({ children }) {
  return <div className="bg-white rounded-[28px] shadow-card border border-line overflow-hidden">{children}</div>;
}

function CardHeader({ id, icon: Icon, title, subtitle }) {
  return (
    <div className="px-5 sm:px-6 md:px-8 pt-6 pb-5 border-b border-line">
      <h3 id={id} className="font-display text-xl md:text-2xl font-semibold tracking-tight text-ink flex items-center">
        <span aria-hidden="true" className="mr-3 shrink-0 h-10 w-10 rounded-2xl bg-brand-50 border border-brand-100 flex items-center justify-center">
          <Icon className="h-5 w-5 text-brand-600" />
        </span>
        {title}
      </h3>
      {subtitle && <p className="text-ink-muted text-sm mt-2">{subtitle}</p>}
    </div>
  );
}

function InfoIcon({ className }) {
  return (
    <svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
    </svg>
  );
}

function LockIcon({ className }) {
  return (
    <svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
    </svg>
  );
}

export default function WhenAndWhereStep({ value, onChange, showHints = false, onUploadingChange, allowRepeat = true }) {
  const v = withDefaults(value);
  const uid = useId();
  const id = (name) => `${uid}-${name}`;
  const latest = useRef(v);
  const fileInputRef = useRef(null);
  const [view, setView] = useState(() => initialView(v.selectedDates));
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  useEffect(() => {
    latest.current = v;
  });

  const update = (patch) => onChange({ ...v, ...patch });

  const goToPreviousMonth = () =>
    setView(({ year, month }) => (month > 1 ? { year, month: month - 1 } : { year: year - 1, month: 12 }));
  const goToNextMonth = () =>
    setView(({ year, month }) => (month < 12 ? { year, month: month + 1 } : { year: year + 1, month: 1 }));

  const repeating = isRepeating(v.frequency);
  // A repeating booking has one date, the first visit's, so another day replaces it; otherwise up to MAX_DATES days are kept.
  const canAddDate = repeating || v.selectedDates.length < MAX_DATES;

  const chooseFrequency = (frequency) => {
    if (frequency === v.frequency) return;
    if (!isRepeating(frequency) || v.selectedDates.length <= 1) {
      update({ frequency });
      return;
    }
    // Only the earliest date, with its times, stays when a booking that has several dates starts to repeat.
    const [first] = v.selectedDates;
    update({ frequency, selectedDates: [first], selectedTimes: first in v.selectedTimes ? { [first]: v.selectedTimes[first] } : {} });
  };

  const toggleDate = (day) => {
    const dateStr = toDateStr(view.year, view.month, day);
    if (v.selectedDates.includes(dateStr)) {
      update({ selectedDates: v.selectedDates.filter((d) => d !== dateStr) });
    } else if (repeating) {
      update({ selectedDates: [dateStr] });
    } else if (canAddDate) {
      // 'YYYY-MM-DD' strings sort in date order
      update({ selectedDates: [...v.selectedDates, dateStr].sort() });
    }
  };

  const toggleSlot = (dateStr, slot) => {
    const current = v.selectedTimes[dateStr] || [];
    if (current.includes(slot.id)) {
      update({ selectedTimes: { ...v.selectedTimes, [dateStr]: current.filter((s) => s !== slot.id) } });
    } else if (isSlotAvailable(dateStr, slot)) {
      update({ selectedTimes: { ...v.selectedTimes, [dateStr]: [...current, slot.id] } });
    }
  };

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files);
    // clearing the input lets the same file be chosen again
    if (fileInputRef.current) fileInputRef.current.value = '';
    setUploadError('');
    if (files.length === 0) return;

    if (v.photos.length + files.length > MAX_PHOTOS) {
      setUploadError(`You can only upload up to ${MAX_PHOTOS} photos`);
      return;
    }

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        setUploadError('Some files exceed the 10MB limit');
        return;
      }
      if (!file.type.startsWith('image/')) {
        setUploadError('Please upload only image files');
        return;
      }
    }

    setUploading(true);
    if (onUploadingChange) onUploadingChange(true);

    const uploadPromises = files.map(async (file) => {
      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();
        if (data.success) {
          return data.url;
        }
        throw new Error(data.message);
      } catch (error) {
        console.error('Upload error:', error);
        return null;
      }
    });

    try {
      const uploadedUrls = await Promise.all(uploadPromises);
      const validUrls = uploadedUrls.filter((url) => url !== null);
      // the latest value, not this render's: the customer may have kept typing while the upload ran
      const current = latest.current;
      onChange({ ...current, photos: [...current.photos, ...validUrls] });

      if (validUrls.length < files.length) {
        setUploadError('Some photos failed to upload');
      }
    } catch {
      setUploadError('Failed to upload photos');
    } finally {
      setUploading(false);
      if (onUploadingChange) onUploadingChange(false);
    }
  };

  const removePhoto = (indexToRemove) => {
    update({ photos: v.photos.filter((_, index) => index !== indexToRemove) });
  };

  const days = calendarDays(view.year, view.month);
  const missingAddress = !v.address.trim();
  const shortDescription = v.jobDescription.trim().length < MIN_DESCRIPTION_LENGTH;
  const addressError = showHints && missingAddress ? 'Required' : '';
  const hintKind = missingAddress ? 'address' : shortDescription ? 'description' : null;
  const hintText = {
    address: 'Please enter your service address',
    description: 'Please write at least 20 characters to help pros understand your job',
  };

  return (
    <div className="space-y-6">
      {allowRepeat && (
        <Card>
          <CardHeader id={id('often')} icon={Repeat} title="How often?" />

          <div className="p-5 sm:p-6 md:p-8">
            <div role="radiogroup" aria-labelledby={id('often')} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {FREQUENCY_CHOICES.map((choice) => {
                const checked = v.frequency === choice.value;
                return (
                  <label
                    key={choice.value}
                    className={`flex items-center gap-3 p-4 rounded-2xl border cursor-pointer motion-safe:transition focus-within:ring-2 focus-within:ring-brand-500 ${checked ? 'ring-2 ring-brand-500 border-brand-500 bg-brand-50' : 'border-line bg-white hover:border-ink/40'}`}
                  >
                    <input
                      type="radio"
                      name={id('often-choice')}
                      value={choice.value}
                      checked={checked}
                      onChange={() => chooseFrequency(choice.value)}
                      className="w-4 h-4 accent-brand-600"
                    />
                    <span className="font-medium text-ink">{choice.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          id={id('dates')}
          icon={CalendarDays}
          title="When should we send someone?"
          subtitle={repeating ? 'Choose the date of the first visit. The next visits are booked from it.' : 'Select 1 to 3 dates that work for you'}
        />

        <div className="p-5 sm:p-6 md:p-8">
          <div className="flex items-center justify-between mb-6">
            <h4 id={id('month')} aria-live="polite" className="font-display text-xl font-semibold text-ink">
              {MONTH_NAMES[view.month - 1]} {view.year}
            </h4>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={goToPreviousMonth}
                aria-label="Previous month"
                className={`w-10 h-10 rounded-full flex items-center justify-center bg-white hover:border-ink/40 motion-safe:transition border border-line ${FOCUS_RING}`}
              >
                <svg aria-hidden="true" className="w-5 h-5 text-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={goToNextMonth}
                aria-label="Next month"
                className={`w-10 h-10 rounded-full flex items-center justify-center bg-white hover:border-ink/40 motion-safe:transition border border-line ${FOCUS_RING}`}
              >
                <svg aria-hidden="true" className="w-5 h-5 text-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          <div role="group" aria-labelledby={id('month')}>
            <div className="grid grid-cols-7 gap-1 md:gap-2 mb-2">
              {WEEKDAYS.map((day, index) => (
                <div key={index} className="text-center text-xs md:text-sm font-semibold text-ink-muted py-2">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1 md:gap-2">
              {days.map((day, index) => {
                if (!day.day) return <div key={index} className="aspect-square" />;

                const dateStr = toDateStr(view.year, view.month, day.day);
                const isSelected = v.selectedDates.includes(dateStr);
                // a selected day stays clickable so it can always be removed
                const isClickable = isSelected || (day.available && canAddDate);

                return (
                  <div key={index} className="aspect-square">
                    <button
                      type="button"
                      onClick={() => toggleDate(day.day)}
                      disabled={!isClickable}
                      aria-pressed={isSelected}
                      aria-label={dayLabel(dateStr, 'long')}
                      className={`
                        w-full h-full rounded-xl sm:rounded-2xl flex items-center justify-center text-sm md:text-base font-medium
                        motion-safe:transition-all motion-safe:duration-200 ${FOCUS_RING}
                        ${isSelected
                          ? 'bg-brand-500 text-white shadow-lg shadow-brand-600/20 motion-safe:scale-105'
                          : isClickable
                            ? 'bg-white hover:bg-brand-50 text-ink border border-line hover:border-brand-500'
                            : 'text-ink-muted/40 bg-paper cursor-not-allowed border border-transparent'
                        }
                      `}
                    >
                      {day.day}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-8">
            <h4 className="font-display text-lg font-semibold text-ink mb-4 flex items-center">
              <AlarmClock aria-hidden="true" className="mr-2 h-5 w-5 text-brand-600" />
              Select your preferred times
            </h4>

            {v.selectedDates.length === 0 ? (
              <div className="bg-paper border border-line rounded-2xl p-6 text-center">
                <p className="text-ink-muted">Please select a date from the calendar first.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {v.selectedDates.map((dateStr) => (
                  <div
                    key={dateStr}
                    role="group"
                    aria-labelledby={id(`times-${dateStr}`)}
                    className="bg-paper border border-line rounded-2xl p-4"
                  >
                    <h5 id={id(`times-${dateStr}`)} className="font-semibold text-ink mb-3 border-b border-line pb-2">
                      {dayLabel(dateStr, 'weekday')}
                    </h5>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {TIME_SLOTS.map((slot) => {
                        const available = isSlotAvailable(dateStr, slot);
                        const isSelected = (v.selectedTimes[dateStr] || []).includes(slot.id);
                        const SlotIcon = SLOT_ICONS[slot.id] || Clock;

                        return (
                          <button
                            key={slot.id}
                            type="button"
                            onClick={() => toggleSlot(dateStr, slot)}
                            disabled={!available && !isSelected}
                            aria-pressed={isSelected}
                            className={`
                              p-3 rounded-2xl border motion-safe:transition-all motion-safe:duration-200 ${FOCUS_RING}
                              ${isSelected
                                ? 'bg-brand-500 border-brand-500 text-white shadow-lg shadow-brand-600/20'
                                : available
                                  ? 'bg-white border-line hover:border-brand-500 hover:bg-brand-50 text-ink'
                                  : 'bg-paper-deep border-line text-ink-muted cursor-not-allowed opacity-60'
                              }
                            `}
                          >
                            <span className="flex flex-col items-center">
                              <span aria-hidden="true" className={`mb-1 ${available ? '' : 'opacity-50'}`}><SlotIcon className={`h-5 w-5 ${isSelected ? 'text-white' : 'text-brand-600'}`} /></span>
                              <span className="font-bold text-sm">{slot.label}</span>
                              <span className={`text-xs mt-0.5 ${isSelected ? 'text-white/80' : 'text-ink-muted'}`}>
                                {available ? slot.time : 'Slot passed'}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader id={id('timing')} icon={Hourglass} title="Timing constraints" subtitle="Let your pro know about any specific timing needs" />

        <div className="p-5 sm:p-6 md:p-8">
          <textarea
            value={v.timingConstraints}
            onChange={(e) => update({ timingConstraints: e.target.value })}
            maxLength={MAX_TIMING_LENGTH}
            placeholder="e.g. Baby is napping from 3-4pm..."
            aria-labelledby={id('timing')}
            aria-describedby={describedBy(id('timing-count'), id('timing-note'))}
            className={`w-full h-32 md:h-40 p-4 border border-line rounded-xl resize-none ${FIELD_FOCUS} motion-safe:transition text-ink placeholder:text-ink-muted text-base`}
          />

          <p id={id('timing-count')} className="text-xs text-ink-muted mt-2 text-right">
            {v.timingConstraints.length}/{MAX_TIMING_LENGTH} characters
          </p>

          <p id={id('timing-note')} className="text-xs text-ink-muted mt-3 flex items-center">
            <InfoIcon className="w-4 h-4 text-brand-600 mr-1" />
            Your pro will see these notes before accepting the job
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader id={id('where')} icon={MapPin} title="Where do you need service?" subtitle="Your exact address helps us match you with nearby pros" />

        <div className="p-5 sm:p-6 md:p-8">
          <div className="flex justify-between items-center mb-2">
            <label htmlFor={id('address')} className="block text-sm font-semibold text-ink">
              Service Address <span aria-hidden="true" className="text-red-600">*</span>
            </label>
            {addressError && (
              <span id={id('address-error')} className="text-red-600 text-xs font-bold motion-safe:animate-pulse">
                {addressError}
              </span>
            )}
          </div>
          <input
            id={id('address')}
            type="text"
            value={v.address}
            onChange={(e) => update({ address: e.target.value })}
            aria-invalid={addressError ? 'true' : undefined}
            aria-describedby={describedBy(addressError && id('address-error'), id('address-note'))}
            className={`w-full p-3 border rounded-xl bg-white motion-safe:transition text-ink placeholder:text-ink-muted ${FIELD_FOCUS} ${addressError ? 'border-red-400' : 'border-line'}`}
            placeholder="Please enter your service location"
            required
          />
          <p id={id('address-note')} className="text-xs text-ink-muted mt-3 flex items-center">
            <LockIcon className="w-4 h-4 text-brand-600 mr-1" />
            Your address is kept private until you accept a pro
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader id={id('what')} icon={NotebookPen} title="What do you need done?" subtitle="Be specific — include make/model if possible" />

        <div className="p-5 sm:p-6 md:p-8">
          <textarea
            value={v.jobDescription}
            onChange={(e) => update({ jobDescription: e.target.value.slice(0, MAX_DESCRIPTION_LENGTH) })}
            placeholder="e.g. My Whirlpool dishwasher (model WDF540PADM) is not draining. It makes a humming sound but water stays at the bottom. Need someone to diagnose and repair."
            aria-labelledby={id('what')}
            aria-invalid={showHints && hintKind === 'description' ? 'true' : undefined}
            aria-describedby={describedBy(id('what-hint'), id('what-count'), hintKind === 'description' && id('hint'))}
            className={`w-full h-40 md:h-48 p-4 border border-line rounded-xl resize-none ${FIELD_FOCUS} motion-safe:transition text-ink placeholder:text-ink-muted text-base`}
          />

          <div className="flex justify-between items-center mt-3">
            <div id={id('what-hint')} className="flex items-center text-xs text-ink-muted">
              <InfoIcon className="w-4 h-4 mr-1 text-brand-600" />
              Include details like: issue, make/model, when it started
            </div>
            <span
              id={id('what-count')}
              className={`text-xs font-medium ${v.jobDescription.length >= MAX_DESCRIPTION_LENGTH ? 'text-red-600' : 'text-ink-muted'}`}
            >
              {v.jobDescription.length}/{MAX_DESCRIPTION_LENGTH}
            </span>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader id={id('photos')} icon={Camera} title="Upload photos" subtitle="Show pros exactly what needs to be done" />

        <div className="p-5 sm:p-6 md:p-8">
          {uploadError && (
            <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 rounded-2xl flex items-center text-red-700 text-sm">
              <svg aria-hidden="true" className="w-5 h-5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {uploadError}
            </div>
          )}

          {v.photos.length > 0 && (
            <div className="mb-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {v.photos.map((photo, index) => (
                  <div key={index} className="relative group aspect-square bg-paper-deep rounded-2xl overflow-hidden border border-line hover:border-brand-500 motion-safe:transition">
                    <img
                      src={photo}
                      alt={`Upload ${index + 1}`}
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 motion-safe:transition-opacity flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => removePhoto(index)}
                        className="bg-red-600 text-white rounded-full p-2 hover:bg-red-700 motion-safe:transition motion-safe:hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                        aria-label="Remove photo"
                      >
                        <svg aria-hidden="true" className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {v.photos.length < MAX_PHOTOS ? (
            <label
              className={`
                relative border-2 border-dashed rounded-2xl p-6 sm:p-8 flex flex-col items-center justify-center text-center cursor-pointer
                motion-safe:transition-all motion-safe:duration-200 focus-within:ring-2 focus-within:ring-brand-500 focus-within:ring-offset-2
                ${v.photos.length === 0
                  ? 'border-line bg-paper hover:border-brand-500 hover:bg-brand-50'
                  : 'border-brand-200 bg-brand-50/50 hover:bg-brand-50'
                }
                ${uploading ? 'opacity-50 cursor-wait' : ''}
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                onChange={handlePhotoUpload}
                className="sr-only"
                disabled={uploading}
                aria-labelledby={id('photos-action')}
                aria-describedby={describedBy(id('photos-types'), id('photos-count'))}
              />
              <span
                className={`
                  w-16 h-16 rounded-full flex items-center justify-center mb-3
                  ${v.photos.length === 0 ? 'bg-brand-50 border border-brand-100' : 'bg-brand-100'}
                `}
              >
                {uploading ? (
                  <svg aria-hidden="true" className="motion-safe:animate-spin w-8 h-8 text-brand-600" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg aria-hidden="true" className={`w-8 h-8 ${v.photos.length === 0 ? 'text-brand-600' : 'text-brand-700'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                )}
              </span>
              <span id={id('photos-action')} className="text-brand-700 font-bold text-lg mb-1">
                {uploading ? 'Uploading...' : (v.photos.length === 0 ? 'Add Photos' : 'Add More Photos')}
              </span>
              <span id={id('photos-types')} className="text-sm text-ink-muted">
                PNG, JPG, GIF up to 10MB each
              </span>
              <span id={id('photos-count')} className="text-xs text-ink-muted mt-2">
                {v.photos.length}/{MAX_PHOTOS} photos uploaded
              </span>
            </label>
          ) : (
            <div className="bg-brand-50 rounded-2xl p-4 text-center border border-brand-100">
              <span className="text-brand-700 font-semibold">✓ Maximum photos uploaded</span>
              <p className="text-xs text-ink-soft mt-1">You&apos;ve added {MAX_PHOTOS} photos</p>
            </div>
          )}

          <p className="text-xs text-ink-muted mt-4 flex items-center">
            <InfoIcon className="w-4 h-4 text-brand-600 mr-1" />
            Photos help pros give more accurate quotes
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader id={id('access')} icon={KeyRound} title="Access & safety (optional)" />

        <div role="group" aria-labelledby={id('access')} className="p-5 sm:p-6 md:p-8 space-y-4">
          {FLAGS.map((flag) => (
            <div key={flag.id} className="flex items-start">
              <div className="flex items-center h-5">
                <input
                  id={flag.id}
                  type="checkbox"
                  checked={v[flag.field]}
                  onChange={(e) => update({ [flag.field]: e.target.checked })}
                  aria-describedby={`${flag.id}-help`}
                  className="w-5 h-5 accent-brand-600 border border-line rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                />
              </div>
              <div className="ml-3 text-sm">
                <label htmlFor={flag.id} className="font-medium text-ink">{flag.label}</label>
                <p id={`${flag.id}-help`} className="text-xs text-ink-muted">{flag.help}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {hintKind && (
        <p id={id('hint')} role={showHints ? 'alert' : 'status'} className="text-sm text-amber-800 bg-amber-50 border border-amber-200 p-3 rounded-2xl flex items-center">
          <svg aria-hidden="true" className="w-5 h-5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {hintText[hintKind]}
        </p>
      )}
    </div>
  );
}
