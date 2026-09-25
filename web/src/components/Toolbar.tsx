import { useRef } from 'preact/hooks';
import { THEMES, THEME_LABEL, type Theme } from '../state/theme';

interface ToolbarProps {
  running: boolean;
  busyLabel: string | null;
  engineReady: boolean;
  theme: Theme;
  onUpload: (file: File) => void;
  onDownloadConfig: () => void;
  /** Says what the download will contain when that is not simply the plan on screen. */
  configHint: string | null;
  onReset: () => void;
  onThemeChange: (theme: Theme) => void;
}

export function Toolbar({
  running,
  busyLabel,
  engineReady,
  theme,
  onUpload,
  onDownloadConfig,
  configHint,
  onReset,
  onThemeChange,
}: ToolbarProps) {
  const fileInput = useRef<HTMLInputElement | null>(null);

  return (
    <div class="toolbar">
      <div class="toolbar__group">
        <button
          type="button"
          class="btn"
          disabled={running}
          onClick={() => fileInput.current?.click()}
        >
          Upload Config
        </button>
        <input
          ref={fileInput}
          class="visually-hidden"
          type="file"
          accept=".yaml,.yml,text/yaml,application/yaml"
          aria-label="Upload a moneypath config file"
          onChange={(event) => {
            const input = event.currentTarget as HTMLInputElement;
            const file = input.files?.[0];
            if (file) onUpload(file);
            input.value = '';
          }}
        />

        <button
          type="button"
          class="btn"
          disabled={running || !engineReady}
          aria-describedby={configHint ? 'download-config-hint' : undefined}
          onClick={onDownloadConfig}
        >
          Download Config
        </button>
        <button type="button" class="btn" disabled={running} onClick={onReset}>
          Reset Config
        </button>
        {/* Its own line, so appearing never shifts the button row. */}
        {configHint ? (
          <small id="download-config-hint" class="toolbar__hint">
            {configHint}
          </small>
        ) : null}
      </div>

      <div class="toolbar__group">
        <fieldset class="segmented">
          <legend class="visually-hidden">Theme</legend>
          {THEMES.map((option) => (
            <label key={option} class={theme === option ? 'is-active' : undefined}>
              <input
                type="radio"
                name="theme"
                value={option}
                checked={theme === option}
                onChange={() => onThemeChange(option)}
              />
              {THEME_LABEL[option]}
            </label>
          ))}
        </fieldset>
      </div>

      <p class="toolbar__status" role="status" aria-live="polite">
        {busyLabel ?? ''}
      </p>
    </div>
  );
}
