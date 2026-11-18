import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { isTiered, type Help } from '../config/help';

/** Where the panel sits relative to its button when there is room. */
const PANEL_OFFSET = -8;
/** Smallest gap kept between the panel and either edge of the viewport. */
const VIEWPORT_MARGIN = 8;

interface HelpTipProps {
  /** Id the described control points at via aria-describedby: the brief. */
  id: string;
  label: string;
  help: Help;
}

/**
 * Help affordance for a field: spec/06 requires every field to explain its
 * semantics, in the words of chapter 03 where that chapter defines them.
 *
 * The help opens on its brief. A tiered help offers the rest behind Show more,
 * and folds it away again whenever the help closes, so it always reopens on
 * the brief.
 *
 * The brief is always in the accessibility tree — the described control
 * references it with aria-describedby — and the button toggles its visual
 * presentation for sighted users. Show more exists only while the help is
 * open, so a closed help adds nothing to the tab order.
 */
export function HelpTip({ id, label, help }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const container = useRef<HTMLSpanElement | null>(null);
  const panel = useRef<HTMLSpanElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const panelId = `${id}-panel`;
  const moreId = `${id}-more`;

  const close = () => {
    setOpen(false);
    setMore(false);
  };

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
      if (event.key !== 'Escape') return;
      // Show more goes away with the panel, so focus on it would be lost.
      // Escape is a key, so the ring that follows is the one a keyboard
      // reader expects.
      if (panel.current?.contains(document.activeElement)) button.current?.focus();
      close();
    };
    const onClick = (event: MouseEvent) => {
      if (container.current && !container.current.contains(event.target as Node)) close();
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
        ref={button}
        type="button"
        class="helptip__button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Help: ${label}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span aria-hidden="true">?</span>
      </button>
      <span id={panelId} ref={panel} class={open ? 'helptip__text' : 'helptip__text is-collapsed'}>
        <span id={id}>{isTiered(help) ? help.brief : help}</span>
        {isTiered(help) && open ? (
          <>
            {' '}
            <button
              type="button"
              class="helptip__more"
              aria-expanded={more}
              aria-controls={moreId}
              onClick={() => setMore((value) => !value)}
            >
              {more ? 'Show less' : 'Show more'}
            </button>
            <span id={moreId} class="helptip__more-text" hidden={!more}>
              {help.more}
            </span>
          </>
        ) : null}
      </span>
    </span>
  );
}
