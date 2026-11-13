// Opt-in sound, generated with the Web Audio API. Nothing plays until the user turns it on.
let ctx: AudioContext | null = null;
let drone: { a: OscillatorNode; b: OscillatorNode; gain: GainNode } | null = null;
let lastHiss = 0;

const on = () => !!ctx && ctx.state === 'running';

export function setSound(enabled: boolean) {
  if (enabled) {
    ctx ??= new AudioContext();
    void ctx.resume();
  } else {
    stopDrone();
    void ctx?.suspend();
  }
}

/** One low tone for the open site: larger day–night swing (loose fines) sits higher, bedrock lower. */
export function startDrone(swingPct: number) {
  if (!ctx || !on()) return;
  const f = 48 + 0.5 * Math.min(100, Math.max(0, swingPct));
  if (!drone) {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const a = ctx.createOscillator(), b = ctx.createOscillator();
    a.type = b.type = 'sine';
    a.connect(gain); b.connect(gain);
    a.start(); b.start();
    drone = { a, b, gain };
  }
  drone.a.frequency.setTargetAtTime(f, ctx.currentTime, 0.4);
  drone.b.frequency.setTargetAtTime(f * 1.5, ctx.currentTime, 0.4);
  drone.gain.gain.setTargetAtTime(0.035, ctx.currentTime, 0.6);
}

export function stopDrone() {
  if (ctx && drone) drone.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
}

function noise(duration: number, peak: number, freq: number) {
  if (!ctx || !on()) return;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
  src.buffer = buf;
  filter.type = 'bandpass'; filter.frequency.value = freq;
  gain.gain.value = peak;
  src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
  src.start();
}

/** Permit stamp landing. */
export const stampClick = () => noise(0.05, 0.25, 900);

/** Rover wheel slip, at most four times a second. */
export function slipHiss() {
  const now = performance.now();
  if (now - lastHiss < 250) return;
  lastHiss = now;
  noise(0.2, 0.08, 3200);
}
