import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useId, useState } from 'preact/hooks';
import { HelpTip } from './HelpTip';
import { formatMonthInput, monthIsError, monthMessage } from '../config/month';
import { sanitizeNumberInput } from '../util/number';

/**
 * The labels of the fields an option changes on a baseline entry, for the form
 * that shows the entry as it is on that path. A field with one of these labels
 * is marked as changed. Empty everywhere else.
 */
export const ChangedLabels = createContext<ReadonlySet<string>>(new Set());

function ChangedMark() {
  return <span class="field__changed">Changed</span>;
}

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

export function FieldShell({
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
  const changed = useContext(ChangedLabels).has(label);
  return (
    <div class={`field${wide ? ' field--wide' : ''}${changed ? ' is-changed' : ''}`}>
      <div class="field__label">
        <label for={controlId}>{label}</label>
        <HelpTip id={helpId} label={label} text={help} />
        {changed ? <ChangedMark /> : null}
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
  /**
   * The value can be negative. A phone is then asked for its full keyboard:
   * an iPhone's decimal keypad has no minus key.
   */
  signed?: boolean;
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
  signed = false,
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
          inputMode={signed ? 'text' : 'decimal'}
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

/**
 * A `YYYY-MM` field validated as you type. It asks a phone for the number
 * pad and puts the dash in itself, since that pad has none.
 */
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
        onInput={(event) => {
          // Sync the DOM directly, as the number field does: the formatted
          // text can equal the previous value, and then nothing re-renders.
          const element = event.currentTarget as HTMLInputElement;
          const formatted = formatMonthInput(element.value);
          if (element.value !== formatted) element.value = formatted;
          onChange(formatted);
        }}
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
  const changed = useContext(ChangedLabels).has(label);
  return (
    <div class={changed ? 'field field--check is-changed' : 'field field--check'}>
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
        {changed ? <ChangedMark /> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface SelectFieldProps<T extends string> {
  label: string;
  help: string;
  /** '' when nothing is picked, which only a field with a `placeholder` can show. */
  value: T | '';
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  /** Shown while nothing is picked; it cannot be picked itself. */
  placeholder?: string;
  /** Said under the field while nothing is picked, for a field that must have a pick. */
  missingMessage?: string;
}

export function SelectField<T extends string>({
  label,
  help,
  value,
  options,
  onChange,
  placeholder,
  missingMessage,
}: SelectFieldProps<T>) {
  const base = useId();
  const controlId = `${base}-input`;
  const helpId = `${base}-help`;
  const messageId = `${base}-msg`;
  const missing = missingMessage !== undefined && value === '';
  return (
    <FieldShell
      label={label}
      help={help}
      controlId={controlId}
      helpId={helpId}
      messageId={messageId}
      message={missing ? missingMessage : null}
      tone="error"
    >
      <select
        id={controlId}
        class={missing ? 'input is-invalid' : 'input'}
        value={value}
        aria-describedby={missing ? `${helpId} ${messageId}` : helpId}
        aria-invalid={missing || undefined}
        onChange={(event) => onChange((event.currentTarget as HTMLSelectElement).value as T)}
      >
        {placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
