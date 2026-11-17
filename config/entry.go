package config

import (
	"strconv"
	"strings"
)

// Describe says in words where path is in the plan, as a problem's “where”
// does (spec chapter 02, Problems JSON).
func Describe(cfg *Config, path string) string { return locate(cfg.doc, path) }

// PathEntry is an event or a loan of the plan as written, and the form a
// scenario's path gives it.
type PathEntry struct {
	// Event or Loan is the entry on the path: the entry itself for the
	// scenario's own entries and those its selected options add, the changed
	// copy for a baseline entry a selected option changes. Both are nil when
	// the entry is not on the path.
	Event *Event
	Loan  *Loan
	// Name is the entry's name as written.
	Name string
	// IsLoan says which list the entry is in, on the path or not.
	IsLoan bool
}

// OnPath reports whether the entry is on the path.
func (e PathEntry) OnPath() bool { return e.Event != nil || e.Loan != nil }

// LocateEntry finds the event or loan at path, in the form of a problem's
// path, in a validated plan, and gives it as the scenario's path has it
// (spec chapter 04 §11). It reports false when path is not an entry of an
// events or loans list of the plan.
func LocateEntry(cfg *Config, sc *Scenario, path string) (PathEntry, bool) {
	seg := strings.Split(path, ".")
	index := func(s string, n int) (int, bool) {
		i, err := strconv.Atoi(s)
		return i, err == nil && i >= 0 && i < n && strconv.Itoa(i) == s
	}
	selected := map[*Option]bool{}
	var picks []*Option
	for _, sel := range sc.Select {
		for _, ch := range cfg.Choices {
			if ch == nil || ch.Name != sel.Choice {
				continue
			}
			for _, o := range ch.Options {
				if o != nil && o.Name == sel.Option {
					selected[o] = true
					picks = append(picks, o)
				}
			}
		}
	}
	// own gives an entry of a list that is on the path exactly when onPath.
	own := func(s *Section, list, at string, onPath bool) (PathEntry, bool) {
		switch list {
		case "events":
			i, ok := index(at, len(s.Events))
			if !ok || s.Events[i] == nil {
				return PathEntry{}, false
			}
			e := PathEntry{Name: s.Events[i].Name}
			if onPath {
				e.Event = s.Events[i]
			}
			return e, true
		case "loans":
			i, ok := index(at, len(s.Loans))
			if !ok || s.Loans[i] == nil {
				return PathEntry{}, false
			}
			e := PathEntry{Name: s.Loans[i].Name, IsLoan: true}
			if onPath {
				e.Loan = s.Loans[i]
			}
			return e, true
		}
		return PathEntry{}, false
	}
	switch {
	case len(seg) == 3 && seg[0] == "common":
		e, ok := own(&cfg.Common, seg[1], seg[2], true)
		if !ok {
			return e, false
		}
		i, _ := strconv.Atoi(seg[2])
		for _, o := range picks {
			if e.IsLoan {
				if o.loans.removed[i] {
					e.Loan = nil
				} else if c, ok := o.loans.changed[i]; ok {
					e.Loan = c
				}
			} else {
				if o.events.removed[i] {
					e.Event = nil
				} else if c, ok := o.events.changed[i]; ok {
					e.Event = c
				}
			}
		}
		return e, true
	case len(seg) == 4 && seg[0] == "scenarios":
		i, ok := index(seg[1], len(cfg.Scenarios))
		if !ok || cfg.Scenarios[i] == nil {
			return PathEntry{}, false
		}
		return own(&cfg.Scenarios[i].Section, seg[2], seg[3], cfg.Scenarios[i] == sc)
	case len(seg) == 6 && seg[0] == "choices" && seg[2] == "options":
		i, ok := index(seg[1], len(cfg.Choices))
		if !ok || cfg.Choices[i] == nil {
			return PathEntry{}, false
		}
		j, ok := index(seg[3], len(cfg.Choices[i].Options))
		if !ok || cfg.Choices[i].Options[j] == nil {
			return PathEntry{}, false
		}
		o := cfg.Choices[i].Options[j]
		return own(&o.Section, seg[4], seg[5], selected[o])
	}
	return PathEntry{}, false
}
