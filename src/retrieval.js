import answers from './guide/answers.json' with { type: 'json' };
import cards from './guide/cards.json' with { type: 'json' };
import catalog from '../sources/references.json' with { type: 'json' };
import reviewedPassages from '../sources/reviewed-passages.json' with { type: 'json' };
import snapshot from './guide/reference-index.json' with { type: 'json' };

const lookupTopics = [
  [
    'ref-1',
    /(?:auckland.*flood|flood.*(?:map|viewer|auckland))/iu,
    'Look up mapped flood information in Auckland.',
  ],
  [
    'ref-3',
    /(?:title|land) (?:search|register|records?)|(?:find|order|request).*record of title/iu,
    'Search Land Information New Zealand for a record of title.',
  ],
  [
    'ref-5',
    /(?:licen[cs]|register).*agent|agent.*(?:licen[cs]|register)/iu,
    'Use the Real Estate Authority public register to check an agent.',
  ],
  [
    'ref-12',
    /do i need (?:a )?(?:building )?consent|can i build|consent checker/iu,
    'Open MBIE’s building consent tool to check a proposed project.',
  ],
];
const guideUrl = 'https://rafael.co.nz/outros/home-veritas/';
export const reviewQuestions = new Map(answers.map((a) => [a.id, a.question]));
const stop = new Set(
  (
    'a an the at or our of to in for by it is my us I me was am are and have has those can could would should how when why which what that this with about from home house property buying buyer tell please said ask asked does do did know take there also other should checks check any important next specific confirm really need having only mentioned says can might kind type la se da de um uma o ao minha na na em e y del por ' +
    'para una uma como los las que dos das por una meu minha casa sobre'
  )
    .toLowerCase()
    .split(/\s+/),
);
const synonyms = {
  conselho: 'council',
  seguro: 'insurance',
  coverage: 'insurance',
  insure: 'insurance',
  cover: 'insurance',
  lawyers: 'lawyer',
  advogado: 'lawyer',
  abogado: 'lawyer',
  leilao: 'auction',
  subasta: 'auction',
  vistoria: 'inspection',
  inspecao: 'inspection',
  inspeccion: 'inspection',
  relatorio: 'report',
  inspector: 'inspection',
  inspections: 'inspection',
  visita: 'viewing',
  visitar: 'viewing',
  garagem: 'garage',
  garaje: 'garage',
  deposito: 'deposit',
  telhado: 'roof',
  solicitor: 'lawyer',
  permisos: 'consent',
  consents: 'consent',
  approvals: 'approval',
  alterations: 'alteration',
  records: 'record',
  agents: 'agent',
  conversion: 'alteration',
  leaky: 'leak',
};
function terms(value) {
  const plain = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/open (?:home|house)|home visit/g, 'viewing')
    .replace(
      /\b(property fil(?:e|es)|council (?:records?|files?))\b/g,
      '$& councilrecord consent plans',
    )
    .replace(
      /\b(converted|conversion|conversions|alterations)\b/g,
      '$& alteration consent',
    )
    .replace(/\b(flooding|floods)\b/g, 'flood')
    .replace(/where (?:should i|do i|to) start|first steps/g, 'journey')
    .replace(/signed off|sign.off/g, 'signoff consent completion')
    .replace(/code compliance certificate/g, 'code compliance certificate ccc')
    .replace(/land information memorandum/g, 'land information memorandum lim');
  const tokens = plain.match(/[a-z\d]+/g) ?? [];
  for (const run of plain.match(/\p{Script=Han}+/gu) ?? []) {
    for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
  }
  return new Set(
    tokens
      .filter((t) => t.length > 1 && !stop.has(t))
      .map((t) => synonyms[t] ?? t),
  );
}
const guide = [
  ...answers.map((a) => ({
    id: a.id,
    title: a.question,
    text: a.answer,
    url: guideUrl,
    links: [a.url],
    keywords: Object.values(a.translations)
      .map((t) => t.question)
      .join(' '),
  })),
  ...cards.map((c) => ({
    id: c.id,
    title: c.question,
    text: c.answer,
    url: guideUrl + '#/' + c.id,
    links: c.links,
    keywords: c.topic,
  })),
].map((g) => ({
  ...g,
  sourceId: g.id,
  publisher: 'Home Veritas',
  kind: 'guide',
}));

