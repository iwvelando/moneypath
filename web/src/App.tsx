import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BrandMark, PathSketch } from './components/icons';
import { Toolbar } from './components/Toolbar';
import { Problems, problemSet } from './components/problems';
import { Workspace } from './components/Workspace';
import {
  adjustmentStatus,
  adjustmentsOf,
  applyAdjustments,
  type Adjustment,
} from './config/adjustments';
import { keepFlippedScenario } from './config/choices';
import { currentMonth } from './config/month';
import { fromConfigDocument, refreshIds, toConfigYaml } from './config/serialize';
import { starterConfig } from './config/starter';
import { planUpload } from './config/upload';
import type { ConfigModel } from './config/types';
import { loadEngine, type EngineStatus } from './engine';
import {
  EngineError,
  type EarliestAnswer,
  type EarliestRequest,
  type FlipComparison,
  type FlipRequest,
  type ForecastResults,
  type Problem,
} from './engine/types';
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
  // The month that run took as the current one, so a flip of it agrees.
  const ranNow = useRef('');
  // Why the last toolbar action (upload, download, reset) did not happen.
  const [toolbarError, setToolbarError] = useState<string | null>(null);
  // A run was asked for while the plan had errors; the run bar then counts them.
  const [blocked, setBlocked] = useState(false);
  // What happened to the saved draft, when it could not be used.
  const [restoreNote, setRestoreNote] = useState<string | null>(
    restored.source === 'starter' ? (restored.reason ?? null) : null,
  );
  const [unsaved, setUnsaved] = useState(false);
  // Text in a number field that is not a number, by the field that holds it.
  // The engine never sees it, so the fields report it themselves.
  const [drafts, setDrafts] = useState<Record<string, { path: string; message: string }>>({});
  // A new plan (uploaded, or the starter) starts the editor afresh.
  const [planId, setPlanId] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const workspaceTabRef = useRef<HTMLButtonElement | null>(null);

  const reportDraft = useCallback((field: string, path: string, message: string | null) => {
    setDrafts((current) => {
      const held = current[field];
      if (message === null ? held === undefined : held?.path === path && held.message === message) {
        return current;
      }
      const next = { ...current };
      if (message === null) delete next[field];
      else next[field] = { path, message };
      return next;
    });
  }, []);

  /* ---- engine ---- */

  useEffect(() => {
    let cancelled = false;
    void loadEngine().then((status) => {
      if (cancelled) return;
      setEngineStatus(status);
      // Browser tests wait on this rather than guessing when the engine is up.
      document.documentElement.dataset.engine = status.state;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- persistence ---- */

  useEffect(() => {
    const handle = window.setTimeout(() => setUnsaved(!saveEditorState(config)), 400);
    return () => window.clearTimeout(handle);
  }, [config]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  /* ---- actions ---- */

  const engine = engineStatus.state === 'ready' ? engineStatus.engine : null;

  /* ---- what is wrong with the plan ---- */

  // The engine checks the plan on every edit, so a problem shows under its
  // field as it is typed and not first at the next run.
  const found = useMemo<Problem[]>(() => {
    if (!engine) return [];
    try {
      return engine.validate(toConfigYaml(config), { now: currentMonth() });
    } catch {
      // A run reports whatever stopped the check.
      return [];
    }
  }, [engine, config]);

  const problems = useMemo(() => {
    const held = Object.values(drafts);
    const paths = new Set(held.map((draft) => draft.path));
    return problemSet(
      [
        // What the engine says about a field whose box holds something else
        // is about a value no longer on screen; the field's own error stands.
        ...found.filter((problem) => !paths.has(problem.path)),
        ...held.map(({ path, message }): Problem => ({ level: 'error', path, where: '', message })),
      ],
      reportDraft,
    );
  }, [found, drafts, reportDraft]);
  const errorCount = useMemo(
    () => problems.all.filter((problem) => problem.level === 'error').length,
    [problems],
  );

  // Once nothing is wrong, the run bar has nothing left to count.
  useEffect(() => {
    if (errorCount === 0) setBlocked(false);
  }, [errorCount]);

  // A failure belongs to the plan as it was. An edit moves on from it.
  useEffect(() => {
    setRunError(null);
    setToolbarError(null);
  }, [config]);

  const runForecast = useCallback(async () => {
    if (!engine) return;
    if (errorCount > 0) {
      setBlocked(true);
      return;
    }
    setRunning(true);
    setBusyLabel('Running the forecast…');
    setRunError(null);
    const configYaml = toConfigYaml(config);
    const started = performance.now();
    const now = currentMonth();
    try {
      const forecast = await engine.forecast(configYaml, { optimize, now });
      setDurationMs(performance.now() - started);
      setResults(forecast);
      setRanWithOptimizer(optimize);
      setLastRunInput(configYaml);
      ranConfig.current = config;
      ranNow.current = now;
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
  }, [engine, config, optimize, errorCount]);

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
    setToolbarError(null);
    // The download is the plan on screen as the engine writes it. A field in
    // error holds something the plan does not, so there is nothing to write
    // yet, whatever an earlier run left behind.
    if (errorCount > 0) {
      setToolbarError(
        errorCount === 1
          ? 'One thing in your plan needs fixing before it can be downloaded.'
          : `${errorCount} things in your plan need fixing before it can be downloaded.`,
      );
      setBlocked(true);
      return;
    }
    const currentInput = toConfigYaml(config);
    // Prefer the engine-canonical YAML from the last run when the editor has
    // not changed since — after an optimizer run that is the adjusted config.
    if (results && lastRunInput === currentInput && results.configYaml) {
      downloadText('moneypath.yaml', results.configYaml, 'application/yaml');
      return;
    }
    setRunning(true);
    setBusyLabel('Preparing the download…');
    try {
      const canonical = await engine.forecast(currentInput, { optimize: false, now: currentMonth() });
      downloadText('moneypath.yaml', canonical.configYaml, 'application/yaml');
      setBusyLabel('Config downloaded.');
    } catch (error) {
      setBusyLabel(null);
      setToolbarError(
        `The plan could not be downloaded. ${error instanceof EngineError ? error.message : `Unexpected engine failure: ${String(error)}`}`,
      );
    } finally {
      setRunning(false);
    }
  }, [engine, config, results, lastRunInput, errorCount]);

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
      // Each adjustment then reads "Applied to your plan" where it is listed.
      setConfig((current) => applyAdjustments(current, adjustments));
    },
    [],
  );

  /* ---- flipping one choice ---- */

  // The flip is of the plan the results came from, run the way they were, so
  // it stays true to them even after the editor has moved on.
  const runFlip = useCallback(
    async (request: FlipRequest): Promise<FlipComparison> => {
      if (!engine || lastRunInput === null) throw new EngineError('The engine is not available.');
      const forecast = await engine.forecast(lastRunInput, {
        optimize: ranWithOptimizer,
        now: ranNow.current,
        flip: request,
      });
      if (!forecast.flip) throw new EngineError('The engine did not report the comparison.');
      return forecast.flip;
    },
    [engine, lastRunInput, ranWithOptimizer],
  );

  /* ---- the earliest month an entry can take ---- */

  // Asked, like a flip, of the plan the results came from, run the way they were.
  const runEarliest = useCallback(
    async (request: EarliestRequest): Promise<EarliestAnswer> => {
      if (!engine || lastRunInput === null) throw new EngineError('The engine is not available.');
      const forecast = await engine.forecast(lastRunInput, {
        optimize: ranWithOptimizer,
        now: ranNow.current,
        earliest: request,
      });
      if (!forecast.earliest) throw new EngineError('The engine did not report the earliest month.');
      return forecast.earliest;
    },
    [engine, lastRunInput, ranWithOptimizer],
  );

  // Like an optimizer adjustment, a flipped path enters the plan only when asked.
  const keepFlip = useCallback(
    (scenarioId: string, choiceId: string, optionId: string, name: string): string | null => {
      if (config !== ranConfig.current) {
        return 'Your plan has changed. Run the forecast again before keeping this path.';
      }
      const next = keepFlippedScenario(config, scenarioId, choiceId, optionId, name);
      if (!next) {
        return 'That path could not be added: its scenario, the choice or the option is no longer in your plan.';
      }
      setConfig(next);
      return null;
    },
    [config],
  );

  const uploadConfig = useCallback(
    async (file: File) => {
      setToolbarError(null);
      setBusyLabel(`Reading ${file.name}…`);
      let text: string;
      try {
        text = await readFileText(file);
      } catch (error) {
        setBusyLabel(null);
        setToolbarError(`${file.name} could not be read. ${String(error)}`);
        return;
      }

      const plan = planUpload(text);
      if (plan.action === 'error') {
        setBusyLabel(null);
        setToolbarError(`${file.name} was not loaded. ${plan.message}`);
        return;
      }

      setConfig(refreshIds(fromConfigDocument(plan.document)));
      setPlanId((current) => current + 1);
      setBusyLabel(`Loaded ${file.name} into the editor.`);
    },
    [],
  );

  const resetConfig = useCallback(() => {
    clearEditorState();
    setConfig(starterConfig());
    setResults(null);
    setLastRunInput(null);
    ranConfig.current = null;
    ranNow.current = '';
    setRunError(null);
    setPlanId((current) => current + 1);
    setTab('workspace');
    setConfirmReset(false);
    setBusyLabel('The editor was reset to the built-in starter config.');
    // The confirmation unmounts, so park focus somewhere predictable.
    workspaceTabRef.current?.focus();
  }, []);

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
            <p>A little perspective for the road ahead.</p>
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
        error={toolbarError}
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

      {restoreNote ? (
        <div class="banner banner--warn banner--dismissable" role="status">
          <p>{restoreNote}</p>
          <button type="button" class="btn btn--quiet" onClick={() => setRestoreNote(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {unsaved ? (
        <div class="banner banner--warn" role="status">
          <p>
            This browser is not saving your plan, so closing or reloading this page will lose it. Use
            Download Config to keep a copy.
          </p>
        </div>
      ) : null}

      <main>
        <div class="page-intro">
          <div>
            <p class="eyebrow">{tab === 'workspace' ? 'Your financial landscape' : 'Your forecast'}</p>
            <h2>{tab === 'workspace' ? 'Life has possibilities. Plan for them.' : 'See where each path takes you.'}</h2>
            <p class="page-intro__description">
              {tab === 'workspace'
                ? 'Start with today, explore the what-ifs, and find your way forward.'
                : 'Compare your scenarios and follow the details, month by month.'}
            </p>
          </div>
          <PathSketch />
        </div>
        <div
          id="panel-workspace"
          role="tabpanel"
          aria-labelledby="tab-workspace"
          hidden={tab !== 'workspace'}
        >
          <Problems.Provider value={problems}>
          <Workspace
            key={planId}
            config={config}
            onChange={setConfig}
            optimizerEnabled={optimize}
            onOptimizerEnabledChange={(value) => {
              setOptimize(value);
              writeFlag(KEYS.optimize, value);
            }}
            running={running}
            canRun={engine !== null}
            blocked={blocked}
            runError={runError}
            onRun={() => void runForecast()}
          />
          </Problems.Provider>
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
              {warnings.length > 0 ? (
                <section class="run-warnings" aria-labelledby="warnings-heading">
                  <h3 id="warnings-heading">Warnings from this run</h3>
                  <p>None of these stopped the forecast.</p>
                  <ul>
                    {warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <ResultsView
                results={results}
                durationMs={durationMs}
                optimizerRan={ranWithOptimizer}
                onDownloadCsv={downloadCsv}
                statusOf={statusOf}
                onApply={applyAdjustmentsToPlan}
                flip={
                  ranConfig.current ? { plan: ranConfig.current, run: runFlip, onKeep: keepFlip } : undefined
                }
                earliest={ranConfig.current ? { plan: ranConfig.current, run: runEarliest } : undefined}
                guardrails={ranConfig.current?.guardrails}
              />
            </>
          ) : null}
        </div>
      </main>

      <footer class="appfoot">
        <span>
          Engine version <code>{version}</code>
        </span>
        <span>Nothing you enter leaves your machine.</span>
        <a href="https://github.com/iwvelando/moneypath">About this site</a>
      </footer>
    </div>
  );
}
