// Package money holds the currency display format shared by the pretty
// renderer and the optimizer's display values (spec chapter 05).
package money

import (
	"fmt"
	"strings"
)

// Fixed renders x with two decimals and no symbol or separators. An amount
// that rounds to zero is 0.00, never -0.00.
func Fixed(x float64) string {
	s := fmt.Sprintf("%.2f", x)
	if s == "-0.00" {
		return "0.00"
	}
	return s
}

// Format renders x as $1,234.56 (negative: -$1,234.56).
func Format(x float64) string {
	s := Fixed(x)
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	dot := strings.IndexByte(s, '.')
	intPart, frac := s[:dot], s[dot:]
	var groups []string
	for len(intPart) > 3 {
		groups = append([]string{intPart[len(intPart)-3:]}, groups...)
		intPart = intPart[:len(intPart)-3]
	}
	groups = append([]string{intPart}, groups...)
	out := "$" + strings.Join(groups, ",") + frac
	if neg {
		out = "-" + out
	}
	return out
}
