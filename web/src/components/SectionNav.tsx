export interface SectionRef {
  id: string;
  label: string;
  /**
   * Reachable with Previous/Next, but given no link of its own. Common
   * settings sits directly under the short, fixed Simulation section, so a
   * jump to Simulation already puts it on screen — and the pinned bar has
   * better uses for the width than a second link to the same place.
   */
  stepOnly?: boolean;
}

interface SectionNavProps {
  sections: SectionRef[];
  currentId: string;
  onJump: (id: string) => void;
}

interface StepProps {
  target: SectionRef | undefined;
  direction: 'Previous' | 'Next';
  onJump: (id: string) => void;
}

/**
 * Arrow-only stepper. The target's name goes in the accessible name and the
 * tooltip, which says more than a bare "Next" would and costs no width.
 * The two render as a pair: a lone forward arrow beside a horizontally
 * scrolling list reads as "scroll right" rather than "next section".
 */
function Step({ target, direction, onJump }: StepProps) {
  const name = target ? `${direction} section: ${target.label}` : `${direction} section`;
  return (
    <button
      type="button"
      class="btn btn--quiet sectionnav__step"
      disabled={!target}
      aria-label={name}
      title={name}
      onClick={() => target && onJump(target.id)}
    >
      <span aria-hidden="true">{direction === 'Previous' ? '←' : '→'}</span>
    </button>
  );
}

/**
 * Sticky section navigation with previous/next controls. Jumping
 * scrolls to the section and briefly highlights it — see `Workspace`.
 */
export function SectionNav({ sections, currentId, onJump }: SectionNavProps) {
  const index = Math.max(
    0,
    sections.findIndex((section) => section.id === currentId),
  );

  return (
    <nav class="sectionnav" aria-label="Editor sections">
      <div class="sectionnav__steps">
        <Step target={sections[index - 1]} direction="Previous" onJump={onJump} />
        <Step target={sections[index + 1]} direction="Next" onJump={onJump} />
      </div>
      <ul class="sectionnav__list">
        {sections
          .filter((section) => !section.stepOnly)
          .map((section) => (
            <li key={section.id}>
              <button
                type="button"
                class={section.id === currentId ? 'sectionnav__link is-current' : 'sectionnav__link'}
                aria-current={section.id === currentId ? 'true' : undefined}
                onClick={() => onJump(section.id)}
              >
                {section.label}
              </button>
            </li>
          ))}
      </ul>
    </nav>
  );
}
