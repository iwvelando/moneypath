import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

/** Where the panel sits relative to its button when there is room. */
const PANEL_OFFSET = -8;
/** Smallest gap kept between the panel and either edge of the viewport. */
const VIEWPORT_MARGIN = 8;

interface HelpTipProps {
  /** Id the described control points at via aria-describedby. */
  id: string;
  label: string;
  text: string;
}

/**
 * Help affordance for a field: spec/06 requires every field to explain its
 * semantics, in the words of chapter 03 where that chapter defines them.
 *
 * The help text is always in the accessibility tree — the described control
 * references it with aria-describedby — and the button toggles its visual
 * presentation for sighted users.
 */
export function HelpTip({ id, label, text }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLSpanElement | null>(null);
  const panel = useRef<HTMLSpanElement | null>(null);

  // The button can sit anywhere in a row, so the panel is kept inside the
  // viewport by sliding it sideways from its usual spot under the button.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const anchor = container.current;
      const tip = panel.current;
      if (!anchor || !tip) return;
      const anchorLeft = anchor.getBoundingClientRect().left;
      const viewport = document.documentElement.clientWidth;
      const furthestRight = viewport - VIEWPORT_MARGIN - tip.offsetWidth;
      const left = Math.max(VIEWPORT_MARGIN, Math.min(anchorLeft + PANEL_OFFSET, furthestRight));
      tip.style.setProperty('--helptip-left', `${left - anchorLeft}px`);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (container.current && !container.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <span class="helptip" ref={container}>
      <button
        type="button"
        class="helptip__button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Help: ${label}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">?</span>
      </button>
      <span id={id} ref={panel} role="tooltip" class={open ? 'helptip__text' : 'helptip__text is-collapsed'}>
        {text}
      </span>
    </span>
  );
}
