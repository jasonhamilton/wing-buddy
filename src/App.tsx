import { useEffect, useState } from "react";
import { parseAirfoilFile } from "./geometry/airfoil";
import { AirfoilParseError } from "./geometry/airfoil";
import { invalidateFoil } from "./domain/airfoils";
import { uid } from "./domain/doc";
import { seedProject } from "./domain/seed";
import { deserialise, download, FILE_EXT, pickFile, ProjectLoadError, serialise } from "./io/projectFile";
import { ops, useStore } from "./state/store";
import { IconButton } from "./ui/primitives";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { ProjectName } from "./ui/ProjectName";
import { UnitSwitch } from "./ui/UnitSwitch";
import { MenuBar, modKey, type MenuEntry } from "./ui/MenuBar";
import { clearLocal } from "./io/localStore";
import { AirfoilLibraryDialog } from "./ui/screens/AirfoilLibrary";
import { ExportDxfDialog, ExportPdfDialog, ExportScadDialog } from "./ui/screens/ExportDialogs";
import { PlaneDefinition } from "./ui/screens/PlaneDefinition";
import { SamplePlansDialog } from "./ui/SamplePlansDialog";
import { StatusBar } from "./ui/StatusBar";
import { Toasts, useToasts } from "./ui/Toasts";

