import React from 'react';
import { LivenessCheck } from '@kloudlot/react-liveness';

export function Default() {
  return <LivenessCheck orgLabel="Marham HQ" />;
}

export function BrandTheme() {
  return (
    <LivenessCheck
      orgLabel="Marham HQ"
      theme={{
        primary: '#7c5cff',
        danger: '#ff6b6b',
      }}
    />
  );
}

export function CustomChallengeCount() {
  return <LivenessCheck orgLabel="Marham HQ" numberOfChallenge={2} />;
}
