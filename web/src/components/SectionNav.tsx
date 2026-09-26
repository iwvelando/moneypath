import { WorkbarDisclosure } from './WorkbarDisclosure';

export interface SectionRef {
  id: string;
  label: string;
  children?: SectionRef[];
}

interface SectionNavProps {
  sections: SectionRef[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJump: (id: string) => void;
}

export function SectionNav({ sections, open, onOpenChange, onJump }: SectionNavProps) {
  const entry = (section: SectionRef) => (
    <li key={section.id}>
      <button
        type="button"
        class="sectionnav__link"
        onClick={() => {
          onOpenChange(false);
          onJump(section.id);
        }}
      >
        {section.label}
      </button>
      {section.children?.length ? (
        <ul class="sectionnav__children">{section.children.map(entry)}</ul>
      ) : null}
    </li>
  );

  return (
    <nav class="sectionnav" aria-label="Editor sections">
      <WorkbarDisclosure
        id="sectionnav-panel"
        className="sectionnav"
        triggerClass="sectionnav__trigger"
        label="Jump to section"
        panelLabel="Jump destinations"
        open={open}
        onOpenChange={onOpenChange}
      >
        <ul class="sectionnav__list">{sections.map(entry)}</ul>
      </WorkbarDisclosure>
    </nav>
  );
}
