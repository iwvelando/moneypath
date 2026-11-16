package config

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// Level says whether a problem stops a plan from running.
type Level string

const (
	LevelError   Level = "error"
	LevelWarning Level = "warning"
)

// Problem is one rule of spec chapter 03 that a plan breaks, or one warning
// about it (spec chapter 02, Problems JSON).
type Problem struct {
	Level Level `json:"level"`
	// Path is the field's place in the config document, such as
	// "common.loans.0.term"; empty for a problem with the whole document.
	Path string `json:"path"`
	// Where is that place in the reader's words; empty when Path names none.
	Where string `json:"where"`
	// Message is one sentence that does not repeat the place.
	Message string `json:"message"`
}

// String is the problem as text on its own: the place, then the sentence.
func (p Problem) String() string {
	if p.Where == "" {
		return p.Message
	}
	return p.Where + ": " + p.Message
}

// Error lets the first error of a plan stand for the refusal to run it.
func (p Problem) Error() string { return p.String() }

// Load parses and validates a plan and returns everything wrong with it. The
// config is nil when the document could not be read at all; it is ready for
// the engine only when no problem is an error.
func Load(data []byte, now Month) (*Config, []Problem) {
	cfg, problems := parse(data)
	if cfg == nil {
		return nil, problems
	}
	// A value of the wrong kind is one mistake. The rules about its size are
	// not held against it too: they would be judging what it was read as.
	misread := map[string]bool{}
	for _, p := range problems {
		if p.Level == LevelError {
			misread[p.Path] = true
		}
	}
	for _, p := range Check(cfg, now) {
		if p.Level == LevelError && misread[p.Path] {
			continue
		}
		problems = append(problems, p)
	}
	return cfg, problems
}

// firstError is the first problem that stops the plan, as an error.
func firstError(problems []Problem) error {
	for _, p := range problems {
		if p.Level == LevelError {
			return p
		}
	}
	return nil
}

// warningsOf is the warnings among problems, each as text on its own.
func warningsOf(problems []Problem) []string {
	var out []string
	for _, p := range problems {
		if p.Level == LevelWarning {
			out = append(out, p.String())
		}
	}
	return out
}

// join extends a path by one key or list position.
func join(path string, parts ...any) string {
	for _, part := range parts {
		s := fmt.Sprint(part)
		if path == "" {
			path = s
		} else {
			path += "." + s
		}
	}
	return path
}

// The reader's word for the entries of each list, by the list's key.
var nouns = map[string]string{
	"scenarios":              "Scenario",
	"choices":                "Choice",
	"options":                "option",
	"events":                 "event",
	"loans":                  "loan",
	"investments":            "investment",
	"extraPrincipalPayments": "extra payment",
	"contributions":          "contribution",
	"withdrawals":            "withdrawal",
}

// locate says in words where path is in the document: each entry on the way
// by its name, or by its number from 1 when it has none. doc may be nil, and
// the path may run past what the document holds; entries are then numbered.
func locate(doc *yaml.Node, path string) string {
	if path == "" {
		return ""
	}
	segments := strings.Split(path, ".")
	switch segments[0] {
	case "simulation", "recommendations":
		return "Simulation"
	}
	var parts []string
	node := doc
	noun, verb := "", ""
	for _, seg := range segments {
		index, err := strconv.Atoi(seg)
		if err != nil {
			node = child(node, seg)
			switch seg {
			case "common":
				parts = append(parts, "Baseline")
			case "change":
				verb = "changed "
			case "remove":
				verb = "removed "
			case "select":
				return strings.Join(parts, ", ")
			}
			noun = nouns[seg]
			continue
		}
		node = item(node, index)
		if noun == "" {
			continue
		}
		name := ""
		if node != nil && node.Kind == yaml.ScalarNode {
			name = node.Value // a removal names its target outright
		} else if n := child(node, "name"); n != nil && n.Kind == yaml.ScalarNode {
			name = n.Value
		}
		if name != "" {
			parts = append(parts, fmt.Sprintf("%s%s “%s”", verb, noun, name))
		} else {
			parts = append(parts, fmt.Sprintf("%s%s %d", verb, noun, index+1))
		}
		noun, verb = "", ""
	}
	return strings.Join(parts, ", ")
}

func child(node *yaml.Node, key string) *yaml.Node {
	if node == nil || node.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		if node.Content[i].Value == key {
			return node.Content[i+1]
		}
	}
	return nil
}

func item(node *yaml.Node, index int) *yaml.Node {
	if node == nil || node.Kind != yaml.SequenceNode || index >= len(node.Content) {
		return nil
	}
	return node.Content[index]
}

// A yaml.v3 type error: the line, the value as written and the Go type the
// field wanted.
var typeError = regexp.MustCompile("^line (\\d+): cannot unmarshal \\S+ `(.*)` into (\\S+)$")

// kindSentence says what a field takes, from the Go type that refused a value.
func kindSentence(goType string) string {
	switch {
	case strings.HasPrefix(goType, "int"):
		return "This must be a whole number."
	case strings.HasPrefix(goType, "float"):
		return "This must be a number."
	case goType == "bool":
		return "This must be either true or false."
	case goType == "string":
		return "This must be text."
	}
	return "This value is not the kind its field takes."
}

// decodeProblems turns a decoding failure into problems. A value of the wrong
// kind is placed at its field, found under root (whose own path is base) by
// the line and spelling yaml reports; anything else is about the document.
func decodeProblems(err error, root *yaml.Node, base string) []Problem {
	var typed *yaml.TypeError
	if !errors.As(err, &typed) {
		return []Problem{{Level: LevelError, Message: sentence(strings.TrimPrefix(err.Error(), "yaml: "))}}
	}
	var out []Problem
	for _, line := range typed.Errors {
		m := typeError.FindStringSubmatch(line)
		if m == nil {
			out = append(out, Problem{Level: LevelError, Path: base, Message: sentence(line)})
			continue
		}
		at, _ := strconv.Atoi(m[1])
		path, found := findScalar(root, base, at, m[2])
		if !found {
			path = base
		}
		out = append(out, Problem{Level: LevelError, Path: path, Message: kindSentence(m[3])})
	}
	return out
}

// sentence makes a library's message read as one: a capital and a full stop.
func sentence(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "This file could not be read as a plan."
	}
	s = strings.ToUpper(s[:1]) + s[1:]
	if !strings.HasSuffix(s, ".") {
		s += "."
	}
	return "This file could not be read as a plan. " + s
}

// findScalar finds the value written as text on the given line under node,
// and returns its path.
func findScalar(node *yaml.Node, path string, line int, text string) (string, bool) {
	if node == nil {
		return "", false
	}
	switch node.Kind {
	case yaml.DocumentNode:
		for _, c := range node.Content {
			if p, ok := findScalar(c, path, line, text); ok {
				return p, true
			}
		}
	case yaml.MappingNode:
		for i := 0; i+1 < len(node.Content); i += 2 {
			if p, ok := findScalar(node.Content[i+1], join(path, node.Content[i].Value), line, text); ok {
				return p, true
			}
		}
	case yaml.SequenceNode:
		for i, c := range node.Content {
			if p, ok := findScalar(c, join(path, i), line, text); ok {
				return p, true
			}
		}
	case yaml.ScalarNode:
		if node.Line == line && node.Value == text {
			return path, true
		}
	}
	return "", false
}
