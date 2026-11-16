import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect } from 'preact/hooks';
import type { Problem } from '../engine/types';

/**
 * Where errors and warnings go. A problem with one field is shown under that
 * field, found by the field's path in the config document, which is how the
 * engine names it. A form says where it is with `At`; a field adds its own
 * key. Nothing here decides what is wrong: the engine does, and a field adds
 * only what the engine never sees, such as text that is not a number.
 */
export interface ProblemSet {
  all: readonly Problem[];
  byPath: ReadonlyMap<string, readonly Problem[]>;
  /** Tells the page that a field holds something the plan cannot carry; null takes it back. */
  report: (path: string, message: string | null) => void;
}

const NONE: readonly Problem[] = [];

export function problemSet(
  problems: readonly Problem[],
  report: ProblemSet['report'] = () => {},
): ProblemSet {
  const byPath = new Map<string, Problem[]>();
  for (const problem of problems) {
    const list = byPath.get(problem.path);
    if (list) list.push(problem);
    else byPath.set(problem.path, [problem]);
  }
  return { all: problems, byPath, report };
}

export const Problems = createContext<ProblemSet>(problemSet([]));

/** The path of the form being rendered; '' outside any. */
const Path = createContext('');

export function joinPath(base: string, sub: string | number): string {
  return base === '' ? String(sub) : `${base}.${sub}`;
}

interface AtProps {
  /** A path from the top of the document. */
  path?: string;
  /** A step further along the current path. */
  sub?: string | number;
  children: ComponentChildren;
}

/** Says where in the config document the fields inside it live. */
export function At({ path, sub, children }: AtProps) {
  const base = useContext(Path);
  const value = path ?? (sub === undefined ? base : joinPath(base, sub));
  return <Path.Provider value={value}>{children}</Path.Provider>;
}

/** The current form's path, or that of one of its fields. */
export function usePath(field?: string): string {
  const base = useContext(Path);
  return field === undefined ? base : joinPath(base, field);
}

export function useProblemsAt(path: string | null): readonly Problem[] {
  const set = useContext(Problems);
  return path === null ? NONE : (set.byPath.get(path) ?? NONE);
}

/** Whether anything at or inside this path stops the plan from running. */
export function useErrorsUnder(path: string): boolean {
  const set = useContext(Problems);
  if (path === '') return false;
  const inside = `${path}.`;
  return set.all.some(
    (problem) => problem.level === 'error' && (problem.path === path || problem.path.startsWith(inside)),
  );
}

/** Reports what only the field knows is wrong, for as long as it is. */
export function useDraftProblem(path: string | null, message: string | null): void {
  const { report } = useContext(Problems);
  useEffect(() => {
    if (path === null || message === null) return;
    report(path, message);
    return () => report(path, null);
  }, [report, path, message]);
}

export interface Note {
  tone: 'error' | 'warning' | 'hint';
  text: string;
}

/** A warning reads as one at a glance: softer than an error, and it says the word. */
export function noteOf(problem: Problem): Note {
  return problem.level === 'warning'
    ? { tone: 'warning', text: `Warning: ${problem.message}` }
    : { tone: 'error', text: problem.message };
}

/**
 * What to say under a field. The field's own message comes first and stands
 * alone when it is an error: the engine would only say the same thing again.
 */
export function notesFor(own: Note | null, problems: readonly Problem[]): Note[] {
  if (own?.tone === 'error') return [own];
  const notes = problems.map(noteOf);
  notes.sort((a, b) => Number(a.tone !== 'error') - Number(b.tone !== 'error'));
  return own ? [own, ...notes] : notes;
}

export function Notes({ id, notes }: { id?: string; notes: readonly Note[] }) {
  if (notes.length === 0) return null;
  return (
    <div id={id} class="field__messages">
      {notes.map((note) => (
        <p key={note.text} class={note.tone === 'hint' ? 'field__message' : `field__message is-${note.tone}`}>
          {note.text}
        </p>
      ))}
    </div>
  );
}

/**
 * Problems with an entry or a list as a whole, shown where that entry or list
 * is. It marks the place even when there is nothing to say, so the page knows
 * a problem here has somewhere to appear.
 */
export function PathProblems({ field, quiet = false }: { field?: string; quiet?: boolean }) {
  const path = usePath(field);
  const problems = useProblemsAt(path);
  const notes = quiet ? [] : problems.map(noteOf);
  return (
    <div class="path-problems" data-path={path} hidden={notes.length === 0}>
      <Notes notes={notes} />
    </div>
  );
}
