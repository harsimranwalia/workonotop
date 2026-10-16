// The page a customer opens from the link an admin gives them (ENG-013): the job the card is for and a field to add a card. It sits outside /booking and shows no
// site navigation. The link is the whole credential, so the page asks search engines to skip it and browsers to send no referrer to anything the page loads.
import CardForm from '@/components/card/CardForm';

export const metadata = {
  title: 'Add your card',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function CardPage({ params }) {
  const { token } = await params;
  return <CardForm token={token} />;
}
