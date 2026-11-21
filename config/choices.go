package config

import (
	"fmt"
	"reflect"
	"strings"

	"gopkg.in/yaml.v3"
)

// Choice is a decision the plan faces; a scenario selects one of its options
// (spec chapter 03, Choices).
type Choice struct {
	Name    string    `yaml:"name"`
	Options []*Option `yaml:"options"`
}

// Option is one way a choice can go: entries it adds, and common entries it
// changes or removes.
type Option struct {
	Name    string `yaml:"name"`
	Section `yaml:",inline"`
	Change  *Change `yaml:"change,omitempty"`
	Remove  *Remove `yaml:"remove,omitempty"`

	// What the option does to common, by index into each common list. Filled
	// by Validate.
	events      effect[Event]
	loans       effect[Loan]
	investments effect[Investment]
}

type Change struct {
	Events      []*EntryChange[Event]      `yaml:"events,omitempty"`
	Loans       []*EntryChange[Loan]       `yaml:"loans,omitempty"`
	Investments []*EntryChange[Investment] `yaml:"investments,omitempty"`
}

type Remove struct {
	Events      []string `yaml:"events,omitempty"`
	Loans       []string `yaml:"loans,omitempty"`
	Investments []string `yaml:"investments,omitempty"`
}

// EntryChange replaces the fields under Set on the common entry of kind T
// called Name. Set stays a YAML mapping because which fields it lists, and
// which it sets to null, is the content.
type EntryChange[T any] struct {
	Name string    `yaml:"name"`
	Set  yaml.Node `yaml:"set,omitempty"`
}

func (c *EntryChange[T]) UnmarshalYAML(n *yaml.Node) error {
	var raw struct {
		Name string    `yaml:"name"`
		Set  yaml.Node `yaml:"set"`
	}
	if err := n.Decode(&raw); err != nil {
		return err
	}
	canonicalNode(&raw.Set)
	c.Name, c.Set = raw.Name, raw.Set
	return nil
}

// setType is the entry type whose fields Set may list; the unknown-key walk
// uses it to check the keys under set.
func (EntryChange[T]) setType() reflect.Type { return reflect.TypeOf((*T)(nil)).Elem() }

// canonicalNode strips what the canonical form does not carry (comments,
// flow style, anchors, a scalar's spelling), so a set is echoed the way the
// rest of the plan is.
func canonicalNode(n *yaml.Node) {
	if n.Kind == yaml.AliasNode && n.Alias != nil {
		line, col := n.Line, n.Column
		*n = *n.Alias
		n.Line, n.Column = line, col
	}
	n.Anchor, n.HeadComment, n.LineComment, n.FootComment = "", "", "", ""
	switch n.Kind {
	case yaml.MappingNode, yaml.SequenceNode:
		n.Style = 0
		for i, c := range n.Content {
			cp := *c
			canonicalNode(&cp)
			n.Content[i] = &cp
		}
	case yaml.ScalarNode:
		// A timestamp keeps its text: every date field is a string, which takes
		// the text as written, and Go's spelling of the time would not be it.
		if n.ShortTag() == "!!timestamp" {
			n.Style = 0
			return
		}
		var v any
		var plain yaml.Node
		if n.Decode(&v) == nil && plain.Encode(v) == nil {
			plain.Line, plain.Column = n.Line, n.Column
			*n = plain
		}
	}
}

func isNull(n *yaml.Node) bool { return n.Kind == yaml.ScalarNode && n.Tag == "!!null" }

// apply returns a copy of base with the fields under Set replaced. A field
// set to null is taken away, so it falls back to its default. What stops it
// is reported as problems placed under path, the change's own.
func (c *EntryChange[T]) apply(base *T, path string) (*T, []Problem) {
	set := join(path, "set")
	if c.Set.Kind != yaml.MappingNode {
		return nil, []Problem{{Level: LevelError, Path: set, Message: "This change does not say which fields to change."}}
	}
	var doc yaml.Node
	if err := doc.Encode(base); err != nil {
		return nil, decodeProblems(err, nil, set)
	}
	var problems []Problem
	for i := 0; i+1 < len(c.Set.Content); i += 2 {
		key, val := c.Set.Content[i], c.Set.Content[i+1]
		switch key.Value {
		case "name":
			problems = append(problems, Problem{Level: LevelError, Path: join(set, "name"), Message: "A change cannot rename the entry."})
			continue
		case "optimize":
			problems = append(problems, Problem{Level: LevelError, Path: join(set, "optimize"), Message: "A change cannot add an optimizer."})
			continue
		}
		at := -1
		for j := 0; j+1 < len(doc.Content); j += 2 {
			if doc.Content[j].Value == key.Value {
				at = j
				break
			}
		}
		switch {
		case isNull(val):
			if at >= 0 {
				doc.Content = append(doc.Content[:at], doc.Content[at+2:]...)
			}
		case at >= 0:
			doc.Content[at+1] = val
		default:
			doc.Content = append(doc.Content, key, val)
		}
	}
	if problems != nil {
		return nil, problems
	}
	out := new(T)
	if err := doc.Decode(out); err != nil {
		return nil, decodeProblems(err, &c.Set, set)
	}
	return out, nil
}

