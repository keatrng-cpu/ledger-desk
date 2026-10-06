/**
 * The floor's sound. OFF by default and remembered per browser; the tab's
 * speaker toggle turns it on, and that click is what unlocks audio.
 *
 * Two layers, both presentation:
 *  - event tones (WebAudio, no files) for what the cycle already decided
 *    (a fill, a winner, the bell at the open);
 *  - the line on the caption, spoken by the browser voice in that person's
 *    pitch. The utterance is the caption text. It does not write a line,
 *    pick a trade, or read a number the room did not already print.
 */

import type { Character } from "@/lib/room/orchestrator";
import type { FloorEvent } from "./floor-scene";

/** Pitch and rate are the cast. Hints only pick a browser voice when one is installed. */
export const VOICE_CAST: Record<Character, { pitch: number; rate: number; hints: readonly string[] }> = {
  Gemma: { pitch: 1.16, rate: 0.96, hints: ["samantha", "victoria", "fiona", "moira", "karen"] },
  Jax: { pitch: 0.84, rate: 1.1, hints: ["daniel", "alex", "fred", "rishi"] },
  Nova: { pitch: 1.06, rate: 0.9, hints: ["karen", "moira", "serena", "samantha"] },
  Sterling: { pitch: 0.74, rate: 0.88, hints: ["daniel", "rishi", "fred", "aaron"] },
  Vince: { pitch: 0.96, rate: 1.02, hints: ["alex", "aaron", "tom", "daniel"] },
};

function englishVoices(): SpeechSynthesisVoice[] {
  const all = window.speechSynthesis?.getVoices() ?? [];
  const en = all.filter((v) => /^en([-_]|$)/i.test(v.lang));
  return en.length ? en : all;
}

function pickVoice(who: Character, used: Set<string>): SpeechSynthesisVoice | null {
  const pool = englishVoices();
  const hints = VOICE_CAST[who].hints;
  const fresh = (v: SpeechSynthesisVoice) => !used.has(v.voiceURI);
  return (
    pool.find((v) => fresh(v) && hints.some((h) => v.name.toLowerCase().includes(h))) ??
    pool.find((v) => fresh(v)) ??
    pool[0] ??
    null
  );
}

const STORAGE = "ledger-room-sound-v1";

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

  /** Speak the caption, in that person's voice. No-op without a line. */
  say(line: { character: Character; text: string }): void {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const text = line.text.trim();
    if (!text) return;
    const synth = window.speechSynthesis;
    const token = ++this.sayToken;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const cast = VOICE_CAST[line.character];
    u.pitch = cast.pitch;
    u.rate = cast.rate;
    u.volume = Math.min(1, Math.max(0.35, this.volume));
    u.lang = "en-US";
    const voice = pickVoice(line.character, new Set(this.cast.values()));
    if (voice) {
      u.voice = voice;
      this.cast.set(line.character, voice.voiceURI);
    }
    // Chrome drops an utterance spoken in the same turn as cancel().
    window.setTimeout(() => {
      if (token !== this.sayToken) return;
      synth.resume();
      synth.speak(u);
    }, 40);
  }

  hush(): void {
    this.sayToken++;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
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
