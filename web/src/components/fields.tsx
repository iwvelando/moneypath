import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useId, useRef, useState } from 'preact/hooks';
import type { Help } from '../config/help';
import { HelpTip } from './HelpTip';
import { formatMonthInput, monthIsError, monthMessage } from '../config/month';
import { sanitizeNumberInput } from '../util/number';
import { Notes, notesFor, useDraftProblem, usePath, useProblemsAt, type Note } from './problems';

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
  help: Help;
  controlId: string;
  helpId: string;
  /** What to say under the control, errors first. */
  notes?: readonly Note[];
  messageId?: string;
  /** The field's place in the config document, when it has one. */
  path?: string | null;
  children: ComponentChildren;
  wide?: boolean;
}

export function FieldShell({
  label,
  help,
  controlId,
  helpId,
  notes = [],
  messageId,
  path = null,
  children,
  wide,
}: FieldShellProps) {
  const changed = useContext(ChangedLabels).has(label);
  return (
    <div
      class={`field${wide ? ' field--wide' : ''}${changed ? ' is-changed' : ''}`}
      data-path={path ?? undefined}
    >
      <div class="field__label">
        <label for={controlId}>{label}</label>
        <HelpTip id={helpId} label={label} help={help} />
        {changed ? <ChangedMark /> : null}
      </div>
      {children}
      <Notes id={messageId} notes={notes} />
    </div>
  );
}

/**
 * What a field says and how its control is marked: its own message, then what
 * the engine reports for its place in the plan.
 */
function useFieldNotes(field: string | undefined, own: Note | null, helpId: string, messageId: string) {
  const here = usePath(field);
  const path = field === undefined ? null : here;
  const notes = notesFor(own, useProblemsAt(path));
  const invalid = notes.some((note) => note.tone === 'error');
  return {
    path,
    notes,
    invalid,
    describedBy: notes.length > 0 ? `${helpId} ${messageId}` : helpId,
  };
}

/* ------------------------------------------------------------------ */

interface TextFieldProps {
  label: string;
  help: Help;
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  wide?: boolean;
  /** The field's key in its entry of the config document. */
  field?: string;
}

export function TextField({ label, help, value, onInput, placeholder, required, wide, field }: TextFieldProps) {
  const base = useId();
  const controlId = `${base}-input`;
  const helpId = `${base}-help`;
  const messageId = `${base}-msg`;
  const missing = required === true && value.trim() === '';
  const { path, notes, invalid, describedBy } = useFieldNotes(
    field,
    missing ? { tone: 'error', text: 'This field is required.' } : null,
    helpId,
    messageId,
  );
  return (
    <FieldShell
      label={label}
      help={help}
      controlId={controlId}
      helpId={helpId}
      messageId={messageId}
      notes={notes}
      path={path}
      wide={wide}
    >
      <input
        id={controlId}
        class={invalid ? 'input is-invalid' : 'input'}
        type="text"
        value={value}
        placeholder={placeholder}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        onInput={(event) => onInput((event.currentTarget as HTMLInputElement).value)}
      />
    </FieldShell>
  );
}

/* ------------------------------------------------------------------ */

interface NumberFieldProps {
  label: string;
  help: Help;
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
  /** The field's key in its entry of the config document. */
  field?: string;
}

function roundStep(value: number, step: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 2);
  return Number(value.toFixed(Math.min(10, decimals)));
}

