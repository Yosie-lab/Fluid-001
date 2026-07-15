/** ポジティブワード辞書（部分一致・日本語/英語） + OCRゆれ対策 */

export const POSITIVE_WORDS = [
  "ありがとう",
  "感謝",
  "愛してる",
  "愛",
  "幸せ",
  "幸福",
  "希望",
  "平和",
  "笑顔",
  "笑",
  "大丈夫",
  "最高",
  "素敵",
  "好き",
  "夢",
  "光",
  "勇気",
  "応援",
  "嬉しい",
  "うれしい",
  "楽しい",
  "たのしい",
  "感動",
  "誇り",
  "信頼",
  "温か",
  "あたたか",
  "癒し",
  "いやし",
  "自由",
  "元気",
  "祝福",
  "ナイス",
  "よろしく",
  "おめでとう",
  "しあわせ",
  "かんしゃ",
  "ゆめ",
  "ひかり",
  "love",
  "hope",
  "peace",
  "joy",
  "happy",
  "thanks",
  "thankyou",
  "thank",
  "beautiful",
  "smile",
  "dream",
  "light",
  "brave",
  "calm",
  "gentle",
  "kind",
  "grateful",
  "shine",
  "free",
  "trust",
  "warm",
  "heal",
  "bless",
  "wonderful",
  "great",
  "good",
  "yes",
  "nice",
];

/** OCRがよく誤る表記 → 正規の語 */
const OCR_ALIASES = {
  ありがと: "ありがとう",
  ありがとら: "ありがとう",
  ありがとうら: "ありがとう",
  arigato: "ありがとう",
  arigatou: "ありがとう",
  thankyou: "thanks",
  thx: "thanks",
  大好き: "愛",
  すき: "好き",
  すてき: "素敵",
  さいこう: "最高",
  だいじょうぶ: "大丈夫",
  ゆうき: "勇気",
  えがお: "笑顔",
  きぼう: "希望",
  へいわ: "平和",
};

export function normalizeForMatch(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}ぁ-んァ-ン一-龥]/gu, "");
}

function orderedCharHit(haystack, needle) {
  if (!needle || needle.length < 2) return false;
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) {
      i++;
      if (i >= needle.length) return true;
    }
  }
  // 短い語は完全包含寄り: 過半数の連続風ヒット
  return false;
}

export function findPositiveWord(text) {
  const normalized = normalizeForMatch(text);
  if (!normalized || normalized.length < 1) return null;

  // 別名ヒット
  for (const [alias, word] of Object.entries(OCR_ALIASES)) {
    if (normalized.includes(normalizeForMatch(alias))) return word;
  }

  const sorted = [...new Set(POSITIVE_WORDS)].sort((a, b) => b.length - a.length);
  for (const word of sorted) {
    const needle = normalizeForMatch(word);
    if (!needle) continue;
    if (normalized.includes(needle)) return word;
    // 3文字以上は並び順一致（OCR抜け対策）
    if (needle.length >= 3 && orderedCharHit(normalized, needle)) return word;
  }
  return null;
}
