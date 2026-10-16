// The page a job link opens (ENG-015): the job, its crew, and the check-in for the people who may see them. The link only says which job; what the page
// shows depends on who is looking, so the page asks the server on every visit. The address holds the link, so the page asks search engines to skip it
// and browsers to send no referrer to anything the page loads.
import JobLink from '@/components/job/JobLink';

export const metadata = {
  title: 'Your job',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function JobLinkPage({ params }) {
  const { token } = await params;
  return <JobLink token={token} />;
}
