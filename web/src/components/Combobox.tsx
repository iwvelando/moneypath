import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { Help } from '../config/help';
import { FieldShell } from './fields';

export interface ComboboxOption {
  value: string;
  label: string;
  /** A short note beside the name, such as the kind of thing it is. */
  detail?: string;
  /** Why this option cannot be picked. It is still listed, with the reason. */
  unavailable?: string | null;
}

interface ComboboxProps {
  label: string;
  help: Help;
  placeholder: string;
  /** Said in the list when the typed letters match nothing. */
  emptyMessage: string;
  options: readonly ComboboxOption[];
  /** The picked option's value, or '' when nothing is picked. */
  value: string;
  onChange: (value: string) => void;
}

/**
 * A text box that searches a list: typing narrows the options to those whose
 * name contains the letters, so a long list need not be read through. The box
 * keeps focus throughout; the arrow keys and Enter pick from the keyboard.
 */
export function Combobox({ label, help, placeholder, emptyMessage, options, value, onChange }: ComboboxProps) {
  const base = useId();
  const controlId = `${base}-input`;
  const helpId = `${base}-help`;
  const listId = `${base}-list`;
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // What has been typed since the box was opened; null while it shows the pick.
  const [query, setQuery] = useState<string | null>(null);
  const [activeValue, setActiveValue] = useState<string | null>(null);

  const selected = options.find((option) => option.value === value);
  const needle = (query ?? '').trim().toLowerCase();
  const matches = needle === '' ? options : options.filter((option) => option.label.toLowerCase().includes(needle));
  const pickable = matches.filter((option) => !option.unavailable);
  const active = pickable.find((option) => option.value === activeValue) ?? pickable[0] ?? null;
  const optionId = (option: ComboboxOption) => `${listId}-${options.indexOf(option)}`;

  const close = () => {
    setOpen(false);
    setQuery(null);
    setActiveValue(null);
  };

  const pick = (option: ComboboxOption) => {
    if (option.unavailable) return;
    onChange(option.value);
    close();
  };

  const step = (direction: 1 | -1) => {
    if (pickable.length === 0) return;
    const at = active ? pickable.indexOf(active) : -1;
    const next = pickable[(at + direction + pickable.length) % pickable.length]!;
    setActiveValue(next.value);
  };

  // A press anywhere else closes the list. Focus leaving is not enough to go
  // by: Safari reports no destination when an option is tapped.
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  const activeId = open && active ? optionId(active) : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  return (
    <FieldShell label={label} help={help} controlId={controlId} helpId={helpId}>
      <div
        class="combobox"
        ref={root}
        onFocusOut={(event) => {
          const next = event.relatedTarget as Node | null;
          if (next && !event.currentTarget.contains(next)) close();
        }}
      >
        <input
          id={controlId}
          class="input combobox__input"
          type="text"
          role="combobox"
          autoComplete="off"
          autoCapitalize="off"
          spellcheck={false}
          aria-autocomplete="list"
          aria-expanded={open ? 'true' : 'false'}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={activeId}
          aria-describedby={helpId}
          placeholder={placeholder}
          value={query ?? selected?.label ?? ''}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onInput={(event) => {
            setQuery((event.currentTarget as HTMLInputElement).value);
            setActiveValue(null);
            setOpen(true);
            // The name no longer says what was picked, so nothing is.
            if (value !== '') onChange('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (!open) setOpen(true);
              else step(event.key === 'ArrowDown' ? 1 : -1);
            } else if (event.key === 'Enter') {
              if (!open || !active) return;
              event.preventDefault();
              pick(active);
            } else if (event.key === 'Escape') {
              if (!open) return;
              event.preventDefault();
              // Leave Escape to this list alone, not to whatever encloses it.
              event.stopPropagation();
              close();
            }
          }}
        />
        {open ? (
          <ul
            class="combobox__list"
            id={listId}
            role="listbox"
            aria-label={label}
            // Pressing an option must not take focus out of the box.
            onMouseDown={(event) => event.preventDefault()}
          >
            {matches.length === 0 ? (
              <li class="combobox__empty" role="presentation">
                {emptyMessage}
              </li>
            ) : (
              matches.map((option) => (
                <li
                  key={option.value}
                  id={optionId(option)}
                  role="option"
                  class={`combobox__option${option === active ? ' is-active' : ''}`}
                  aria-selected={option.value === value ? 'true' : 'false'}
                  aria-disabled={option.unavailable ? 'true' : undefined}
                  onClick={() => pick(option)}
                >
                  <span class="combobox__main">
                    <span class="combobox__name">{option.label}</span>
                    {option.detail ? <span class="combobox__detail">{option.detail}</span> : null}
                  </span>
                  {option.unavailable ? <span class="combobox__reason">{option.unavailable}</span> : null}
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </FieldShell>
  );
}
