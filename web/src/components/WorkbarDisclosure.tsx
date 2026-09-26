import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

interface WorkbarDisclosureProps {
  id: string;
  className: string;
  triggerClass: string;
  label: string;
  panelLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ComponentChildren;
}

/** A nonmodal disclosure: normal Tab order, outside dismissal, and Escape back to its trigger. */
export function WorkbarDisclosure({
  id, className, triggerClass, label, panelLabel, open, onOpenChange, children,
}: WorkbarDisclosureProps) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const element = panel.current;
    // CSS anchors to the trigger on desktop and the full workbar on phones.
    const place = () => {
      const anchor = element.offsetParent;
      if (!anchor) return;
      const bounds = anchor.getBoundingClientRect();
      const below = window.innerHeight - bounds.bottom - 12;
      const above = bounds.top - 12;
      const upward = below < Math.min(320, above);
      element.dataset.side = upward ? 'above' : 'below';
      element.style.setProperty('--panel-available-height', `${Math.max(0, upward ? above : below)}px`);
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (root.current) observer?.observe(root.current);
    const bar = root.current?.closest('.workbar');
    if (bar) observer?.observe(bar);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer?.disconnect();
    };
  }, [open]);

  // Install dismissal before paint so rapid keyboard input cannot outrun it.
  useLayoutEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onOpenChange(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [open, onOpenChange]);

  return (
    <div
      class={`workbar-disclosure ${className}`}
      ref={root}
      onFocusOut={(event) => {
        // Safari may clear focus before dispatching a click on a panel button.
        // Only dismiss for an actual focus destination outside the disclosure.
        if (open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) {
          onOpenChange(false);
        }
      }}
    >
      <button
        type="button"
        class={`btn workbar-disclosure__trigger ${triggerClass}`}
        ref={trigger}
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={id}
        onClick={() => onOpenChange(!open)}
      >
        {label}
        <span class="workbar-disclosure__chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div
          class={`workbar-disclosure__panel ${className}__panel`}
          ref={panel}
          id={id}
          role="group"
          aria-label={panelLabel}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
