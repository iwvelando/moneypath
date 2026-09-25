// Package money holds the currency display format shared by the pretty
// renderer and the optimizer's display values (spec chapter 05).
package money

import (
	"fmt"
	"strings"
)

// Format renders x as $1,234.56 (negative: -$1,234.56).
func Format(x float64) string {
	s := fmt.Sprintf("%.2f", x)
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
