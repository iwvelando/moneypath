import { createContext } from 'preact';

/**
 * A prefix for the element ids of the entries inside one form. An option that
 * changes a baseline entry shows that entry's form a second time, nested lists
 * and all, so the same rows are on the page twice and their ids must differ.
 */
export const CardScope = createContext('');
