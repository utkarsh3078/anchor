// Parsing for answers (components/Markdown.js renders the result). Pure functions, so
// they can be unit-tested with `npm test`.
// Supported: "**bold**", "*italic*", "`code`", "- " / "1. " lists with one level of
// nesting, "#" or bold-only lines as headings, and [n] / [1, 3] citation markers.

const MARKER = String.raw`\[\d+(?:\s*,\s*\d+)*\]`;
// One or more markers in a row ("[1] [2]", "[1], [3]") become a single group
const CITES = new RegExp(`(${MARKER}(?:\\s*,?\\s*${MARKER})*)`);
const STYLE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/;

function styled(seg) {
  if (seg.startsWith('**')) return { type: 'bold', text: seg.slice(2, -2) };
  if (seg.startsWith('`')) return { type: 'code', text: seg.slice(1, -1) };
  if (seg.startsWith('*') && seg.endsWith('*') && seg.length > 2) return { type: 'italic', text: seg.slice(1, -1) };
  return { type: 'text', text: seg };
}

// One line of text -> [{ type: 'text' | 'bold' | 'italic' | 'code', text } | { type: 'cite', numbers }]
// Citations are placed the way footnote marks are: right after the sentence's
// punctuation, with no space before them. Models write "…on 14 May [1]." and the
// full stop would otherwise be left hanging after the marker.
export function parseInline(line) {
  const tokens = [];
  line.split(CITES).forEach((part, i) => {
    if (i % 2) {
      tokens.push({ type: 'cite', numbers: [...new Set(part.match(/\d+/g).map(Number))] });
      return;
    }
    for (const seg of part.split(STYLE)) if (seg) tokens.push(styled(seg));
  });

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'cite') continue;
    let before = tokens[i - 1];
    if (before?.type === 'text') before.text = before.text.trimEnd();
    const after = tokens[i + 1];
    const punct = after?.type === 'text' && after.text.match(/^\s*([.,;:!?]+)(?=\s|$)/);
    if (punct) {
      after.text = after.text.slice(punct[0].length);
      if (before?.type === 'text') before.text += punct[1];
      else {
        before = { type: 'text', text: punct[1] };
        tokens.splice(i, 0, before);
        i++;
      }
    }
  }
  return tokens.filter((t) => t.type === 'cite' || t.text);
}

const BULLET = /^[-*•]\s+(.*)/;
const NUMBERED = /^\d+[.)]\s+(.*)/;

// The whole answer -> blocks:
//   { type: 'h', text } | { type: 'p', text } | { type: 'ul' | 'ol', items: [{ text, children: [text] }] }
export function parseBlocks(text) {
  const blocks = [];
  let list = null;
  const flush = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const indent = raw.length - raw.trimStart().length;
    const bullet = line.match(BULLET);
    const numbered = line.match(NUMBERED);
    if (bullet || numbered) {
      const item = (bullet ?? numbered)[1];
      if (list && indent >= 2 && list.items.length) {
        list.items.at(-1).children.push(item);
        continue;
      }
      const type = bullet ? 'ul' : 'ol';
      if (!list || list.type !== type) {
        flush();
        list = { type, items: [] };
      }
      list.items.push({ text: item, children: [] });
      continue;
    }
    if (!line) {
      // A blank line between two list items doesn't end the list
      continue;
    }
    flush();
    const heading = line.match(/^#{1,4}\s+(.*)/) ?? line.match(/^\*\*([^*]+)\*\*:?$/);
    blocks.push(heading ? { type: 'h', text: heading[1].replace(/\*\*/g, '').replace(/:$/, '') } : { type: 'p', text: line });
  }
  flush();
  return blocks;
}
