import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { EditorSummary } from './summaries';

export interface EditorCardState {
  open: boolean;
  autoFocus: boolean;
  onOpenChange: (open: boolean) => void;
}

export function useEditorCards(items: { id: string }[]) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [focusId, setFocusId] = useState<string | null>(null);
  const setOpen = (id: string, open: boolean) => setExpanded((current) => ({ ...current, [id]: open }));
  const allOpen = items.length > 0 && items.every((item) => expanded[item.id]);
  return {
    cardProps: (id: string): EditorCardState => ({
      open: expanded[id] ?? false,
      autoFocus: focusId === id,
      onOpenChange: (open) => setOpen(id, open),
    }),
    openNew: (id: string) => { setOpen(id, true); setFocusId(id); },
    toggleAll: items.length ? (
      <button type="button" class="btn btn--quiet" onClick={() => {
        setExpanded(Object.fromEntries(items.map((item) => [item.id, !allOpen])));
      }}>
        {allOpen ? 'Collapse all' : 'Expand all'}
      </button>
    ) : null,
  };
}

interface EditorCardProps extends EditorCardState {
  id: string;
  title: string;
  summary: EditorSummary;
  badge?: string;
  actions: ComponentChildren;
  children: ComponentChildren;
}

export function EditorCard({ id, title, summary, badge, actions, children, open, autoFocus, onOpenChange }: EditorCardProps) {
  const root = useRef<HTMLLIElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const bodyId = `${id}-fields`;
  const description = `${id}-summary ${id}-detail${summary.attention ? ` ${id}-attention` : ''}`;
  useLayoutEffect(() => {
    if (!autoFocus) return;
    root.current?.scrollIntoView?.({ block: 'start' });
    root.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, [autoFocus]);

  useLayoutEffect(() => {
    const element = root.current;
    const reveal = () => onOpenChange(true);
    element?.addEventListener('editor:reveal', reveal);
    return () => element?.removeEventListener('editor:reveal', reveal);
  }, [onOpenChange]);

  return (
    <li class={`row-card editor-card${open ? ' is-open' : ''}`} id={id} ref={root} tabIndex={-1}>
      <h5 class="editor-card__heading">
        <button type="button" class="editor-card__toggle" ref={toggle}
          aria-expanded={open} aria-controls={bodyId} aria-describedby={description} aria-label={`${open ? 'Collapse' : 'Edit'} ${title}`}
          onClick={() => onOpenChange(!open)}>
          <span class="editor-card__overview">
            <span class="editor-card__title">{title}</span>
            <span class="editor-card__summary" id={`${id}-summary`}>{summary.primary}</span>
            <span class="editor-card__detail" id={`${id}-detail`}>{summary.detail}</span>
            {summary.attention ? <span class="editor-card__notice" id={`${id}-attention`}>Check details</span> : null}
            {badge ? <span class="editor-card__badge">{badge}</span> : null}
          </span>
          <span class="editor-card__affordance" aria-hidden="true">
            {open ? 'Collapse' : 'Edit'}<span class="editor-card__chevron" />
          </span>
        </button>
      </h5>
      {/* Keep fields mounted so collapsing never discards a field's draft. */}
      <div class="editor-card__body" id={bodyId} hidden={!open}>
        <div class="row-card__actions editor-card__actions">{actions}</div>
        {children}
        <div class="editor-card__footer">
          <button type="button" class="btn btn--quiet" onClick={() => {
            onOpenChange(false);
            toggle.current?.focus({ preventScroll: true });
            const top = root.current?.getBoundingClientRect().top ?? 0;
            const barBottom = root.current?.closest('.workspace')?.querySelector('.workbar')?.getBoundingClientRect().bottom ?? 0;
            if (top < barBottom + 12) root.current?.scrollIntoView?.({ block: 'start' });
          }}>Collapse details</button>
        </div>
      </div>
    </li>
  );
}

export function EditorFields({ title, children }: { title: string; children: ComponentChildren }) {
  return <fieldset class="editor-fields"><legend>{title}</legend>{children}</fieldset>;
}