// Selection is one line of a scenario's select: the option taken for a choice.
type Selection struct {
	Choice string
	Option string
}

// Select is a scenario's selections. In YAML it is a mapping from choice name
// to option name; Validate puts it in the order the choices are listed, which
// is the order it is written back in.
type Select []Selection

func (s *Select) UnmarshalYAML(n *yaml.Node) error {
	if isNull(n) {
		*s = nil
		return nil
	}
	if n.Kind != yaml.MappingNode {
		return fmt.Errorf("line %d: select must give one option for each choice, as \"choice name: option name\"", n.Line)
	}
	out := Select{}
	for i := 0; i+1 < len(n.Content); i += 2 {
		key, val := n.Content[i], n.Content[i+1]
		if key.Kind != yaml.ScalarNode || val.Kind != yaml.ScalarNode {
			return fmt.Errorf("line %d: select must give one option for each choice, as \"choice name: option name\"", key.Line)
		}
		// A repeated choice is kept, so Validate can refuse it by scenario.
		out = append(out, Selection{Choice: key.Value, Option: val.Value})
	}
	*s = out
	return nil
}

func (s Select) MarshalYAML() (any, error) {
	n := &yaml.Node{Kind: yaml.MappingNode}
	for _, sel := range s {
		var k, v yaml.Node
		if err := k.Encode(sel.Choice); err != nil {
			return nil, err
		}
		if err := v.Encode(sel.Option); err != nil {
			return nil, err
		}
		n.Content = append(n.Content, &k, &v)
	}
	return n, nil
}

// effect is what one option does to one common list, by index into it.
type effect[T any] struct {
	changed map[int]*T
	removed map[int]bool
}

func (e *effect[T]) reset() {
	e.changed, e.removed = map[int]*T{}, map[int]bool{}
}

// applyEffects returns base as the given options' effects leave it: a changed
// entry in its place, a removed one dropped.
func applyEffects[T any](base []*T, effects []*effect[T]) []*T {
	var out []*T
	for i, entry := range base {
		keep := true
		for _, fx := range effects {
			if fx.removed[i] {
				keep = false
			}
			if c, ok := fx.changed[i]; ok {
				entry = c
			}
		}
		if keep {
			out = append(out, entry)
		}
	}
	return out
}

// entryRef names a common entry the way change and remove do.
type entryRef struct{ kind, name string }

// choices checks every choice and option (spec chapter 03, Choices,
// Validation) and works out what each option does to common. It runs after
// common itself has been checked.
func (c *checker) choices(cfg *Config) {
	choiceSeen := map[string]bool{}
	owner := map[entryRef]string{} // the choice whose options change or remove the entry
	for ci, ch := range cfg.Choices {
		path := join("choices", ci)
		if ch == nil {
			c.fail(path, "This choice is empty.")
			continue
		}
		switch {
		case ch.Name == "":
			c.fail(join(path, "name"), "The choice needs a name.")
		case choiceSeen[ch.Name]:
			c.fail(join(path, "name"), "Another choice is already named “%s”. Give each choice its own name.", ch.Name)
		}
		choiceSeen[ch.Name] = true
		if len(ch.Options) == 0 {
			c.fail(join(path, "options"), "A choice needs at least one option.")
		}
		optionSeen := map[string]bool{}
		for oi, opt := range ch.Options {
			p := join(path, "options", oi)
			if opt == nil {
				c.fail(p, "This option is empty.")
				continue
			}
			switch {
			case opt.Name == "":
				c.fail(join(p, "name"), "The option needs a name.")
			case optionSeen[opt.Name]:
				c.fail(join(p, "name"), "Another option of this choice is already named “%s”. Give each option its own name.", opt.Name)
			}
			optionSeen[opt.Name] = true
			c.section(&opt.Section, p, "An optimizer cannot be used on an option’s event; put the event in a scenario’s own events.")
			c.optionEffects(cfg, ch, opt, p, owner)
		}
	}
}

