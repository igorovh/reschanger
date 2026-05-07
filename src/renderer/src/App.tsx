import {
  CheckCircle2,
  Monitor,
  Moon,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_LOCALE,
  DEFAULT_THEME_MODE,
  formatMode,
  LOCALES,
  THEME_MODES,
  t,
} from "../../shared/i18n";
import {
  DEFAULT_PROCESS_WATCH_INTERVAL_MS,
  MAX_PROCESS_WATCH_INTERVAL_MS,
  MIN_PROCESS_WATCH_INTERVAL_MS,
} from "../../shared/types";
import { api } from "./api";
import type {
  AppSettings,
  AppState,
  Locale,
  MonitorInfo,
  Preset,
  ThemeMode,
} from "./types";

type RightPanelMode = "list" | "create" | "edit";

type ProcessField = {
  id: string;
  value: string;
};

type FormState = {
  name: string;
  processNames: ProcessField[];
  monitorId: string;
  resolution: string;
  refreshRate: number;
  manualMode: boolean;
  manualWidth: number;
  manualHeight: number;
  manualRefreshRate: number;
  isDefault: boolean;
};

let processFieldId = 0;

const emptyState: AppState = {
  settings: {
    version: 7,
    autostart: false,
    restartExplorerAfterApply: false,
    processWatchIntervalMs: DEFAULT_PROCESS_WATCH_INTERVAL_MS,
    language: DEFAULT_LOCALE,
    themeMode: DEFAULT_THEME_MODE,
    monitorBindings: [],
    monitorAliases: [],
    defaultPresets: [],
    presets: [],
  },
  monitors: [],
};

const initialForm: FormState = {
  name: nextPresetName(DEFAULT_LOCALE, []),
  processNames: [createProcessField()],
  monitorId: "",
  resolution: "",
  refreshRate: 60,
  manualMode: false,
  manualWidth: 1920,
  manualHeight: 1080,
  manualRefreshRate: 60,
  isDefault: false,
};

