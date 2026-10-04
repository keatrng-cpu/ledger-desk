/**
 * The floor's sound — synthesized with WebAudio, no files. OFF by default and
 * remembered per browser; the tab's speaker toggle turns it on. Every sound
 * answers something the cycle decided (a fill, a winner, the bell at the
 * open) — the room never makes noise on its own.
 */

import type { FloorEvent } from "./floor-scene";

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

  unlock(): void {
    this.ensure();
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
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}
