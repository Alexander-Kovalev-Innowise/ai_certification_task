// "PRACTICE" over "PERFECT" - the stacked product name, accent on the second word.
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-display text-[15px] font-extrabold uppercase leading-[1.05] tracking-[0.04em] ${className}`.trim()}>
      <span className="block text-ink">Practice</span>
      <span className="block text-brand-primary">Perfect</span>
    </span>
  );
}
