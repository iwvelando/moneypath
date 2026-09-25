import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BrandMark } from './components/icons';
import { Toolbar } from './components/Toolbar';
import { Workspace } from './components/Workspace';
import {
  adjustmentStatus,
  adjustmentsOf,
  applyAdjustments,
  type Adjustment,
} from './config/adjustments';
import { currentMonth } from './config/month';
import { fromConfigDocument, refreshIds, toConfigYaml } from './config/serialize';
import { starterConfig } from './config/starter';
import { parseMigratedYaml, planUpload } from './config/upload';
import type { ConfigModel } from './config/types';
import { loadEngine, type EngineStatus } from './engine';
import { EngineError, type ForecastResults } from './engine/types';
import { ResultsView } from './results/ResultsView';
import {
  KEYS,
  clearEditorState,
  loadEditorState,
  readFlag,
  saveEditorState,
  writeFlag,
} from './state/persistence';
import { applyTheme, loadTheme, saveTheme, type Theme } from './state/theme';
import { downloadText, readFileText } from './util/download';

type TabId = 'workspace' | 'results';

interface Notice {
  id: number;
  tone: 'info' | 'warn' | 'error';
  text: string;
}

let noticeId = 0;

export function App() {
  const restored = useMemo(() => loadEditorState(), []);
  const [config, setConfig] = useState<ConfigModel>(restored.config);
  const [tab, setTab] = useState<TabId>('workspace');
  const [engineStatus, setEngineStatus] = useState<EngineStatus>({ state: 'loading' });
  const [optimize, setOptimize] = useState(() => readFlag(KEYS.optimize, false));
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [running, setRunning] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [results, setResults] = useState<ForecastResults | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [ranWithOptimizer, setRanWithOptimizer] = useState(false);
  const [lastRunInput, setLastRunInput] = useState<string | null>(null);
  // The config object that produced `results`. Editing replaces the config
  // immutably, so identity alone tells us the numbers have gone stale.
  const ranConfig = useRef<ConfigModel | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const workspaceTabRef = useRef<HTMLButtonElement | null>(null);

  const pushNotice = useCallback((tone: Notice['tone'], text: string) => {
    noticeId += 1;
    const id = noticeId;
    setNotices((current) => [...current, { id, tone, text }]);
  }, []);

  const dismissNotice = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  /* ---- engine ---- */

  useEffect(() => {
    let cancelled = false;
    void loadEngine().then((status) => {
      if (cancelled) return;
      setEngineStatus(status);
      if (status.state === 'ready' && status.fallbackReason) {
        pushNotice('warn', status.fallbackReason);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pushNotice]);

  /* ---- persistence ---- */

  useEffect(() => {
    if (restored.source === 'starter' && restored.reason) pushNotice('warn', restored.reason);
  }, [restored, pushNotice]);

  useEffect(() => {
    const handle = window.setTimeout(() => saveEditorState(config), 400);
    return () => window.clearTimeout(handle);
  }, [config]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  /* ---- actions ---- */

  const engine = engineStatus.state === 'ready' ? engineStatus.engine : null;

  const runForecast = useCallback(async () => {
    if (!engine) return;
    setRunning(true);
    setBusyLabel('Running the forecast…');
    setRunError(null);
    const configYaml = toConfigYaml(config);
    const started = performance.now();
    try {
      const forecast = await engine.forecast(configYaml, { optimize, now: currentMonth() });
      setDurationMs(performance.now() - started);
      setResults(forecast);
      setRanWithOptimizer(optimize);
      setLastRunInput(configYaml);
      ranConfig.current = config;
      setTab('results');
      setBusyLabel('Forecast complete.');
    } catch (error) {
      setBusyLabel(null);
      setRunError(
        error instanceof EngineError ? error.message : `Unexpected engine failure: ${String(error)}`,
      );
    } finally {
      setRunning(false);
    }
  }, [engine, config, optimize]);

  // A tweak deep in the editor should be runnable in place, without scrolling
  // back to the toolbar. The pinned control in the workspace is the visible
  // half of this; the shortcut works from inside a field, where the user is.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
      if (event.altKey || event.shiftKey) return;
      if (tab !== 'workspace' || running || !engine) return;
      event.preventDefault();
      void runForecast();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [runForecast, running, engine, tab]);

  const downloadConfig = useCallback(async () => {
    if (!engine) return;
    const currentInput = toConfigYaml(config);
    // Prefer the engine-canonical YAML from the last run when the editor has
    // not changed since — after an optimizer run that is the adjusted config.
    if (results && lastRunInput === currentInput && results.configYaml) {
      downloadText('moneypath.yaml', results.configYaml, 'application/yaml');
      return;
    }
    setRunning(true);
    setBusyLabel('Serializing the config…');
    setRunError(null);
    try {
      const canonical = await engine.forecast(currentInput, { optimize: false, now: currentMonth() });
      downloadText('moneypath.yaml', canonical.configYaml, 'application/yaml');
      setBusyLabel('Config downloaded.');
    } catch (error) {
      setBusyLabel(null);
      setRunError(
        error instanceof EngineError
          ? `${error.message} (the config must be valid before it can be serialized)`
          : `Unexpected engine failure: ${String(error)}`,
      );
    } finally {
      setRunning(false);
    }
  }, [engine, config, results, lastRunInput]);

  const downloadCsv = useCallback(() => {
    if (!results) return;
    downloadText('moneypath.csv', results.csv, 'text/csv');
  }, [results]);

  /* ---- optimizer adjustments ---- */

  // A forecast never edits the plan on its own; this is the deliberate step
  // that moves the optimizer's chosen values into it.
  const statusOf = useCallback(
    (adjustment: Adjustment) => adjustmentStatus(config, adjustment),
    [config],
  );

  // Download Config hands back the config as run, which after an optimizing
  // run is not the plan on screen. Say so rather than letting the two diverge
  // silently.
  const configHint = useMemo(() => {
    if (!results || !ranWithOptimizer || ranConfig.current !== config) return null;
    const unapplied = adjustmentsOf(results).filter(
      (adjustment) => adjustment.summary.converged && adjustmentStatus(config, adjustment) === 'pending',
    );
    if (unapplied.length === 0) return null;
    return 'Includes the optimizer’s adjustments, which your plan has not taken yet.';
  }, [results, ranWithOptimizer, config]);

  const applyAdjustmentsToPlan = useCallback(
    (adjustments: Adjustment[]) => {
      if (adjustments.length === 0) return;
      setConfig((current) => applyAdjustments(current, adjustments));
      pushNotice(
        'info',
        adjustments.length === 1
          ? 'Applied the adjustment to your plan. Run the forecast again to see it.'
          : `Applied ${adjustments.length} adjustments to your plan. Run the forecast again to see them.`,
      );
    },
    [pushNotice],
  );

  const uploadConfig = useCallback(
    async (file: File) => {
      setRunError(null);
      setBusyLabel(`Reading ${file.name}…`);
      let text: string;
      try {
        text = await readFileText(file);
      } catch (error) {
        setBusyLabel(null);
        pushNotice('error', `Could not read ${file.name}: ${String(error)}`);
        return;
      }

      const plan = planUpload(text);
      if (plan.action === 'error') {
        setBusyLabel(null);
        pushNotice('error', plan.message);
        return;
      }

      if (plan.action === 'load') {
        setConfig(refreshIds(fromConfigDocument(plan.document)));
        setBusyLabel(`Loaded ${file.name}.`);
        pushNotice('info', `Loaded ${file.name} into the editor.`);
        return;
      }

      if (!engine) {
        setBusyLabel(null);
        pushNotice('error', 'That looks like a legacy config, but the engine is not available to migrate it.');
        return;
      }

      setRunning(true);
      setBusyLabel('Migrating a legacy config…');
      try {
        const migrated = await engine.migrate(text);
        setConfig(refreshIds(fromConfigDocument(parseMigratedYaml(migrated.configYaml))));
        pushNotice('info', plan.reason);
        for (const notice of migrated.notices) pushNotice('warn', `Migration notice: ${notice}`);
        setBusyLabel(`Migrated ${file.name}.`);
      } catch (error) {
        setBusyLabel(null);
        pushNotice(
          'error',
          error instanceof EngineError
            ? `Migration failed: ${error.message}`
            : `Migration failed: ${String(error)}`,
        );
      } finally {
        setRunning(false);
      }
    },
    [engine, pushNotice],
  );

  const resetConfig = useCallback(() => {
    clearEditorState();
    setConfig(starterConfig());
    setResults(null);
    setLastRunInput(null);
    ranConfig.current = null;
    setRunError(null);
    setTab('workspace');
    setConfirmReset(false);
    pushNotice('info', 'The editor was reset to the built-in starter config.');
    // The confirmation unmounts, so park focus somewhere predictable.
    workspaceTabRef.current?.focus();
  }, [pushNotice]);

  // Move focus into the confirmation as soon as it appears.
  useEffect(() => {
    if (confirmReset) confirmButtonRef.current?.focus();
  }, [confirmReset]);

  /* ---- render ---- */

  // Readable, but no longer describing what is in the editor.
  const resultsStale = results !== null && ranConfig.current !== config;

  const warnings = results?.warnings ?? [];
  const version =
    engineStatus.state === 'ready' ? engineStatus.version : engineStatus.state === 'loading' ? '…' : 'unavailable';

  return (
    <div class="app">
      <header class="appbar">
        <div class="appbar__brand">
          <BrandMark />
          <div>
            <h1>moneypath</h1>
            <p>Personal finance scenario simulator — everything runs in your browser.</p>
          </div>
        </div>
        <div class="tablist tablist--main" role="tablist" aria-label="Views">
          <button
            type="button"
            role="tab"
            id="tab-workspace"
            aria-selected={tab === 'workspace'}
            aria-controls="panel-workspace"
            tabIndex={tab === 'workspace' ? 0 : -1}
            class={tab === 'workspace' ? 'tablist__tab is-active' : 'tablist__tab'}
            ref={workspaceTabRef}
            onClick={() => setTab('workspace')}
          >
            Planning Workspace
          </button>
          <button
            type="button"
            role="tab"
            id="tab-results"
            aria-selected={tab === 'results'}
            aria-controls="panel-results"
            aria-disabled={results === null}
            disabled={results === null}
            tabIndex={tab === 'results' ? 0 : -1}
            class={[
              'tablist__tab',
              tab === 'results' ? 'is-active' : '',
              resultsStale ? 'is-outdated' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            title={resultsStale ? 'These results predate your latest edits.' : undefined}
            onClick={() => results && setTab('results')}
          >
            Results
          </button>
        </div>
      </header>

      <Toolbar
        running={running}
        busyLabel={busyLabel}
        engineReady={engine !== null}
        theme={theme}
        onUpload={(file) => void uploadConfig(file)}
        onDownloadConfig={() => void downloadConfig()}
        configHint={configHint}
        onReset={() => setConfirmReset(true)}
        onThemeChange={(next) => {
          setTheme(next);
          saveTheme(next);
        }}
      />

      {confirmReset ? (
        <div class="confirm" role="alertdialog" aria-labelledby="confirm-reset-title">
          <p id="confirm-reset-title">
            Reset the editor to the built-in starter config? Your current plan will be discarded.
          </p>
          <div class="confirm__actions">
            <button type="button" class="btn btn--danger" onClick={resetConfig} ref={confirmButtonRef}>
              Reset config
            </button>
            <button type="button" class="btn" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {engineStatus.state === 'failed' ? (
        <div class="banner banner--error" role="alert">
          <h2>The moneypath engine could not be loaded</h2>
          <p>{engineStatus.message}</p>
          <p>
            Editing still works and your plan is saved locally, but forecasts cannot run until the
            engine loads. Reload the page once the site&rsquo;s assets are available.
          </p>
        </div>
      ) : null}

      {notices.length > 0 ? (
        <ul class="notices" aria-label="Messages" aria-live="polite">
          {notices.map((notice) => (
            <li key={notice.id} class={`notice notice--${notice.tone}`}>
              <span>{notice.text}</span>
              <button
                type="button"
                class="notice__dismiss"
                aria-label="Dismiss message"
                onClick={() => dismissNotice(notice.id)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {warnings.length > 0 ? (
        <section class="banner banner--warn" aria-labelledby="warnings-heading">
          <h2 id="warnings-heading">Validation warnings from the last run</h2>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          <p class="banner__note">Warnings never block a forecast — the run above completed.</p>
        </section>
      ) : null}

      <main>
        <div
          id="panel-workspace"
          role="tabpanel"
          aria-labelledby="tab-workspace"
          hidden={tab !== 'workspace'}
        >
          <Workspace
            config={config}
            onChange={setConfig}
            optimizerEnabled={optimize}
            onOptimizerEnabledChange={(value) => {
              setOptimize(value);
              writeFlag(KEYS.optimize, value);
            }}
            running={running}
            canRun={engine !== null}
            runError={runError}
            onRun={() => void runForecast()}
          />
        </div>
        <div
          id="panel-results"
          role="tabpanel"
          aria-labelledby="tab-results"
          hidden={tab !== 'results'}
          tabIndex={-1}
        >
          {results ? (
            <>
              {resultsStale ? (
                <p class="results-stale" role="status">
                  These numbers came from an earlier version of your plan. Go back to the
                  Planning Workspace and run the forecast again to bring them up to date.
                </p>
              ) : null}
              <ResultsView
                results={results}
                durationMs={durationMs}
                optimizerRan={ranWithOptimizer}
                onDownloadCsv={downloadCsv}
                statusOf={statusOf}
                onApply={applyAdjustmentsToPlan}
              />
            </>
          ) : null}
        </div>
      </main>

      <footer class="appfoot">
        <span>
          Engine version <code>{version}</code>
        </span>
        {engineStatus.state === 'ready' && engineStatus.engine.kind === 'mock' ? (
          <span class="tag tag--warn">mock engine — synthetic numbers</span>
        ) : null}
        <span>Nothing you enter leaves your machine.</span>
      </footer>
    </div>
  );
}
