// A detached document lets us read publisher text without loading scripts or assets.
export async function htmlPassages(page, html) {
  return page.evaluate((input) => {
    const doc = new DOMParser().parseFromString(input, 'text/html');
    const clean = (value) => value.replace(/\s+/gu, ' ').trim();
    for (const el of doc.querySelectorAll(
      'nav,footer,aside,form,dialog,script,style,noscript,template,[hidden],[role="navigation"],[aria-hidden="true"],.breadcrumb,.breadcrumbs',
    ))
      el.remove();
    const title = doc.querySelector('h1');
    const root =
      title?.closest('main,article,[role="main"]') ??
      doc.querySelector('main,[role="main"]') ??
      doc.body;
    const result = [];
    let heading = '';
    let started = !title || !root.contains(title);
    for (const el of root.querySelectorAll('h1,h2,h3,h4,h5,p,li,td')) {
      if (el === title) started = true;
      if (!started || el.querySelector('p,li,td,h2,h3')) continue;
      const text = clean(el.textContent ?? '');
      if (/^H\d$/.test(el.tagName)) {
        heading = text;
      } else if (
        text.length >= 35 &&
        text.length <= 6000 &&
        !el.querySelector('button,input')
      ) {
        result.push({ heading, text });
      }
    }
    return {
      title: clean(title?.textContent || doc.title || ''),
      passages: result,
    };
  }, html);
}

export async function pdfPassages(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: true,
  });
  try {
    const doc = await task.promise;
    const passages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const text = (await page.getTextContent()).items
        .map((item) => item.str ?? '')
        .join(' ')
        .replace(/\s+/gu, ' ')
        .trim();
      if (text) passages.push({ heading: 'Page ' + i, text });
    }
    return { title: '', passages };
  } finally {
    await task.destroy();
  }
}
