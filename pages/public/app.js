import {
  chatLimit,
  earlierTurns,
  onHistoryChange,
  readHistory,
  savedToDevice,
  updateHistory,
} from './history.js';
import { quickTopics } from './quick-answers.js';
import { readChat } from './stream.js';
import { listenButton, stopVoice, syncComposerActions } from './voice.js';
const $ = (selector) => document.querySelector(selector);
const form = $('#composer'),
  question = $('#question'),
  thread = $('#thread'),
  quickAnswers = $('#quick-answers'),
  clear = $('#clear'),
  status = $('#status');
const embedded = document.body.hasAttribute('data-embedded');
if (embedded) {
  const content = document.createElement('div');
  content.className = 'panel-content';
  $('main').prepend(content);
  content.append($('.hero'), $('#library'), $('.starters'), thread, quickAnswers);
  $('#continue-composer').after($('.return-note'));

  if (window.parent !== window) {
    window.addEventListener('message', (event) => {
      if (
        event.source === window.parent &&
        event.origin === location.origin &&
        event.data?.type === 'veritas:pause'
      ) stopVoice();
    });
    window.addEventListener('keydown', (event) => {
      // Dictation handles Escape on the document before it reaches the window.
      if (event.key !== 'Escape' || event.defaultPrevented || event.repeat)
        return;
      event.preventDefault();
      window.parent.postMessage({ type: 'veritas:close' }, location.origin);
    });
  }
}

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
const availabilityKey = 'veritas-agent.daily-limit';
let reopenTimer;
let paused = false;
let selectedGuideTurn = null;

function selectQuickTopic(item) {
  const answer = $('#quick-answer');
  for (const button of $('#quick-topics').children)
    button.setAttribute('aria-pressed', String(button.dataset.topic === item?.id));
  answer.replaceChildren();
  selectedGuideTurn = null;
  if (!item) return;
  const link = element('a', '', item.source);
  link.href = item.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  answer.append(element('h3', '', item.question), element('p', '', item.answer), link);
  selectedGuideTurn = {
    id: crypto.randomUUID(),
    mode: 'guide',
    question: item.question,
    answer: item.answer,
    citations: [{ sourceId: item.id, title: item.source, url: item.url }],
  };
  if (!paused) question.placeholder = 'Ask a follow-up…';
}

for (const item of quickTopics) {
  const button = element('button', '', item.label);
  button.type = 'button';
  button.dataset.topic = item.id;
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-controls', 'quick-answer');
  button.addEventListener('click', () => selectQuickTopic(item));
  $('#quick-topics').append(button);
}

function pauseChat(availability, notice) {
  const remaining = Date.parse(availability?.reopensAt) - Date.now();
  if (!(remaining > 0)) return;
  paused = true;
  $('#reopening-notice').textContent = notice;
  try {
    sessionStorage.setItem(availabilityKey, JSON.stringify({
      availability: { reopensAt: availability.reopensAt }, notice,
    }));
  } catch {}
  clearTimeout(reopenTimer);
  reopenTimer = setTimeout(() => {
    const hadFocus = quickAnswers.contains(document.activeElement);
    paused = false;
    try { sessionStorage.removeItem(availabilityKey); } catch {}
    render();
    status.textContent = 'Chat is available again.';
    if (hadFocus && quickAnswers.hidden) question.focus();
  }, remaining);
}