/**
 * A numeric field that keeps a text draft so half-typed values ("-", "1.")
 * survive, and supports arrow-key stepping — Shift or Alt take bigger steps.
 * Text that is not a number stays in the box with its error after the field
 * is left, and the page is told, so a plan never runs on a value other than
 * the one on screen.
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
  field,
}: NumberFieldProps) {
  const base = useId();
  const controlId = `${base}-input`;
  const helpId = `${base}-help`;
  const messageId = `${base}-msg`;

  const [draft, setDraft] = useState(value === null ? '' : String(value));
  const focused = useRef(false);

  // A value that changes from outside the field replaces what was typed.
  useEffect(() => {
    if (!focused.current) setDraft(value === null ? '' : String(value));
  }, [value]);

  const malformed = draft.trim() !== '' && !Number.isFinite(Number(draft));
  const { path, notes, invalid, describedBy } = useFieldNotes(
    field,
    malformed ? { tone: 'error', text: 'Enter a number.' } : null,
    helpId,
    messageId,
  );
  useDraftProblem(path, malformed ? 'Enter a number.' : null);

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
      notes={notes}
      path={path}
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
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={(event) => {
            focused.current = false;
            // Read the box, not the last render: a blur can follow a keystroke at once.
            const text = (event.currentTarget as HTMLInputElement).value;
            if (text.trim() === '' || Number.isFinite(Number(text))) {
              setDraft(value === null ? '' : String(value));
            }
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
  help: Help;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  /** The field's key in its entry of the config document. */
  field?: string;
}

/**
 * A `YYYY-MM` field validated as you type. It asks a phone for the number
 * pad and puts the dash in itself, since that pad has none.
 */
export function MonthField({ label, help, value, onChange, required, placeholder, field }: MonthFieldProps) {
  const base = useId();
  const controlId = `${base}-input`;
  const helpId = `${base}-help`;
  const messageId = `${base}-msg`;

  const message = monthMessage(value, { required: required === true });
  const wrong = monthIsError(value, { required: required === true });
  const { path, notes, invalid, describedBy } = useFieldNotes(
    field,
    message === null ? null : { tone: wrong ? 'error' : 'hint', text: message },
    helpId,
    messageId,
  );

  return (
    <FieldShell
      label={label}
      help={help}
      controlId={controlId}
      helpId={helpId}
      messageId={messageId}
      notes={notes}
      path={path}
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
        aria-describedby={describedBy}
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
  help: Help;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The field's key in its entry of the config document. */
  field?: string;
}

export function CheckField({ label, help, checked, onChange, field }: CheckFieldProps) {
  const base = useId();
  const controlId = `${base}-input`;
  const helpId = `${base}-help`;
  const messageId = `${base}-msg`;
  const changed = useContext(ChangedLabels).has(label);
  const { path, notes, invalid, describedBy } = useFieldNotes(field, null, helpId, messageId);
  return (
    <div class={changed ? 'field field--check is-changed' : 'field field--check'} data-path={path ?? undefined}>
      <div class="check-row">
        <input
          id={controlId}
          type="checkbox"
          checked={checked}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange((event.currentTarget as HTMLInputElement).checked)}
        />
        <label for={controlId}>{label}</label>
        <HelpTip id={helpId} label={label} help={help} />
        {changed ? <ChangedMark /> : null}
      </div>
      <Notes id={messageId} notes={notes} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface SelectFieldProps<T extends string> {
  label: string;
  help: Help;
  /** '' when nothing is picked, which only a field with a `placeholder` can show. */
  value: T | '';
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  /** Shown while nothing is picked; it cannot be picked itself. */
  placeholder?: string;
  /** Said under the field while nothing is picked, for a field that must have a pick. */
  missingMessage?: string;
  /** The field's key in its entry of the config document. */
  field?: string;
}

export function SelectField<T extends string>({
  label,
  help,
  value,
  options,
  onChange,
  placeholder,
  missingMessage,
  field,
}: SelectFieldProps<T>) {
  const base = useId();
  const controlId = `${base}-input`;
  const helpId = `${base}-help`;
  const messageId = `${base}-msg`;
  const missing = missingMessage !== undefined && value === '';
  const { path, notes, invalid, describedBy } = useFieldNotes(
    field,
    missing ? { tone: 'error', text: missingMessage } : null,
    helpId,
    messageId,
  );
  return (
    <FieldShell
      label={label}
      help={help}
      controlId={controlId}
      helpId={helpId}
      messageId={messageId}
      notes={notes}
      path={path}
    >
      <select
        id={controlId}
        class={invalid ? 'input is-invalid' : 'input'}
        value={value}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
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
