'use client';

import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type PointerEvent as ReactPointerEvent } from 'react';

const MIN_THUMB = 28;
const TRACK_PAD = 4;

interface Thumb {
  length: number;
  offset: number;
  // scrollable distance / free track distance - converts thumb px to scroll px
  ratio: number;
}

interface Metrics {
  vertical: Thumb | null;
  horizontal: Thumb | null;
}

function measure(el: HTMLElement, insetTop: number): Metrics {
  const { scrollTop, scrollLeft, scrollHeight, scrollWidth, clientHeight, clientWidth } = el;

  const vRange = scrollHeight - clientHeight;
  const vTrack = clientHeight - insetTop - TRACK_PAD * 2;
  let vertical: Thumb | null = null;
  if (vRange > 1 && vTrack > MIN_THUMB) {
    const length = Math.max(MIN_THUMB, (vTrack * clientHeight) / scrollHeight);
    const free = vTrack - length;
    vertical = { length, offset: insetTop + TRACK_PAD + (scrollTop / vRange) * free, ratio: free > 0 ? vRange / free : 0 };
  }

  const hRange = scrollWidth - clientWidth;
  const hTrack = clientWidth - TRACK_PAD * 2 - (vertical ? 10 : 0);
  let horizontal: Thumb | null = null;
  if (hRange > 1 && hTrack > MIN_THUMB) {
    const length = Math.max(MIN_THUMB, (hTrack * clientWidth) / scrollWidth);
    const free = hTrack - length;
    horizontal = { length, offset: TRACK_PAD + (scrollLeft / hRange) * free, ratio: free > 0 ? hRange / free : 0 };
  }

  return { vertical, horizontal };
}

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  /** Pixels at the top of the vertical track kept clear (e.g. a sticky header's height). */
  insetTop?: number;
}

// A scroll container whose scrollbars are drawn OVER the content instead of
// beside it: the native bars are hidden (`scroll-hide-native`), so a sticky
// header and the rows keep their full width. Props (role, aria-*, onScroll,
// className, ...) land on the scrolling viewport itself. The thumb is faint,
// brightens while the area is hovered, and turns accent-coloured under the
// pointer / while dragged. Wheel, touch, keyboard and trackpad scrolling are
// untouched because the real scroller is still a normal overflow:auto element.
export function ScrollArea({ insetTop = 0, className = '', children, onScroll, ...viewportProps }: ScrollAreaProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<Metrics>({ vertical: null, horizontal: null });
  const [dragging, setDragging] = useState<'vertical' | 'horizontal' | null>(null);

  const update = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const next = measure(el, insetTop);
    setMetrics((prev) =>
      prev.vertical?.length === next.vertical?.length &&
      prev.vertical?.offset === next.vertical?.offset &&
      prev.horizontal?.length === next.horizontal?.length &&
      prev.horizontal?.offset === next.horizontal?.offset
        ? prev
        : next,
    );
  }, [insetTop]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [update, children]);

  function startDrag(axis: 'vertical' | 'horizontal', event: ReactPointerEvent<HTMLDivElement>) {
    const el = viewportRef.current;
    const thumb = metrics[axis];
    if (!el || !thumb) return;
    event.preventDefault();
    event.stopPropagation();
    const startPointer = axis === 'vertical' ? event.clientY : event.clientX;
    const startScroll = axis === 'vertical' ? el.scrollTop : el.scrollLeft;
    setDragging(axis);

    const onMove = (move: PointerEvent) => {
      const delta = (axis === 'vertical' ? move.clientY : move.clientX) - startPointer;
      if (axis === 'vertical') el.scrollTop = startScroll + delta * thumb.ratio;
      else el.scrollLeft = startScroll + delta * thumb.ratio;
    };
    const onUp = () => {
      setDragging(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function jumpTo(axis: 'vertical' | 'horizontal', event: ReactPointerEvent<HTMLDivElement>) {
    const el = viewportRef.current;
    const thumb = metrics[axis];
    if (!el || !thumb) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const pointer = axis === 'vertical' ? event.clientY - rect.top : event.clientX - rect.left;
    const target = (pointer - thumb.length / 2 - (axis === 'vertical' ? insetTop + TRACK_PAD : TRACK_PAD)) * thumb.ratio;
    if (axis === 'vertical') el.scrollTop = target;
    else el.scrollLeft = target;
  }

  const thumbTone = (axis: 'vertical' | 'horizontal') =>
    dragging === axis ? 'bg-brand-primary' : 'bg-ink/20 group-hover/scroll:bg-ink/40 group-hover/thumb:bg-brand-primary';

  return (
    <div className="group/scroll relative">
      <div
        {...viewportProps}
        ref={viewportRef}
        onScroll={(event) => {
          update();
          onScroll?.(event);
        }}
        className={`scroll-hide-native ${className}`}
      >
        {children}
      </div>

      {metrics.vertical ? (
        <div
          aria-hidden="true"
          onPointerDown={(event) => jumpTo('vertical', event)}
          className="absolute bottom-0 right-0 top-0 z-20 w-[10px] cursor-default"
        >
          <div
            onPointerDown={(event) => startDrag('vertical', event)}
            style={{ top: metrics.vertical.offset, height: metrics.vertical.length }}
            className="group/thumb absolute right-[2px] w-[6px] cursor-default"
          >
            <div className={`h-full w-full rounded-pill transition-colors duration-150 ${thumbTone('vertical')}`} />
          </div>
        </div>
      ) : null}

      {metrics.horizontal ? (
        <div
          aria-hidden="true"
          onPointerDown={(event) => jumpTo('horizontal', event)}
          className="absolute bottom-0 left-0 right-0 z-20 h-[10px] cursor-default"
        >
          <div
            onPointerDown={(event) => startDrag('horizontal', event)}
            style={{ left: metrics.horizontal.offset, width: metrics.horizontal.length }}
            className="group/thumb absolute bottom-[2px] h-[6px] cursor-default"
          >
            <div className={`h-full w-full rounded-pill transition-colors duration-150 ${thumbTone('horizontal')}`} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
