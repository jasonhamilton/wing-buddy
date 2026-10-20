/**
 * A length, stored in millimetres and shown in whichever unit the project uses.
 *
 * Everything the document holds is millimetres, so nothing about geometry, files or
 * exports changes when the unit does: this component converts on the way in and out.
 * With `percent` it passes the number straight through, for the fields that can be
 * either a percentage of the chord or a length.
 */
import { useStore } from "../state/store";
import { formatInches, lengthDecimals, lengthStep, mmFromInput, parseLength, toDisplay } from "../domain/units";
import { NumberField, type NumberFieldProps } from "./primitives";

export type LengthFieldProps = Omit<NumberFieldProps, "unit" | "decimals" | "parse"> & {
  /** the value is a percentage, not a length: no conversion, "%" label */
  percent?: boolean;
  /** show a different decimal count in either unit */
  decimals?: number;
};

export function LengthField({ value, onCommit, step = 1, min, max, percent, decimals, ...rest }: LengthFieldProps) {
  const units = useStore((s) => s.doc.displayUnits);
  if (percent) {
    return <NumberField {...rest} value={value} onCommit={onCommit} step={step} min={min} max={max} unit="%" decimals={decimals} />;
  }
  return (
    <NumberField
      {...rest}
      value={toDisplay(value, units)}
      onCommit={(v) => onCommit(mmFromInput(v, units))}
      unit={units}
      decimals={decimals ?? lengthDecimals(units)}
      step={lengthStep(step, units)}
      min={min === undefined ? undefined : toDisplay(min, units)}
      max={max === undefined ? undefined : toDisplay(max, units)}
      parse={(t) => parseLength(t, units)}
      format={units === "in" && decimals === undefined ? formatInches : undefined}
    />
  );
}
