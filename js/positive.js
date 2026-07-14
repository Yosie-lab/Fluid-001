/** ポジティブワード辞書（部分一致・日本語/英語） */
export const POSITIVE_WORDS = [
  "ありがとう",
  "感謝",
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
  "楽しい",
  "感動",
  "誇り",
  "信頼",
  "温か",
  "癒し",
  "自由",
  "元気",
  "祝福",
  "ナイス",
  "love",
  "hope",
  "peace",
  "joy",
  "happy",
  "thanks",
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

export function normalizeForMatch(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s\u3000]+/g, "");
}

export function findPositiveWord(text) {
  const normalized = normalizeForMatch(text);
  if (!normalized) return null;

  const sorted = [...POSITIVE_WORDS].sort((a, b) => b.length - a.length);
  for (const word of sorted) {
    const needle = normalizeForMatch(word);
    if (needle && normalized.includes(needle)) return word;
  }
  return null;
}
