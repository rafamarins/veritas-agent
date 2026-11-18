// A network chunk can split a UTF-8 character or contain several records.
export async function* lines(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const cancel = () => reader.cancel().catch(() => {});
  signal?.addEventListener('abort', cancel, { once: true });
  let rest = '';
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      rest += decoder.decode(value, { stream: !done });
      let end;
      while ((end = rest.indexOf('\n')) !== -1) {
        if (end > 65536) throw Error('Stream record is too large.');
        const line = rest.slice(0, end).trimEnd();
        rest = rest.slice(end + 1);
        if (line) yield line;
      }
      if (rest.length > 65536) throw Error('Stream record is too large.');
      if (done) {
        if (rest.trimEnd()) yield rest.trimEnd();
        return;
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    await cancel();
    reader.releaseLock();
  }
}

export async function readChat(body, onText) {
  for await (const line of lines(body)) {
    const event = JSON.parse(line);
    if (event.type === 'delta' && typeof event.text === 'string') {
      onText?.(event.text);
    } else if (
      event.type === 'done' &&
      event.reply?.answer &&
      event.reply.receipt
    ) {
      return event.reply;
    } else {
      throw Error(event.error || 'Could not read this reply. Try again.');
    }
  }
  throw Error('The reply was interrupted. Send your question again.');
}
