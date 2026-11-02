/**
 * soundService.js
 * Aks (अक्स) — High-Fidelity Literary Reading Sound Engine
 *
 * Provides:
 * - Ultra-low latency paper page-turning sound playback for Book Mode.
 * - Dual playback engine: Web Audio API (with micro-detuning & instant overlap cancellation)
 *   with graceful fallback to HTMLAudioElement.
 * - Procedural acoustic paper-noise synthesis fallback if audio assets are unreachable.
 * - Automatic browser user-gesture unlocking (handles suspended AudioContext policies).
 * - Safe lifecycle management: preloading, non-overlapping playback, volume normalization,
 *   and test-environment safety (Node.js no-op).
 */

const AUDIO_ASSET_PATH = '/sounds/page-flip.wav';
const DEFAULT_VOLUME = 0.38; // Subtle, gentle volume appropriate for quiet reading sanctuary

let audioContext = null;
let audioBuffer = null;
let activeSourceNode = null;
let activeGainNode = null;
let fallbackAudio = null;
let isPreloaded = false;
let isContextUnlocked = false;

/**
 * Returns or initializes the shared AudioContext (lazily created).
 */
function getAudioContext() {
  if (typeof window === 'undefined') return null;

  if (!audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      audioContext = new AudioCtx();
    }
  }

  // Attempt to resume if suspended by browser autoplay policy
  if (audioContext && audioContext.state === 'suspended' && isContextUnlocked) {
    audioContext.resume().catch(() => {});
  }

  return audioContext;
}

/**
 * Attach global pointerdown/keydown listener once to unlock AudioContext
 * after the first user interaction.
 */
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    isContextUnlocked = true;
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
  };

  window.addEventListener('pointerdown', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });
  window.addEventListener('touchstart', unlockAudio, { passive: true });
}

/**
 * Synthesize a realistic paper-turning sound buffer procedurally using Web Audio API.
 * Used as a zero-dependency instant fallback if the network fetch fails.
 */
function createProceduralPaperBuffer(ctx) {
  const sampleRate = ctx.sampleRate || 44100;
  const duration = 0.36; // 360ms
  const frameCount = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, frameCount, sampleRate);
  const channelData = buffer.getChannelData(0);

  // Generate pink/bandpass filtered noise with natural leaf-turning envelope
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;

  for (let i = 0; i < frameCount; i++) {
    const t = i / sampleRate;
    const progress = t / duration;

    // Pink noise generator (Paul Kellet's filter)
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    const pink = b0 + b1 + b2 + white * 0.5362;

    // Physical leaf envelope: gentle attack, textured friction body, soft exponential decay
    let env = 0;
    if (progress < 0.22) {
      const p = progress / 0.22;
      env = 0.5 * (1 - Math.cos(Math.PI * p));
    } else if (progress < 0.6) {
      const p = (progress - 0.22) / 0.38;
      env = 1.0 - 0.2 * Math.sin(Math.PI * p);
    } else {
      const p = (progress - 0.6) / 0.4;
      env = 0.8 * Math.exp(-3.5 * p);
    }

    // Subtle fluttering air displacement
    const flutter = 1.0 + 0.15 * Math.sin(2 * Math.PI * 16 * t);

    // Boundary ramp to guarantee 0 pops
    let boundary = 1;
    if (i < 200) boundary = i / 200;
    else if (i > frameCount - 200) boundary = (frameCount - i) / 200;

    channelData[i] = pink * 0.18 * env * flutter * boundary;
  }

  return buffer;
}

/**
 * Preload the page-turning sound asset.
 * Safe to call multiple times (idempotent).
 */
export async function preloadPageTurnSound() {
  if (typeof window === 'undefined') return;
  if (isPreloaded) return;
  isPreloaded = true;

  // Initialize fallback HTMLAudioElement
  try {
    fallbackAudio = new Audio(AUDIO_ASSET_PATH);
    fallbackAudio.preload = 'auto';
    fallbackAudio.volume = DEFAULT_VOLUME;
  } catch (_) {}

  // Preload and decode via Web Audio API for 0-latency playback
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const response = await fetch(AUDIO_ASSET_PATH);
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  } catch (err) {
    console.info('[soundService] Loading audio asset failed, generating procedural buffer fallback:', err?.message);
    try {
      audioBuffer = createProceduralPaperBuffer(ctx);
    } catch (_) {}
  }
}

