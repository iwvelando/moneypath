import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';

/**
 * Hand-rolled inline SVG icons: 16px grid, stroked with currentColor so they
 * inherit each theme's text color. All decorative — every icon is aria-hidden
 * and the adjacent text carries the meaning.
 */

interface IconProps {
  children: ComponentChildren;
}

function Icon({ children }: IconProps) {
  return (
    <svg
      class="icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {children}
    </svg>
  );
}

/** Two slider rails with knobs — simulation settings. */
export function IconSliders() {
  return (
    <Icon>
      <line x1="2" y1="4.5" x2="14" y2="4.5" />
      <circle cx="6" cy="4.5" r="1.7" fill="var(--surface)" />
      <line x1="2" y1="11.5" x2="14" y2="11.5" />
      <circle cx="10" cy="11.5" r="1.7" fill="var(--surface)" />
    </Icon>
  );
}

/** Stacked layers — settings shared by every scenario. */
export function IconLayers() {
  return (
    <Icon>
      <path d="M8 1.8 L14 5 L8 8.2 L2 5 Z" />
      <path d="M2 8.2 L8 11.4 L14 8.2" />
      <path d="M2 11.4 L8 14.6 L14 11.4" />
    </Icon>
  );
}

/** A branching line — alternative scenarios diverging from one plan. */
export function IconBranch() {
  return (
    <Icon>
      <circle cx="4" cy="3.4" r="1.7" />
      <circle cx="4" cy="12.6" r="1.7" />
      <circle cx="12" cy="5.6" r="1.7" />
      <line x1="4" y1="5.1" x2="4" y2="10.9" />
      <path d="M4 9.5 C4 7.6 12 9.4 12 7.3" />
    </Icon>
  );
}

/** Calendar with a marked day — dated cash events. */
export function IconCalendar() {
  return (
    <Icon>
      <rect x="2" y="3" width="12" height="11" rx="2" />
      <line x1="2" y1="6.5" x2="14" y2="6.5" />
      <line x1="5.5" y1="1.5" x2="5.5" y2="3.8" />
      <line x1="10.5" y1="1.5" x2="10.5" y2="3.8" />
      <circle cx="8" cy="10.3" r="1.1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Percent sign — loans and their interest. */
export function IconPercent() {
  return (
    <Icon>
      <line x1="3.6" y1="12.4" x2="12.4" y2="3.6" />
      <circle cx="4.9" cy="4.9" r="2" />
      <circle cx="11.1" cy="11.1" r="2" />
    </Icon>
  );
}

/** Rising bars — invested balances growing. */
export function IconGrowth() {
  return (
    <Icon>
      <line x1="2.2" y1="13.8" x2="13.8" y2="13.8" />
      <line x1="4.6" y1="13.8" x2="4.6" y2="10" stroke-width="2.1" />
      <line x1="8" y1="13.8" x2="8" y2="7.2" stroke-width="2.1" />
      <line x1="11.4" y1="13.8" x2="11.4" y2="4.4" stroke-width="2.1" />
    </Icon>
  );
}

/**
 * The moneypath mark: waypoints on an ascending path, on an accent tile.
 * Matches the favicon so the tab and the page read as the same thing.
 */
export function BrandMark({ size = 34 }: { size?: number }) {
  // Per instance: two marks on one page must not share a gradient id.
  const gradientId = `${useId()}-brand-tile`;
  return (
    <svg
      class="brandmark"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      role="presentation"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="var(--brand-tile-a)" />
          <stop offset="1" stop-color="var(--brand-tile-b)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill={`url(#${gradientId})`} />
      <path
        d="M7 23 L13 16.5 L18 19 L25 9.5"
        fill="none"
        stroke="var(--brand-stroke)"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="7" cy="23" r="1.7" fill="var(--brand-stroke)" />
      <circle cx="13" cy="16.5" r="1.7" fill="var(--brand-stroke)" />
      <circle cx="18" cy="19" r="1.7" fill="var(--brand-stroke)" />
      <circle cx="25" cy="9.5" r="2.6" fill="var(--brand-stroke)" />
      <circle cx="25" cy="9.5" r="1.1" fill="var(--brand-tile-b)" />
    </svg>
  );
}

/** Muted placeholder line for chart-less moments. Decorative only. */
export function EmptyChartSketch() {
  return (
    <svg
      class="empty-sketch"
      viewBox="0 0 140 36"
      width="140"
      height="36"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 30 C24 30 26 14 44 16 S70 28 88 22 S120 6 132 8" stroke-dasharray="1 6" />
      <circle cx="132" cy="8" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
