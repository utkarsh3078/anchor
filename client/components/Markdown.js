'use client';

// Minimal Markdown for answers: "**bold**", "- " / "1. " lists, "#" or bold-only lines as
// headings, plus [n] / [1, 3] citation markers rendered as clickable chips.
const CITE = /(\[\d+(?:\s*,\s*\d+)*\])/g;

function Inline({ text, onCite, citeTitle }) {
  return text.split(CITE).map((part, i) => {
    const cite = part.match(/^\[(.+)\]$/);
    if (cite) {
      return (
        <span key={i} className="mx-1 inline-flex gap-1 align-baseline">
          {cite[1].split(',').map((n) => (
            <button
              key={n}
              onClick={() => onCite(Number(n))}
              title={citeTitle?.(Number(n)) ?? 'Open the source passage'}
              className="rounded bg-blue-100 px-1.5 font-sans text-[11px] font-medium leading-5 text-blue-800 hover:bg-blue-200"
            >
              {n.trim()}
            </button>
          ))}
        </span>
      );
    }
    return part.split(/(\*\*[^*]+\*\*)/g).map((seg, j) => (
      seg.startsWith('**') && seg.endsWith('**')
        ? <strong key={`${i}-${j}`}>{seg.slice(2, -2)}</strong>
        : <span key={`${i}-${j}`}>{seg}</span>
    ));
  });
}

// citeTitle(n): optional hover text for citation chip n (e.g. its page)
export default function Markdown({ text, onCite, citeTitle }) {
  const blocks = [];
  let list = null;
  const flush = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)/);
    const numbered = line.match(/^\d+[.)]\s+(.*)/);
    if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol';
      if (!list || list.type !== type) {
        flush();
        list = { type, items: [] };
      }
      list.items.push((bullet ?? numbered)[1]);
      continue;
    }
    flush();
    if (!line) continue;
    const heading = line.match(/^#{1,4}\s+(.*)/) ?? line.match(/^\*\*([^*]+)\*\*:?$/);
    blocks.push(heading ? { type: 'h', text: heading[1] } : { type: 'p', text: line });
  }
  flush();

  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        if (b.type === 'h') return <h4 key={i} className="pt-1 font-sans text-sm font-semibold uppercase tracking-wide text-slate-700">{b.text}</h4>;
        if (b.type === 'p') return <p key={i}><Inline text={b.text} onCite={onCite} citeTitle={citeTitle} /></p>;
        const List = b.type;
        return (
          <List key={i} className={`space-y-1 pl-6 ${b.type === 'ul' ? 'list-disc' : 'list-decimal'}`}>
            {b.items.map((item, j) => <li key={j}><Inline text={item} onCite={onCite} citeTitle={citeTitle} /></li>)}
          </List>
        );
      })}
    </div>
  );
}
