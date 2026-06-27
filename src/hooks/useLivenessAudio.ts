'use client';

import { useCallback, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TonePreset = 'pass' | 'fail' | 'complete' | 'timeout' | 'start';

// ---------------------------------------------------------------------------
// Tone definitions
// Each tone is a sequence of { frequency, duration, volume } segments played
// back-to-back through the Web Audio API — zero asset dependencies.
// ---------------------------------------------------------------------------

interface ToneSegment {
  frequency: number;
  duration: number; // seconds
  volume: number;   // 0–1
  type?: OscillatorType;
}

const TONES: Record<TonePreset, ToneSegment[]> = {
  // Soft ascending two-note chime — challenge passed
  pass: [
    { frequency: 523.25, duration: 0.1, volume: 0.25, type: 'sine' }, // C5
    { frequency: 783.99, duration: 0.18, volume: 0.2,  type: 'sine' }, // G5
  ],
  // Gentle low single tone — challenge timed out
  timeout: [
    { frequency: 220, duration: 0.22, volume: 0.18, type: 'sine' },
  ],
  // Slightly sharper version of timeout for explicit fail
  fail: [
    { frequency: 261.63, duration: 0.12, volume: 0.2, type: 'sine' }, // C4
    { frequency: 196,    duration: 0.22, volume: 0.18, type: 'sine' }, // G3
  ],
  // Ascending three-note resolution — session complete
  complete: [
    { frequency: 523.25, duration: 0.1,  volume: 0.22, type: 'sine' }, // C5
    { frequency: 659.25, duration: 0.1,  volume: 0.22, type: 'sine' }, // E5
    { frequency: 783.99, duration: 0.22, volume: 0.2,  type: 'sine' }, // G5
  ],
  // Subtle soft ping — session starting
  start: [
    { frequency: 440, duration: 0.12, volume: 0.15, type: 'sine' }, // A4
  ],
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLivenessAudio() {
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Lazily create the AudioContext on first use to satisfy browser autoplay
  // policies (must be triggered from a user gesture).
  function getCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext();
    }
    // Resume in case it was suspended
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }

  // ---------------------------------------------------------------------------
  // playTone — schedules a sequence of oscillator segments
  // ---------------------------------------------------------------------------
  const playTone = useCallback((preset: TonePreset) => {
    try {
      const ctx = getCtx();
      const segments = TONES[preset];
      let startTime = ctx.currentTime + 0.01; // tiny offset avoids click

      for (const seg of segments) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = seg.type ?? 'sine';
        osc.frequency.setValueAtTime(seg.frequency, startTime);

        // Smooth attack/decay envelope to avoid clicks
        const attack = 0.01;
        const decay  = 0.06;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(seg.volume, startTime + attack);
        gain.gain.setValueAtTime(seg.volume, startTime + seg.duration - decay);
        gain.gain.linearRampToValueAtTime(0, startTime + seg.duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + seg.duration);

        startTime += seg.duration;
      }
    } catch (err) {
      // Audio is non-critical; swallow errors silently
      console.warn('[useLivenessAudio] playTone error:', err);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // speak — Web Speech API for voiced challenge instructions
  // Falls back silently if the API is unavailable (e.g. some mobile browsers).
  // ---------------------------------------------------------------------------
  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    // Cancel any in-progress speech before starting new instruction
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate   = 0.95; // slightly slower than default for clarity
    utterance.pitch  = 1.0;
    utterance.volume = 0.9;

    // Prefer an English voice if available
    const voices = window.speechSynthesis.getVoices();
    const englishVoice = voices.find(
      (v) => v.lang.startsWith('en') && !v.name.toLowerCase().includes('novelty')
    );
    if (englishVoice) utterance.voice = englishVoice;

    window.speechSynthesis.speak(utterance);
  }, []);

  // ---------------------------------------------------------------------------
  // Convenience methods called from LivenessCheck
  // ---------------------------------------------------------------------------

  /** Called when a new challenge starts — plays a soft ping then speaks the instruction. */
  const announceChallenge = useCallback((instruction: string) => {
    playTone('start');
    // Small delay so the tone finishes before speech begins
    setTimeout(() => speak(instruction), 200);
  }, [playTone, speak]);

  /** Called when a challenge is passed. */
  const announcePass = useCallback(() => {
    window.speechSynthesis?.cancel(); // stop instruction mid-speech if still going
    playTone('pass');
  }, [playTone]);

  /** Called when a challenge times out. */
  const announceTimeout = useCallback(() => {
    window.speechSynthesis?.cancel();
    playTone('timeout');
  }, [playTone]);

  /** Called when the whole session completes successfully. */
  const announceComplete = useCallback(() => {
    playTone('complete');
    setTimeout(() => speak('Verification complete. Well done!'), 350);
  }, [playTone, speak]);

  /** Called when the session fails overall. */
  const announceFail = useCallback(() => {
    playTone('fail');
    setTimeout(() => speak('Verification failed. Please try again.'), 300);
  }, [playTone, speak]);

  /** Stop all audio — call on reset or unmount. */
  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  return {
    announceChallenge,
    announcePass,
    announceTimeout,
    announceComplete,
    announceFail,
    stop,
  };
}