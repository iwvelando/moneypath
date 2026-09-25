package config

import (
	"fmt"
	"regexp"
	"strconv"
)

// Month is a calendar month encoded as year*12 + (month-1).
// All engine date arithmetic uses this representation; boundaries
// (YAML, CSV, JSON) always use the YYYY-MM string form.
type Month int

var monthRe = regexp.MustCompile(`^(\d{4})-(\d{2})$`)

// ParseMonth parses a YYYY-MM string.
func ParseMonth(s string) (Month, error) {
	m := monthRe.FindStringSubmatch(s)
	if m == nil {
		return 0, fmt.Errorf("invalid date %q: want YYYY-MM", s)
	}
	year, _ := strconv.Atoi(m[1])
	mon, _ := strconv.Atoi(m[2])
	if mon < 1 || mon > 12 {
		return 0, fmt.Errorf("invalid date %q: month out of range", s)
	}
	return Month(year*12 + mon - 1), nil
}

func (m Month) String() string {
	return fmt.Sprintf("%04d-%02d", int(m)/12, int(m)%12+1)
}

// IsJanuary reports whether the month is a January.
func (m Month) IsJanuary() bool { return int(m)%12 == 0 }

// IsDecember reports whether the month is a December.
func (m Month) IsDecember() bool { return int(m)%12 == 11 }

// YearStart returns the January of m's calendar year.
func (m Month) YearStart() Month { return m - Month(int(m)%12) }
