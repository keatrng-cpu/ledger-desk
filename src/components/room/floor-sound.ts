/**
 * The floor's sound. OFF by default and remembered per browser; the tab's
 * speaker toggle turns it on, and that click is what unlocks audio.
 *
 * Layers, all presentation, each mutable on its own (the sound bed, Chunk A item 13):
 *  - event tones (WebAudio, no files) for what the cycle already decided
 *    (a fill, a winner, the bell at the open);
 *  - the line on the caption, in that person's designated voice. The voice is
 *    chosen once and kept. Pitch stays near a normal speaking voice; dropping
 *    it is what rasps. A raid is a little quicker, a stop a little slower.
 *    The person already talking finishes. The words are the caption. It does
 *    not write a line, pick a trade, or read a number the room did not print.
 *  - the bed: a room murmur, the weather (wind under overcast, rain + thunder in a storm — from the real VIX band,
 *    silent without one), a soft tape tick when the price prints up or down, and the killzone clock (a tick each
 *    second inside a killzone, a chime when one opens).
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

const CAST_KEY = "ledger-room-cast-v3";

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

/** The sound bed's layers. "events" and "voices" are the two layers the floor always had. */
export type BedLayer = "room" | "weather" | "tape" | "clock" | "events" | "voices";
export const BED_LAYERS: { id: BedLayer; label: string; title: string }[] = [
  { id: "voices", label: "Voices", title: "The five (and the Stand) speaking the caption" },
  { id: "events", label: "Events", title: "Fills, exits, the bell, alerts, the cat" },
  { id: "room", label: "Room", title: "A low room murmur" },
  { id: "weather", label: "Weather", title: "Wind when the VIX is 20+, rain and thunder at 30+ (silent without a VIX)" },
  { id: "tape", label: "Tape", title: "A soft tick when NQ (the QQQ track) prints up (higher) or down (lower)" },
  { id: "clock", label: "Clock", title: "Killzone clock: a tick each second inside a killzone, a chime when one opens" },
];
const BED_KEY = "ledger-room-soundbed-v1";

export function loadBedMutes(): Record<BedLayer, boolean> {
  const base: Record<BedLayer, boolean> = { room: false, weather: false, tape: false, clock: false, events: false, voices: false };
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(BED_KEY) : null;
    const v = raw ? (JSON.parse(raw) as Partial<Record<BedLayer, boolean>>) : null;
    if (v && typeof v === "object") for (const k of Object.keys(base) as BedLayer[]) if (typeof v[k] === "boolean") base[k] = v[k]!;
  } catch {
    // defaults
  }
  return base;
}

export function saveBedMutes(m: Record<BedLayer, boolean>): void {
  try {
    window.localStorage.setItem(BED_KEY, JSON.stringify(m));
  } catch {
    // Per-tab only.
  }
}

export interface BedState {
  weather: "clear" | "cloud" | "overcast" | "storm" | "none";
  intensity: number;
  inKillzone: boolean;
}

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
  private mutes: Record<BedLayer, boolean> = loadBedMutes();
  private loops: Partial<Record<"room" | "weather", { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode }>> = {};
  private bedOn = false;
  private bedState: BedState = { weather: "none", intensity: 0, inKillzone: false };

  isMuted(layer: BedLayer): boolean {
    return this.mutes[layer];
  }

  setMuted(layer: BedLayer, muted: boolean): void {
    this.mutes = { ...this.mutes, [layer]: muted };
    saveBedMutes(this.mutes);
    if (layer === "voices" && muted) this.hush();
    this.applyBed();
  }

  /** Start / update / stop the loops. `on` is the floor's speaker toggle; each loop also has its own mute. */
  bed(on: boolean, state: BedState): void {
    this.bedOn = on;
    this.bedState = state;
    if (on) this.ensure();
    this.applyBed();
  }

  private loop(kind: "room" | "weather") {
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    const have = this.loops[kind];
    if (have) return have;
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (kind === "room") {
        // Brown noise: a low murmur.
        last = (last + 0.02 * white) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = white;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = kind === "room" ? "lowpass" : "bandpass";
    filter.frequency.value = kind === "room" ? 380 : 2200;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    const rec = { src, gain, filter };
    this.loops[kind] = rec;
    return rec;
  }

  private applyBed(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const room = this.bedOn && !this.mutes.room ? 0.05 : 0;
    const w = this.bedState.weather;
    const weather = this.bedOn && !this.mutes.weather ? (w === "storm" ? 0.1 + 0.05 * this.bedState.intensity : w === "overcast" ? 0.035 : w === "cloud" ? 0.012 : 0) : 0;
    if (room > 0 || this.loops.room) this.loop("room")?.gain.gain.setTargetAtTime(room, now, 0.6);
    if (weather > 0 || this.loops.weather) {
      const l = this.loop("weather");
      if (l) {
        l.filter.type = w === "storm" ? "bandpass" : "lowpass";
        l.filter.frequency.setTargetAtTime(w === "storm" ? 2200 : 650, now, 0.5);
        l.gain.gain.setTargetAtTime(weather, now, 0.8);
      }
    }
  }

  /** One short click, built once. A new buffer every second was hitching the floor. */
  private clickBuf: AudioBuffer | null = null;

  private clickBuffer(): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    if (this.clickBuf) return this.clickBuf;
    const len = Math.max(1, Math.floor(ctx.sampleRate * 0.02));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = 1 - i / len;
      d[i] = Math.sin((i / ctx.sampleRate) * Math.PI * 2 * 1400) * env * env;
    }
    this.clickBuf = buf;
    return buf;
  }

  /** Replay the shared click. No new sample buffer, no filter, no resume. */
  private blip(rate: number, gain: number): void {
    const ctx = this.ctx;
    const buf = this.clickBuffer();
    if (!ctx || !buf || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
    };
    src.start();
  }

  /** The tape layer: one soft tick, higher when the print is up, lower when down. */
  tapeTick(up: boolean): void {
    if (!this.bedOn || this.mutes.tape) return;
    if (!this.ensure()) return;
    this.blip(up ? 1.35 : 0.8, 0.03);
  }

  /** The clock layer: a tick each second inside a killzone; a two-note chime when one opens. */
  clockTick(): void {
    if (!this.bedOn || this.mutes.clock || !this.bedState.inKillzone) return;
    if (!this.ensure()) return;
    this.blip(0.62, 0.022);
  }

  chime(): void {
    if (!this.bedOn || this.mutes.clock) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    this.tone(784, t, 0.9, "sine", 0.12);
    this.tone(1175, t + 0.28, 1.2, "sine", 0.1);
  }

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
    if (this.master && this.master.gain.value !== this.volume * 0.6) this.master.gain.value = this.volume * 0.6;
    if (this.ctx.state === "suspended") void this.ctx.resume();
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
    if (this.mutes.voices) return;
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
      u.lang = voice?.lang || "en-US";
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
    if (e === "thunder" ? this.mutes.weather : this.mutes.events) return;
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
      case "thunder":
        // A low rumble that rolls off.
        this.tone(55, t, 2.4, "sawtooth", 0.08, 38);
        this.noise(t, 1.8, 0.12, 120);
        break;
      case "meow":
        this.tone(620, t, 0.18, "sawtooth", 0.06, 900);
        this.tone(900, t + 0.18, 0.28, "sawtooth", 0.05, 480);
        break;
    }
  }

  dispose(): void {
    this.hush();
    for (const l of Object.values(this.loops)) {
      try {
        l?.src.stop();
      } catch {
        // already stopped
      }
    }
    this.loops = {};
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}
