'use client';

// "Job link for your crew" on a provider's job page (ENG-015): the job's link with copy, open, switch off and a new link, and each cleaner's number state
// and check-in. The work is in src/components/job/JobLinkManager.jsx; this says which routes to ask and which look to wear. For a job that is not the
// provider's own the route answers 404 and the panel renders nothing.
import JobLinkManager from '@/components/job/JobLinkManager';

export default function JobLinkPanel({ bookingId }) {
  return <JobLinkManager key={bookingId} path={`/api/provider/jobs/${encodeURIComponent(bookingId)}/job-link`} kind="provider" look="provider" title="Job link for your crew" />;
}
