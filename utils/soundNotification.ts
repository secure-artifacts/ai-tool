/**
 * Sound Notification Utility
 * 
 * Provides completion/error sound notifications using Web Audio API.
 * No external audio files needed — all sounds are synthesized.
 * 
 * Usage:
 *   import { playCompletionSound, playErrorSound } from '@/utils/soundNotification';
 *   // After a task finishes:
 *   playCompletionSound();
 */

const STORAGE_KEY = 'app_sound_enabled';

/** Check if sound notifications are enabled */
export function isSoundEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem(STORAGE_KEY);
    // Default: enabled
    return stored === null ? true : stored === 'true';
}

/** Set sound notification enabled/disabled */
export function setSoundEnabled(enabled: boolean): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, String(enabled));
}

/** Lazy-init a shared AudioContext (created on first use) */
let _audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!_audioCtx) {
        try {
            _audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        } catch {
            console.warn('[Sound] AudioContext not supported');
            return null;
        }
    }
    // Resume if suspended (browser autoplay policy)
    if (_audioCtx.state === 'suspended') {
        _audioCtx.resume().catch(() => {});
    }
    return _audioCtx;
}

/**
 * Play a pleasant "task complete" chime.
 * Two-note ascending tone — short and non-intrusive.
 */
export function playCompletionSound(): void {
    if (!isSoundEnabled()) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.25, now);
    masterGain.connect(ctx.destination);

    // Note 1: C5 (523 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523, now);
    gain1.gain.setValueAtTime(0.4, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc1.connect(gain1);
    gain1.connect(masterGain);
    osc1.start(now);
    osc1.stop(now + 0.15);

    // Note 2: E5 (659 Hz) — slightly delayed
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(659, now + 0.1);
    gain2.gain.setValueAtTime(0.01, now);
    gain2.gain.setValueAtTime(0.4, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc2.connect(gain2);
    gain2.connect(masterGain);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.3);

    // Note 3: G5 (784 Hz) — final upward resolution
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(784, now + 0.2);
    gain3.gain.setValueAtTime(0.01, now);
    gain3.gain.setValueAtTime(0.35, now + 0.2);
    gain3.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    osc3.connect(gain3);
    gain3.connect(masterGain);
    osc3.start(now + 0.2);
    osc3.stop(now + 0.5);

    // Cleanup
    setTimeout(() => {
        masterGain.disconnect();
    }, 600);
}

/**
 * Play an error/warning tone.
 * Two descending notes — clearly different from completion.
 */
export function playErrorSound(): void {
    if (!isSoundEnabled()) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.2, now);
    masterGain.connect(ctx.destination);

    // Note 1: A4 (440 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(440, now);
    gain1.gain.setValueAtTime(0.4, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    osc1.connect(gain1);
    gain1.connect(masterGain);
    osc1.start(now);
    osc1.stop(now + 0.2);

    // Note 2: F4 (349 Hz) — descending
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(349, now + 0.15);
    gain2.gain.setValueAtTime(0.01, now);
    gain2.gain.setValueAtTime(0.4, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
    osc2.connect(gain2);
    gain2.connect(masterGain);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.4);

    setTimeout(() => {
        masterGain.disconnect();
    }, 500);
}
