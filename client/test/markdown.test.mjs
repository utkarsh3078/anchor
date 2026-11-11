import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks, parseInline } from '../lib/markdown.js';

const text = (tokens) => tokens.map((t) => (t.type === 'cite' ? `{${t.numbers.join(',')}}` : t.text)).join('');

test('parseInline: the full stop moves in front of the citation', () => {
  assert.equal(text(parseInline('The exam is on 14 May [1].')), 'The exam is on 14 May.{1}');
  assert.equal(text(parseInline('The exam is on 14 May [1] .')), 'The exam is on 14 May.{1}');
  assert.equal(text(parseInline('First [1], then second [2].')), 'First,{1} then second.{2}');
});

test('parseInline: markers in a row become one group without repeats', () => {
  assert.deepEqual(parseInline('Units 1 to 5 [1] [2].').at(-1), { type: 'cite', numbers: [1, 2] });
  assert.deepEqual(parseInline('Units [1, 3][3], [4]').at(-1), { type: 'cite', numbers: [1, 3, 4] });
});

test('parseInline: punctuation after a bold term still ends up before the citation', () => {
  const tokens = parseInline('on **Monday, 14 May** [1].');
  assert.deepEqual(tokens.map((t) => t.type), ['text', 'bold', 'text', 'cite']);
  assert.equal(text(tokens), 'on Monday, 14 May.{1}');
});

test('parseInline: a citation in mid-sentence keeps the words after it', () => {
  assert.equal(text(parseInline('It covers units 1 to 5 [2] and labs [3]')), 'It covers units 1 to 5{2} and labs{3}');
});

test('parseInline: bold, italic and code; decimals and file names are left alone', () => {
  assert.deepEqual(parseInline('**Gemini API** for *vision* via `generateContent`').map((t) => t.type), ['bold', 'text', 'italic', 'text', 'code']);
  assert.equal(text(parseInline('Version 2.5 of my_notes_v2.pdf costs 3 * 4')), 'Version 2.5 of my_notes_v2.pdf costs 3 * 4');
});

test('parseBlocks: headings, paragraphs, bullets and numbers', () => {
  const blocks = parseBlocks('It is a syllabus [1].\n\n**Unit 1:**\n- Search [1]\n- Logic [2]\n\n## What to bring\n1. Admit card\n2. Calculator');
  assert.deepEqual(blocks.map((b) => b.type), ['p', 'h', 'ul', 'h', 'ol']);
  assert.equal(blocks[1].text, 'Unit 1');
  assert.deepEqual(blocks[2].items.map((i) => i.text), ['Search [1]', 'Logic [2]']);
  assert.equal(blocks[4].items.length, 2);
});

test('parseBlocks: indented bullets nest under the item above; a blank line does not split a list', () => {
  const [list, ...rest] = parseBlocks('- Hosting\n  - Vercel\n  - Render\n\n- Storage');
  assert.equal(rest.length, 0);
  assert.deepEqual(list.items, [{ text: 'Hosting', children: ['Vercel', 'Render'] }, { text: 'Storage', children: [] }]);
});

test('parseBlocks: a bold line with more text after it is a paragraph, not a heading', () => {
  assert.equal(parseBlocks('**Gemini API** for the chatbot [3].')[0].type, 'p');
});
