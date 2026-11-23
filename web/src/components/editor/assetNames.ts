import { createContext } from 'preact';
import type { ConfigModel } from '../../config/types';

/**
 * Every asset name in the plan, each once and in the plan's order: the
 * baseline's, those an option adds and each scenario's own. These are the
 * names a loan can be secured on; the engine says when the one it names is not
 * on the loan's path.
 */
export function assetNames(config: ConfigModel): string[] {
  const sections = [config.common, ...config.choices.flatMap((choice) => choice.options), ...config.scenarios];
  const names = sections.flatMap((section) => section.assets.map((asset) => asset.name.trim()));
  return [...new Set(names.filter((name) => name !== ''))];
}

/** The plan's asset names, for a loan's "Secured on". */
export const AssetNames = createContext<string[]>([]);
