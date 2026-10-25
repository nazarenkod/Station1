import {animate, motion, useMotionValue, useTransform} from 'motion/react';
import {useEffect, useId, useState} from 'react';

import {scoreTone} from './a11y-ui.js';

import styles from './A11yTab.module.css';

const SIZE = 84;
const STROKE = 8;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const TONE_STOPS = {
  good: ['#22C55E', '#22D3EE'],
  fair: ['#F59E0B', '#F97316'],
  poor: ['#F43F5E', '#A855F7'],
};

/**
 * The screen's score as a ring that sweeps and counts up to its value.
 */
const ScoreRing = ({score, label}) => {
  const gradientId = useId();
  const progress = useMotionValue(0);
  const dashOffset = useTransform(progress, (value) => CIRCUMFERENCE * (1 - value / 100));
  const [shown, setShown] = useState(0);
  const [from, to] = TONE_STOPS[scoreTone(score)];

  useEffect(() => {
    const controls = animate(progress, score, {
      duration: 1.1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (value) => setShown(Math.round(value)),
    });
    return () => controls.stop();
  }, [score, progress]);

  return (
    <div className={styles.scoreRing} aria-label={`${label}: ${score}`}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={from} />
            <stop offset="1" stopColor={to} />
          </linearGradient>
        </defs>
        <circle className={styles.scoreTrack} cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} strokeWidth={STROKE} fill="none" />
        <motion.circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          style={{strokeDashoffset: dashOffset, rotate: -90, transformOrigin: '50% 50%'}}
        />
      </svg>
      <div className={styles.scoreValue}>
        <span className={styles.scoreNumber}>{shown}</span>
        <span className={styles.scoreLabel}>{label}</span>
      </div>
    </div>
  );
};

export default ScoreRing;
