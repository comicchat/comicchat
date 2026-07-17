// Text → emotion "expert system" — faithful port of textpose.cpp with the
// authentic rule table from the original chat.rc string resources.
//
// Rule functions: AllCaps, FindString[*], CheckWord[*], CheckStart[*]
// (* = case-insensitive). All rules add intensity 1.0 at their strength.

import { EM } from '../art/types';
import { EmotionOpts } from './avatar';

type RuleFn = 'AllCaps' | 'FindString' | 'FindString*' | 'CheckWord' | 'CheckWord*' | 'CheckStart' | 'CheckStart*';

interface Rule { fn: RuleFn; arg: string; strength: number; emotion: number }

// Verbatim from chat.rc (ID_RULE_*). ANGRY/SCARED/BORED ship empty.
const RULES: Rule[] = [
  { fn: 'AllCaps', arg: '', strength: 9, emotion: EM.SHOUT },
  { fn: 'FindString', arg: '!!!', strength: 9, emotion: EM.SHOUT },
  { fn: 'CheckWord*', arg: 'rotfl', strength: 11, emotion: EM.LAUGH },
  { fn: 'CheckWord*', arg: 'lol', strength: 11, emotion: EM.LAUGH },
  { fn: 'FindString*', arg: 'hehe', strength: 11, emotion: EM.LAUGH },
  { fn: 'FindString', arg: ':)', strength: 10, emotion: EM.HAPPY },
  { fn: 'FindString', arg: ':-)', strength: 10, emotion: EM.HAPPY },
  { fn: 'FindString', arg: ':(', strength: 10, emotion: EM.SAD },
  { fn: 'FindString', arg: ':-(', strength: 10, emotion: EM.SAD },
  { fn: 'CheckStart*', arg: 'you', strength: 4, emotion: EM.POINTOTHER },
  { fn: 'CheckWord*', arg: 'are you', strength: 8, emotion: EM.POINTOTHER },
  { fn: 'CheckWord*', arg: 'will you', strength: 8, emotion: EM.POINTOTHER },
  { fn: 'CheckWord*', arg: 'did you', strength: 8, emotion: EM.POINTOTHER },
  { fn: 'CheckWord*', arg: "aren't you", strength: 8, emotion: EM.POINTOTHER },
  { fn: 'CheckWord*', arg: "don't you", strength: 8, emotion: EM.POINTOTHER },
  { fn: 'CheckStart*', arg: 'i', strength: 3, emotion: EM.POINTSELF },
  { fn: 'CheckWord*', arg: "i'm", strength: 7, emotion: EM.POINTSELF },
  { fn: 'CheckWord*', arg: 'i will', strength: 7, emotion: EM.POINTSELF },
  { fn: 'CheckWord*', arg: "i'll", strength: 7, emotion: EM.POINTSELF },
  { fn: 'CheckWord*', arg: 'i am', strength: 7, emotion: EM.POINTSELF },
  { fn: 'CheckStart*', arg: 'hi', strength: 2, emotion: EM.WAVE },
  { fn: 'CheckStart*', arg: 'bye', strength: 3, emotion: EM.WAVE },
  { fn: 'CheckStart*', arg: 'hello', strength: 5, emotion: EM.WAVE },
  { fn: 'CheckStart*', arg: 'welcome', strength: 5, emotion: EM.WAVE },
  { fn: 'CheckStart*', arg: 'howdy', strength: 5, emotion: EM.WAVE },
  { fn: 'FindString', arg: ';-)', strength: 10, emotion: EM.COY },
  { fn: 'FindString', arg: ';)', strength: 10, emotion: EM.COY },
];

const SENTENCE_TERMINATORS = /[.!?]/;

/** textpose.cpp CheckForUppers: no lowercase and >1 uppercase letters. */
function checkForUppers(s: string): boolean {
  let uppers = 0;
  for (const ch of s) {
    if (ch >= 'a' && ch <= 'z') return false;
    if (ch >= 'A' && ch <= 'Z') uppers++;
  }
  return uppers > 1;
}

/** textpose.cpp CheckWord: substring at word boundaries. */
function checkWord(buff: string, substr: string): boolean {
  let idx = buff.indexOf(substr);
  while (idx !== -1) {
    const before = idx === 0 || /\s/.test(buff[idx - 1]);
    const afterCh = buff[idx + substr.length];
    const after = afterCh === undefined || /\s/.test(afterCh) || /[!-/:-@[-`{-~]/.test(afterCh);
    if (before && after) return true;
    idx = buff.indexOf(substr, idx + 1);
  }
  return false;
}

/** textpose.cpp StartCompare2: sentence starts with word (no alnum after). */
function startCompare(sent: string, substr: string): boolean {
  if (!sent.startsWith(substr)) return false;
  const after = sent[substr.length];
  return after === undefined || !/[a-zA-Z0-9]/.test(after);
}

function* sentenceStarts(buff: string): Generator<number> {
  let i = 0;
  while (i < buff.length && /\s/.test(buff[i])) i++;
  if (i < buff.length) yield i;
  while (true) {
    const rest = buff.slice(i);
    const m = rest.match(SENTENCE_TERMINATORS);
    if (!m || m.index === undefined) return;
    i += m.index;
    while (i < buff.length && (/\s/.test(buff[i]) || /[!-/:-@[-`{-~]/.test(buff[i]))) i++;
    if (i >= buff.length) return;
    yield i;
  }
}

/** textpose.cpp GetEmotionsFromString. */
export function getEmotionsFromString(text: string): EmotionOpts {
  const opts = new EmotionOpts();
  const buff = text;
  const lower = text.toLowerCase();

  // AllCaps
  const caps = RULES.find((r) => r.fn === 'AllCaps');
  if (caps && checkForUppers(buff)) opts.add(caps.emotion, 1.0, caps.strength);

  for (const rule of RULES) {
    const ci = rule.fn.endsWith('*');
    const hay = ci ? lower : buff;
    const needle = ci ? rule.arg.toLowerCase() : rule.arg;
    switch (rule.fn) {
      case 'FindString':
      case 'FindString*':
        if (hay.includes(needle)) opts.add(rule.emotion, 1.0, rule.strength);
        break;
      case 'CheckWord':
      case 'CheckWord*':
        if (checkWord(hay, needle)) opts.add(rule.emotion, 1.0, rule.strength);
        break;
      default:
        break;
    }
  }

  // sentence-start rules
  for (const start of sentenceStarts(buff)) {
    for (const rule of RULES) {
      if (rule.fn !== 'CheckStart' && rule.fn !== 'CheckStart*') continue;
      const ci = rule.fn.endsWith('*');
      const hay = ci ? lower.slice(start) : buff.slice(start);
      const needle = ci ? rule.arg.toLowerCase() : rule.arg;
      if (startCompare(hay, needle)) opts.add(rule.emotion, 1.0, rule.strength);
    }
  }

  return opts;
}
