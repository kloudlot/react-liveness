'use client';

import { useCallback, useRef } from 'react';
import { UseLivenessAudioReturn } from '../types';

type TonePreset = 'pass' | 'fail' | 'complete' | 'timeout' | 'start';

interface ToneSegment {
  frequency: number;
  duration: number;
  volume: number;
  type?: OscillatorType;
}

const TONES: Record<TonePreset, ToneSegment[]> = {
  start:    [{ frequency: 440,    duration: 0.12, volume: 0.15, type: 'sine' }],
  pass:     [{ frequency: 523.25, duration: 0.1,  volume: 0.25, type: 'sine' },
             { frequency: 783.99, duration: 0.18, volume: 0.2,  type: 'sine' }],
  timeout:  [{ frequency: 220,    duration: 0.22, volume: 0.18, type: 'sine' }],
  fail:     [{ frequency: 261.63, duration: 0.12, volume: 0.2,  type: 'sine' },
             { frequency: 196,    duration: 0.22, volume: 0.18, type: 'sine' }],
  complete: [{ frequency: 523.25, duration: 0.1,  volume: 0.22, type: 'sine' },
             { frequency: 659.25, duration: 0.1,  volume: 0.22, type: 'sine' },
             { frequency: 783.99, duration: 0.22, volume: 0.2,  type: 'sine' }],
};

export function useLivenessAudio(muted = false): UseLivenessAudioReturn {
  const audioCtxRef = useRef<AudioContext | null>(null);

  function getCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }

  const playTone = useCallback((preset: TonePreset) => {
    if (muted) return;
    try {
      const ctx      = getCtx();
      const segments = TONES[preset];
      let startTime  = ctx.currentTime + 0.01;

      for (const seg of segments) {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = seg.type ?? 'sine';
        osc.frequency.setValueAtTime(seg.frequency, startTime);

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
      console.warn('[useLivenessAudio] playTone error:', err);
    }
  }, [muted]);

  const speak = useCallback((text: string) => {
    if (muted || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance  = new SpeechSynthesisUtterance(text);
    utterance.rate   = 0.95;
    utterance.pitch  = 1.0;
    utterance.volume = 0.9;
    const voices     = window.speechSynthesis.getVoices();
    const eng        = voices.find(
      (v) => v.lang.startsWith('en') && !v.name.toLowerCase().includes('novelty')
    );
    if (eng) utterance.voice = eng;
    window.speechSynthesis.speak(utterance);
  }, [muted]);

  const announceChallenge = useCallback((instruction: string) => {
    playTone('start');
    setTimeout(() => speak(instruction), 200);
  }, [playTone, speak]);

  const announcePass = useCallback(() => {
    window.speechSynthesis?.cancel();
    playTone('pass');
  }, [playTone]);

  const announceTimeout = useCallback(() => {
    window.speechSynthesis?.cancel();
    playTone('timeout');
  }, [playTone]);

  const announceComplete = useCallback(() => {
    playTone('complete');
    setTimeout(() => speak('Verification complete. Well done!'), 350);
  }, [playTone, speak]);

  const announceFail = useCallback(() => {
    playTone('fail');
    setTimeout(() => speak('Verification failed. Please try again.'), 300);
  }, [playTone, speak]);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  return { announceChallenge, announcePass, announceTimeout, announceComplete, announceFail, stop };
}