const refs = new Map(catalog.map((r) => [r.id, r]));
const official = snapshot.records.flatMap((r) => {
  const ref = refs.get(r.id);
  return r.passages.map((p, i) => ({
    id: r.id + '.' + i,
    sourceId: r.id,
    title: ref.title,
    publisher: ref.publisher,
    url: ref.url,
    kind: 'reference',
    checkedOn: p.checkedOn ?? r.checkedOn,
    section: p.heading,
    text: p.text,
    keywords: ref.publisher + ' ' + p.heading,
  }));
});

// Pin the publisher evidence for a comparison from the LIM quick answer. The
// buyer can refer to either check without repeating the names in the next turn.
const inspectionGuide = guide.find((doc) => doc.id === 'inspect-1');
const inspectionEvidence = ['ref-31', 'ref-39'].flatMap((id) =>
  reviewedPassages[id].map(({ text, quote }) => {
    const passage = official.find((doc) =>
      doc.sourceId === id && doc.text.includes(text),
    );
    if (!passage) throw Error('Missing reviewed inspection evidence: ' + id);
    return { ...passage, text, quote };
  }),
);

// Document frequency downweights words shared by most of the guide, such as "bank" or "buy".
function searchIndex(documents) {
  const frequency = new Map();
  const rows = documents.map((doc) => {
    const weights = new Map();
    for (const [value, weight] of [
      [doc.text, 1],
      [doc.keywords, 1.8],
      [doc.title, 3],
    ])
      for (const term of terms(value)) weights.set(term, weight);
    for (const term of weights.keys())
      frequency.set(term, (frequency.get(term) ?? 0) + 1);
    return { doc, weights };
  });
  const rarity = new Map(
    [...frequency].map(([term, count]) => [
      term,
      Math.log(1 + (rows.length - count + 0.5) / (count + 0.5)),
    ]),
  );
  return (query, related = new Set()) =>
    rows.map(({ doc, weights }) => {
      let score = 0;
      for (const term of query)
        score += (weights.get(term) ?? 0) * (rarity.get(term) ?? 0);
      for (const term of related)
        if (!query.has(term))
          score += 0.47 * (weights.get(term) ?? 0) * (rarity.get(term) ?? 0);
      return { doc, score };
    });
}
const rankGuides = searchIndex(guide);
const rankReferences = searchIndex(official);
const recentIntent =
  /\b(it|that|those|this|same|they|then|instead|still|mentioned|did i|did we|isso|essa|esse|disso|ellos|esto|eso)\b|那|这个/iu;
const comparisonIntent =
  /\b(?:you (?:just )?compared|(?:the|those|these) two (?:checks|reports|documents)|the (?:other|first|second) (?:check|one|report|document)|both of (?:them|those))\b/iu;
const inspectionSubject =
  /\b(?:roof|inspection|inspector|lim|title|property file|ownership|plans)\b/iu;
const recallIntent =
  /\b(did i (?:say|tell|mention)|did we (?:discuss|say)|i mentioned|remind me|qual (?:rua|endereco)|que te dije)\b/iu;
const byScore = (a, b) => b.score - a.score;
function quotation(text, query) {
  const sentences = text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/gu) ?? [text];
  const ranked = sentences
    .map((s) => {
      const tokens = terms(s);
      return {
        text: s.trim(),
        score: [...query].filter((t) => tokens.has(t)).length,
      };
    })
    .filter((s) => s.text.length > 14)
    .sort(byScore);
  const sentence = ranked[0]?.text ?? text;
  const quote = sentence.split(/\s+/u).slice(0, 25).join(' ');
  return { quote, shortened: quote.length < sentence.length };
}

