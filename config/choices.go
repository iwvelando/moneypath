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
// set to null is taken away, so it falls back to its default.
func (c *EntryChange[T]) apply(base *T) (*T, error) {
	if c.Set.Kind != yaml.MappingNode {
		return nil, fmt.Errorf("set is required and lists the fields to replace, each as \"field: value\"")
	}
	var doc yaml.Node
	if err := doc.Encode(base); err != nil {
		return nil, err
	}
	for i := 0; i+1 < len(c.Set.Content); i += 2 {
		key, val := c.Set.Content[i], c.Set.Content[i+1]
		switch key.Value {
		case "name", "optimize":
			return nil, fmt.Errorf("%s cannot be set", key.Value)
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
	out := new(T)
	if err := doc.Decode(out); err != nil {
		return nil, err
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

// validateChoices checks every choice and option (spec chapter 03, Choices,
// Validation) and works out what each option does to common. It runs after
// common itself has been validated.
func validateChoices(cfg *Config, start, end Month, warns *[]string) error {
	choiceSeen := map[string]bool{}
	owner := map[entryRef]string{} // the choice whose options change or remove the entry
	for ci, ch := range cfg.Choices {
		if ch == nil || ch.Name == "" {
			return fmt.Errorf("choices[%d] has no name", ci)
		}
		if choiceSeen[ch.Name] {
			return fmt.Errorf("duplicate choice name %q", ch.Name)
		}
		choiceSeen[ch.Name] = true
		if len(ch.Options) == 0 {
			return fmt.Errorf("choice %q has no options; a choice needs at least one", ch.Name)
		}
		optionSeen := map[string]bool{}
		for oi, opt := range ch.Options {
			if opt == nil || opt.Name == "" {
				return fmt.Errorf("choice %q: options[%d] has no name", ch.Name, oi)
			}
			if optionSeen[opt.Name] {
				return fmt.Errorf("choice %q: duplicate option name %q", ch.Name, opt.Name)
			}
			optionSeen[opt.Name] = true
			where := fmt.Sprintf("choice %q, option %q", ch.Name, opt.Name)
			const noOptimize = "optimize is not allowed on an option's events; put the event in a scenario's own events"
			if err := validateSection(&opt.Section, where, noOptimize, start, end, warns); err != nil {
				return err
			}
			if err := validateOptionEffects(cfg, ch, opt, where, owner, start, end, warns); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateOptionEffects(cfg *Config, ch *Choice, opt *Option, where string, owner map[entryRef]string, start, end Month, warns *[]string) error {
	opt.events.reset()
	opt.loans.reset()
	opt.investments.reset()

	touched := map[entryRef]bool{}
	// claim finds the one common entry of that kind and name and records
	// that this option changes or removes it.
	claim := func(action, kind, name string, names []string) (int, error) {
		if name == "" {
			return 0, fmt.Errorf("%s: %s: name the %s to %s; a common %s without a name cannot be changed or removed",
				where, action, kind, action, kind)
		}
		at, count := -1, 0
		for i, n := range names {
			if n == name {
				at = i
				count++
			}
		}
		if count == 0 {
			return 0, fmt.Errorf("%s: %s: common has no %s named %q", where, action, kind, name)
		}
		if count > 1 {
			return 0, fmt.Errorf("%s: %s: common has %d %ss named %q; give each a name of its own so an option can %s one",
				where, action, count, kind, name, action)
		}
		ref := entryRef{kind, name}
		if touched[ref] {
			return 0, fmt.Errorf("%s: common %s %q is changed or removed more than once", where, kind, name)
		}
		touched[ref] = true
		if other, ok := owner[ref]; ok && other != ch.Name {
			return 0, fmt.Errorf("common %s %q is changed or removed by two choices, %q and %q; only the options of one choice can change or remove an entry",
				kind, name, other, ch.Name)
		}
		owner[ref] = ch.Name
		return at, nil
	}

	common := &cfg.Common
	eventNames := make([]string, len(common.Events))
	for i, ev := range common.Events {
		eventNames[i] = ev.Name
	}
	loanNames := make([]string, len(common.Loans))
	for i, l := range common.Loans {
		loanNames[i] = l.Name
	}
	investmentNames := make([]string, len(common.Investments))
	for i, inv := range common.Investments {
		investmentNames[i] = inv.Name
	}

	if rm := opt.Remove; rm != nil {
		for _, name := range rm.Events {
			at, err := claim("remove", "event", name, eventNames)
			if err != nil {
				return err
			}
			opt.events.removed[at] = true
		}
		for _, name := range rm.Loans {
			at, err := claim("remove", "loan", name, loanNames)
			if err != nil {
				return err
			}
			opt.loans.removed[at] = true
		}
		for _, name := range rm.Investments {
			at, err := claim("remove", "investment", name, investmentNames)
			if err != nil {
				return err
			}
			opt.investments.removed[at] = true
		}
	}

	if chg := opt.Change; chg != nil {
		w := where + ": change"
		const noOptimize = "optimize is not allowed on common events"
		for _, c := range chg.Events {
			at, err := claim("change", "event", nameOf(c), eventNames)
			if err != nil {
				return err
			}
			changed, err := applyChange(c, common.Events[at], w, "event", warns, func(ev *Event, warns *[]string) error {
				return validateEvent(ev, w, at, noOptimize, start, end, warns)
			})
			if err != nil {
				return err
			}
			opt.events.changed[at] = changed
		}
		for _, c := range chg.Loans {
			at, err := claim("change", "loan", nameOf(c), loanNames)
			if err != nil {
				return err
			}
			changed, err := applyChange(c, common.Loans[at], w, "loan", warns, func(l *Loan, warns *[]string) error {
				return validateLoan(l, w, at, start, end, warns)
			})
			if err != nil {
				return err
			}
			opt.loans.changed[at] = changed
		}
		for _, c := range chg.Investments {
			at, err := claim("change", "investment", nameOf(c), investmentNames)
			if err != nil {
				return err
			}
			changed, err := applyChange(c, common.Investments[at], w, "investment", warns, func(inv *Investment, warns *[]string) error {
				return validateInvestment(inv, w, at, start, end, warns)
			})
			if err != nil {
				return err
			}
			opt.investments.changed[at] = changed
		}
	}
	return nil
}

func nameOf[T any](c *EntryChange[T]) string {
	if c == nil {
		return ""
	}
	return c.Name
}

// applyChange builds the changed entry and validates it as changed. A warning
// the entry raises as written in common is not repeated for its changed form.
func applyChange[T any](c *EntryChange[T], base *T, where, kind string, warns *[]string, validate func(*T, *[]string) error) (*T, error) {
	changed, err := c.apply(base)
	if err != nil {
		return nil, fmt.Errorf("%s: %s %q: %w", where, kind, c.Name, err)
	}
	var got []string
	if err := validate(changed, &got); err != nil {
		return nil, err
	}
	already := map[string]bool{}
	if unchanged, err := (&EntryChange[T]{Set: yaml.Node{Kind: yaml.MappingNode}}).apply(base); err == nil {
		var baseWarns []string
		if validate(unchanged, &baseWarns) == nil {
			for _, w := range baseWarns {
				already[w] = true
			}
		}
	}
	for _, w := range got {
		if !already[w] {
			*warns = append(*warns, w)
		}
	}
	return changed, nil
}

// resolveScenarios validates each scenario's select and resolves the scenario
// into the two lists the engine simulates (spec chapter 03, Choices,
// Resolution). Inactive scenarios are resolved and checked like any other.
func resolveScenarios(cfg *Config) error {
	for _, sc := range cfg.Scenarios {
		if len(cfg.Choices) == 0 && len(sc.Select) == 0 {
			sc.Resolved, sc.ResolvedShared = sc.Section, cfg.Common
			continue
		}
		picked := map[string]string{}
		for _, sel := range sc.Select {
			if _, dup := picked[sel.Choice]; dup {
				return fmt.Errorf("scenario %q: select names the choice %q more than once", sc.Name, sel.Choice)
			}
			picked[sel.Choice] = sel.Option
		}

		var selected []*Option
		ordered := Select{}
		for _, ch := range cfg.Choices {
			name, ok := picked[ch.Name]
			if !ok {
				return fmt.Errorf("scenario %q: select picks no option for the choice %q", sc.Name, ch.Name)
			}
			delete(picked, ch.Name)
			var opt *Option
			names := make([]string, len(ch.Options))
			for i, o := range ch.Options {
				names[i] = o.Name
				if o.Name == name {
					opt = o
				}
			}
			if opt == nil {
				return fmt.Errorf("scenario %q: the choice %q has no option named %q; its options are: %s",
					sc.Name, ch.Name, name, strings.Join(names, ", "))
			}
			selected = append(selected, opt)
			ordered = append(ordered, Selection{Choice: ch.Name, Option: name})
		}
		// Whatever is left names no choice of the plan. Report the first as written.
		for _, sel := range sc.Select {
			if _, left := picked[sel.Choice]; left {
				return fmt.Errorf("scenario %q: select names the choice %q, which this plan does not have", sc.Name, sel.Choice)
			}
		}
		sc.Select = ordered

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
		names := map[string]bool{}
		for _, inv := range resolved.Investments {
			if names[inv.Name] {
				return fmt.Errorf("scenario %q: duplicate investment name %q among its own investments and those its selected options add",
					sc.Name, inv.Name)
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
	return nil
}
