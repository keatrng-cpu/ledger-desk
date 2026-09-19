/**
 * Ring 2 / Ring 3 input: the trader names the word and the missing layer
 * BEFORE the engine's answer is on screen. Scored against smc-master labels.
 */

import { useState } from "react";
import {
  MUST_LAYERS,
  WORDS,
  scoreCall,
  type Call,
  type CallScore,
  type Word,
} from "@/lib/learn/drill";

export function DrillCall({
  prompt,
  truth,
  onCommit,
}: {
  prompt: string;
  truth: Call;
  onCommit?: (score: CallScore, guess: Call) => void;
}) {
  const [word, setWord] = useState<Word | null>(null);
  const [missing, setMissing] = useState<string>("");
  const [score, setScore] = useState<CallScore | null>(null);
  const [guess, setGuess] = useState<Call | null>(null);

  function commit() {
    if (!word) return;
    const g: Call = {
      word,
      missing: word === "TAKE" ? "Sequence complete" : missing || "Sequence complete",
    };
    if (word !== "TAKE" && !missing) return;
    const s = scoreCall(g, truth);
    setGuess(g);
    setScore(s);
    onCommit?.(s, g);
  }

  if (score && guess) {
    const color =
      score.grade === "hit" ? "var(--color-up)" : score.grade === "word" ? "var(--color-warn)" : "var(--color-down)";
    const bg =
      score.grade === "hit"
        ? "color-mix(in oklab, var(--color-up) 12%, transparent)"
        : score.grade === "word"
          ? "color-mix(in oklab, var(--color-warn) 12%, transparent)"
          : "color-mix(in oklab, var(--color-down) 12%, transparent)"
    return (
      <div className="rounded-[var(--radius-sm)] p-3" style={{ background: bg }}>
        <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>
          {score.grade === "hit" ? "Hit" : score.grade === "word" ? "Word right, layer off" : "Miss"}
        </p>
        <p className="mt-1 text-[13px] leading-snug text-[var(--color-fg)]">
          You: {guess.word}
          {guess.word !== "TAKE" ? ` · ${guess.missing}` : ""}. Desk: {truth.word}
          {truth.word !== "TAKE" ? ` · ${truth.missing}` : ""}.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] p-3">
      <p className="text-[11px] leading-snug text-[var(--color-fg)]">{prompt}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {WORDS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => {
              setWord(w);
              if (w === "TAKE") setMissing("Sequence complete");
            }}
            className={`rounded-[var(--radius-sm)] px-2.5 py-1 text-[11px] font-semibold ${
              word === w
                ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
                : "bg-[var(--color-surface-3)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            }`}
          >
            {w}
          </button>
        ))}
      </div>
      {word && word !== "TAKE" && (
        <div className="mt-2 flex flex-wrap gap-1">
          {MUST_LAYERS.filter((l) => l !== "Sequence complete").map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setMissing(l)}
              className={`rounded-[var(--radius-sm)] px-2 py-1 text-[10px] ${
                missing === l
                  ? "bg-[var(--color-primary-dim)] text-[var(--color-fg)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        disabled={!word || (word !== "TAKE" && !missing)}
        onClick={commit}
        className="mt-2 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] py-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)] disabled:opacity-40"
      >
        Commit — then see the desk
      </button>
    </div>
  );
}

export function WhyBox({ prompt, answer }: { prompt: string; answer: string }) {
  const [text, setText] = useState("");
  const [show, setShow] = useState(false);
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
        Why — say it before you read it
      </p>
      <p className="mt-1 text-[13px] text-[var(--color-fg)]">{prompt}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="One sentence."
        className="mt-2 w-full resize-none rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-[12px] text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]"
      />
      {show ? (
        <p className="mt-2 text-[13px] leading-snug text-[var(--color-fg)]">{answer}</p>
      ) : (
        <button
          type="button"
          disabled={text.trim().length < 8}
          onClick={() => setShow(true)}
          className="mt-2 text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)] disabled:opacity-40"
        >
          Check against the desk
        </button>
      )}
    </div>
  );
}
