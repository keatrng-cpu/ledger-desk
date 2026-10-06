/**
 * The floor's sound. OFF by default and remembered per browser; the tab's
 * speaker toggle turns it on, and that click is what unlocks audio.
 *
 * Two layers, both presentation:
 *  - event tones (WebAudio, no files) for what the cycle already decided
 *    (a fill, a winner, the bell at the open);
 *  - the line on the caption, spoken in phrases in that person's pattern
 *    (a lecture that settles, a clip, a flat number, a verdict, an operator).
 *    Turn-taking: `say` reports when the line has been fully said, the scene
 *    holds the caption until then, and a line that arrives early waits for the
 *    phrase in the air to finish — nobody talks over anybody.
 *    The words are the caption. It does not write a line, pick a trade, or
 *    read a number the room did not already print.
 */

import type { Character } from "@/lib/room/orchestrator";
import { phrasePlan, voiceScore, VOICE_CAST, type SpokenPhrase } from "@/lib/room/floor-voice";
import type { FloorEvent } from "./floor-scene";

export { VOICE_CAST };

function englishVoices(): SpeechSynthesisVoice[] {
  const all = window.speechSynthesis?.getVoices() ?? [];
  const en = all.filter((v) => /^en([-_]|$)/i.test(v.lang));
  return en.length ? en : all;
}

/** Prefer a neural voice, and keep the five on different ones. */
function pickVoice(who: Character, used: Set<string>): SpeechSynthesisVoice | null {
  const cast = VOICE_CAST[who];
  const pool = englishVoices().filter((v) => !used.has(v.voiceURI));
  const ranked = (pool.length ? pool : englishVoices()).slice().sort(
    (a, b) => voiceScore(b.name, b.lang, cast.lean, cast.hints) - voiceScore(a.name, a.lang, cast.lean, cast.hints),
  );
  return ranked[0] ?? null;
}

const STORAGE = "ledger-room-sound-v1";

/** Longest a new line waits for the phrase in the air to finish before it is cut. */
const PREEMPT_CAP_MS = 2600;
/** The breath between a finished phrase and the speaker who was waiting for it. */
const PREEMPT_GAP_MS = 260;

export function loadSoundPref(): { on: boolean; volume: number } {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE) : null;
    const v = raw ? (JSON.parse(raw) as { on?: boolean; volume?: number }) : null;
    return { on: Boolean(v?.on), volume: typeof v?.volume === "number" ? Math.min(1, Math.max(0, v.volume)) : 0.5 };
  } catch {
    return { on: false, volume: 0.5 };
  }
}

export function saveSoundPref(p: { on: boolean; volume: number }): void {
  try {
    window.localStorage.setItem(STORAGE, JSON.stringify(p));
  } catch {
    // Per-tab only.
  }
}

