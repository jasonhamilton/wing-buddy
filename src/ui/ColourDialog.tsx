/** Select a colour: basic swatches, hue, saturation and value, red, green and blue, a hex field, and saved custom colours. */
import { useState } from "react";
import { BASIC_COLOURS, hexToRgb, hsvToRgb, parseHex, readableOn, rgbToHex, rgbToHsv } from "../domain/colour";
import type { Color } from "../domain/schema";
import { Button, Dialog, NumberField, TextField } from "./primitives";

const STORE = "wb-custom-colours";
const SLOTS = 8;

function loadCustom(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && parseHex(x) === x).slice(0, SLOTS) : [];
  } catch {
    return [];
  }
}
function saveCustom(list: string[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(list));
  } catch {
    /* storage is a convenience here; the colour is still chosen */
  }
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

export function ColourDialog({
  current,
  title = "Select colour",
  onChoose,
  onCancel,
}: {
  current: Color;
  title?: string;
  onChoose: (c: Color) => void;
  onCancel: () => void;
}) {
  const start = current === "standard" ? "#0072b2" : current;
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(...hexToRgb(start)));
  const [hexText, setHexText] = useState(start);
  const [hexError, setHexError] = useState(false);
  const [custom, setCustom] = useState<string[]>(loadCustom);

  const rgb = hsvToRgb(...hsv);
  const hex = rgbToHex(...rgb);

  const apply = (next: [number, number, number]) => {
    setHsv(next);
    setHexText(rgbToHex(...hsvToRgb(...next)));
    setHexError(false);
  };
  const applyHex = (h: string) => apply(rgbToHsv(...hexToRgb(h)));
  const eye = typeof window !== "undefined" ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper : undefined;

  return (
    <Dialog
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button className="mr-auto" onClick={() => onChoose("standard")}>
            Standard colour
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => onChoose(hex as Color)}>
            OK
          </Button>
        </>
      }
    >
      <div className="grid gap-5 p-6">
        <section aria-label="Basic colours">
          <h3 className="mb-2 text-micro font-medium uppercase tracking-[.07em] text-muted">Basic colours</h3>
          <div className="grid grid-cols-8 gap-1.5">
            {BASIC_COLOURS.map((c) => (
              <button
                key={c.hex}
                type="button"
                aria-label={`${c.name} ${c.hex}`}
                aria-pressed={hex === c.hex}
                title={c.name}
                onClick={() => applyHex(c.hex)}
                style={{ backgroundColor: c.hex }}
                className={`h-6 rounded-sm border ${hex === c.hex ? "border-fg outline outline-2 outline-offset-1 outline-accent" : "border-border-strong"}`}
              />
            ))}
          </div>
          {eye && (
            <Button
              size="sm"
              className="mt-3"
              onClick={() => {
                void new eye().open().then((r) => applyHex(parseHex(r.sRGBHex) ?? hex)).catch(() => undefined);
              }}
            >
              Pick from the screen
            </Button>
          )}
        </section>

        <section aria-label="Mix a colour" className="grid gap-4 sm:grid-cols-[96px_1fr]">
          <div
            role="img"
            aria-label={`Selected colour ${hex}`}
            style={{ backgroundColor: hex, color: readableOn(hex) }}
            className="flex h-24 items-end justify-center rounded-md border border-border-strong pb-2 font-mono text-xs"
          >
            {hex}
          </div>
          <div className="grid gap-2 text-sm">
            {([
              ["Hue", 0, 359, Math.round(hsv[0]) % 360, (v: number) => apply([v, hsv[1], hsv[2]])],
              ["Saturation", 0, 100, Math.round(hsv[1] * 100), (v: number) => apply([hsv[0], v / 100, hsv[2]])],
              ["Value", 0, 100, Math.round(hsv[2] * 100), (v: number) => apply([hsv[0], hsv[1], v / 100])],
            ] as const).map(([label, min, max, value, set]) => (
              <label key={label} className="flex items-center gap-3">
                <span className="w-20 text-muted">{label}</span>
                <input type="range" min={min} max={max} value={value} aria-label={label} onChange={(e) => set(Number(e.target.value))} className="min-w-0 flex-1" />
                <span className="w-9 text-right font-mono text-xs tabular-nums">{value}</span>
              </label>
            ))}
          </div>
        </section>

        <section aria-label="Exact values" className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-3">
          {(["Red", "Green", "Blue"] as const).map((label, i) => (
            <label key={label} className="grid gap-1 text-sm">
              <span className="text-muted">{label}</span>
              <NumberField
                label={label}
                value={rgb[i]}
                decimals={0}
                min={0}
                max={255}
                step={1}
                onCommit={(v) => {
                  const next = [...rgb] as [number, number, number];
                  next[i] = v;
                  applyHex(rgbToHex(...next));
                }}
              />
            </label>
          ))}
        </section>

        <div>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">HTML colour</span>
            <TextField
              aria-label="HTML colour"
              aria-invalid={hexError || undefined}
              value={hexText}
              onChange={(e) => {
                setHexText(e.target.value);
                const p = parseHex(e.target.value);
                if (p) {
                  setHexError(false);
                  setHsv(rgbToHsv(...hexToRgb(p)));
                } else setHexError(true);
              }}
              onBlur={() => {
                if (hexError) {
                  setHexText(hex);
                  setHexError(false);
                }
              }}
              className="font-mono"
            />
          </label>
          {hexError && (
            <p role="alert" className="mt-1 text-micro text-danger">
              That is not a colour. Use six digits such as #4cb84c, or three such as #4b8.
            </p>
          )}
        </div>

        <section aria-label="Custom colours">
          <h3 className="mb-2 text-micro font-medium uppercase tracking-[.07em] text-muted">Custom colours</h3>
          <div className="grid grid-cols-8 gap-1.5">
            {Array.from({ length: SLOTS }, (_, i) => {
              const c = custom[i];
              return c ? (
                <button
                  key={i}
                  type="button"
                  aria-label={`Custom colour ${i + 1}: ${c}`}
                  aria-pressed={hex === c}
                  onClick={() => applyHex(c)}
                  style={{ backgroundColor: c }}
                  className="h-6 rounded-sm border border-border-strong"
                />
              ) : (
                <span key={i} aria-hidden="true" className="h-6 rounded-sm border border-dashed border-border" />
              );
            })}
          </div>
          <Button
            size="sm"
            className="mt-3"
            onClick={() => {
              const next = [hex, ...custom.filter((c) => c !== hex)].slice(0, SLOTS);
              setCustom(next);
              saveCustom(next);
            }}
          >
            Add to custom colours
          </Button>
        </section>
      </div>
    </Dialog>
  );
}
