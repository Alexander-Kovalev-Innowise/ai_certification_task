'use client';

import { motion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';

const STAGGER_SECONDS = 0.06;
const ITEM_DURATION_SECONDS = 0.22;

const shellVariants: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: STAGGER_SECONDS },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: ITEM_DURATION_SECONDS, ease: 'easeOut' } },
};

export interface BootRevealShellProps {
  children: ReactNode;
  className?: string;
}

/**
 * fe §1.3/Task 18.5 — "`/login` and `/join/[code]` reveal in one staggered
 * pass (logo → headline → form, 60ms stagger, 220ms ease-out) — the only
 * place a 'page load' animation exists; every authenticated dashboard route
 * renders instantly with skeletons instead (Task 18.4), because staggered
 * reveals on a screen someone hits 40x/day become friction, not delight."
 * Only these two routes import this component — it is deliberately NOT a
 * generic page-transition wrapper.
 *
 * `motion` (the npm package formerly Framer Motion) — pre-approved for this
 * exact task per `specs/frontend-design-spec.md` §1.3's tech-stack note
 * ("Motion library ... for React"); this is the one new dependency this
 * phase adds (`apps/client/package.json`).
 */
export function BootRevealShell({ children, className }: BootRevealShellProps) {
  return (
    <motion.div variants={shellVariants} initial="hidden" animate="show" className={className}>
      {children}
    </motion.div>
  );
}

export function BootRevealItem({ children }: { children: ReactNode }) {
  return <motion.div variants={itemVariants}>{children}</motion.div>;
}
