// public/js/studio/shared/gimmick/synth.js
// 効果音を、音のファイル無しでその場で作る（sfxr のような音作り）。
// クリエイターモードの「サウンド」で波形・音の高さ・長さ・メロディを決めると、
// 配信画面（OBS）でも同じ音が鳴る。
//
// ブラウザは、人が画面を触るまで音を出させないことがある（OBS のブラウザソースは出せる）。
// 出せないときは黙って何もしない。

const MAX_VOICES = 24;
let ctx = null;
let master = null;
let noise = null;
let voices = 0;

function audio() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
    } catch (e) {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => { });
  return ctx;
}

function noiseBuffer(ac) {
  if (noise) return noise;
  noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

const NOTE_INDEX = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** "C5" "F#4" "Bb3" → 周波数。"-" や読めないものは休符（null） */
export function noteFreq(name) {
  const m = /^([a-g])([#b]?)(-?\d)$/i.exec(String(name).trim());
  if (!m) return null;
  let n = NOTE_INDEX[m[1].toLowerCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  n += (Number(m[3]) + 1) * 12;
  return 440 * 2 ** ((n - 69) / 12);
}

export function parseNotes(text) {
  return String(text ?? "").split(/[\s,、]+/).filter(Boolean).slice(0, 64).map(noteFreq);
}

const clamp = (v, a, b, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d;
};

/** 1音を鳴らす */
function voice(ac, def, start, length, f0, f1, gain) {
  if (voices >= MAX_VOICES) return;
  const wave = ["sine", "square", "sawtooth", "triangle", "noise"].includes(def.wave) ? def.wave : "square";
  let src;
  if (wave === "noise") {
    src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac);
    src.loop = true;
    // ノイズは高さの代わりに再生速度を変える（爆発音が低く唸る）
    src.playbackRate.setValueAtTime(clamp(f0 / 440, 0.05, 8, 1), start);
    src.playbackRate.exponentialRampToValueAtTime(clamp(f1 / 440, 0.05, 8, 1), start + length);
  } else {
    src = ac.createOscillator();
    src.type = wave;
    src.frequency.setValueAtTime(f0, start);
    if (f1 !== f0) src.frequency.exponentialRampToValueAtTime(Math.max(1, f1), start + length);
    const depth = clamp(def.vibrato, 0, 2000, 0);
    if (depth > 0) {
      const lfo = ac.createOscillator();
      const lfoGain = ac.createGain();
      lfo.frequency.value = clamp(def.vibratoRate, 0.1, 60, 8);
      lfoGain.gain.value = depth;
      lfo.connect(lfoGain).connect(src.frequency);
      lfo.start(start);
      lfo.stop(start + length + 0.05);
    }
  }

  const env = ac.createGain();
  const attack = Math.min(length * 0.9, clamp(def.attack, 0, 2, 0.005));
  const hold = Math.min(length - attack, length * clamp(def.sustain, 0, 1, 0.2));
  env.gain.setValueAtTime(0.0001, start);
  env.gain.linearRampToValueAtTime(gain, start + Math.max(0.001, attack));
  env.gain.setValueAtTime(gain, start + attack + hold);
  env.gain.exponentialRampToValueAtTime(0.0001, start + length);

  let node = src;
  const cutoff = clamp(def.filter, 0, 20000, 0);
  if (cutoff > 0) {
    const f = ac.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    node.connect(f);
    node = f;
  }
  node.connect(env).connect(master);
  voices++;
  src.onended = () => { voices = Math.max(0, voices - 1); };
  src.start(start);
  src.stop(start + length + 0.02);
}

/**
 * サウンドを鳴らす。
 * @param {object} def ギミックのサウンド（wave / freq / freqEnd / duration / notes …）
 * @param {number} [volume] 0..1
 */
export function playSynth(def, volume = 1) {
  const ac = audio();
  if (!ac || !def) return;
  const gain = clamp(def.volume, 0, 1, 0.5) * clamp(volume, 0, 1, 1) * 0.6;
  if (gain <= 0) return;
  const t0 = ac.currentTime + 0.01;
  const repeat = Math.round(clamp(def.repeat, 1, 8, 1));
  const notes = parseNotes(def.notes);
  const f0 = clamp(def.freq, 20, 12000, 440);
  const f1 = clamp(def.freqEnd ?? def.freq, 20, 12000, f0);

  if (notes.length) {
    const step = clamp(def.noteLength, 0.02, 2, 0.12);
    const total = notes.length * step;
    for (let r = 0; r < repeat; r++) {
      notes.forEach((f, i) => {
        if (!f) return;
        // メロディの音は、それぞれの音の高さから freqEnd / freq の比でしゃくる
        voice(ac, def, t0 + r * total + i * step, step * 0.95, f, f * (f1 / f0), gain);
      });
    }
    return;
  }
  const length = clamp(def.duration, 0.02, 5, 0.3);
  for (let r = 0; r < repeat; r++) voice(ac, def, t0 + r * length, length, f0, f1, gain);
}

/** 作り始めに選べる音（sfxr の定番） */
export const SOUND_PRESETS = [
  { key: "coin", label: "🪙 コイン", sound: { wave: "square", freq: 988, freqEnd: 988, duration: 0.25, notes: "B5 E6", noteLength: 0.08, sustain: 0.3, volume: 0.45 } },
  { key: "jump", label: "⤴ ジャンプ", sound: { wave: "square", freq: 300, freqEnd: 900, duration: 0.22, sustain: 0.1, volume: 0.4 } },
  { key: "explosion", label: "💥 爆発", sound: { wave: "noise", freq: 300, freqEnd: 40, duration: 0.9, sustain: 0.05, filter: 1800, volume: 0.7 } },
  { key: "laser", label: "⚡ レーザー", sound: { wave: "sawtooth", freq: 1800, freqEnd: 200, duration: 0.25, sustain: 0.05, volume: 0.35 } },
  { key: "powerup", label: "⬆ パワーアップ", sound: { wave: "triangle", freq: 440, freqEnd: 470, notes: "C5 E5 G5 C6 E6 G6", noteLength: 0.06, sustain: 0.4, volume: 0.5 } },
  { key: "hit", label: "👊 ヒット", sound: { wave: "noise", freq: 900, freqEnd: 200, duration: 0.15, sustain: 0, volume: 0.6 } },
  { key: "blip", label: "· ピッ", sound: { wave: "sine", freq: 1200, freqEnd: 1200, duration: 0.08, sustain: 0.2, volume: 0.4 } },
  { key: "fanfare", label: "🎺 ファンファーレ", sound: { wave: "square", freq: 440, freqEnd: 440, notes: "C5 C5 C5 C5 - G#4 - A#4 - C5 - - A#4 C5", noteLength: 0.11, sustain: 0.6, filter: 4000, volume: 0.45 } },
  { key: "alarm", label: "🚨 警報", sound: { wave: "sawtooth", freq: 700, freqEnd: 700, duration: 0.6, vibrato: 250, vibratoRate: 6, sustain: 0.8, repeat: 2, filter: 3000, volume: 0.35 } },
  { key: "drop", label: "💧 しずく", sound: { wave: "sine", freq: 1400, freqEnd: 300, duration: 0.18, sustain: 0, volume: 0.5 } },
  { key: "lose", label: "📉 ざんねん", sound: { wave: "triangle", freq: 440, freqEnd: 400, notes: "G4 F#4 F4 E4", noteLength: 0.28, sustain: 0.7, vibrato: 6, vibratoRate: 7, volume: 0.5 } },
  { key: "magic", label: "✨ きらきら", sound: { wave: "sine", freq: 880, freqEnd: 880, notes: "E6 B6 G#6 E7 B6 E7", noteLength: 0.05, sustain: 0.3, volume: 0.35 } },
];
