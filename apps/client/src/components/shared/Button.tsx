'use client';

import { motion, type HTMLMotionProps } from 'motion/react';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive';

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'className'> {
  variant?: ButtonVariant;
  className?: string;
}

// fe §1.4 — per-variant classes, verbatim from the component spec table:
// primary (gradient brand-primary -> brand-primary-deep, shadow-button-primary),
// secondary/ghost (transparent, border-soft, hover -> brand-primary),
// destructive (danger-based gradient, "never tenant-colored, for the same
// legibility-of-danger reason as the impersonation banner").
const VARIANT_CLASSNAME: Record<ButtonVariant, string> = {
  primary: 'btn btn-primary',
  secondary: 'btn btn-secondary',
  destructive: 'btn btn-danger',
};

// fe §1.3 — "-translate-y-1 scale-1.02 on hover ... spring-eased
// (stiffness: 400, damping: 28)". `y: -4` mirrors Tailwind's `-translate-y-1`
// (0.25rem = 4px at the default root font size).
const HOVER_TRANSFORM = { y: -4, scale: 1.02 };
const HOVER_TRANSITION = { type: 'spring', stiffness: 400, damping: 28 } as const;

/**
 * fe §1.4/Task 18.5 — the shared `Button` primitive the design spec's
 * component table describes but no prior phase built: every existing form
 * (LoginForm, ChangePasswordForm, ProfileEditForm, ...) hand-rolled its own
 * submit-button className instead. This task creates it and uses it in the
 * NEW/touched surfaces Task 18.5 itself modifies (ImpersonationBanner's Exit
 * button) — retrofitting every prior phase's existing button markup is out
 * of scope, the same boundary Task 18.3 drew for the toast system.
 */
export function Button({ variant = 'primary', className = '', type = 'button', disabled, ...props }: ButtonProps) {
  return (
    <motion.button
      type={type}
      disabled={disabled}
      whileHover={disabled ? undefined : HOVER_TRANSFORM}
      transition={HOVER_TRANSITION}
      className={`${VARIANT_CLASSNAME[variant]} ${className}`}
      {...props}
    />
  );
}
