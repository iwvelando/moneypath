package config

import (
	"fmt"
	"math"
	"reflect"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// Parse decodes a v2 YAML document. Unknown keys are returned as warnings
// (spec chapter 03: they must not be hard errors).
func Parse(data []byte) (*Config, []string, error) {
	cfg, problems := parse(data)
	if err := firstError(problems); err != nil {
		return nil, nil, err
	}
	return cfg, warningsOf(problems), nil
}

// parse decodes a document into a config, or says why it could not. The
// config is nil when any problem is an error.
func parse(data []byte) (*Config, []Problem) {
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, decodeProblems(err, nil, "")
	}
	var root *yaml.Node
	if len(doc.Content) > 0 {
		root = doc.Content[0]
	}
	var cfg Config
	if err := doc.Decode(&cfg); err != nil {
		problems := decodeProblems(err, root, "")
		for i := range problems {
			problems[i].Where = locate(root, problems[i].Path)
		}
		return nil, problems
	}
	cfg.doc = root
	var problems []Problem
	if root != nil {
		collectUnknownKeys(root, reflect.TypeOf(Config{}), "", &problems)
	}
	for i := range problems {
		problems[i].Where = locate(root, problems[i].Path)
	}
	return &cfg, problems
}

// knownFields maps yaml key -> field type for a struct type, flattening
// inline structs.
func knownFields(t reflect.Type) map[string]reflect.Type {
	out := map[string]reflect.Type{}
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		if !f.IsExported() {
			continue
		}
		tag := f.Tag.Get("yaml")
		parts := strings.Split(tag, ",")
		name := parts[0]
		if name == "-" {
			continue
		}
		inline := false
		for _, p := range parts[1:] {
			if p == "inline" {
				inline = true
			}
		}
		if inline {
			for k, v := range knownFields(f.Type) {
				out[k] = v
			}
			continue
		}
		if name == "" {
			name = strings.ToLower(f.Name)
		}
		out[name] = f.Type
	}
	return out
}

// collectUnknownKeys walks the document beside the type it was decoded into
// and reports what decoding lets through in silence: a key the type does not
// have, and a fraction where a whole number belongs.
func collectUnknownKeys(node *yaml.Node, t reflect.Type, path string, problems *[]Problem) {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	// A growth takes any value as written, and Check says what is wrong with it.
	if t == reflect.TypeOf(Growth{}) {
		return
	}
	// A value reached through an alias is the value it stands for, at the
	// place the alias is written.
	if node.Kind == yaml.AliasNode && node.Alias != nil {
		node = node.Alias
	}
	switch node.Kind {
	case yaml.ScalarNode:
		// yaml reads 1.5 into a whole-number field as 1 without a word.
		if t.Kind() == reflect.Int && node.ShortTag() == "!!float" {
			if v, err := strconv.ParseFloat(node.Value, 64); err == nil && v != math.Trunc(v) {
				*problems = append(*problems, Problem{Level: LevelError, Path: path, Message: kindSentence("int")})
			}
		}
	case yaml.MappingNode:
		if t.Kind() != reflect.Struct {
			return
		}
		fields := knownFields(t)
		// The keys under a change's set are those of the entry it changes.
		if c, ok := reflect.New(t).Interface().(interface{ setType() reflect.Type }); ok {
			fields["set"] = c.setType()
		}
		for i := 0; i+1 < len(node.Content); i += 2 {
			keyNode, valNode := node.Content[i], node.Content[i+1]
			key := keyNode.Value
			ft, ok := fields[key]
			p := join(path, key)
			if !ok {
				*problems = append(*problems, Problem{
					Level:   LevelWarning,
					Path:    p,
					Message: fmt.Sprintf("“%s” is not a setting moneypath knows, so it is ignored.", key),
				})
				continue
			}
			collectUnknownKeys(valNode, ft, p, problems)
		}
	case yaml.SequenceNode:
		if t.Kind() != reflect.Slice && t.Kind() != reflect.Array {
			return
		}
		for i, item := range node.Content {
			collectUnknownKeys(item, t.Elem(), join(path, i), problems)
		}
	}
}
