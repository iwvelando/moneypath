package money

import "testing"

// The display form of a currency amount is $ + thousands separators + 2
// decimals; negative as -$1,234.56.
func TestFormat(t *testing.T) {
	cases := map[float64]string{
		0:          "$0.00",
		1234.56:    "$1,234.56",
		-1234.56:   "-$1,234.56",
		999.999:    "$1,000.00",
		1000000:    "$1,000,000.00",
		12345678.9: "$12,345,678.90",
		-0.004:     "$0.00", // rounds to zero: no sign
		-0.005001:  "-$0.01",
		17654.331:  "$17,654.33",
	}
	for in, want := range cases {
		if got := Format(in); got != want {
			t.Errorf("Format(%v) = %q, want %q", in, got, want)
		}
	}
}
