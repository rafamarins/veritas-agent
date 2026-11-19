import {
  chatLimit,
  earlierTurns,
  onHistoryChange,
  readHistory,
  savedToDevice,
  updateHistory,
} from './history.js';
import { readChat } from './stream.js';
import { listenButton, finishVoiceReply, stopVoice } from './voice.js';
const $ = (selector) => document.querySelector(selector);
const form = $('#composer'),
  question = $('#question'),
  thread = $('#thread'),
  clear = $('#clear'),
  status = $('#status');
let chats = readHistory();
function routeId() {
  return /^#chat\/(previous|[a-f0-9-]{36})$/.exec(location.hash)?.[1];
}
const currentChat = () => chats.find((chat) => chat.id === routeId());
let requestController;

let sending = false;
let pending = null;
const voting = new Set();
if (location.hash.startsWith('#/'))
  history.replaceState(null, '', location.pathname + location.search);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function citationFigure(c) {
  const fig = element('figure', 'citation'),
    caption = element('figcaption');
  if (c.quote)
    fig.append(element('blockquote', '', c.quote + (c.shortened ? '…' : '')));
  if (c.url && /^https:\/\//u.test(c.url)) {
    const a = element('a', '', c.title);
    a.href = c.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.append(
      document.querySelector('.guide-link .block-arrow').cloneNode(true),
    );
    caption.append(a);
  } else caption.append(document.createTextNode(c.title));
  const date = c.checkedOn
    ? new Intl.DateTimeFormat('en-NZ', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(c.checkedOn + 'T00:00:00Z'))
    : '';
  caption.append(
    element(
      'small',
      '',
      [
        c.publisher,
        c.kind === 'lookup' ? 'Lookup tool' : c.section,
        date ? 'Source checked ' + date : '',
      ]
        .filter(Boolean)
        .join(' · '),
    ),
  );
  fig.append(caption);
  return fig;
}
function turnView(turn, last) {
  const row = element('article', 'turn');
  const q = element('p', 'question', turn.question);
  q.prepend(element('span', 'visually-hidden', 'You asked: '));
  row.append(
    q,
    element('h2', 'author', 'Veritas'),
    element(
      'p',
      turn.answer ? 'answer' : 'answer is-reading',
      turn.answer || 'Reading the guide and references…',
    ),
  );
  if (turn.citations?.length) {
    const details = element('details', 'sources');
    details.open = last;
    details.append(
      element(
        'summary',
        '',
        turn.citations.length === 1
          ? 'Source'
          : 'Sources (' + turn.citations.length + ')',
      ),
    );
    for (const c of turn.citations) details.append(citationFigure(c));
    row.append(details);
  }
  if (turn.receipt) {
    const controls = element('div', 'answer-feedback');
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Rate this answer');
    for (const [value, label] of [
      [1, 'Helpful'],
      [-1, 'Not helpful'],
    ]) {
      const button = element('button', 'vote');
      button.id = 'vote-' + turn.id + '-' + value;
      button.type = 'button';
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(turn.vote === value));
      button.title = label;
      button.disabled = voting.has(turn.receipt);
      const icon = document.querySelector('#thumb').content.cloneNode(true);
      if (value === -1) icon.querySelector('svg').classList.add('down');
      button.append(icon);
      button.addEventListener('click', () => rate(turn, value));
      controls.append(button);
    }
    row.append(controls, listenButton(turn.answer, turn.receipt));
  }
  return row;
}
function render() {
  const messages = currentChat()?.messages || [];
  const list = pending ? [...messages, pending] : messages;
  const library = $('#library');
  library.hidden = Boolean(
    list.length || location.hash === '#new' || !chats.length,
  );
  if (!library.hidden) {
    $('#chat-list').replaceChildren(
      ...chats.map((chat) => {
        const item = element('li');
        const link = element('a', '', chat.title);
        link.href = '#chat/' + chat.id;
        item.append(link);
        return item;
      }),
    );
  }
  $('#chat-nav').hidden = !list.length && location.hash !== '#new';
  const active = list.length > 0;
  status.classList.toggle('visually-hidden', sending);
  document.body.toggleAttribute('data-chat', active);
  clear.hidden = !messages.length;
  clear.disabled = sending;
  thread.hidden = !active;
  const slot = $(active ? '#continue-composer' : '#start-composer');
  if (form.parentElement !== slot) slot.append(form);
  question.placeholder = active
    ? 'Ask a follow-up…'
    : 'What would you like to know?';
  thread.replaceChildren(
    ...list.map((t, i) => turnView(t, i === list.length - 1)),
  );
  $('#send').disabled = sending;
  for (const btn of document.querySelectorAll('.starter'))
    btn.disabled = sending;
}
function appendAnswer(text) {
  const answer = thread.lastElementChild.querySelector('.answer');
  if (!pending.answer) {
    answer.classList.remove('is-reading');
    answer.textContent = '';
    status.textContent = 'Writing the answer…';
  }
  pending.answer += text;
  answer.textContent = pending.answer;
}
async function post(path, data, onText, signal) {
  const response = await fetch(path, {
    method: 'POST',
    signal,
    credentials: 'omit',
    headers: {
      'content-type': 'application/json',
      accept: onText ? 'application/x-ndjson' : 'application/json',
    },
    body: JSON.stringify(data),
  });
  if (!response.ok)
    throw Error(
      (await response.json()).error || 'Unable to finish this request.',
    );
  return onText ? readChat(response.body, onText) : response.json();
}
async function rate(turn, value) {
  if (voting.has(turn.receipt)) return;
  const id = routeId();
  const focus = document.activeElement?.id;
  voting.add(turn.receipt);
  render();
  try {
    const vote = turn.vote === value ? 0 : value;
    await post('/api/feedback', { receipt: turn.receipt, vote });
    await updateHistory((all) =>
      all.map((chat) =>
        chat.id === id
          ? {
              ...chat,
              messages: chat.messages.map((m) =>
                m.id === turn.id ? { ...m, vote } : m,
              ),
            }
          : chat,
      ),
    );
    if (id === routeId())
      status.textContent = vote ? 'Feedback saved.' : 'Feedback removed.';
  } catch (e) {
    if (id === routeId()) status.textContent = e.message;
  } finally {
    voting.delete(turn.receipt);
    chats = readHistory();
    render();
    if (focus && document.activeElement === document.body)
      document.getElementById(focus)?.focus({ preventScroll: true });
  }
}
function showLatest() {
  requestAnimationFrame(() =>
    thread.lastElementChild?.scrollIntoView({ block: 'start' }),
  );
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = question.value.trim();
  if (!text || sending) return;
  const before = currentChat();
  if (!before && chats.length >= chatLimit) {
    status.textContent = 'Clear a saved chat to make room for a new one.';
    return;
  }
  const id = before?.id || crypto.randomUUID();
  const controller = new AbortController();
  stopVoice();
  requestController = controller;
  sending = true;
  pending = { question: text, answer: '' };
  question.value = '';
  question.readOnly = true;
  status.textContent = 'Finding sources…';
  render();
  showLatest();
  try {
    const reply = await post(
      '/api/chat',
      {
        question: text,
        history: earlierTurns(before?.messages || [], text),
      },
      (delta) => {
        if (requestController === controller) appendAnswer(delta);
      },
      controller.signal,
    );
    const appended = await updateHistory((all) => {
      if (controller.signal.aborted) return null;
      const chat = all.find((item) => item.id === id);
      if (chat?.messages.at(-1)?.id !== before?.messages.at(-1)?.id)
        return null;
      if (!chat && all.length >= chatLimit)
        throw Error('Clear a saved chat to make room for a new one.');
      const turn = {
        id: crypto.randomUUID(),
        question: text,
        ...reply,
        vote: 0,
      };
      return [
        {
          id,
          title: chat?.title || text,
          messages: [...(chat?.messages || []), turn].slice(-30),
        },
        ...all.filter((item) => item.id !== id),
      ];
    });
    if (controller.signal.aborted) return;
    if (!appended)
      throw Error(
        'This chat changed in another tab. Check the latest message and send again.',
      );
    if (!before) history.pushState(null, '', '#chat/' + id);
    finishVoiceReply(reply.answer, reply.receipt);
    status.textContent = savedToDevice()
      ? 'Reply saved on this device.'
      : 'Browser storage is unavailable. This reply will last until you close the tab.';
  } catch (e) {
    if (controller.signal.aborted) return;
    question.value = text;
    status.textContent = e.message;
  } finally {
    if (requestController !== controller) return;
    requestController = null;
    chats = readHistory();
    pending = null;
    sending = false;
    question.readOnly = false;
    render();
  }
});
question.addEventListener('keydown', (event) => {
  if (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.isComposing &&
    !sending
  ) {
    event.preventDefault();
    form.requestSubmit();
  }
});
for (const btn of document.querySelectorAll('.starter'))
  btn.addEventListener('click', () => {
    question.value = btn.firstChild.textContent.trim();
    form.requestSubmit();
  });