/**
 * Play a realistic paper page-turning sound.
 * Stops any previously running sound immediately with a micro-fade to prevent overlapping.
 *
 * @param {Object} [options]
 * @param {number} [options.volume=DEFAULT_VOLUME] Volume between 0.0 and 1.0
 * @param {boolean} [options.enabled=true] Whether sound is enabled
 * @returns {Promise<boolean>} True if playback was initiated
 */
export async function playPageTurnSound({ volume = DEFAULT_VOLUME, enabled = true } = {}) {
  if (!enabled || typeof window === 'undefined') return false;

  const ctx = getAudioContext();

  // ── Engine 1: Web Audio API (Zero Latency + Pitch Variation + Clean Cut) ──
  if (ctx) {
    try {
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }

      // If audioBuffer is not yet loaded, create procedural fallback or trigger load
      if (!audioBuffer) {
        audioBuffer = createProceduralPaperBuffer(ctx);
        preloadPageTurnSound().catch(() => {});
      }

      // Stop previous active sound cleanly to prevent overlapping
      if (activeSourceNode && activeGainNode) {
        try {
          const now = ctx.currentTime;
          activeGainNode.gain.cancelScheduledValues(now);
          activeGainNode.gain.setValueAtTime(activeGainNode.gain.value, now);
          activeGainNode.gain.linearRampToValueAtTime(0.001, now + 0.015);
          activeSourceNode.stop(now + 0.02);
        } catch (_) {}
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      // Micro-detune (+/- 3%) so consecutive page turns don't sound repetitive
      const detune = 0.97 + Math.random() * 0.06;
      source.playbackRate.value = detune;

      const gain = ctx.createGain();
      const targetVol = Math.max(0, Math.min(1, volume));
      gain.gain.setValueAtTime(targetVol, ctx.currentTime);

      source.connect(gain);
      gain.connect(ctx.destination);

      activeSourceNode = source;
      activeGainNode = gain;

      source.onended = () => {
        if (activeSourceNode === source) {
          activeSourceNode = null;
          activeGainNode = null;
        }
      };

      source.start(0);
      return true;
    } catch (err) {
      console.warn('[soundService] Web Audio API playback failed, trying HTMLAudio fallback:', err);
    }
  }

  // ── Engine 2: HTMLAudioElement Fallback ──────────────────────────────────
  if (typeof Audio !== 'undefined') {
    try {
      if (!fallbackAudio) {
        fallbackAudio = new Audio(AUDIO_ASSET_PATH);
      }
      fallbackAudio.volume = Math.max(0, Math.min(1, volume));
      fallbackAudio.currentTime = 0;
      const playPromise = fallbackAudio.play();
      if (playPromise !== undefined) {
        await playPromise.catch(() => {});
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  return false;
}

/**
 * Stop any active page turn audio immediately.
 */
export function stopPageTurnSound() {
  if (audioContext && activeSourceNode && activeGainNode) {
    try {
      const now = audioContext.currentTime;
      activeGainNode.gain.cancelScheduledValues(now);
      activeGainNode.gain.linearRampToValueAtTime(0.001, now + 0.01);
      activeSourceNode.stop(now + 0.015);
    } catch (_) {}
  }
  if (fallbackAudio) {
    try {
      fallbackAudio.pause();
      fallbackAudio.currentTime = 0;
    } catch (_) {}
  }
}

/**
 * Clean up sound resources.
 */
export function cleanupSoundService() {
  stopPageTurnSound();
  activeSourceNode = null;
  activeGainNode = null;
  if (fallbackAudio) {
    try {
      fallbackAudio.src = '';
      fallbackAudio = null;
    } catch (_) {}
  }
  isPreloaded = false;
}
