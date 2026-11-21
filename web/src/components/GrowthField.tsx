import { HELP, type Help } from '../config/help';
import type { GrowthMode, GrowthModel } from '../config/types';
import { NumberField, SelectField } from './fields';

const MODES: readonly { value: GrowthMode; label: string }[] = [
  { value: 'fixed', label: 'Stays the same' },
  { value: 'inflation', label: 'With inflation' },
  { value: 'rate', label: 'At its own rate' },
];

interface GrowthFieldProps {
  label: string;
  help?: Help;
  /** The label of the rate's own field. */
  rateLabel?: string;
  /** The growth's key in its entry of the config document. */
  field: string;
  value: GrowthModel;
  onChange: (growth: GrowthModel) => void;
}

/**
 * How an amount changes over the plan's years (spec/03, Growth): a choice of
 * three, and a yearly rate beside it for "At its own rate". What the engine
 * says about the growth is shown under the rate when there is one, and under
 * the choice otherwise, so it appears once. A growth the editor cannot offer
 * is shown as written, for the engine's error to explain.
 */
export function GrowthField({ label, help = HELP.growth, rateLabel = 'Yearly growth', field, value, onChange }: GrowthFieldProps) {
  const known = MODES.some((mode) => mode.value === value.mode);
  const options = known ? MODES : [...MODES, { value: value.mode, label: value.mode, disabled: true }];
  const ownRate = value.mode === 'rate';
  return (
    <>
      <SelectField<string>
        label={label}
        help={help}
        field={ownRate ? undefined : field}
        value={value.mode}
        options={options}
        onChange={(mode) => onChange({ ...value, mode })}
      />
      {ownRate ? (
        <NumberField
          label={rateLabel}
          help={HELP.growthRate}
          field={field}
          value={value.rate}
          step={0.5}
          suffix="% / yr"
          signed
          missingMessage="Enter the yearly growth."
          onChange={(rate) => onChange({ ...value, rate })}
        />
      ) : null}
    </>
  );
}
