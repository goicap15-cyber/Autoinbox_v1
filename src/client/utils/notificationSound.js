// Web Audio API chime synthesizer for incoming chat notifications
let audioCtx = null;
let soundEnabled = true;

try {
  const saved = localStorage.getItem('crm_sound_enabled');
  if (saved !== null) {
    soundEnabled = saved === 'true';
  }
} catch (_) {}

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Unlock audio on first user gesture (browser autoplay policy)
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'running') {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    }
  };
  window.addEventListener('click', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });
}

/**
 * Play a pleasant two-tone melodic chime (Messenger style)
 * Tone 1: 587.33 Hz (D5) -> Tone 2: 880 Hz (A5)
 */
export function playMessageSound() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // First tone (D5 - 587.33 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.2, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.26);

    // Second tone (A5 - 880.00 Hz, slightly louder & brighter)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.0, now + 0.12);
    gain2.gain.setValueAtTime(0, now + 0.12);
    gain2.gain.linearRampToValueAtTime(0.25, now + 0.14);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.46);
  } catch (err) {
    console.warn('[NotificationSound] Audio play failed:', err.message);
  }
}

/**
 * Reminder bell: 3 nốt chuông dần cao (E5 -> A5 -> C#6, sóng triangle) rồi
 * lặp nốt cao 1 lần nữa — khác hẳn chime 2 nốt tin nhắn để agent không bao
 * giờ lầm "tin mới" với "đến giờ nhắc". Mỗi lượt chơi 2 cụm liên tiếp cách
 * 0.9s với gain 0.4 cho đủ to, rõ.
 */
export function playReminderSound() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const tones = [
      { freq: 659.25, at: 0 },
      { freq: 880.0, at: 0.16 },
      { freq: 1108.73, at: 0.32 },
      { freq: 1108.73, at: 0.64 }
    ];
    for (const phraseOffset of [0, 0.9]) {
      for (const tone of tones) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(tone.freq, now + phraseOffset + tone.at);
        gain.gain.setValueAtTime(0, now + phraseOffset + tone.at);
        gain.gain.linearRampToValueAtTime(0.4, now + phraseOffset + tone.at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + phraseOffset + tone.at + 0.32);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + phraseOffset + tone.at);
        osc.stop(now + phraseOffset + tone.at + 0.34);
      }
    }
  } catch (err) {
    console.warn('[NotificationSound] Reminder bell failed:', err.message);
  }
}

export function isSoundEnabled() {
  return soundEnabled;
}

export function setSoundEnabled(enabled) {
  soundEnabled = Boolean(enabled);
  try {
    localStorage.setItem('crm_sound_enabled', String(soundEnabled));
  } catch (_) {}
}
