/**
 * The floor's sound. OFF by default and remembered per browser; the tab's
 * speaker toggle turns it on, and that click is what unlocks audio.
 *
 * Two layers, both presentation:
 *  - event tones (WebAudio, no files) for what the cycle already decided
 *    (a fill, a winner, the bell at the open);
 *  - the line on the caption, in that person's designated voice. The voice is
 *    chosen once and kept. Pitch stays near a normal speaking voice; dropping
 *    it is what rasps. A raid is a little quicker, a stop a little slower.
 *    The person already talking finishes. The words are the caption. It does
 *    not write a line, pick a trade, or read a number the room did not print.
 */

import type { Character } from "@/lib/room/orchestrator";
import { assignVoices, phrasePlan, VOICE_CAST, type SpokenPhrase } from "@/lib/room/floor-voice";
import type { FloorEvent } from "./floor-scene";

export { VOICE_CAST };

function englishVoices(): SpeechSynthesisVoice[] {
  const all = window.speechSynthesis?.getVoices() ?? [];
  const en = all.filter((v) => /^en([-_]|$)/i.test(v.lang));
  return en.length ? en : all;
}

const CAST_KEY = "ledger-room-cast-v2";

function loadCast(): Partial<Record<Character, string>> {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(CAST_KEY) : null;
    if (!raw) return {};
    const v = JSON.parse(raw) as Partial<Record<Character, string>>;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function saveCast(cast: Partial<Record<Character, string>>): void {
  try {
    window.localStorage.setItem(CAST_KEY, JSON.stringify(cast));
  } catch {
    // Per-browser only.
  }
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

  private primed = false;
  private voicesBound = false;
  private saved: Partial<Record<Character, string>> = {};
  private queue: { token: number; who: Character; parts: SpokenPhrase[] }[] = [];
  private draining = false;
  private gen = 0;

  /** Must run from the speaker-toggle click. Primes both WebAudio and speech. */
  unlock(): void {
    this.ensure();
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return;
    this.bindVoices();
    if (this.primed) return;
    this.primed = true;
    synth.resume();
    const warm = new SpeechSynthesisUtterance(" ");
    warm.volume = 0.01;
    warm.rate = 1;
    synth.speak(warm);
  }

  private bindVoices(): void {
    const synth = window.speechSynthesis;
    if (!synth || this.voicesBound) return;
    this.voicesBound = true;
    this.saved = loadCast();
    synth.addEventListener?.("voiceschanged", () => this.lockCast());
    this.lockCast();
  }

  /** Assign each person once, and only a voice of their gender. A saved mismatch is dropped. */
  private lockCast(): void {
    const voices = englishVoices();
    if (!voices.length) return;
    const assigned = assignVoices(
      voices.map((v) => ({ name: v.name, voiceURI: v.voiceURI, lang: v.lang })),
      this.saved,
    );
    let changed = false;
    for (const who of ["Gemma", "Nova", "Jax", "Sterling", "Vince"] as const) {
      const uri = assigned[who];
      if (uri) {
        if (uri !== this.saved[who]) {
          this.saved[who] = uri;
          changed = true;
        }
      } else if (this.saved[who]) {
        delete this.saved[who];
        changed = true;
      }
    }
    if (changed) saveCast(this.saved);
  }

  private voiceFor(who: Character): SpeechSynthesisVoice | null {
    this.bindVoices();
    const uri = this.saved[who];
    if (!uri) return null;
    return englishVoices().find((v) => v.voiceURI === uri) ?? null;
  }

  /**
   * Queue the caption. The person already talking finishes. A new line waits.
   * Only hush() (voices off) cuts the room.
   */
  say(line: { character: Character; text: string; animation?: string }): void {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const parts = phrasePlan(line.character, line.text, line.animation);
    if (!parts.length || !parts[0].text) return;
    this.queue.push({ token: this.gen, who: line.character, parts });
    if (this.queue.length > 6) this.queue.splice(0, this.queue.length - 6);
    this.drain();
  }

  private drain(): void {
    if (this.draining || !this.queue.length) return;
    const job = this.queue.shift();
    if (!job) return;
    this.draining = true;
    const synth = window.speechSynthesis;
    const voice = this.voiceFor(job.who);
    const volume = Math.min(1, Math.max(0.5, this.volume));
    const speakAt = (i: number) => {
      if (job.token !== this.gen) {
        this.draining = false;
        return;
      }
      const p = job.parts[i];
      if (!p) {
        this.draining = false;
        this.drain();
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
        if (stepped || job.token !== this.gen) return;
        stepped = true;
        window.clearTimeout(fallback);
        window.setTimeout(() => speakAt(i + 1), p.gap);
      };
      const fallback = window.setTimeout(advance, words * 460 + 800);
      u.onend = advance;
      u.onerror = () => {
        window.clearTimeout(fallback);
        if (!stepped) advance();
      };
      synth.resume();
      synth.speak(u);
    };
    window.setTimeout(() => speakAt(0), 40);
  }

  hush(): void {
    this.gen++;
    this.queue = [];
    this.draining = false;
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
