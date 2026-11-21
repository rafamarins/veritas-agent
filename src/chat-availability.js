import guideAnswers from './guide/answers.json' with { type: 'json' };

export const quickTopics = [
  ['Deposits', 'deposit-3'],
  ['Open homes', 'search-9'],
  ['LIM reports', 'inspect-1'],
  ['Making an offer', 'offer-4'],
  ['Settlement day', 'settlement-1'],
].map(([label, id]) => {
  const { question, answer, source, url } = guideAnswers.find((entry) => entry.id === id);
  return { id, label, question, answer, source, url };
});

export function dailyChatPause() {
  // The app's message budget and the Workers AI allowance both reset at midnight UTC.
  const reset = new Date();
  reset.setUTCHours(24, 0, 0, 0);
  const when = reset.toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    hour12: true,
  });
  return {
    message: `Chat is unavailable until ${when} (New Zealand time).`,
    availability: { reopensAt: reset.toISOString(), quickAnswers: quickTopics },
  };
}
