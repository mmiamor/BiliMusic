import { plain } from './provider-utils.mjs';

const han = /\p{Script=Han}/u;
const kanaOrHangul = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const latin = /\p{Script=Latin}/u;

// Kuwo H5 emits a translated line immediately before its original at the same timestamp.
// Keep simultaneous verses together when the script provides no evidence of a translation.
export function kuwoLyricLines(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const text = plain(row?.lineLyric);
    const time = Number(row?.time);
    if (!text || row.time == null || !Number.isFinite(time) || time < 0) continue;
    if (!groups.has(time)) groups.set(time, []);
    groups.get(time).push({
      time, text,
      ...(row.translation && { translation: plain(row.translation) }),
      ...(row.pronunciation && { pronunciation: plain(row.pronunciation) })
    });
  }

  const lines = [];
  for (const [time, group] of groups) {
    const original = group.at(-1);
    const first = group[0];
    if (
      group.length === 2 && han.test(first.text) && !kanaOrHangul.test(first.text)
      && ((!han.test(original.text) && latin.test(original.text)) || kanaOrHangul.test(original.text))
    ) {
      lines.push({ ...original, translation: original.translation || first.text });
    } else {
      const texts = [...new Set(group.map(row => row.text))].filter(text => text !== '//');
      if (texts.length) lines.push({ ...original, time, text: texts.join('\n') });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

// Keep each primary cue's original timing. A secondary subtitle track may have its own edit.
export function subtitleLyricLines(primary = [], language = '', alternate = []) {
  const byTime = new Map(alternate.map(cue => [Math.round(Number(cue.from) * 1000), plain(cue.content)]));
  return primary.flatMap(cue => {
    const time = Number(cue.from);
    const text = plain(cue.content);
    if (!text || cue.from == null || !Number.isFinite(time) || time < 0) return [];
    const translation = byTime.get(Math.round(time * 1000));
    return [{ time, text, language, ...(translation && translation !== text && { translation }) }];
  }).sort((a, b) => a.time - b.time);
}

export async function annotateLyrics(lines) {
  // AU lyrics and Kuwo lyrics do not always include a language code. Kana/Hangul in the
  // original track is a stronger signal than a single kanji-only line in that track.
  const otherScript = lines.some(line => kanaOrHangul.test(line.text));
  function needsPinyin(line) {
    const language = String(line.language || '').toLowerCase().replace(/^ai-/, '');
    return !line.pronunciation && han.test(line.text) && !kanaOrHangul.test(line.text) &&
      (language ? /^(zh(?:-|$)|cmn(?:-|$))/.test(language) : !otherScript);
  }
  if (!lines.some(needsPinyin)) return lines;
  // The dictionary is loaded once, only when the first Chinese lyric arrives.
  let pinyin;
  try { ({ pinyin } = await import('./vendor/pinyin-pro/index.mjs')); }
  catch { return lines; } // The original cues still work if a PWA update is interrupted.
  return lines.map(line => {
    if (!needsPinyin(line)) return line;
    const pronunciation = line.text.split(/\r?\n/).map(verse =>
      pinyin(verse, { toneType: 'none', nonZh: 'consecutive' })
        .replace(/[^\S\n]+/g, ' ').replace(/\s+([，。！？、：；,.!?;:])/g, '$1').trim()
    ).join('\n');
    return pronunciation && pronunciation !== line.text ? { ...line, pronunciation } : line;
  });
}