func (c *checker) optionEffects(cfg *Config, ch *Choice, opt *Option, path string, owner map[entryRef]string) {
	opt.events.reset()
	opt.loans.reset()
	opt.investments.reset()

	touched := map[entryRef]bool{}
	// claim finds the one common entry of that kind and name and records
	// that this option changes or removes it. at is the path of the change
	// or removal.
	claim := func(at, action, kind, name string, names []string) (int, bool) {
		if name == "" {
			c.fail(at, "Name the %s to %s. A baseline %s without a name cannot be changed or removed.", kind, action, kind)
			return 0, false
		}
		found, count := -1, 0
		for i, n := range names {
			if n == name {
				found = i
				count++
			}
		}
		if count == 0 {
			c.fail(at, "The baseline has no %s named “%s”.", kind, name)
			return 0, false
		}
		if count > 1 {
			c.fail(at, "The baseline has %d %ss named “%s”. Give each a name of its own so an option can %s one.", count, kind, name, action)
			return 0, false
		}
		ref := entryRef{kind, name}
		if touched[ref] {
			c.fail(at, "This option changes or removes the baseline %s “%s” more than once.", kind, name)
			return 0, false
		}
		touched[ref] = true
		if other, ok := owner[ref]; ok && other != ch.Name {
			c.fail(at, "The baseline %s “%s” is changed or removed by two choices, “%s” and “%s”. Only the options of one choice can change or remove an entry.",
				kind, name, other, ch.Name)
			return 0, false
		}
		owner[ref] = ch.Name
		return found, true
	}

	common := &cfg.Common
	eventNames := make([]string, len(common.Events))
	for i, ev := range common.Events {
		if ev != nil {
			eventNames[i] = ev.Name
		}
	}
	loanNames := make([]string, len(common.Loans))
	for i, l := range common.Loans {
		if l != nil {
			loanNames[i] = l.Name
		}
	}
	investmentNames := make([]string, len(common.Investments))
	for i, inv := range common.Investments {
		if inv != nil {
			investmentNames[i] = inv.Name
		}
	}

	if rm := opt.Remove; rm != nil {
		for k, name := range rm.Events {
			if at, ok := claim(join(path, "remove", "events", k), "remove", "event", name, eventNames); ok {
				opt.events.removed[at] = true
			}
		}
		for k, name := range rm.Loans {
			if at, ok := claim(join(path, "remove", "loans", k), "remove", "loan", name, loanNames); ok {
				opt.loans.removed[at] = true
			}
		}
		for k, name := range rm.Investments {
			if at, ok := claim(join(path, "remove", "investments", k), "remove", "investment", name, investmentNames); ok {
				opt.investments.removed[at] = true
			}
		}
	}

	if chg := opt.Change; chg != nil {
		const noOptimize = "An optimizer cannot be used on a baseline event; put the event in a scenario."
		for k, change := range chg.Events {
			p := join(path, "change", "events", k)
			at, ok := claim(p, "change", "event", nameOf(change), eventNames)
			if !ok {
				continue
			}
			if changed := applyChange(c, change, common.Events[at], p, func(c *checker, ev *Event, path string) {
				c.event(ev, path, noOptimize)
			}); changed != nil {
				opt.events.changed[at] = changed
			}
		}
		for k, change := range chg.Loans {
			p := join(path, "change", "loans", k)
			at, ok := claim(p, "change", "loan", nameOf(change), loanNames)
			if !ok {
				continue
			}
			if changed := applyChange(c, change, common.Loans[at], p, (*checker).loan); changed != nil {
				opt.loans.changed[at] = changed
			}
		}
		for k, change := range chg.Investments {
			p := join(path, "change", "investments", k)
			at, ok := claim(p, "change", "investment", nameOf(change), investmentNames)
			if !ok {
				continue
			}
			if changed := applyChange(c, change, common.Investments[at], p, (*checker).investment); changed != nil {
				opt.investments.changed[at] = changed
			}
		}
	}
}

func nameOf[T any](c *EntryChange[T]) string {
	if c == nil {
		return ""
	}
	return c.Name
}

