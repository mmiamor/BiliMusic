import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviders } from '../src/providers.mjs';
import { annotateLyrics, kuwoLyricLines, subtitleLyricLines } from '../src/lyric-lines.mjs';

test('Kuwo cues retain timestamps, join a translation to its original, and annotate Chinese offline', async () => {
  const lrclist = [
    { time: '3.25', lineLyric: '雨落下' },
    { time: '3.25', lineLyric: 'Rain falls' },
    { time: '1.12', lineLyric: '听音乐，去银行' },
    { time: '6', lineLyric: '第一声' }, { time: '6', lineLyric: '第二声' }
  ];
  const api = createProviders(async () => ({ status: 200, body: JSON.stringify({ data: { lrclist } }) }));
  const lines = await api.lyrics({ source: 'kuwo', rid: '2' });
  assert.deepEqual(lines.map(line => line.time), [1.12, 3.25, 6]);
  assert.equal(lines[0].pronunciation, 'ting yin yue， qu yin hang');
  assert.deepEqual(lines[1], { time: 3.25, text: 'Rain falls', translation: '雨落下' });
  assert.equal(lines[2].text, '第一声\n第二声');
  assert.equal(lines[2].pronunciation, 'di yi sheng\ndi er sheng');
});

test('existing phonetics survive; kana in an untagged original protects its kanji-only cues', async () => {
  const rows = [
    { time: 1, text: '春', pronunciation: 'haru' }, { time: 2, text: '夜空' },
    { time: 3, text: 'ゆっくり' }, { time: 4, text: '風', language: 'ja' }
  ];
  assert.deepEqual(await annotateLyrics(rows), rows);
  assert.deepEqual(kuwoLyricLines([{ time: 1, lineLyric: '//'}, {time: 1, lineLyric: 'Voice'}]),
    [{ time: 1, text: 'Voice' }]);
});

test('Kuwo retries a transient catalog error without mistaking it for missing lyrics', async () => {
  let attempts = 0;
  const api = createProviders(async () => {
    attempts++;
    const result = attempts === 1 ? { status: 301, data: null } :
      { status: 200, data: { lrclist: [{ time: '0.50', lineLyric: 'Hello' }] } };
    return { status: 200, body: JSON.stringify(result) };
  });
  assert.deepEqual(await api.lyrics({ source: 'kuwo', rid: '12' }), [{ time: 0.5, text: 'Hello' }]);
  assert.equal(attempts, 2);
});

test('alternate subtitles must match the timestamp; an explicit non-Chinese language preserves kanji', async () => {
  const original = [{ from: 1.22, content: '夜空' }, { from: 4, content: '月' }];
  const translation = [{ from: 1.22, content: 'Night sky' }, { from: 6, content: 'Later' }];
  const lines = await annotateLyrics(subtitleLyricLines(original, 'ja', translation));
  assert.equal(lines[0].translation, 'Night sky');
  assert.equal(lines[0].pronunciation, undefined);
  assert.equal(lines[1].translation, undefined);
});
