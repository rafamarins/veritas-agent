const key = 'veritas-agent.chats.v2';
const legacy = 'veritas-agent.chat.v1';
export const chatLimit = 30;
let memory = [];
let durable = true;

export function readHistory() {
  if (!durable) return memory;
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const chats = JSON.parse(stored);
      return Array.isArray(chats) ? chats : [];
    }
    const old = JSON.parse(localStorage.getItem(legacy) || 'null');
    if (!old?.messages?.length) return [];
    return [
      {
        id: 'previous',
        title: old.messages[0].question,
        messages: old.messages.slice(-30),
      },
    ];
  } catch {
    durable = false;
    return memory;
  }
}

export async function updateHistory(edit) {
  const write = () => {
    const next = edit(readHistory());
    if (!next) return false;
    if (durable) {
      try {
        localStorage.setItem(key, JSON.stringify(next));
        localStorage.removeItem(legacy);
      } catch (error) {
        if (error.name === 'QuotaExceededError' && localStorage.length) {
          throw Error(
            'This device is out of storage. Clear a saved chat and try again.',
          );
        }
        durable = false;
      }
    }
    memory = next;
    return true;
  };
  return navigator.locks ? navigator.locks.request(key, write) : write();
}

export function savedToDevice() {
  return durable;
}
export function onHistoryChange(callback) {
  window.addEventListener('storage', (event) => {
    if (event.key === key || event.key === legacy || event.key === null)
      callback();
  });
}
export function earlierTurns(messages, question) {
  const terms = new Set(question.toLowerCase().match(/[\p{L}\d]{4,}/gu) ?? []);
  const extra = messages
    .slice(0, -6)
    .map((m) => ({
      m,
      score: [...terms].filter((t) => m.question.toLowerCase().includes(t))
        .length,
    }))
    .filter((r) => r.score)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((r) => r.m);
  return [...extra, ...messages.slice(-6)].map((m) => ({
    id: m.id,
    question: m.question.slice(0, 750),
    answer: m.answer.slice(0, 950),
    sourceIds: m.citations
      .map((c) => c.sourceId)
      .filter(Boolean)
      .slice(0, 3),
  }));
}