function citationFigure(c) {
  const fig = element('figure', 'citation'),
    caption = element('figcaption');
  const passages = [c, ...(c.additionalQuotes ?? [])];
  for (const { quote, shortened } of passages) {
    if (quote) fig.append(element('blockquote', '', quote + (shortened ? '…' : '')));
  }
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
        c.kind === 'lookup' ? 'Lookup tool' : [...new Set(passages.map((p) => p.section).filter(Boolean))].join(' / '),
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
  q.prepend(element('span', 'visually-hidden', turn.mode === 'guide' ? 'Guide question: ' : 'You asked: '));
  row.append(
    q,
    element('h2', 'author', turn.mode === 'guide' ? 'Quick answer' : 'Veritas'),
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
  const list = pending ? [...messages, ...(selectedGuideTurn ? [selectedGuideTurn] : []), pending] : messages;
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
  const slot = $(embedded || active ? '#continue-composer' : '#start-composer');
  if (form.parentElement !== slot) slot.append(form);
  question.placeholder = active || selectedGuideTurn
    ? 'Ask a follow-up…'
    : 'What would you like to know?';
  thread.replaceChildren(
    ...list.map((t, i) => turnView(t, i === list.length - 1)),
  );
  quickAnswers.hidden = active && !paused && (!selectedGuideTurn || sending);
  if (paused || active) {
    if (thread.nextElementSibling !== quickAnswers) thread.after(quickAnswers);
  } else if (quickAnswers.nextElementSibling !== $('.starters')) {
    $('.starters').before(quickAnswers);
  }
  question.readOnly = sending || paused;
  form.hidden = paused && !question.value;
  const label = form.querySelector('label[for="question"]');
  label.classList.toggle('visually-hidden', !paused);
  label.textContent = paused ? 'Your unsent question' : 'Your question';
  $('.starters').hidden = paused;
  const skip = $('.skip');
  skip.href = paused ? '#quick-title' : '#question';
  skip.textContent = paused ? 'Skip to quick answers' : 'Skip to your question';
  document.body.toggleAttribute('data-chat-paused', paused);
  $('#reopening-notice').hidden = !paused || messages.at(-1)?.answer === $('#reopening-notice').textContent;
  syncComposerActions();
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
  if (!response.ok) {
    const problem = await response.json();
    const error = Error(problem.error || 'Unable to finish this request.');
    if (response.status === 429) error.availability = problem.availability;
    throw error;
  }
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
    await post('./api/feedback', { receipt: turn.receipt, vote });
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
  requestAnimationFrame(() => {
    const turn = thread.lastElementChild;
    if (!turn) return;
    if (embedded) {
      const content = $('.panel-content');
      content.scrollTop += turn.getBoundingClientRect().top - content.getBoundingClientRect().top;
    } else {
      turn.scrollIntoView({ block: 'start' });
    }
  });
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = question.value.trim();
  if (!text || $('#send').disabled) return;
  const before = currentChat();
  if (!before && chats.length >= chatLimit) {
    status.textContent = 'Clear a saved chat to make room for a new one.';
    return;
  }
  const id = before?.id || crypto.randomUUID();
  const guideTurn = selectedGuideTurn;
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
    const { availability, ...reply } = await post(
      './api/chat',
      {
        question: text,
        history: earlierTurns([...(before?.messages || []), ...(guideTurn ? [guideTurn] : [])], text),
      },
      (delta) => {
        if (requestController === controller) appendAnswer(delta);
      },
      controller.signal,
    );
    if (controller.signal.aborted) return;
    if (availability) pauseChat(availability, reply.answer);
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
          messages: [...(chat?.messages || []), ...(guideTurn ? [guideTurn] : []), turn].slice(-30),
        },
        ...all.filter((item) => item.id !== id),
      ];
    });
    if (controller.signal.aborted) return;
    if (!appended)
      throw Error(
        'This chat changed in another tab. Check the latest message and send again.',
      );
    selectQuickTopic(null);
    if (!before) {
      if (embedded) history.replaceState(null, '', '#chat/' + id);
      else history.pushState(null, '', '#chat/' + id);
    }
    status.textContent = savedToDevice()
      ? 'Reply saved on this device.'
      : 'Browser storage is unavailable. This reply will last until you close the tab.';
  } catch (e) {
    if (controller.signal.aborted) return;
    question.value = text;
    if (e.availability) pauseChat(e.availability, e.message);
    status.textContent = e.availability && paused ? '' : e.message;
  } finally {
    if (requestController !== controller) return;
    requestController = null;
    chats = readHistory();
    pending = null;
    sending = false;
    render();
    if (paused) $('#quick-title').focus();
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
    selectQuickTopic(null);
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
function navigate({ focus = true, keepDraft = false } = {}) {
  stopVoice();
  requestController?.abort();
  requestController = null;
  pending = null;
  sending = false;
  question.readOnly = false;
  if (!keepDraft) {
    question.value = '';
    selectQuickTopic(null);
  }
  status.textContent = '';
  chats = readHistory();
  if (routeId() && !currentChat())
    history.replaceState(null, '', location.pathname + location.search);
  render();
  if (focus) {
    const heading = embedded
      ? $('.turn .author') || $('#library:not([hidden]) h2') || question
      : $('#page-title');
    if (heading !== question) heading.tabIndex = -1;
    const target = location.hash === '#new' ? question : heading;
    (target === question && paused ? $('#quick-title') : target)
      .focus({ preventScroll: true });
    if (embedded) $('.panel-content').scrollTop = 0;
    else window.scrollTo(0, 0);
  }
}
$('.skip').addEventListener('click', (event) => {
  event.preventDefault();
  (paused ? $('#quick-title') : question).focus();
});
if (embedded) {
  // Frame history is shared with the tab. Back should take the buyer to the previous guide topic.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('#library a, #chat-nav a');
    if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey) return;
    event.preventDefault();
    history.replaceState(null, '', link.href);
    navigate();
  });
} else {
  for (const link of document.querySelectorAll('a[href="#"], a[href="#new"]')) {
    link.addEventListener('click', () => {
      if (link.href === location.href) navigate();
    });
  }
}
window.addEventListener('hashchange', navigate);
onHistoryChange(() => {
  chats = readHistory();
  if (routeId() && !currentChat()) navigate();
  else render();
});
try {
  const saved = JSON.parse(sessionStorage.getItem(availabilityKey));
  if (saved && Date.parse(saved.availability.reopensAt) > Date.now())
    pauseChat(saved.availability, saved.notice);
  else sessionStorage.removeItem(availabilityKey);
} catch {}
navigate({ focus: false, keepDraft: true });
