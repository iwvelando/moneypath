import { useEffect, useRef, useState } from 'preact/hooks';

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
      <span id={id} role="tooltip" class={open ? 'helptip__text' : 'helptip__text is-collapsed'}>
        {text}
      </span>
    </span>
  );
}
