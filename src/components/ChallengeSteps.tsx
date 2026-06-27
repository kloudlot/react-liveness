'use client';

import { Challenge, ChallengeResult } from "../types";

// import { Challenge, ChallengeResult } from '@/types/liveness';
// import { CheckIcon } from 'lucide-react';

interface ChallengeStepsProps {
  challenges: Challenge[];
  currentIndex: number;
  results: ChallengeResult[];
  timeRemaining: number;
  totalTime: number;
}

export function ChallengeSteps({
  challenges,
  currentIndex,
  results,
  timeRemaining,
  totalTime,
}: ChallengeStepsProps) {
  const progress = (timeRemaining / totalTime) * 100;
  const progressColor = timeRemaining < totalTime * 0.3 ? '#f56565' : '#4299e1';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        width: '100%',
      }}
    >
      {/* Step indicators */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'center',
          width: '100%',
        }}
      >
        {challenges.map((challenge, i) => {
          const result = results[i];
          const isActive = i === currentIndex;
          const isPast = i < currentIndex;
          const passed = result?.passed;

          let bg = 'rgba(255,255,255,0.2)';
          let borderColor = 'rgba(255,255,255,0.3)';

          if (passed) {
            bg = '#48bb78';
            borderColor = '#68d391';
          } else if (isPast && !passed) {
            bg = '#f56565';
            borderColor = '#fc8181';
          } else if (isActive) {
            bg = '#4299e1';
            borderColor = '#63b3ed';
          }

          return (
            <div
              key={challenge.type}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                flex: 1,
                maxWidth: 80,
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: '50%',
                  background: bg,
                  border: `2px solid ${borderColor}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.3s',
                  boxShadow: isActive
                    ? '0 0 12px rgba(99,179,237,0.6)'
                    : 'none',
                }}
              >
                {passed ? (
                  <p color="white">passedicon</p>
                ) : (
                  <span
                    style={{
                      fontSize: 18,
                      lineHeight: 1,
                    }}
                  >
                    {challenge.icon}
                  </span>
                )}
              </div>

              <div
                style={{
                  fontSize: 9,
                  color: isActive
                    ? '#bee3f8'
                    : 'rgba(255,255,255,0.6)',
                  fontWeight: isActive ? 700 : 400,
                  textAlign: 'center',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              >
                {challenge.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Timer bar */}
      {currentIndex < challenges.length && (
        <div style={{ width: '100%' }}>
          <div
            style={{
              width: '100%',
              height: 8,
              background: 'rgba(255,255,255,0.2)',
              borderRadius: 9999,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: '100%',
                background: progressColor,
                transition: 'width 0.1s linear',
              }}
            />
          </div>

          <div
            style={{
              fontSize: 10,
              color: 'rgba(255,255,255,0.5)',
              marginTop: 4,
              textAlign: 'right',
            }}
          >
            {(timeRemaining / 1000).toFixed(1)}s
          </div>
        </div>
      )}
    </div>
  );
}