export function contextFor(messages, question) {
  const last = messages.at(-1);
  const query = terms(question);
  const comparison = comparisonIntent.test(question);
  const contextual = last && (comparison || recentIntent.test(question) || query.size < 3);
  const inspectionFollowUp = last?.question === inspectionGuide.title &&
    last.citations.some((source) => source.sourceId === inspectionGuide.id) &&
    (comparison || (contextual && inspectionSubject.test(question)));
  const related = contextual ? terms(last.question) : new Set();
  const topGuides = inspectionFollowUp ? [{ doc: inspectionGuide }] : rankGuides(query, related)
    .filter((r) => r.score > 0)
    .sort(byScore)
    .slice(0, 4);
  const linked = new Set(topGuides.slice(0, 3).flatMap((r) => r.doc.links));
  const previousIds = new Set(
    contextual ? last.citations.map((c) => c.sourceId) : [],
  );
  const expanded = new Set(related);
  // The guide's translated questions connect non-English queries to English primary sources.
  for (const { doc } of topGuides.slice(0, 2))
    for (const t of terms(doc.title)) expanded.add(t);
  const ranked = inspectionFollowUp ? [] : rankReferences(query, expanded);
  for (const row of ranked) {
    if (linked.has(row.doc.url)) row.score += 3;
    if (previousIds.has(row.doc.sourceId)) row.score += 5;
  }
  const picked = inspectionFollowUp ? [...inspectionEvidence] : [],
    perPage = new Map();
  for (const { doc, score } of ranked.sort(byScore)) {
    if (score <= 0 || picked.length === 7) break;
    const count = perPage.get(doc.url) ?? 0;
    if (count >= 2) continue;
    picked.push(doc);
    perPage.set(doc.url, count + 1);
  }
  if (inspectionFollowUp) {
    for (const source of inspectionEvidence) linked.add(source.url);
  }
  picked.push(...topGuides.slice(0, 3).map((r) => r.doc));
  for (const [id, match, description] of lookupTopics) {
    if (match.test(question)) {
      const ref = refs.get(id);
      picked.unshift({
        ...ref,
        sourceId: id,
        kind: 'lookup',
        text: description,
      });
    }
  }
  const previous = messages.slice(-6);
  const older = messages
    .slice(0, -6)
    .map((m) => ({
      doc: m,
      score: [...terms(m.question)].filter((t) => query.has(t)).length,
    }))
    .filter((r) => r.score > 0)
    .sort(byScore)
    .slice(0, 2)
    .map((r) => r.doc);
  const history = [...older, ...previous];
  if (recallIntent.test(question)) {
    for (const m of history)
      picked.push({
        id: m.id,
        sourceId: m.id,
        kind: 'memory',
        publisher: 'You',
        title: 'Earlier message',
        text: m.question,
      });
  }
  const focus = new Set([...query, ...related]);
  return {
    question,
    topic: topGuides.find(({ doc }) => reviewQuestions.has(doc.id))?.doc.id,
    linkedUrls: [...linked],
    previous: history.map(({ question, answer }) => ({ question, answer })),
    sources: picked.map((doc, i) => {
      const { quote, shortened } =
        doc.kind === 'lookup'
          ? { quote: '', shortened: false }
          : doc.quote
            ? { quote: doc.quote, shortened: false }
            : quotation(doc.text, focus);
      return {
        key: 'S' + (i + 1),
        sourceId: doc.sourceId,
        kind: doc.kind,
        publisher: doc.publisher,
        title: doc.title,
        url: doc.url,
        checkedOn: doc.checkedOn,
        section: doc.section,
        text: doc.text,
        quote,
        shortened,
      };
    }),
  };
}
