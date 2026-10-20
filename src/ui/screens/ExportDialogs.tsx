/** S20 and S21: the two exports the core loop needs. */
import { useState } from "react";
import { DXF_DEFAULTS, buildDxf } from "../../export/dxf";
import { SCAD_DEFAULTS, buildScad, type ScadOptions } from "../../export/scad";
import { PAGE_SIZES, buildPdf, type PageSizeName } from "../../export/pdf";
import { download } from "../../io/projectFile";
import { useStore } from "../../state/store";
import { formatInches } from "../../domain/units";
import { LengthField } from "../LengthField";
import { Button, Checkbox, Dialog, Field, FieldGrid, Radio } from "../primitives";

const safeName = (n: string) => n.replace(/[^\w\- ]+/g, "").trim() || "wing";

/** "210×297mm", or "8.27×11.69in" for an inch project. */
function pageText(w: number, h: number, units: "mm" | "in"): string {
  return units === "in" ? `${formatInches(w / 25.4)}×${formatInches(h / 25.4)}in` : `${w}×${h}mm`;
}

export function ExportPdfDialog({ onClose }: { onClose: () => void }) {
  const { doc, geometry } = useStore();
  const units = doc.displayUnits;
  const [pageSize, setPageSize] = useState<PageSizeName>("A4");
  const [landscape, setLandscape] = useState(true);
  const [margin, setMargin] = useState(10);
  const [calibration, setCalibration] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const run = async () => {
    if (!geometry) return;
    setBusy(true);
    setNote(null);
    try {
      const { bytes, pages, oversized } = await buildPdf(geometry, {
        pageSize,
        landscape,
        marginMm: margin,
        projectName: doc.name,
        showCalibration: calibration,
      });
      download(bytes, `${safeName(doc.name)}-ribs.pdf`, "application/pdf");
      setNote(
        oversized.length
          ? `${pages} page(s) saved. ${oversized.length} rib(s) are wider than this page and were clipped — use a larger page or print in landscape.`
          : `${pages} page(s) saved.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Export rib templates to PDF"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" loading={busy} disabled={!geometry?.ribs.length} onClick={run}>
            Save PDF
          </Button>
        </>
      }
    >
      <div className="p-6">
        <div className="mb-5 rounded-md border border-warning/40 bg-warning/5 p-4 text-xs">
          <strong className="mb-1 block text-sm font-medium">Print at 100%, not “Fit to page”.</strong>
          Page one carries a bar of exactly 100mm{units === "in" ? " (3.937in)" : ""}. Measure it with a ruler before you
          cut anything — if it is not exactly that long, the print was scaled and every rib will be the wrong size.
        </div>
        <FieldGrid>
          <Field label="Page size:">
            <select
              value={pageSize}
              onChange={(e) => setPageSize(e.target.value as PageSizeName)}
              aria-label="Page size"
              className="h-ctl w-full rounded-sm border border-border-input bg-input-bg px-2 text-sm text-fg"
            >
              {Object.entries(PAGE_SIZES).map(([k, v]) => (
                <option key={k} value={k}>
                  {k} — {pageText(v.w, v.h, units)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Orientation:">
            <div className="flex gap-6">
              <Radio name="orient" checked={!landscape} onChange={() => setLandscape(false)}>Portrait</Radio>
              <Radio name="orient" checked={landscape} onChange={() => setLandscape(true)}>Landscape</Radio>
            </div>
          </Field>
          <Field label="Margin:">
            <LengthField label="Page margin" value={margin} min={0} max={40} step={1} onCommit={setMargin} />
          </Field>
        </FieldGrid>
        <div className="mt-4">
          <Checkbox checked={calibration} onChange={setCalibration}>
            Print the calibration bar on page one
          </Checkbox>
        </div>
        {note && (
          <p className="mt-5 text-xs text-muted" aria-live="polite">
            {note}
          </p>
        )}
      </div>
    </Dialog>
  );
}

export function ExportDxfDialog({ onClose }: { onClose: () => void }) {
  const { doc, geometry } = useStore();
  const [boxes, setBoxes] = useState(DXF_DEFAULTS.boxesAroundRibs);
  const [spacing, setSpacing] = useState(DXF_DEFAULTS.spacingMm);
  const [silhouette, setSilhouette] = useState(DXF_DEFAULTS.drawOriginalSilhouette);
  const [trim, setTrim] = useState(DXF_DEFAULTS.trimTrailingEdge);
  const [trimMm, setTrimMm] = useState(DXF_DEFAULTS.trailingMinMm);
  const [note, setNote] = useState<string | null>(null);

  const run = () => {
    if (!geometry) return;
    const text = buildDxf(geometry, {
      ...DXF_DEFAULTS,
      boxesAroundRibs: boxes,
      spacingMm: spacing,
      drawOriginalSilhouette: silhouette,
      trimTrailingEdge: trim,
      trailingMinMm: trimMm,
    });
    download(text, `${safeName(doc.name)}-ribs.dxf`, "application/dxf");
    setNote(
      `${geometry.ribs.length} ribs written, in millimetres, on layers RIBS / HOLES / BOXES / LABELS${silhouette ? " / SILHOUETTE" : ""}.`,
    );
  };

  return (
    <Dialog
      title="Export to DXF"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={!geometry?.ribs.length} onClick={run}>
            Save DXF
          </Button>
        </>
      }
    >
      <div className="p-6">
        <p className="mb-5 max-w-prose text-sm text-muted">
          R12 ASCII with the units set to millimetres, so your laser or CNC software does not have to guess
          the scale. Ribs are laid out in one row from the root.
        </p>
        <FieldGrid>
          <Field label="Spacing:">
            <LengthField label="Spacing between parts" value={spacing} min={0} max={100} step={1} onCommit={setSpacing} />
          </Field>
        </FieldGrid>
        <div className="mt-4 flex flex-col gap-3">
          <Checkbox checked={boxes} onChange={setBoxes}>
            Draw a bounding box around each rib
          </Checkbox>
          <div>
            <Checkbox checked={silhouette} onChange={setSilhouette}>
              Draw the original rib silhouette
            </Checkbox>
            <p className="mt-1 max-w-prose text-micro text-muted">
              The whole airfoil each rib was cut from, on its own SILHOUETTE layer, so you can see what the notches and
              stock took away. Leave that layer out of the cut.
            </p>
          </div>
          <div>
            <Checkbox checked={trim} onChange={setTrim}>
              Trim sharp trailing edges
            </Checkbox>
            <p className="mt-1 max-w-prose text-micro text-muted">
              A trailing edge that runs out to a point leaves a laser two lines that almost touch. This cuts it back to a
              thickness you choose, never by more than a twentieth of the chord.
            </p>
            <div className="mt-2 max-w-60">
              <FieldGrid>
                <Field label="Down to:">
                  <LengthField label="Trailing edge minimum thickness" disabled={!trim} value={trimMm} min={0.1} max={5} step={0.1} onCommit={setTrimMm} />
                </Field>
              </FieldGrid>
            </div>
          </div>
        </div>
        {note && (
          <p className="mt-5 text-xs text-muted" aria-live="polite">
            {note}
          </p>
        )}
      </div>
    </Dialog>
  );
}

export function ExportScadDialog({ onClose }: { onClose: () => void }) {
  const { doc, geometry } = useStore();
  const [parts, setParts] = useState<Pick<ScadOptions, "ribs" | "leadingEdge" | "trailingEdge" | "spars" | "sheeting" | "combs">>({
    ribs: SCAD_DEFAULTS.ribs,
    leadingEdge: SCAD_DEFAULTS.leadingEdge,
    trailingEdge: SCAD_DEFAULTS.trailingEdge,
    spars: SCAD_DEFAULTS.spars,
    sheeting: SCAD_DEFAULTS.sheeting,
    combs: SCAD_DEFAULTS.combs,
  });
  const [bothHalves, setBothHalves] = useState(SCAD_DEFAULTS.bothHalves);
  const [spread, setSpread] = useState(false);
  const [spacing, setSpacing] = useState(40);
  const [note, setNote] = useState<string | null>(null);
  const anything = parts.ribs || parts.leadingEdge || parts.trailingEdge || parts.spars || parts.sheeting || parts.combs;

  const run = () => {
    if (!geometry) return;
    const text = buildScad(doc, geometry, { ...parts, bothHalves, panelSpacingMm: spread ? spacing : 0 });
    download(text, `${safeName(doc.name)}.scad`, "text/plain");
    setNote("Written in millimetres. Open it in OpenSCAD and press F6 to render; X is the span, Y the chord and Z is up.");
  };

  return (
    <Dialog
      title="Export to OpenSCAD"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={!geometry?.ribs.length || !anything} onClick={run}>
            Save OpenSCAD
          </Button>
        </>
      }
    >
      <div className="p-6">
        <p className="mb-5 max-w-prose text-sm text-muted">
          A 3D model of the wing as an OpenSCAD file. Choose what goes into it.
        </p>
        <fieldset className="mb-4 flex flex-col gap-2">
          <legend className="mb-2 text-micro font-medium uppercase tracking-[.07em] text-muted">Parts</legend>
          <Checkbox checked={parts.ribs} onChange={(v) => setParts({ ...parts, ribs: v })}>Ribs</Checkbox>
          <Checkbox checked={parts.leadingEdge} onChange={(v) => setParts({ ...parts, leadingEdge: v })}>Leading edge</Checkbox>
          <Checkbox checked={parts.trailingEdge} onChange={(v) => setParts({ ...parts, trailingEdge: v })}>Trailing edge</Checkbox>
          <Checkbox checked={parts.spars} onChange={(v) => setParts({ ...parts, spars: v })}>Spars and webbing</Checkbox>
          <Checkbox checked={parts.sheeting} onChange={(v) => setParts({ ...parts, sheeting: v })}>Sheeting</Checkbox>
          <Checkbox checked={parts.combs} onChange={(v) => setParts({ ...parts, combs: v })}>Rib combs</Checkbox>
        </fieldset>
        <div className="mb-4">
          <Checkbox checked={bothHalves} onChange={setBothHalves}>Both wing halves</Checkbox>
        </div>
        <div className="flex items-start gap-4">
          <Checkbox checked={spread} onChange={setSpread}>Extra space between panels</Checkbox>
          <div className="w-40">
            <LengthField label="Space between panels" disabled={!spread} value={spacing} min={0} max={500} step={5} onCommit={setSpacing} />
          </div>
        </div>
        {!anything && <p className="mt-4 text-xs text-warning">Choose at least one part to export.</p>}
        {note && (
          <p className="mt-5 text-xs text-muted" aria-live="polite">
            {note}
          </p>
        )}
      </div>
    </Dialog>
  );
}