export class FloorSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  volume = 0.5;

  /** Must run from a user gesture the first time (browser autoplay rules). */
  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    if (this.master) this.master.gain.value = this.volume * 0.6;
    void this.ctx.resume();
    return this.ctx;
  }

  private sayToken = 0;
  private primed = false;
  private cast = new Map<Character, string>();
  /** An utterance is in the air right now (one phrase of a line). */
  private uttering = false;
  /** A new line waiting for the phrase in the air to finish — nobody is cut off mid-word. */
  private afterPhrase: (() => void) | null = null;
  private afterPhraseCap = 0;

  /** Must run from the speaker-toggle click. Primes both WebAudio and speech. */
  unlock(): void {
    this.ensure();
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || this.primed) return;
    this.primed = true;
    synth.resume();
    const warm = new SpeechSynthesisUtterance(" ");
    warm.volume = 0.01;
    warm.rate = 2;
    synth.speak(warm);
  }

  /**
   * Speak the caption in phrases, in that person's pattern. `onDone` fires once, when the LAST phrase has been said
   * (or the voice failed) — the scene holds the line until then, so the next person waits their turn.
   *
   * A new line that arrives while someone is mid-phrase does not cut them off: the phrase in the air finishes
   * (never longer than PREEMPT_CAP_MS), the rest of the old line is dropped, and the new speaker starts after a beat.
   * Returns false when nothing will be said (no speech engine, no words) — the caller must not wait for it.
   */
  say(line: { character: Character; text: string }, onDone?: () => void): boolean {
    if (typeof window === "undefined" || !window.speechSynthesis) return false;
    const parts = phrasePlan(line.character, line.text);
    if (!parts.length || !parts[0].text) return false;
    const synth = window.speechSynthesis;
    const token = ++this.sayToken;
    const voice = pickVoice(line.character, new Set(this.cast.values()));
    if (voice) this.cast.set(line.character, voice.voiceURI);
    const volume = Math.min(1, Math.max(0.45, this.volume));
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (token === this.sayToken) onDone?.();
    };
    const speakAt = (i: number) => {
      if (token !== this.sayToken) return;
      const p: SpokenPhrase | undefined = parts[i];
      if (!p) {
        finish();
        return;
      }
      const u = new SpeechSynthesisUtterance(p.text);
      u.pitch = p.pitch;
      u.rate = p.rate;
      u.volume = volume;
      u.lang = "en-US";
      if (voice) u.voice = voice;
      const words = p.text.split(/\s+/).length;
      let stepped = false;
      const advance = () => {
        if (stepped) return;
        stepped = true;
        window.clearTimeout(fallback);
        this.uttering = false;
        if (token !== this.sayToken) {
          // Superseded mid-line: this phrase was allowed to finish; hand the floor to the next speaker.
          const next = this.afterPhrase;
          this.afterPhrase = null;
          window.clearTimeout(this.afterPhraseCap);
          if (next) window.setTimeout(next, PREEMPT_GAP_MS);
          return;
        }
        if (i === parts.length - 1) finish();
        else window.setTimeout(() => speakAt(i + 1), p.gap);
      };
      // Some engines never fire onend: a generous estimate of the phrase stands in for it.
      const fallback = window.setTimeout(advance, (words * 420) / Math.max(0.5, p.rate) + 900);
      u.onend = advance;
      u.onerror = advance;
      this.uttering = true;
      synth.resume();
      synth.speak(u);
    };
    const start = () => speakAt(0);
    if (this.uttering) {
      // Somebody is mid-phrase: let them land it, then go.
      this.afterPhrase = start;
      window.clearTimeout(this.afterPhraseCap);
      this.afterPhraseCap = window.setTimeout(() => {
        const next = this.afterPhrase;
        this.afterPhrase = null;
        this.uttering = false;
        synth.cancel();
        if (next) window.setTimeout(next, 50);
      }, PREEMPT_CAP_MS);
    } else {
      synth.cancel();
      // Chrome drops an utterance spoken in the same turn as cancel().
      window.setTimeout(start, 50);
    }
    return true;
  }

  hush(): void {
    this.sayToken++;
    this.afterPhrase = null;
    this.uttering = false;
    if (typeof window !== "undefined") {
      window.clearTimeout(this.afterPhraseCap);
      window.speechSynthesis?.cancel();
    }
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number, glideTo?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(this.master!);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  private noise(start: number, dur: number, gain: number, hp = 1800) {
    const ctx = this.ctx!;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master!);
    src.start(start);
  }

  play(e: FloorEvent): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    switch (e) {
      case "bell":
        // An inharmonic bell: partials that ring out.
        for (const [mult, g] of [
          [1, 0.5],
          [2.4, 0.25],
          [3.9, 0.12],
          [5.4, 0.06],
        ] as [number, number][])
          this.tone(523 * mult, t, 2.6, "sine", g);
        this.tone(523, t + 0.9, 2.2, "sine", 0.3);
        break;
      case "fill":
        for (let i = 0; i < 6; i++) this.noise(t + i * 0.05, 0.03, 0.25, 2500);
        this.tone(880, t + 0.32, 0.12, "square", 0.08);
        break;
      case "exit_win":
        this.noise(t, 0.06, 0.3, 3000);
        this.tone(1318, t + 0.05, 0.25, "triangle", 0.35);
        this.tone(1760, t + 0.18, 0.5, "triangle", 0.35);
        break;
      case "exit_loss":
        this.tone(220, t, 0.45, "sawtooth", 0.12, 140);
        break;
      case "alert":
        for (let i = 0; i < 3; i++) {
          this.tone(740, t + i * 0.36, 0.16, "square", 0.07);
          this.tone(587, t + i * 0.36 + 0.18, 0.16, "square", 0.07);
        }
        break;
      case "meow":
        this.tone(620, t, 0.18, "sawtooth", 0.06, 900);
        this.tone(900, t + 0.18, 0.28, "sawtooth", 0.05, 480);
        break;
    }
  }

  dispose(): void {
    this.hush();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}