clear.addEventListener('click', async () => {
  if (sending || !confirm('Clear the saved conversation on this device?'))
    return;
  const id = routeId();
  await updateHistory((all) => all.filter((chat) => chat.id !== id));
  history.replaceState(null, '', location.pathname + location.search);
  navigate();
  status.textContent = 'Conversation cleared.';
});
function navigate({ focus = true } = {}) {
  stopVoice();
  requestController?.abort();
  requestController = null;
  pending = null;
  sending = false;
  question.readOnly = false;
  question.value = '';
  status.textContent = '';
  chats = readHistory();
  if (routeId() && !currentChat())
    history.replaceState(null, '', location.pathname + location.search);
  render();
  if (focus) {
    const heading = $('#page-title');
    heading.tabIndex = -1;
    (location.hash === '#new' ? question : heading).focus({
      preventScroll: true,
    });
    window.scrollTo(0, 0);
  }
}
$('.skip').addEventListener('click', (event) => {
  event.preventDefault();
  question.focus();
});
for (const link of document.querySelectorAll('a[href="#"], a[href="#new"]')) {
  link.addEventListener('click', () => {
    if (link.href === location.href) navigate();
  });
}
window.addEventListener('hashchange', navigate);
onHistoryChange(() => {
  chats = readHistory();
  if (routeId() && !currentChat()) navigate();
  else render();
});
navigate({ focus: false });
