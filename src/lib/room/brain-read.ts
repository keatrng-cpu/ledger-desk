/**
 * One line from the lines the book already holds. The first sentence of each, nothing invented.
 * Fewer than two real lines and the book stays quiet.
 */

function clause(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.trim();
  if (!t || t.startsWith("No ")) return null;
  const end = t.indexOf(". ");
  const one = (end === -1 ? t : t.slice(0, end + 1)).trim();
  return one.length > 220 ? `${one.slice(0, 217)}...` : one;
}

export function bookSentence(parts: { label: string; text: string | null | undefined }[]): string | null {
  const kept = parts.flatMap((p) => {
    const line = clause(p.text);
    return line ? [`${p.label}: ${line}`] : [];
  });
  if (kept.length < 2) return null;
  return kept.join(" ");
}
