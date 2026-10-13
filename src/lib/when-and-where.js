// The answers of step 4 (when and where), what the step checks before the booking goes on, and the booking fields they make. They live
// here and not in the step's component so the confirm page can run the same checks without pulling the step into its bundle.
import { dayLabel } from '@/lib/booking-answers';

export const EMPTY_WHEN_AND_WHERE = {
  selectedDates: [],
  selectedTimes: {},
  timingConstraints: '',
  address: '',
  jobDescription: '',
  photos: [],
  parkingAccess: false,
  elevatorAccess: false,
  hasPets: false,
};

export const MIN_DESCRIPTION_LENGTH = 20;

// closesAt: on today's date a slot is offered until this local hour, then reads "Slot passed"
export const TIME_SLOTS = [
  { id: 'morning', label: 'Morning', icon: '🌅', time: '8am - 12pm', closesAt: 11 },
  { id: 'afternoon', label: 'Afternoon', icon: '☀️', time: '12pm - 4pm', closesAt: 15 },
  { id: 'evening', label: 'Evening', icon: '🌙', time: '4pm - 8pm', closesAt: 19 },
];

export const withDefaults = (value) => ({ ...EMPTY_WHEN_AND_WHERE, ...value });

export function checkWhenAndWhere(value) {
  const { selectedDates, selectedTimes, address, jobDescription } = withDefaults(value);

  if (selectedDates.length === 0) {
    return { kind: 'dates', title: 'Selection Required', text: 'Please select 1 to 3 dates to continue' };
  }
  if (selectedDates.some((d) => !selectedTimes[d] || selectedTimes[d].length === 0)) {
    return { kind: 'slots', title: 'Time Slot Required', text: 'Please select at least one time slot for each date' };
  }
  if (!address || address.trim() === '') {
    return { kind: 'address', title: '', text: 'Please enter your service location' };
  }
  if (jobDescription.trim().length < MIN_DESCRIPTION_LENGTH) {
    return { kind: 'description', title: '', text: 'Please write at least 20 characters to help pros understand your job' };
  }
  return null;
}

export function whenAndWhereBooking(value) {
  const v = withDefaults(value);
  const jobTimeSlot = [];

  v.selectedDates.forEach((dateStr) => {
    const slots = v.selectedTimes[dateStr];
    if (slots && slots.length > 0) {
      const names = slots.map((id) => TIME_SLOTS.find((slot) => slot.id === id)?.label ?? id);
      jobTimeSlot.push(`${dayLabel(dateStr)}: ${names.join(' & ')}`);
    }
  });

  return {
    job_date: v.selectedDates,
    job_time_slot: jobTimeSlot,
    timing_constraints: v.timingConstraints,
    job_description: v.jobDescription,
    instructions: '',
    parking_access: v.parkingAccess,
    elevator_access: v.elevatorAccess,
    has_pets: v.hasPets,
    photos: v.photos,
    address: v.address,
  };
}
