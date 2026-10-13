// The words shown beside a booking's amount, chosen by its payment status.

const WORDS = {
  authorized: {
    baseLabel: 'Held on your card (base price):',
    notCompletedText: 'Held on your card; charged when the job is done',
    totalLabel: 'Total held',
    totalNote: 'Your card is held and is charged when the job is done',
  },
  paid: {
    baseLabel: 'Paid (base price):',
    notCompletedText: 'Paid',
    totalLabel: 'Total paid',
    totalNote: 'Paid when the job was done',
  },
  pending: {
    baseLabel: 'Payment not confirmed yet (base price):',
    notCompletedText: 'Payment not confirmed yet',
    totalLabel: 'Total',
    totalNote: 'Payment not confirmed yet',
  },
  failed: {
    baseLabel: 'Payment not completed (base price):',
    notCompletedText: 'Payment not completed',
    totalLabel: 'Total',
    totalNote: 'Payment not completed',
  },
  refunded: {
    baseLabel: 'Refunded (base price):',
    notCompletedText: 'Refunded',
    totalLabel: 'Total refunded',
    totalNote: 'Refunded to your card',
  },
}

// No status, or one that is not listed, gets the authorized words: the receipt shown right after checkout carries no status.
export function paymentStatusText(status) {
  return Object.prototype.hasOwnProperty.call(WORDS, status) ? WORDS[status] : WORDS.authorized
}
