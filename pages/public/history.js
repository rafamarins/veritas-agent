const key = 'veritas-agent.chat.v1';
const empty = () => ({ epoch: '', messages: [] });
let memory = empty();
let durable = true;

export function readHistory() {
  if (!durable) return memory;
  try {
    const data = JSON.parse(localStorage.getItem(key) || 'null');
    return data &&
      typeof data.epoch === 'string' &&
      Array.isArray(data.messages)
      ? data
      : empty();
  } catch {
    durable = false;
    return memory;
  }
}
export async function updateHistory(edit) {
  const write = () => {
    const next = edit(readHistory());
    if (!next) return false;
    memory = { epoch: next.epoch, messages: next.messages.slice(-30) };
    try {
      localStorage.setItem(key, JSON.stringify(memory));
    } catch {
      durable = false;
    }
    return true;
  };
  return navigator.locks ? navigator.locks.request(key, write) : write();
}
export function savedToDevice() {
  return durable;
}
export function onHistoryChange(callback) {
  window.addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) callback();
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
