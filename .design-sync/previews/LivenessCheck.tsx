import React from 'react';
import { LivenessCheck } from '@kloudlot/react-liveness';

export function Default() {
  return <LivenessCheck brandLabel="Attest" orgLabel="Marham HQ" />;
}

export function BrandTheme() {
  return (
    <LivenessCheck
      brandLabel="Kloudlot"
      orgLabel="Lagos HQ"
      theme={{
        primary: '#7c5cff',
        danger: '#ff6b6b',
      }}
    />
  );
}

export function CustomChallengeCount() {
  return (
    <LivenessCheck
      brandLabel="Attest"
      orgLabel="Marham HQ"
      numberOfChallenge={4}
    />
  );
}