export function App(): React.JSX.Element {
  const [state, setState] = useState<AppState>(emptyState);
  const [form, setForm] = useState<FormState>(initialForm);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("list");
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [presetPendingDelete, setPresetPendingDelete] = useState<Preset | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [monitorAliasName, setMonitorAliasName] = useState("");
  const [notice, setNotice] = useState<string>(() =>
    t(DEFAULT_LOCALE, "notice.loadingSettings"),
  );
  const [error, setError] = useState<string | null>(null);
  const settingsRef = useRef(state.settings);
  const locale = state.settings.language;
  const themeMode = state.settings.themeMode;

  useEffect(() => {
    settingsRef.current = state.settings;
  }, [state.settings]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    let mounted = true;

    api
      .getState()
      .then((nextState) => {
        if (!mounted) {
          return;
        }
        setState(nextState);
        setNotice(t(nextState.settings.language, "notice.ready"));
      })
      .catch((loadError: unknown) => {
        setError(toMessage(loadError, DEFAULT_LOCALE));
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
      (monitor) => monitor.id === form.monitorId,
    );
    if (currentMonitor) {
      return;
    }

    const firstMonitor = state.monitors[0];
    if (!firstMonitor) {
      return;
    }

    setEditingPresetId(null);
    setRightPanelMode("list");
    setForm(
      createFormForMonitor(
        firstMonitor,
        nextPresetName(locale, state.settings.presets),
        false,
      ),
    );
  }, [form.monitorId, locale, state.monitors, state.settings.presets]);

  useEffect(() => {
    if (!settingsOpen && presetPendingDelete === null) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") {
        return;
      }

      setSettingsOpen(false);
      setPresetPendingDelete(null);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [presetPendingDelete, settingsOpen]);

  const selectedMonitor = useMemo(
    () =>
      state.monitors.find((monitor) => monitor.id === form.monitorId) ?? null,
    [form.monitorId, state.monitors],
  );
  const selectedMonitorId = selectedMonitor?.id ?? null;
  const selectedMonitorIndex = selectedMonitor
    ? state.monitors.findIndex((monitor) => monitor.id === selectedMonitor.id)
    : -1;
  const selectedMonitorDisplayName = selectedMonitor
    ? getMonitorDisplayName(
        locale,
        state.settings,
        selectedMonitor,
        selectedMonitorIndex >= 0 ? selectedMonitorIndex : 0,
      )
    : "";
  const selectedMonitorTitle = selectedMonitor
    ? getMonitorTitle(
        locale,
        state.settings,
        selectedMonitor,
        selectedMonitorIndex >= 0 ? selectedMonitorIndex : 0,
      )
    : "";

  useEffect(() => {
    if (!selectedMonitorId) {
      setMonitorAliasName("");
      return;
    }

    setMonitorAliasName(
      getMonitorAliasName(settingsRef.current, selectedMonitorId),
    );
  }, [selectedMonitorId]);

  const selectedPresets = useMemo(() => {
    if (!selectedMonitor) {
      return [];
    }

    return state.settings.presets.filter((preset) => {
      const presetMonitor = findMonitorForPreset(
        state.monitors,
        state.settings,
        preset,
      );
      return presetMonitor?.id === selectedMonitor.id;
    });
  }, [selectedMonitor, state]);

  const unavailablePresets = useMemo(
    () =>
      state.settings.presets.filter(
        (preset) =>
          findMonitorForPreset(state.monitors, state.settings, preset) === null,
      ),
    [state],
  );

  const resolutionOptions = useMemo(
    () => getResolutionOptions(selectedMonitor),
    [selectedMonitor],
  );

  const refreshOptions = useMemo(
    () => getRefreshOptions(selectedMonitor, form.resolution),
    [form.resolution, selectedMonitor],
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
      refreshRate: refreshOptions[0] ?? current.refreshRate,
    }));
  }, [form.refreshRate, refreshOptions]);

  const selectedMode = form.manualMode
    ? {
        width: form.manualWidth,
        height: form.manualHeight,
        refreshRate: form.manualRefreshRate,
      }
    : {
        ...parseResolution(form.resolution),
        refreshRate: form.refreshRate,
      };

  const canSave =
    selectedMonitor !== null &&
    form.name.trim().length > 0 &&
    selectedMode.width > 0 &&
    selectedMode.height > 0;

  async function refreshMonitors(): Promise<void> {
    await runAction(t(locale, "notice.monitorsRefreshed"), () =>
      api.refreshMonitors(),
    );
  }

  async function savePreset(): Promise<void> {
    if (!selectedMonitor || !canSave) {
      setError(t(locale, "validation.completePreset"));
      return;
    }

    const payload = {
      name: form.name,
      processNames: compactProcessNames(form.processNames),
      monitorId: selectedMonitor.id,
      width: selectedMode.width,
      height: selectedMode.height,
      refreshRate: selectedMode.refreshRate,
      isDefault: form.isDefault,
    };

    if (editingPresetId) {
      await runAction(t(locale, "notice.presetUpdated"), () =>
        api.updatePreset(editingPresetId, payload),
      );
      closePresetEditor(selectedMonitor);
      return;
    }

    await runAction(t(locale, "notice.presetSaved"), () =>
      api.createPreset(payload),
    );
    setForm(
      createFormForMonitor(
        selectedMonitor,
        nextPresetName(locale, [
          ...state.settings.presets,
          createPreviewPreset(payload, selectedMonitor),
        ]),
        false,
      ),
    );
    setRightPanelMode("list");
  }

  async function applyPreset(preset: Preset): Promise<void> {
    await runAction(
      t(locale, "notice.presetApplied", { name: preset.name }),
      () => api.applyPreset(preset.id),
    );
  }

  async function confirmDeletePreset(): Promise<void> {
    if (!presetPendingDelete) {
      return;
    }

    const preset = presetPendingDelete;
    await runAction(
      t(locale, "notice.presetDeleted", { name: preset.name }),
      () => api.deletePreset(preset.id),
    );
    setPresetPendingDelete(null);
    if (editingPresetId === preset.id && selectedMonitor) {
      closePresetEditor(selectedMonitor);
    }
  }

  async function setAutostart(enabled: boolean): Promise<void> {
    await runAction(
      t(locale, enabled ? "autostart.enabled" : "autostart.disabled"),
      () => api.setAutostart(enabled),
    );
  }

  async function setRestartExplorerAfterApply(enabled: boolean): Promise<void> {
    await runAction(
      t(
        locale,
        enabled ? "explorerRestart.enabled" : "explorerRestart.disabled",
      ),
      () => api.setRestartExplorerAfterApply(enabled),
    );
  }

  async function setProcessWatchIntervalSeconds(value: string): Promise<void> {
    const intervalSeconds = Number(value);
    if (!Number.isFinite(intervalSeconds)) {
      return;
    }

    await runAction(t(locale, "processWatchInterval.updated"), () =>
      api.setProcessWatchInterval({
        intervalMs: Math.round(intervalSeconds * 1000),
      }),
    );
  }

  async function setLanguage(language: Locale): Promise<void> {
    if (language === locale) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const nextState = await api.setLanguage(language);
      setState(nextState);
      setNotice(t(language, "notice.ready"));
    } catch (languageError) {
      setError(toMessage(languageError, locale));
    } finally {
      setBusy(false);
    }
  }

  async function setThemeMode(theme: ThemeMode): Promise<void> {
    if (theme === themeMode) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const nextState = await api.setThemeMode(theme);
      setState(nextState);
      setNotice(t(locale, "settings.updated"));
    } catch (themeError) {
      setError(toMessage(themeError, locale));
    } finally {
      setBusy(false);
    }
  }

  async function saveMonitorAlias(): Promise<void> {
    if (!selectedMonitor) {
      return;
    }

    await runAction(t(locale, "notice.monitorAliasSaved"), () =>
      api.setMonitorAlias({
        monitorId: selectedMonitor.id,
        name: monitorAliasName,
      }),
    );
  }

  async function runAction(
    successMessage: string,
    action: () => Promise<AppState>,
  ): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const nextState = await action();
      setState(nextState);
      setNotice(successMessage);
    } catch (actionError) {
      setError(toMessage(actionError, locale));
    } finally {
      setBusy(false);
    }
  }

  function beginCreatePreset(): void {
    if (!selectedMonitor) {
      return;
    }

    setEditingPresetId(null);
    setForm(
      createFormForMonitor(
        selectedMonitor,
        nextPresetName(locale, state.settings.presets),
        false,
      ),
    );
    setRightPanelMode("create");
  }

  function editPreset(preset: Preset): void {
    const monitor = findMonitorForPreset(
      state.monitors,
      state.settings,
      preset,
    );
    setEditingPresetId(preset.id);
    setForm({
      name: preset.name,
      processNames:
        preset.processNames.length > 0
          ? preset.processNames.map(createProcessField)
          : [createProcessField()],
      monitorId: monitor?.id ?? preset.monitorId,
      resolution: `${preset.width}x${preset.height}`,
      refreshRate: preset.refreshRate,
      manualMode: !monitor?.modes.some(
        (mode) =>
          mode.width === preset.width &&
          mode.height === preset.height &&
          mode.refreshRate === preset.refreshRate,
      ),
      manualWidth: preset.width,
      manualHeight: preset.height,
      manualRefreshRate: preset.refreshRate,
      isDefault: isDefaultPreset(state.settings, preset),
    });
    setRightPanelMode("edit");
  }

  function closePresetEditor(
    monitor: MonitorInfo | null = selectedMonitor,
  ): void {
    setEditingPresetId(null);
    setRightPanelMode("list");
    if (monitor) {
      setForm(
        createFormForMonitor(
          monitor,
          nextPresetName(locale, state.settings.presets),
          false,
        ),
      );
      return;
    }

    setForm({
      ...initialForm,
      name: nextPresetName(locale, state.settings.presets),
    });
  }

  function selectMonitor(monitorId: string): void {
    const monitor = state.monitors.find((item) => item.id === monitorId);
    if (!monitor) {
      return;
    }

    setEditingPresetId(null);
    setRightPanelMode("list");
    setForm(
      createFormForMonitor(
        monitor,
        nextPresetName(locale, state.settings.presets),
        false,
      ),
    );
  }

  function updateProcessName(id: string, value: string): void {
    setForm((current) => ({
      ...current,
      processNames: current.processNames.map((processName) =>
        processName.id === id ? { ...processName, value } : processName,
      ),
    }));
  }

  function addProcessName(): void {
    setForm((current) => ({
      ...current,
      processNames: [...current.processNames, createProcessField()],
    }));
  }

  function removeProcessName(id: string): void {
    setForm((current) => {
      const processNames = current.processNames.filter(
        (processName) => processName.id !== id,
      );

      return {
        ...current,
        processNames:
          processNames.length > 0 ? processNames : [createProcessField()],
      };
    });
  }

  function renderPresetItem(
    preset: Preset,
    isMonitorAvailable: boolean,
  ): React.JSX.Element {
    const isDefault = isDefaultPreset(state.settings, preset);

    return (
      <article className="preset-item" key={preset.id}>
        <div className="preset-main">
          <div className="preset-title-row">
            <strong>{preset.name}</strong>
            {isDefault ? (
              <span className="preset-default-badge">
                {t(locale, "preset.defaultBadge")}
              </span>
            ) : null}
          </div>
          <span>
            {formatMode(preset.width, preset.height, preset.refreshRate)}
          </span>
          {preset.processNames.length > 0 ? (
            <span>
              {t(locale, "preset.processTriggers", {
                processNames: preset.processNames.join(", "),
              })}
            </span>
          ) : null}
          {!isMonitorAvailable ? (
            <em>{t(locale, "preset.monitorUnavailable")}</em>
          ) : null}
        </div>
        <div className="preset-actions">
          <button
            className="icon-button"
            type="button"
            title={t(locale, "action.apply")}
            onClick={() => void applyPreset(preset)}
            disabled={!isMonitorAvailable || busy}
          >
            <Play size={17} />
          </button>
          <button
            className="icon-button"
            type="button"
            title={t(locale, "action.edit")}
            onClick={() => editPreset(preset)}
            disabled={busy}
          >
            <Pencil size={17} />
          </button>
          <button
            className="icon-button danger"
            type="button"
            title={t(locale, "action.delete")}
            onClick={() => setPresetPendingDelete(preset)}
            disabled={busy}
          >
            <Trash2 size={17} />
          </button>
        </div>
      </article>
    );
  }

  function renderPresetEditor(): React.JSX.Element {
    return (
      <section className="preset-editor">
        <div className="panel-section-heading">
          <div>
            <h3>
              {rightPanelMode === "edit"
                ? t(locale, "form.editPreset")
                : t(locale, "form.newPreset")}
            </h3>
            <span className="heading-meta">{selectedMonitorDisplayName}</span>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => closePresetEditor()}
            disabled={busy}
          >
            <X size={17} />
            <span>{t(locale, "action.backToPresets")}</span>
          </button>
        </div>

        <div className="field">
          <label htmlFor="preset-name">{t(locale, "field.name")}</label>
          <input
            id="preset-name"
            value={form.name}
            onChange={(event) =>
              setForm({ ...form, name: event.currentTarget.value })
            }
            placeholder={nextPresetName(locale, [])}
          />
        </div>

        <div className="process-fieldset">
          <div className="fieldset-heading">
            <span className="fieldset-label">
              {t(locale, "field.processNames")}
            </span>
            <button
              className="secondary-button compact"
              type="button"
              onClick={addProcessName}
              disabled={busy}
            >
              <Plus size={16} />
              <span>{t(locale, "action.addProcess")}</span>
            </button>
          </div>
          <div className="process-list">
            {form.processNames.map((processName) => (
              <div className="process-row" key={processName.id}>
                <input
                  value={processName.value}
                  onChange={(event) =>
                    updateProcessName(processName.id, event.currentTarget.value)
                  }
                  placeholder={t(locale, "form.processPlaceholder")}
                  disabled={busy}
                />
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => removeProcessName(processName.id)}
                  disabled={busy || form.processNames.length === 1}
                  title={t(locale, "action.removeProcess")}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(event) =>
              setForm({ ...form, isDefault: event.currentTarget.checked })
            }
            disabled={busy}
          />
          <span>{t(locale, "form.defaultPreset")}</span>
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.manualMode}
            onChange={(event) =>
              setForm({ ...form, manualMode: event.currentTarget.checked })
            }
            disabled={busy}
          />
          <span>{t(locale, "form.manualMode")}</span>
        </label>

        {form.manualMode ? (
          <div className="triple-grid">
            <div className="field">
              <label htmlFor="manual-width">{t(locale, "field.width")}</label>
              <input
                id="manual-width"
                type="number"
                min={640}
                max={10000}
                value={form.manualWidth}
                onChange={(event) =>
                  setForm({
                    ...form,
                    manualWidth: Number(event.currentTarget.value),
                  })
                }
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="manual-height">{t(locale, "field.height")}</label>
              <input
                id="manual-height"
                type="number"
                min={480}
                max={10000}
                value={form.manualHeight}
                onChange={(event) =>
                  setForm({
                    ...form,
                    manualHeight: Number(event.currentTarget.value),
                  })
                }
                disabled={busy}
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
                    manualRefreshRate: Number(event.currentTarget.value),
                  })
                }
                disabled={busy}
              />
            </div>
          </div>
        ) : (
          <div className="double-grid">
            <div className="field">
              <label htmlFor="resolution">
                {t(locale, "field.resolution")}
              </label>
              <select
                id="resolution"
                value={form.resolution}
                onChange={(event) =>
                  setForm({ ...form, resolution: event.currentTarget.value })
                }
                disabled={busy}
              >
                {resolutionOptions.map((resolution) => (
                  <option key={resolution} value={resolution}>
                    {resolution}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="refresh-rate">
                {t(locale, "field.refreshRate")}
              </label>
              <select
                id="refresh-rate"
                value={form.refreshRate}
                onChange={(event) =>
                  setForm({
                    ...form,
                    refreshRate: Number(event.currentTarget.value),
                  })
                }
                disabled={busy}
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
            {rightPanelMode === "edit" ? (
              <Save size={18} />
            ) : (
              <Plus size={18} />
            )}
            <span>
              {rightPanelMode === "edit"
                ? t(locale, "action.saveChanges")
                : t(locale, "action.addPreset")}
            </span>
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => closePresetEditor()}
            disabled={busy}
          >
            <X size={18} />
            <span>{t(locale, "action.cancel")}</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo" aria-hidden="true" />
          <div>
            <h1>reschanger</h1>
            <p>{t(locale, "app.subtitle")}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <fieldset className="theme-toggle">
            <legend>{t(locale, "field.themeMode")}</legend>
            <button
              className={themeMode === "light" ? "active" : ""}
              type="button"
              onClick={() => void setThemeMode("light")}
              disabled={busy}
              title={t(locale, "theme.light")}
            >
              <Sun size={16} />
              <span>{t(locale, "theme.light")}</span>
            </button>
            <button
              className={themeMode === "dark" ? "active" : ""}
              type="button"
              onClick={() => void setThemeMode("dark")}
              disabled={busy}
              title={t(locale, "theme.dark")}
            >
              <Moon size={16} />
              <span>{t(locale, "theme.dark")}</span>
            </button>
          </fieldset>
          <button
            className="icon-button"
            type="button"
            onClick={() => setSettingsOpen(true)}
            disabled={busy}
            title={t(locale, "settings.open")}
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {settingsOpen ? (
        <div className="modal-backdrop">
          <button
            className="modal-dismiss-layer"
            type="button"
            onClick={() => setSettingsOpen(false)}
            aria-label={t(locale, "action.cancel")}
          />
          <section
            className="settings-modal"
            id="settings-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <div className="settings-modal-header">
              <h2 id="settings-title">{t(locale, "settings.title")}</h2>
              <button
                className="icon-button"
                type="button"
                onClick={() => setSettingsOpen(false)}
                title={t(locale, "action.cancel")}
              >
                <X size={18} />
              </button>
            </div>
            <div className="settings-modal-body">
              <label className="settings-row">
                <span>{t(locale, "field.language")}</span>
                <select
                  value={locale}
                  onChange={(event) =>
                    void setLanguage(event.currentTarget.value as Locale)
                  }
                  disabled={busy}
                >
                  {LOCALES.map((language) => (
                    <option key={language} value={language}>
                      {languageLabel(locale, language)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-row">
                <span>{t(locale, "field.themeMode")}</span>
                <select
                  value={themeMode}
                  onChange={(event) =>
                    void setThemeMode(event.currentTarget.value as ThemeMode)
                  }
                  disabled={busy}
                >
                  {THEME_MODES.map((theme) => (
                    <option key={theme} value={theme}>
                      {themeModeLabel(locale, theme)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-row switch-row">
                <span>{t(locale, "autostart.label")}</span>
                <span className="switch">
                  <input
                    type="checkbox"
                    checked={state.settings.autostart}
                    onChange={(event) =>
                      void setAutostart(event.currentTarget.checked)
                    }
                    disabled={busy}
                  />
                  <span className="switch-track" />
                </span>
              </label>
              <label className="settings-row switch-row">
                <span>{t(locale, "explorerRestart.label")}</span>
                <span className="switch">
                  <input
                    type="checkbox"
                    checked={state.settings.restartExplorerAfterApply}
                    onChange={(event) =>
                      void setRestartExplorerAfterApply(
                        event.currentTarget.checked,
                      )
                    }
                    disabled={busy}
                  />
                  <span className="switch-track" />
                </span>
              </label>
              <details className="settings-advanced">
                <summary>{t(locale, "settings.advanced")}</summary>
                <label className="settings-row">
                  <span>{t(locale, "processWatchInterval.label")}</span>
                  <input
                    type="number"
                    min={MIN_PROCESS_WATCH_INTERVAL_MS / 1000}
                    max={MAX_PROCESS_WATCH_INTERVAL_MS / 1000}
                    step={0.25}
                    value={state.settings.processWatchIntervalMs / 1000}
                    onChange={(event) =>
                      void setProcessWatchIntervalSeconds(
                        event.currentTarget.value,
                      )
                    }
                    disabled={busy}
                  />
                </label>
              </details>
            </div>
          </section>
        </div>
      ) : null}

      {presetPendingDelete ? (
        <div className="modal-backdrop">
          <button
            className="modal-dismiss-layer"
            type="button"
            onClick={() => setPresetPendingDelete(null)}
            aria-label={t(locale, "action.cancel")}
          />
          <section
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-preset-title"
          >
            <div className="settings-modal-header">
              <h2 id="delete-preset-title">
                {t(locale, "confirm.deletePresetTitle")}
              </h2>
              <button
                className="icon-button"
                type="button"
                onClick={() => setPresetPendingDelete(null)}
                title={t(locale, "action.cancel")}
              >
                <X size={18} />
              </button>
            </div>
            <p>
              {t(locale, "confirm.deletePresetMessage", {
                name: presetPendingDelete.name,
              })}
            </p>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setPresetPendingDelete(null)}
                disabled={busy}
              >
                <X size={18} />
                <span>{t(locale, "action.cancel")}</span>
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={() => void confirmDeletePreset()}
                disabled={busy}
              >
                <Trash2 size={18} />
                <span>{t(locale, "confirm.deletePresetConfirm")}</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

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
      </section>

      <div className="workspace-layout">
        <aside className="monitor-sidebar">
          <div className="sidebar-heading">
            <div>
              <h2>{t(locale, "nav.monitors")}</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => void refreshMonitors()}
              disabled={busy}
              title={t(locale, "action.refreshMonitors")}
            >
              <RefreshCw size={18} />
            </button>
          </div>
          <nav
            className="monitor-nav-list"
            aria-label={t(locale, "nav.monitors")}
          >
            {state.monitors.length === 0 ? (
              <div className="empty-state compact">
                {t(locale, "empty.noMonitors")}
              </div>
            ) : null}
            {state.monitors.map((monitor, index) => {
              const isActive = monitor.id === selectedMonitorId;
              return (
                <button
                  className={`monitor-nav-item${isActive ? " active" : ""}`}
                  key={monitor.id}
                  type="button"
                  onClick={() => selectMonitor(monitor.id)}
                  disabled={busy}
                >
                  <Monitor size={18} />
                  <span>
                    <strong>
                      {getMonitorDisplayName(
                        locale,
                        state.settings,
                        monitor,
                        index,
                      )}
                    </strong>
                    <small>
                      {formatMode(
                        monitor.current.width,
                        monitor.current.height,
                        monitor.current.refreshRate,
                      )}
                    </small>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="main-panel">
          {selectedMonitor ? (
            <>
              <div className="main-panel-header">
                <div>
                  <h2>{selectedMonitorDisplayName}</h2>
                  <p>
                    {selectedMonitor.name} · {selectedMonitor.deviceName}
                  </p>
                </div>
                <span className="monitor-current-mode">
                  {t(locale, "form.currentMode", {
                    mode: formatMode(
                      selectedMonitor.current.width,
                      selectedMonitor.current.height,
                      selectedMonitor.current.refreshRate,
                    ),
                  })}
                </span>
              </div>

              <div className="alias-row">
                <label htmlFor="monitor-alias">
                  {t(locale, "field.monitorAlias")}
                </label>
                <div className="alias-controls">
                  <input
                    id="monitor-alias"
                    value={monitorAliasName}
                    onChange={(event) =>
                      setMonitorAliasName(event.currentTarget.value)
                    }
                    placeholder={selectedMonitorTitle}
                    disabled={busy}
                  />
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void saveMonitorAlias()}
                    disabled={busy}
                  >
                    <Save size={17} />
                    <span>{t(locale, "action.save")}</span>
                  </button>
                </div>
              </div>

              {rightPanelMode === "list" ? (
                <section className="preset-list-section">
                  <div className="panel-section-heading">
                    <div>
                      <h3>{t(locale, "preset.savedPresets")}</h3>
                    </div>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={beginCreatePreset}
                      disabled={busy}
                    >
                      <Plus size={18} />
                      <span>{t(locale, "action.newPreset")}</span>
                    </button>
                  </div>

                  <div className="preset-list">
                    {selectedPresets.length > 0 ? (
                      selectedPresets.map((preset) =>
                        renderPresetItem(preset, true),
                      )
                    ) : (
                      <div className="empty-state">
                        {t(locale, "preset.noMonitorPresets")}
                      </div>
                    )}
                  </div>

                  {unavailablePresets.length > 0 ? (
                    <div className="unavailable-presets">
                      <div className="panel-section-heading compact-heading">
                        <div>
                          <h3>{t(locale, "preset.unavailableGroup")}</h3>
                          <span className="heading-meta">
                            {t(locale, "preset.monitorUnavailable")}
                          </span>
                        </div>
                      </div>
                      <div className="preset-list">
                        {unavailablePresets.map((preset) =>
                          renderPresetItem(preset, false),
                        )}
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : (
                renderPresetEditor()
              )}
            </>
          ) : (
            <div className="empty-state">{t(locale, "empty.noMonitors")}</div>
          )}
        </section>
      </div>
    </main>
  );
}

function createFormForMonitor(
  monitor: MonitorInfo,
  name: string,
  isDefault: boolean,
): FormState {
  const currentResolution = `${monitor.current.width}x${monitor.current.height}`;
  const modeExists = monitor.modes.some(
    (mode) =>
      mode.width === monitor.current.width &&
      mode.height === monitor.current.height &&
      mode.refreshRate === monitor.current.refreshRate,
  );

  return {
    name,
    processNames: [createProcessField()],
    monitorId: monitor.id,
    resolution: modeExists
      ? currentResolution
      : (getResolutionOptions(monitor)[0] ?? currentResolution),
    refreshRate: monitor.current.refreshRate,
    manualMode: false,
    manualWidth: monitor.current.width,
    manualHeight: monitor.current.height,
    manualRefreshRate: monitor.current.refreshRate,
    isDefault,
  };
}

function getResolutionOptions(monitor: MonitorInfo | null): string[] {
  if (!monitor) {
    return [];
  }

  return Array.from(
    new Set(monitor.modes.map((mode) => `${mode.width}x${mode.height}`)),
  );
}

function getRefreshOptions(
  monitor: MonitorInfo | null,
  resolution: string,
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
    height: Number(height),
  };
}

function createProcessField(value = ""): ProcessField {
  processFieldId += 1;
  return {
    id: `process-field-${processFieldId}`,
    value,
  };
}

function compactProcessNames(processNames: ProcessField[]): string[] {
  return processNames
    .map((processName) => processName.value)
    .filter((processName) => processName.trim().length > 0);
}

function nextPresetName(locale: Locale, presets: Preset[]): string {
  return t(locale, "preset.defaultName", { number: presets.length + 1 });
}

function languageLabel(locale: Locale, language: Locale): string {
  return t(locale, language === "pl" ? "language.pl" : "language.en");
}

function themeModeLabel(locale: Locale, themeMode: ThemeMode): string {
  switch (themeMode) {
    case "light":
      return t(locale, "theme.light");
    case "dark":
      return t(locale, "theme.dark");
    case "auto":
      return t(locale, "theme.auto");
  }
}

function createPreviewPreset(
  input: {
    name: string;
    monitorId: string;
    width: number;
    height: number;
    refreshRate: number;
    processNames?: string[];
  },
  monitor: MonitorInfo,
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
    processNames: input.processNames ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

function isDefaultPreset(settings: AppSettings, preset: Preset): boolean {
  return settings.defaultPresets.some((item) => item.presetId === preset.id);
}

function getMonitorTitle(
  locale: Locale,
  settings: AppSettings,
  monitor: MonitorInfo,
  fallbackIndex: number,
): string {
  return t(locale, "monitor.groupTitle", {
    number: getMonitorSortOrder(settings, monitor, fallbackIndex),
  });
}

function getMonitorDisplayName(
  locale: Locale,
  settings: AppSettings,
  monitor: MonitorInfo,
  fallbackIndex: number,
): string {
  return (
    getMonitorAliasName(settings, monitor.id) ||
    getMonitorTitle(locale, settings, monitor, fallbackIndex)
  );
}

function getMonitorAliasName(settings: AppSettings, monitorId: string): string {
  const alias = settings.monitorAliases.find(
    (item) => item.monitorId === monitorId,
  );

  return alias?.name.trim() ?? "";
}

function getMonitorSortOrder(
  settings: AppSettings,
  monitor: MonitorInfo,
  fallbackIndex: number,
): number {
  const rememberedBinding = settings.monitorBindings.find(
    (binding) => binding.monitorId === monitor.id,
  );
  const rememberedNumber = rememberedBinding
    ? parseDisplayNumber(rememberedBinding.deviceName)
    : null;

  return rememberedNumber ?? fallbackIndex + 1;
}

function parseDisplayNumber(deviceName: string): number | null {
  const match = /DISPLAY(\d+)$/i.exec(deviceName);
  if (!match?.[1]) {
    return null;
  }

  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function findMonitorForPreset(
  monitors: MonitorInfo[],
  settings: AppSettings,
  preset: Preset,
): MonitorInfo | null {
  const exactMonitor =
    monitors.find((monitor) => monitor.id === preset.monitorId) ?? null;
  if (exactMonitor) {
    return exactMonitor;
  }

  if (!isLegacyDisplayDeviceName(preset.monitorId)) {
    return null;
  }

  const binding = settings.monitorBindings.find(
    (item) => item.deviceName === preset.monitorId,
  );
  if (binding) {
    const monitor = monitors.find((item) => item.id === binding.monitorId);
    if (monitor) {
      return monitor;
    }
  }

  return (
    monitors.find((monitor) => monitor.deviceName === preset.monitorId) ?? null
  );
}

function isLegacyDisplayDeviceName(value: string): boolean {
  return /^\\\\\.\\DISPLAY\d+$/i.test(value);
}

function toMessage(error: unknown, locale: Locale): string {
  return error instanceof Error ? error.message : t(locale, "error.unknown");
}
