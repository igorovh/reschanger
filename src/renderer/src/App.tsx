import {
  CheckCircle2,
  Monitor,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { AppState, MonitorInfo, Preset } from "./types";

type FormState = {
  name: string;
  monitorId: string;
  resolution: string;
  refreshRate: number;
  manualMode: boolean;
  manualWidth: number;
  manualHeight: number;
  manualRefreshRate: number;
};

const emptyState: AppState = {
  settings: {
    version: 1,
    autostart: false,
    presets: []
  },
  monitors: []
};

const initialForm: FormState = {
  name: "Opcja 1",
  monitorId: "",
  resolution: "",
  refreshRate: 60,
  manualMode: false,
  manualWidth: 1920,
  manualHeight: 1080,
  manualRefreshRate: 60
};

export function App(): React.JSX.Element {
  const [state, setState] = useState<AppState>(emptyState);
  const [form, setForm] = useState<FormState>(initialForm);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>("Ładowanie ustawień...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    api
      .getState()
      .then((nextState) => {
        if (!mounted) {
          return;
        }
        setState(nextState);
        setNotice("Gotowe.");
      })
      .catch((loadError: unknown) => {
        setError(toMessage(loadError));
      });

    const unsubscribeState = api.onStateChanged((nextState) => {
      setState(nextState);
    });

    const unsubscribeApplied = api.onPresetApplied((result) => {
      setNotice(result.message);
      setError(null);
    });

    const unsubscribeError = api.onAppError((appError) => {
      setError(`${appError.title} ${appError.message}`);
    });

    return () => {
      mounted = false;
      unsubscribeState();
      unsubscribeApplied();
      unsubscribeError();
    };
  }, []);

  useEffect(() => {
    if (state.monitors.length === 0) {
      return;
    }

    const currentMonitor = state.monitors.find(
      (monitor) => monitor.id === form.monitorId
    );
    if (currentMonitor) {
      return;
    }

    const firstMonitor = state.monitors[0];
    if (!firstMonitor) {
      return;
    }

    setForm((current) =>
      createFormForMonitor(
        firstMonitor,
        current.name || nextPresetName(state.settings.presets)
      )
    );
  }, [form.monitorId, state.monitors, state.settings.presets]);

  const selectedMonitor = useMemo(
    () =>
      state.monitors.find((monitor) => monitor.id === form.monitorId) ?? null,
    [form.monitorId, state.monitors]
  );

  const resolutionOptions = useMemo(
    () => getResolutionOptions(selectedMonitor),
    [selectedMonitor]
  );

  const refreshOptions = useMemo(
    () => getRefreshOptions(selectedMonitor, form.resolution),
    [form.resolution, selectedMonitor]
  );

  useEffect(() => {
    if (
      refreshOptions.length === 0 ||
      refreshOptions.includes(form.refreshRate)
    ) {
      return;
    }

    setForm((current) => ({
      ...current,
      refreshRate: refreshOptions[0] ?? current.refreshRate
    }));
  }, [form.refreshRate, refreshOptions]);

  const selectedMode = form.manualMode
    ? {
        width: form.manualWidth,
        height: form.manualHeight,
        refreshRate: form.manualRefreshRate
      }
    : {
        ...parseResolution(form.resolution),
        refreshRate: form.refreshRate
      };

  const canSave =
    selectedMonitor !== null &&
    form.name.trim().length > 0 &&
    selectedMode.width > 0 &&
    selectedMode.height > 0;

  async function refreshMonitors(): Promise<void> {
    await runAction("Odświeżono monitory.", () => api.refreshMonitors());
  }

  async function savePreset(): Promise<void> {
    if (!selectedMonitor || !canSave) {
      setError("Uzupełnij nazwę, monitor, rozdzielczość i Hz.");
      return;
    }

    const payload = {
      name: form.name,
      monitorId: selectedMonitor.id,
      width: selectedMode.width,
      height: selectedMode.height,
      refreshRate: selectedMode.refreshRate
    };

    if (editingPresetId) {
      await runAction("Zapisano zmiany presetu.", () =>
        api.updatePreset(editingPresetId, payload)
      );
      cancelEdit();
      return;
    }

    await runAction("Zapisano preset.", () => api.createPreset(payload));
    setForm((current) => ({
      ...current,
      name: nextPresetName([
        ...state.settings.presets,
        createPreviewPreset(payload, selectedMonitor)
      ])
    }));
  }

  async function applyPreset(preset: Preset): Promise<void> {
    await runAction(`Zastosowano preset "${preset.name}".`, () =>
      api.applyPreset(preset.id)
    );
  }

  async function deletePreset(preset: Preset): Promise<void> {
    await runAction(`Usunięto preset "${preset.name}".`, () =>
      api.deletePreset(preset.id)
    );
    if (editingPresetId === preset.id) {
      cancelEdit();
    }
  }

  async function setAutostart(enabled: boolean): Promise<void> {
    await runAction(
      enabled ? "Włączono autostart." : "Wyłączono autostart.",
      () => api.setAutostart(enabled)
    );
  }

  async function runAction(
    successMessage: string,
    action: () => Promise<AppState>
  ): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const nextState = await action();
      setState(nextState);
      setNotice(successMessage);
    } catch (actionError) {
      setError(toMessage(actionError));
    } finally {
      setBusy(false);
    }
  }

  function editPreset(preset: Preset): void {
    const monitor = state.monitors.find((item) => item.id === preset.monitorId);
    setEditingPresetId(preset.id);
    setForm({
      name: preset.name,
      monitorId: preset.monitorId,
      resolution: `${preset.width}x${preset.height}`,
      refreshRate: preset.refreshRate,
      manualMode: !monitor?.modes.some(
        (mode) =>
          mode.width === preset.width &&
          mode.height === preset.height &&
          mode.refreshRate === preset.refreshRate
      ),
      manualWidth: preset.width,
      manualHeight: preset.height,
      manualRefreshRate: preset.refreshRate
    });
  }

  function cancelEdit(): void {
    const monitor =
      state.monitors.find((item) => item.id === form.monitorId) ??
      state.monitors[0] ??
      null;
    setEditingPresetId(null);
    if (monitor) {
      setForm(
        createFormForMonitor(monitor, nextPresetName(state.settings.presets))
      );
    } else {
      setForm({
        ...initialForm,
        name: nextPresetName(state.settings.presets)
      });
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>reschanger</h1>
          <p>
            Szybka zmiana rozdzielczości i odświeżania z zasobnika systemowego.
          </p>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={() => void refreshMonitors()}
          disabled={busy}
          title="Odśwież monitory"
        >
          <RefreshCw size={18} />
        </button>
      </header>

      <section className="status-row" aria-live="polite">
        {error ? (
          <div className="status error">
            <X size={18} />
            <span>{error}</span>
          </div>
        ) : (
          <div className="status success">
            <CheckCircle2 size={18} />
            <span>{notice}</span>
          </div>
        )}
        <label className="switch">
          <input
            type="checkbox"
            checked={state.settings.autostart}
            onChange={(event) => void setAutostart(event.currentTarget.checked)}
            disabled={busy}
          />
          <span className="switch-track" />
          <span>Autostart z Windows</span>
        </label>
      </section>

      <div className="content-grid">
        <section className="panel">
          <div className="panel-heading">
            <Monitor size={20} />
            <h2>{editingPresetId ? "Edytuj preset" : "Nowy preset"}</h2>
          </div>

          <div className="field">
            <label htmlFor="preset-name">Nazwa</label>
            <input
              id="preset-name"
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.currentTarget.value })
              }
              placeholder="Opcja 1"
            />
          </div>

          <div className="field">
            <label htmlFor="monitor">Monitor</label>
            <select
              id="monitor"
              value={form.monitorId}
              onChange={(event) => {
                const monitor = state.monitors.find(
                  (item) => item.id === event.currentTarget.value
                );
                if (monitor) {
                  setForm(createFormForMonitor(monitor, form.name));
                }
              }}
            >
              {state.monitors.length === 0 ? (
                <option value="">Brak wykrytych monitorów</option>
              ) : null}
              {state.monitors.map((monitor) => (
                <option key={monitor.id} value={monitor.id}>
                  {monitor.name} ({monitor.deviceName})
                </option>
              ))}
            </select>
          </div>

          {selectedMonitor ? (
            <div className="current-mode">
              Aktualnie: {selectedMonitor.current.width}x
              {selectedMonitor.current.height} @{" "}
              {selectedMonitor.current.refreshRate} Hz
            </div>
          ) : null}

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.manualMode}
              onChange={(event) =>
                setForm({ ...form, manualMode: event.currentTarget.checked })
              }
            />
            <span>Wpisz tryb ręcznie</span>
          </label>

          {form.manualMode ? (
            <div className="triple-grid">
              <div className="field">
                <label htmlFor="manual-width">Szerokość</label>
                <input
                  id="manual-width"
                  type="number"
                  min={640}
                  max={10000}
                  value={form.manualWidth}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      manualWidth: Number(event.currentTarget.value)
                    })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="manual-height">Wysokość</label>
                <input
                  id="manual-height"
                  type="number"
                  min={480}
                  max={10000}
                  value={form.manualHeight}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      manualHeight: Number(event.currentTarget.value)
                    })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="manual-refresh">Hz</label>
                <input
                  id="manual-refresh"
                  type="number"
                  min={30}
                  max={1000}
                  value={form.manualRefreshRate}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      manualRefreshRate: Number(event.currentTarget.value)
                    })
                  }
                />
              </div>
            </div>
          ) : (
            <div className="double-grid">
              <div className="field">
                <label htmlFor="resolution">Rozdzielczość</label>
                <select
                  id="resolution"
                  value={form.resolution}
                  onChange={(event) =>
                    setForm({ ...form, resolution: event.currentTarget.value })
                  }
                >
                  {resolutionOptions.map((resolution) => (
                    <option key={resolution} value={resolution}>
                      {resolution}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="refresh-rate">Odświeżanie</label>
                <select
                  id="refresh-rate"
                  value={form.refreshRate}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      refreshRate: Number(event.currentTarget.value)
                    })
                  }
                >
                  {refreshOptions.map((refreshRate) => (
                    <option key={refreshRate} value={refreshRate}>
                      {refreshRate} Hz
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => void savePreset()}
              disabled={!canSave || busy}
            >
              {editingPresetId ? <Save size={18} /> : <Plus size={18} />}
              <span>{editingPresetId ? "Zapisz zmiany" : "Dodaj preset"}</span>
            </button>
            {editingPresetId ? (
              <button
                className="secondary-button"
                type="button"
                onClick={cancelEdit}
                disabled={busy}
              >
                <X size={18} />
                <span>Anuluj</span>
              </button>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <Save size={20} />
            <h2>Zapisane presety</h2>
          </div>

          <div className="preset-list">
            {state.settings.presets.length === 0 ? (
              <div className="empty-state">Brak zapisanych presetów.</div>
            ) : (
              state.settings.presets.map((preset) => {
                const isMonitorAvailable = state.monitors.some(
                  (monitor) => monitor.id === preset.monitorId
                );

                return (
                  <article className="preset-item" key={preset.id}>
                    <div className="preset-main">
                      <strong>{preset.name}</strong>
                      <span>
                        {preset.monitorName} · {preset.width}x{preset.height} @{" "}
                        {preset.refreshRate} Hz
                      </span>
                      {!isMonitorAvailable ? (
                        <em>Monitor niedostępny</em>
                      ) : null}
                    </div>
                    <div className="preset-actions">
                      <button
                        className="icon-button"
                        type="button"
                        title="Zastosuj"
                        onClick={() => void applyPreset(preset)}
                        disabled={!isMonitorAvailable || busy}
                      >
                        <Play size={17} />
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        title="Edytuj"
                        onClick={() => editPreset(preset)}
                        disabled={busy}
                      >
                        <Pencil size={17} />
                      </button>
                      <button
                        className="icon-button danger"
                        type="button"
                        title="Usuń"
                        onClick={() => void deletePreset(preset)}
                        disabled={busy}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function createFormForMonitor(monitor: MonitorInfo, name: string): FormState {
  const currentResolution = `${monitor.current.width}x${monitor.current.height}`;
  const modeExists = monitor.modes.some(
    (mode) =>
      mode.width === monitor.current.width &&
      mode.height === monitor.current.height &&
      mode.refreshRate === monitor.current.refreshRate
  );

  return {
    name,
    monitorId: monitor.id,
    resolution: modeExists
      ? currentResolution
      : (getResolutionOptions(monitor)[0] ?? currentResolution),
    refreshRate: monitor.current.refreshRate,
    manualMode: false,
    manualWidth: monitor.current.width,
    manualHeight: monitor.current.height,
    manualRefreshRate: monitor.current.refreshRate
  };
}

function getResolutionOptions(monitor: MonitorInfo | null): string[] {
  if (!monitor) {
    return [];
  }

  return Array.from(
    new Set(monitor.modes.map((mode) => `${mode.width}x${mode.height}`))
  );
}

function getRefreshOptions(
  monitor: MonitorInfo | null,
  resolution: string
): number[] {
  if (!monitor) {
    return [];
  }

  const { width, height } = parseResolution(resolution);
  return monitor.modes
    .filter((mode) => mode.width === width && mode.height === height)
    .map((mode) => mode.refreshRate)
    .sort((left, right) => right - left);
}

function parseResolution(resolution: string): {
  width: number;
  height: number;
} {
  const [width = "0", height = "0"] = resolution.split("x");
  return {
    width: Number(width),
    height: Number(height)
  };
}

function nextPresetName(presets: Preset[]): string {
  return `Opcja ${presets.length + 1}`;
}

function createPreviewPreset(
  input: {
    name: string;
    monitorId: string;
    width: number;
    height: number;
    refreshRate: number;
  },
  monitor: MonitorInfo
): Preset {
  const now = new Date().toISOString();
  return {
    id: "preview",
    name: input.name,
    monitorId: input.monitorId,
    monitorName: monitor.name,
    width: input.width,
    height: input.height,
    refreshRate: input.refreshRate,
    createdAt: now,
    updatedAt: now
  };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Wystąpił nieznany błąd.";
}