// applyChange builds the changed entry and checks it as changed, placing its
// problems under the change's set. A problem the entry raises as written in
// common is not repeated for its changed form.
func applyChange[T any](c *checker, change *EntryChange[T], base *T, path string, check func(*checker, *T, string)) *T {
	changed, problems := change.apply(base, path)
	if problems != nil {
		c.problems = append(c.problems, problems...)
		return nil
	}
	set := join(path, "set")
	sub := &checker{start: c.start, end: c.end, window: c.window, inflation: c.inflation}
	check(sub, changed, set)

	already := map[Problem]bool{}
	if unchanged, problems := (&EntryChange[T]{Set: yaml.Node{Kind: yaml.MappingNode}}).apply(base, path); problems == nil {
		baseline := &checker{start: c.start, end: c.end, window: c.window, inflation: c.inflation}
		check(baseline, unchanged, set)
		for _, p := range baseline.problems {
			already[p] = true
		}
	}
	for _, p := range sub.problems {
		if !already[p] {
			c.problems = append(c.problems, p)
		}
	}
	return changed
}

// resolveScenarios checks each scenario's select and resolves the scenario
// into the two lists the engine simulates (spec chapter 03, Choices,
// Resolution). Inactive scenarios are resolved and checked like any other.
func (c *checker) resolveScenarios(cfg *Config) {
	for si, sc := range cfg.Scenarios {
		if sc == nil {
			continue
		}
		if len(cfg.Choices) == 0 && len(sc.Select) == 0 {
			sc.Resolved, sc.ResolvedShared = sc.Section, cfg.Common
			continue
		}
		path := join("scenarios", si)
		picked := map[string]string{}
		for _, sel := range sc.Select {
			if _, dup := picked[sel.Choice]; dup {
				c.fail(join(path, "select"), "The selections name the choice “%s” more than once.", sel.Choice)
				continue
			}
			picked[sel.Choice] = sel.Option
		}

		var selected []*Option
		ordered := Select{}
		complete := true
		for ci, ch := range cfg.Choices {
			if ch == nil {
				complete = false
				continue
			}
			name, ok := picked[ch.Name]
			if !ok {
				c.fail(join(path, "select", ci), "Pick an option for the choice “%s”.", ch.Name)
				complete = false
				continue
			}
			delete(picked, ch.Name)
			var opt *Option
			var names []string
			for _, o := range ch.Options {
				if o == nil {
					continue
				}
				names = append(names, o.Name)
				if o.Name == name {
					opt = o
				}
			}
			if opt == nil {
				c.fail(join(path, "select", ci), "The choice “%s” has no option named “%s”. Its options are: %s.",
					ch.Name, name, strings.Join(names, ", "))
				complete = false
				continue
			}
			selected = append(selected, opt)
			ordered = append(ordered, Selection{Choice: ch.Name, Option: name})
		}
		// Whatever is left names no choice of the plan, in the order written.
		for _, sel := range sc.Select {
			if _, left := picked[sel.Choice]; left {
				c.fail(join(path, "select"), "The selections name a choice, “%s”, that this plan does not have.", sel.Choice)
				delete(picked, sel.Choice)
				complete = false
			}
		}
		if complete {
			sc.Select = ordered
		}

		own := sc.Section
		resolved := Section{
			Events:      append([]*Event(nil), own.Events...),
			Loans:       append([]*Loan(nil), own.Loans...),
			Investments: append([]*Investment(nil), own.Investments...),
		}
		var evFx []*effect[Event]
		var loanFx []*effect[Loan]
		var invFx []*effect[Investment]
		for _, opt := range selected {
			resolved.Events = append(resolved.Events, opt.Events...)
			resolved.Loans = append(resolved.Loans, opt.Loans...)
			resolved.Investments = append(resolved.Investments, opt.Investments...)
			evFx = append(evFx, &opt.events)
			loanFx = append(loanFx, &opt.loans)
			invFx = append(invFx, &opt.investments)
		}
		// Names repeated within the scenario's own list are already reported there.
		names := map[string]bool{}
		for i, inv := range resolved.Investments {
			if inv == nil || inv.Name == "" {
				continue
			}
			if names[inv.Name] && i >= len(own.Investments) {
				c.fail(join(path, "investments"), "“%s” names more than one investment among this scenario’s own and those its selected options add. Give each its own name.", inv.Name)
			}
			names[inv.Name] = true
		}
		sc.Resolved = resolved
		sc.ResolvedShared = Section{
			Events:      applyEffects(cfg.Common.Events, evFx),
			Loans:       applyEffects(cfg.Common.Loans, loanFx),
			Investments: applyEffects(cfg.Common.Investments, invFx),
		}
	}
}
