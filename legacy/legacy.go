// Package legacy converts finance-forecast-era (v1) configs to the v2
// format (spec chapter 07). The conversion works on the YAML node tree so
// unknown keys and scalar formatting carry through untouched.
package legacy

import (
	"fmt"
	"strconv"

	"gopkg.in/yaml.v3"

	"github.com/iwvelando/moneypath/config"
)

// Migrate converts a legacy YAML document to v2 YAML, returning the
// converted document and informational notices.
func Migrate(data []byte) ([]byte, []string, error) {
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, nil, fmt.Errorf("input is not parseable YAML: %w", err)
	}
	if len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return nil, nil, fmt.Errorf("input is not a YAML mapping document")
	}
	root := doc.Content[0]
	var notices []string

	if v := mapGet(root, "version"); v != nil {
		if v.Value == "2" {
			return nil, nil, fmt.Errorf("config already contains 'version: 2'; nothing to migrate")
		}
		return nil, nil, fmt.Errorf("config contains an unexpected 'version' field (%s); not a legacy config", v.Value)
	}
	common := mapGet(root, "common")
	if common == nil || mapGet(common, "deathDate") == nil {
		return nil, nil, fmt.Errorf("legacy config lacks common.deathDate; cannot determine the simulation end")
	}

	// simulation: from top-level startDate, common.deathDate,
	// common.startingValue (rules 2).
	simulation := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
	if sd := mapGet(root, "startDate"); sd != nil {
		mapAppend(simulation, "startDate", sd)
	}
	mapAppend(simulation, "endDate", mapGet(common, "deathDate"))
	if sv := mapGet(common, "startingValue"); sv != nil {
		mapAppend(simulation, "startingCash", sv)
	}
	mapDelete(common, "deathDate")
	mapDelete(common, "startingValue")

	// Rules 8: drop logging/output with notices.
	for _, key := range []string{"logging", "output"} {
		if mapGet(root, key) != nil {
			mapDelete(root, key)
			notices = append(notices, fmt.Sprintf("dropped '%s' block: %s is configured via CLI flags in v2", key, key))
		}
	}

	// Rule 5: absent scenario `active` meant false in v1; make it explicit.
	if scenarios := mapGet(root, "scenarios"); scenarios != nil && scenarios.Kind == yaml.SequenceNode {
		for _, sc := range scenarios.Content {
			if sc.Kind == yaml.MappingNode && mapGet(sc, "active") == nil {
				active := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!bool", Value: "false"}
				mapInsertAfter(sc, "name", "active", active)
			}
		}
	}

	// Rules 6 and 7 apply throughout the tree: drop explicit frequency: 0
	// and the optimizer kind/target keys.
	walkMappings(root, func(m *yaml.Node) {
		if f := mapGet(m, "frequency"); f != nil && f.Value == "0" {
			mapDelete(m, "frequency")
		}
		if opt := mapGet(m, "optimize"); opt != nil && opt.Kind == yaml.MappingNode {
			for key, def := range map[string]string{"kind": "cash_floor", "target": "emergencyFund"} {
				if n := mapGet(opt, key); n != nil {
					if n.Value != def {
						notices = append(notices, fmt.Sprintf(
							"optimize.%s %q was dropped: v1 only ever supported %q (such configs never ran in v1 either)",
							key, n.Value, def))
					}
					mapDelete(opt, key)
				}
			}
		}
	})

	if usesChangedSemantics(root, mapGet(simulation, "endDate")) {
		notices = append(notices, "this config uses features whose behavior changed in v2 — mortgage insurance now charges, final loan payments are exact, escrow settles uniformly at loan end, threshold payoffs measure and spend liquid funds, and emergency-fund averaging and the optimizer changed — so review the forecast against your expectations")
	}

	// Assemble the v2 document in canonical order (rules 1–4): version,
	// simulation, recommendations, common, scenarios, then anything else.
	out := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
	mapAppend(out, "version", &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!int", Value: "2"})
	mapAppend(out, "simulation", simulation)
	if r := mapGet(root, "recommendations"); r != nil {
		mapAppend(out, "recommendations", r)
	}
	if len(common.Content) > 0 {
		mapAppend(out, "common", common)
	}
	if s := mapGet(root, "scenarios"); s != nil {
		mapAppend(out, "scenarios", s)
	}
	// Unknown top-level keys carry through untouched (rule 9).
	for i := 0; i+1 < len(root.Content); i += 2 {
		key := root.Content[i].Value
		switch key {
		case "startDate", "recommendations", "common", "scenarios":
			continue
		}
		mapAppend(out, key, root.Content[i+1])
	}

	final := &yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{out}}
	converted, err := yaml.Marshal(final)
	if err != nil {
		return nil, nil, fmt.Errorf("rendering migrated config: %w", err)
	}
	return converted, notices, nil
}

// usesChangedSemantics reports whether the input uses any feature whose
// behavior changed in v2 (spec chapter 07, "Semantics changes migrating users
// should know"): mortgageInsurance, escrow on a loan maturing inside the
// simulated window, earlyPayoffThreshold, or optimize.
func usesChangedSemantics(root, endDate *yaml.Node) bool {
	end := config.Month(-1)
	if endDate != nil {
		if m, err := config.ParseMonth(endDate.Value); err == nil {
			end = m
		}
	}
	found := false
	walkMappings(root, func(m *yaml.Node) {
		if mapGet(m, "optimize") != nil {
			found = true
		}
		if n := mapGet(m, "mortgageInsurance"); n != nil && n.Value != "0" {
			found = true
		}
		if n := mapGet(m, "earlyPayoffThreshold"); n != nil && n.Value != "0" {
			found = true
		}
		// A loan shape with escrow, maturing at or before the end date.
		if esc := mapGet(m, "escrow"); esc != nil && esc.Value != "0" {
			start, term := mapGet(m, "startDate"), mapGet(m, "term")
			if start != nil && term != nil {
				s, err1 := config.ParseMonth(start.Value)
				tn, err2 := strconv.Atoi(term.Value)
				if err1 == nil && err2 == nil && end >= 0 && s+config.Month(tn-1) <= end {
					found = true
				}
			}
			if mapGet(m, "earlyPayoffDate") != nil {
				found = true
			}
		}
	})
	return found
}

// --- yaml.Node mapping helpers ---

func mapGet(m *yaml.Node, key string) *yaml.Node {
	if m == nil || m.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			return m.Content[i+1]
		}
	}
	return nil
}

func mapDelete(m *yaml.Node, key string) {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			m.Content = append(m.Content[:i], m.Content[i+2:]...)
			return
		}
	}
}

func mapAppend(m *yaml.Node, key string, value *yaml.Node) {
	m.Content = append(m.Content,
		&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key}, value)
}

// mapInsertAfter inserts key/value right after afterKey (or appends when
// afterKey is absent).
func mapInsertAfter(m *yaml.Node, afterKey, key string, value *yaml.Node) {
	keyNode := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key}
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == afterKey {
			rest := append([]*yaml.Node{keyNode, value}, m.Content[i+2:]...)
			m.Content = append(m.Content[:i+2], rest...)
			return
		}
	}
	m.Content = append(m.Content, keyNode, value)
}

func walkMappings(n *yaml.Node, fn func(*yaml.Node)) {
	if n == nil {
		return
	}
	if n.Kind == yaml.MappingNode {
		fn(n)
	}
	for _, c := range n.Content {
		walkMappings(c, fn)
	}
}
