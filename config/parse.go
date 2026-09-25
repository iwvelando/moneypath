package config

import (
	"fmt"
	"reflect"
	"strings"

	"gopkg.in/yaml.v3"
)

// Parse decodes a v2 YAML document. Unknown keys are returned as warnings
// (spec chapter 03: they must not be hard errors).
func Parse(data []byte) (*Config, []string, error) {
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, nil, fmt.Errorf("parsing config: %w", err)
	}
	var cfg Config
	if err := doc.Decode(&cfg); err != nil {
		return nil, nil, fmt.Errorf("parsing config: %w", err)
	}
	var warnings []string
	if len(doc.Content) > 0 {
		collectUnknownKeys(doc.Content[0], reflect.TypeOf(Config{}), "", &warnings)
	}
	return &cfg, warnings, nil
}

// knownFields maps yaml key -> field type for a struct type, flattening
// inline structs.
func knownFields(t reflect.Type) map[string]reflect.Type {
	out := map[string]reflect.Type{}
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
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

func collectUnknownKeys(node *yaml.Node, t reflect.Type, path string, warnings *[]string) {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	switch node.Kind {
	case yaml.MappingNode:
		if t.Kind() != reflect.Struct {
			return
		}
		fields := knownFields(t)
		for i := 0; i+1 < len(node.Content); i += 2 {
			keyNode, valNode := node.Content[i], node.Content[i+1]
			key := keyNode.Value
			ft, ok := fields[key]
			p := key
			if path != "" {
				p = path + "." + key
			}
			if !ok {
				*warnings = append(*warnings, fmt.Sprintf("unknown key %q", p))
				continue
			}
			collectUnknownKeys(valNode, ft, p, warnings)
		}
	case yaml.SequenceNode:
		if t.Kind() != reflect.Slice && t.Kind() != reflect.Array {
			return
		}
		for i, item := range node.Content {
			collectUnknownKeys(item, t.Elem(), fmt.Sprintf("%s[%d]", path, i), warnings)
		}
	}
}
