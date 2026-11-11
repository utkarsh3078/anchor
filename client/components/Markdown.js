'use client';

import { parseBlocks, parseInline } from '@/lib/markdown';

const mark =
  'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-soft px-1 font-sans text-[10px] ' +
  'font-semibold leading-none text-accent-soft-fg transition-colors duration-200 hover:bg-accent hover:text-accent-fg';

// Citation marks: small numbered dots raised like footnote marks, so they sit after the
// sentence without widening the line spacing
function Cites({ numbers, onCite, citeTitle }) {
  return (
    <span className="ml-0.5 inline-flex gap-0.5 align-[0.25em]">
      {numbers.map((n) => (
        <button key={n} type="button" onClick={() => onCite(n)} title={citeTitle?.(n) ?? 'Open the source passage'} className={mark}>
          <span className="sr-only">Source </span>{n}
        </button>
      ))}
    </span>
  );
}

function Inline({ text, onCite, citeTitle }) {
  const tokens = parseInline(text);
  const cites = (t) => <Cites numbers={t.numbers} onCite={onCite} citeTitle={citeTitle} />;
  return tokens.map((t, i) => {
    if (t.type === 'cite') {
      // Normally drawn together with the text before it (below); on its own only when
      // there is none
      const prev = tokens[i - 1];
      return prev && prev.type !== 'cite' ? null : <span key={i}>{cites(t)}</span>;
    }
    const next = tokens[i + 1];
    let body = t.text;
    let tail = null;
    if (next?.type === 'cite') {
      // Keep the marks on the same line as the last word they follow
      const cut = t.type === 'text' ? body.lastIndexOf(' ') + 1 : 0;
      const last = body.slice(cut);
      if (t.type === 'text' && last.length <= 30) {
        body = body.slice(0, cut);
        tail = <span className="whitespace-nowrap">{last}{cites(next)}</span>;
      } else {
        tail = cites(next);
      }
    }
    let el = body;
    if (t.type === 'bold') el = <strong className="font-semibold">{body}</strong>;
    else if (t.type === 'italic') el = <em>{body}</em>;
    else if (t.type === 'code') el = <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.9em]">{body}</code>;
    return <span key={i}>{el}{tail}</span>;
  });
}

const dot = 'relative pl-5 before:absolute before:left-1 before:top-[0.68em] before:size-[5px] before:rounded-full';

// Answer text: headings, paragraphs and lists with clickable citation marks.
// citeTitle(n): optional hover text for citation n (e.g. its page)
export default function Markdown({ text, onCite, citeTitle }) {
  const inline = (s) => <Inline text={s} onCite={onCite} citeTitle={citeTitle} />;
  return (
    <div className="flex flex-col gap-2.5">
      {parseBlocks(text).map((b, i) => {
        if (b.type === 'h') return <h4 key={i} className="mt-3 font-sans text-[15px] font-semibold leading-6 text-fg first:mt-0">{b.text}</h4>;
        if (b.type === 'p') return <p key={i}>{inline(b.text)}</p>;
        const ordered = b.type === 'ol';
        const List = b.type;
        return (
          <List key={i} className={`space-y-1.5 ${ordered ? 'list-decimal pl-6 marker:font-sans marker:text-sm marker:text-muted' : ''}`}>
            {b.items.map((item, j) => (
              <li key={j} className={ordered ? 'pl-1' : `${dot} before:bg-subtle`}>
                {inline(item.text)}
                {item.children.length > 0 && (
                  <ul className="mt-1.5 space-y-1 text-[0.95em] text-muted">
                    {item.children.map((child, k) => <li key={k} className={`${dot} before:border before:border-subtle`}>{inline(child)}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
