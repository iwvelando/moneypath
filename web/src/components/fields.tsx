import type { ComponentChildren } from 'preact';
import { useEffect, useId, useState } from 'preact/hooks';
import { HelpTip } from './HelpTip';
import { monthIsError, monthMessage } from '../config/month';
import { sanitizeNumberInput } from '../util/number';

interface FieldShellProps {
  label: string;
  help: string;
  controlId: string;
  helpId: string;
  message?: string | null;
  messageId?: string;
  tone?: 'error' | 'hint';
  children: ComponentChildren;
  wide?: boolean;
}

function FieldShell({
  label,
  help,
  controlId,
  helpId,
  message,
  messageId,
  tone = 'hint',
  children,
  wide,
}: FieldShellProps) {
  return (
    <div class={wide ? 'field field--wide' : 'field'}>
      <div class="field__label">
        <label for={controlId}>{label}</label>
        <HelpTip id={helpId} label={label} text={help} />
      </div>
      {children}
      {message ? (
        <p id={messageId} class={tone === 'error' ? 'field__message is-error' : 'field__message'}>
          {message}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface TextFieldProps {
  label: string;
  help: string;
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  wide?: boolean;
}

export function TextField({ label, help, value, onInput, placeholder, required, wide }: TextFieldProps) {
  const base = useId();
  const controlId = `${base}-input`;
  const helpId = `${base}-help`;
  const messageId = `${base}-msg`;
  const missing = required === true && value.trim() === '';
  return (
    <FieldShell
      label={label}
      help={help}
      controlId={controlId}
      helpId={helpId}
      messageId={messageId}
      message={missing ? 'This field is required.' : null}
      tone="error"
      wide={wide}
    >
      <input
        id={controlId}
        class={missing ? 'input is-invalid' : 'input'}
        type="text"
        value={value}
        placeholder={placeholder}
        aria-describedby={missing ? `${helpId} ${messageId}` : helpId}
        aria-invalid={missing || undefined}
        onInput={(event) => onInput((event.currentTarget as HTMLInputElement).value)}
      />
    </FieldShell>
  );
}

/* ------------------------------------------------------------------ */

interface NumberFieldProps {
  label: string;
  help: string;
  value: number | null;
  onChange: (value: number | null) => void;
  /** Arrow-key step; a modifier multiplies it by `modifierMultiplier`. */
  step?: number;
  modifierMultiplier?: number;
  placeholder?: string;
  suffix?: string;
}

function roundStep(value: number, step: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 2);
  return Number(value.toFixed(Math.min(10, decimals)));
}

/**
 * A numeric field that keeps a text draft so half-typed values ("-", "1.")
 * survive, and supports arrow-key stepping — Shift or Alt take bigger steps.
 */
export function NumberField({
  label,
  help,
  value,
  onChange,
  step = 1,
  modifierMultiplier = 10,
  placeholder,
  suffix,
}: NumberFieldProps) {
  const base = useId();
  const controlId = `${base}-input`;
  const helpId = `${base}-help`;
  const messageId = `${base}-msg`;

  const [draft, setDraft] = useState(value === null ? '' : String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value === null ? '' : String(value));
  }, [value, focused]);

  const invalid = draft.trim() !== '' && !Number.isFinite(Number(draft));

  const commit = (raw: string) => {
    setDraft(raw);
    if (raw.trim() === '') {
      onChange(null);
      return;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) onChange(parsed);
  };

  const nudge = (direction: 1 | -1, event: KeyboardEvent) => {
    const magnitude = event.shiftKey || event.altKey ? step * modifierMultiplier : step;
    const current = Number.isFinite(Number(draft)) && draft.trim() !== '' ? Number(draft) : (value ?? 0);
    const next = roundStep(current + direction * magnitude, magnitude);
    setDraft(String(next));
    onChange(next);
  };

  return (
    <FieldShell
      label={label}
      help={help}
      controlId={controlId}
      helpId={helpId}
      messageId={messageId}
      message={invalid ? 'Enter a number.' : null}
      tone="error"
    >
      <div class="input-row">
        <input
          id={controlId}
          class={invalid ? 'input is-invalid' : 'input'}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={draft}
          placeholder={placeholder}
          aria-describedby={invalid ? `${helpId} ${messageId}` : helpId}
          aria-invalid={invalid || undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setDraft(value === null ? '' : String(value));
          }}
          onInput={(event) => {
            // Pasted values often carry "$", commas or spaces — keep only the
            // number. Sync the DOM directly: when the sanitized text equals
            // the previous draft, no re-render would clean the input up.
            const element = event.currentTarget as HTMLInputElement;
            const raw = sanitizeNumberInput(element.value);
            if (element.value !== raw) element.value = raw;
            commit(raw);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              nudge(1, event);
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              nudge(-1, event);
            }
          }}
        />
        {suffix ? <span class="input-suffix" aria-hidden="true">{suffix}</span> : null}
      </div>
    </FieldShell>
  );
}

/* ------------------------------------------------------------------ */

interface MonthFieldProps {
  label: string;
  help: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
}

/** A `YYYY-MM` field validated as you type. */
export function MonthField({ label, help, value, onChange, required, placeholder }: MonthFieldProps) {
  const base = useId();
  const controlId = `${base}-input`;
  const helpId = `${base}-help`;
  const messageId = `${base}-msg`;

  const message = monthMessage(value, { required: required === true });
  const invalid = monthIsError(value, { required: required === true });

  return (
    <FieldShell
      label={label}
      help={help}
      controlId={controlId}
      helpId={helpId}
      messageId={messageId}
      message={message}
      tone={invalid ? 'error' : 'hint'}
    >
      <input
        id={controlId}
        class={invalid ? 'input is-invalid' : 'input'}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellcheck={false}
        maxLength={7}
        value={value}
        placeholder={placeholder ?? 'YYYY-MM'}
        aria-describedby={message ? `${helpId} ${messageId}` : helpId}
        aria-invalid={invalid || undefined}
        onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value.trim())}
      />
    </FieldShell>
  );
}

/* ------------------------------------------------------------------ */

interface CheckFieldProps {
  label: string;
  help: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function CheckField({ label, help, checked, onChange }: CheckFieldProps) {
  const base = useId();
  const controlId = `${base}-input`;
  const helpId = `${base}-help`;
  return (
    <div class="field field--check">
      <div class="check-row">
        <input
          id={controlId}
          type="checkbox"
          checked={checked}
          aria-describedby={helpId}
          onChange={(event) => onChange((event.currentTarget as HTMLInputElement).checked)}
        />
        <label for={controlId}>{label}</label>
        <HelpTip id={helpId} label={label} text={help} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface SelectFieldProps<T extends string> {
  label: string;
  help: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function SelectField<T extends string>({
  label,
  help,
  value,
  options,
  onChange,
}: SelectFieldProps<T>) {
  const base = useId();
  const controlId = `${base}-input`;
  const helpId = `${base}-help`;
  return (
    <FieldShell label={label} help={help} controlId={controlId} helpId={helpId}>
      <select
        id={controlId}
        class="input"
        value={value}
        aria-describedby={helpId}
        onChange={(event) => onChange((event.currentTarget as HTMLSelectElement).value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