export default function App() {
  const store = useStore();
  const { doc, dirty, undoStack, redoStack } = store;
  const [exporting, setExporting] = useState<null | "pdf" | "dxf" | "scad">(null);
  const [confirmingNew, setConfirmingNew] = useState(false);
  const [browsingSamples, setBrowsingSamples] = useState(false);
  /** A project file that has been read and checked, waiting for the user to agree to replace this one. */
  const [pendingLoad, setPendingLoad] = useState<null | { fileName: string; doc: ReturnType<typeof deserialise> }>(null);
  const { toasts, push, dismiss } = useToasts();

  // First geometry build.
  useEffect(() => {
    store.recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tell the user once if the browser will not keep their work between visits.
  const storageProblem = store.storageProblem;
  useEffect(() => {
    if (!storageProblem) return;
    push({
      level: "danger",
      text: storageProblem === "full" ? "This browser's storage is full." : "This browser is not keeping your project.",
      detail: "Your work will be gone if you reload. Use File ▸ Save to write it to a file.",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageProblem]);

  useEffect(() => {
    document.title = `Wing Buddy - ${doc.name}`;
  }, [doc.name]);

  // Keyboard: undo, redo, open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      } else if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") {
        e.preventDefault();
        store.redo();
      } else if (e.key.toLowerCase() === "o") {
        e.preventDefault();
        void onLoadProject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const startNew = () => {
    clearLocal();
    // The same model the app opens with, so "new" and "first visit" can never drift apart.
    // The display unit is a preference rather than part of the model, so it stays as chosen.
    store.replaceDoc({ ...seedProject(), displayUnits: doc.displayUnits }, "new");
    setConfirmingNew(false);
    push({ level: "info", text: "Started a new project." });
  };

  /** Write the project to a file. This is the only way a copy leaves the browser. */
  const onExportProject = () => {
    download(serialise(doc), `${doc.name.replace(/[^\w\- ]+/g, "").trim() || "wing"}${FILE_EXT}`, "application/json");
    store.markExported();
    push({ level: "info", text: "Project exported.", detail: "A copy was downloaded. Open it later with File ▸ Open." });
  };

  /**
   * Open and Import Project do the same thing: read a project file, check it, and replace
   * this project with it. The check comes first, so a bad file is refused without asking
   * anyone to confirm anything.
   */
  const onLoadProject = async () => {
    const file = await pickFile(".json,application/json");
    if (!file) return;
    try {
      setPendingLoad({ fileName: file.name, doc: deserialise(await file.text()) });
    } catch (err) {
      push({
        level: "danger",
        text: "Could not open that file.",
        detail: err instanceof ProjectLoadError ? err.message : String(err),
      });
    }
  };

  const confirmLoad = () => {
    if (!pendingLoad) return;
    store.replaceDoc(pendingLoad.doc, "open");
    push({ level: "info", text: `Loaded ${pendingLoad.doc.name}.`, detail: pendingLoad.fileName });
    setPendingLoad(null);
  };

  /**
   * Read an airfoil file into the project. With `apply`, the new section also becomes
   * that panel's root or tip section in the same undo step, so the user sees the wing change.
   */
  const onImportFoil = async (apply?: { panelId: string; target: "root" | "tip" }) => {
    const file = await pickFile(".dat,.cor,text/plain");
    if (!file) return;
    try {
      const { name, points } = parseAirfoilFile(await file.text());
      const pairs = points.map((p) => [p.x, p.y] as [number, number]);
      // The same file twice is the same section: reuse it rather than list it again.
      const existing = useStore.getState().doc.airfoils.find(
        (a) =>
          a.name === name &&
          a.points?.length === pairs.length &&
          a.points.every((q, i) => q[0] === pairs[i][0] && q[1] === pairs[i][1]),
      );
      const id = existing?.id ?? uid();
      store.mutate("import airfoil", (d) => {
        if (!existing) {
          d.airfoils.push({
            id,
            name,
            origin: "embedded",
            source: file.name.toLowerCase().endsWith(".cor") ? "cor" : "dat",
            points: pairs,
            controlPoints: null,
            createdAt: new Date().toISOString(),
          });
        }
        const target = apply && d.wing.panels.find((p) => p.id === apply.panelId);
        if (target && apply) {
          if (apply.target === "root") target.rootAirfoilId = id;
          else target.tipAirfoilId = id;
        }
      });
      invalidateFoil(id);
      const first = existing ? `${name} was already in this project.` : `Imported ${name}.`;
      push({
        level: "info",
        text: apply ? `${first} It is now the ${apply.target} section.` : first,
        detail: apply
          ? `${points.length} points.`
          : `${points.length} points. Open a panel and pick it from the top of the Airfoil list.`,
      });
    } catch (err) {
      push({
        level: "danger",
        text: `Could not read ${file.name}.`,
        detail: err instanceof AirfoilParseError ? err.message : "The file could not be parsed as an airfoil.",
      });
    }
  };

  const mod = modKey();
  const menus: { label: string; entries: MenuEntry[] }[] = [
    {
      label: "File",
      entries: [
        { label: "New…", onSelect: () => setConfirmingNew(true) },
        { label: "Open…", shortcut: `${mod}O`, onSelect: () => void onLoadProject() },
        { label: "Sample plans…", onSelect: () => setBrowsingSamples(true) },
        { separator: true },
        {
          label: "Import",
          submenu: [
            { label: "Import Project…", onSelect: () => void onLoadProject() },
            { label: "Import Airfoil…", onSelect: () => void onImportFoil() },
          ],
        },
        {
          label: "Export",
          submenu: [
            { label: "Export PDF…", onSelect: () => setExporting("pdf") },
            { label: "Export DXF…", onSelect: () => setExporting("dxf") },
            { label: "Export OpenSCAD…", onSelect: () => setExporting("scad") },
            { label: "Export Project", onSelect: onExportProject },
          ],
        },
      ],
    },
    {
      label: "Edit",
      entries: [
        {
          label: "Undo",
          hint: undoStack.length ? undoStack[undoStack.length - 1]?.label : undefined,
          shortcut: `${mod}Z`,
          disabled: undoStack.length === 0,
          onSelect: store.undo,
        },
        {
          label: "Redo",
          hint: redoStack.length ? redoStack[redoStack.length - 1]?.label : undefined,
          shortcut: `${mod}⇧Z`,
          disabled: redoStack.length === 0,
          onSelect: store.redo,
        },
      ],
    },
  ];

  const modalOpen = store.foilPicker !== null || exporting !== null || confirmingNew || browsingSamples || pendingLoad !== null;

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      {/* While a dialog is open the rest of the app is inert, so focus cannot
          wander behind the modal and a screen reader is not offered two
          different "Delete" buttons at once. */}
      <div className="flex min-h-0 flex-1 flex-col" inert={modalOpen}>
      {/* ------------------------------------------------------- toolbar */}
      <header aria-label="Toolbar" className="relative z-40 flex h-10 shrink-0 items-center gap-1 border-b border-border bg-surface px-3">
        
        <MenuBar menus={menus} />
        <div className="ml-auto flex min-w-0 items-center gap-3 pl-3">
          <UnitSwitch />
          <ProjectName name={doc.name} changed={dirty} onRename={ops.renameProject} />
          <ThemeToggle />
        </div>
      </header>

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <PlaneDefinition />
      </main>

      <StatusBar />
      </div>

      {store.foilPicker && <AirfoilLibraryDialog onImport={() => void onImportFoil()} />}
      {exporting === "pdf" && <ExportPdfDialog onClose={() => setExporting(null)} />}
      {exporting === "dxf" && <ExportDxfDialog onClose={() => setExporting(null)} />}
      {exporting === "scad" && <ExportScadDialog onClose={() => setExporting(null)} />}
      {browsingSamples && (
        <SamplePlansDialog
          onClose={() => setBrowsingSamples(false)}
          onLoad={(plan) => {
            // Opening one replaces the project, so it asks the same question Open does.
            setBrowsingSamples(false);
            setPendingLoad({ fileName: "the sample plans", doc: { ...plan.doc, displayUnits: doc.displayUnits } });
          }}
        />
      )}
      {confirmingNew && (
        <ConfirmDialog
          title="Start a new project?"
          confirmLabel="Delete this project and start new"
          onConfirm={startNew}
          onCancel={() => setConfirmingNew(false)}
        >
          <p>
            The project you have open, <strong>{doc.name}</strong>, will be deleted from this browser.
          </p>
          <p className="mt-3 text-muted">
            This cannot be undone. If you want to keep it, cancel and choose File ▸ Export ▸ Export Project
            first.
          </p>
        </ConfirmDialog>
      )}
      {pendingLoad && (
        <ConfirmDialog
          title="Replace this project?"
          confirmLabel="Replace and load"
          onConfirm={confirmLoad}
          onCancel={() => setPendingLoad(null)}
        >
          <p>
            <strong>{doc.name}</strong> will be replaced by <strong>{pendingLoad.doc.name}</strong> from{" "}
            {pendingLoad.fileName}. The project loads from scratch and the one you have open is deleted from this
            browser.
          </p>
          <p className="mt-3 text-muted">
            This cannot be undone. To keep the current one, cancel and use File ▸ Export ▸ Export Project first.
          </p>
        </ConfirmDialog>
      )}
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">(() => {
    try {
      return (localStorage.getItem("wb-theme") as "light" | "dark" | "system") ?? "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("wb-theme", theme);
    } catch {
      /* private window */
    }
  }, [theme]);
  const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  return (
    <IconButton label={`Theme: ${theme}. Switch to ${next}.`} onClick={() => setTheme(next)}>
      {theme === "dark" ? (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="8" cy="8" r="3.2" />
          <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9 13 13M13 3l-1.1 1.1M4.1 11.9 3 13" strokeLinecap="round" />
        </svg>
      )}
    </IconButton>
  );
}
