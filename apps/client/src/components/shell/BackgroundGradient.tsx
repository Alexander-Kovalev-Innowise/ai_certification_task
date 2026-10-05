'use client';

import { MeshGradient } from '@paper-design/shaders-react';
import { useReducedMotion } from 'motion/react';
import { useMemo } from 'react';

import { darkenColor, lightenColor } from '../../lib/branding/color-transform';
import { useBrandAccentStore } from '../../stores/useBrandAccentStore';

import { useTheme } from './useTheme';

const DARK_BASE = '#0d0d0d';
const LIGHT_BASE = '#eaf0ea';

// Full-viewport animated mesh gradient behind the whole app (replaces the CSS
// radial gradients, which showed visible colour banding on near-black). The
// shader dithers with a faint grain, drifts very slowly, and follows both the
// light/dark theme and the current tenant's accent colour.
export function BackgroundGradient() {
  const [theme] = useTheme();
  const accent = useBrandAccentStore((state) => state.accentHex);
  const reduceMotion = useReducedMotion();

  const colors = useMemo(() => {
    if (theme === 'light') {
      return [LIGHT_BASE, lightenColor(accent, 82), LIGHT_BASE, lightenColor(accent, 72), LIGHT_BASE, lightenColor(accent, 78)];
    }
    return [DARK_BASE, darkenColor(accent, 68), DARK_BASE, darkenColor(accent, 50), DARK_BASE, darkenColor(accent, 60)];
  }, [theme, accent]);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <MeshGradient
        colors={colors}
        distortion={0.55}
        swirl={0.15}
        grainMixer={0}
        grainOverlay={theme === 'light' ? 0.02 : 0.035}
        speed={reduceMotion ? 0 : 0.1}
        scale={1.7}
        minPixelRatio={1}
        maxPixelCount={1_400_000}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
