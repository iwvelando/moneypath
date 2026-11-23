package config

import (
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

const assetPlan = `version: 2
simulation: {startDate: 2026-01, endDate: 2035-12, startingCash: 0, inflationRate: 3}
common:
  assets:
    - {sellCosts: 6, sellDate: 2034-06, startDate: 2025-01, appreciation: fixed, value: 300000, name: House}
    - {name: Car, value: 20000, startDate: 2027-03, appreciation: -15}
  loans:
    - {principal: 240000, asset: House, name: Mortgage, interestRate: 4, term: 360, startDate: 2021-01}
choices:
  - name: Housing
    options:
      - name: Keep
      - name: Sell
        change: {assets: [{name: House, set: {sellDate: 2028-06}}]}
        assets: [{name: Cabin, value: 90000, appreciation: inflation}]
      - name: No car
        remove: {assets: [Car]}
scenarios:
  - {name: keep, select: {Housing: Keep}}
  - {name: sell, select: {Housing: Sell}}
  - {name: walk, select: {Housing: No car}}
`

// Spec chapter 03, Asset: an asset's first month is its startDate, or the
// plan's start when it has none or one before the start; a sale month
// resolves; a kept asset has none.
func TestAssetMonthsResolve(t *testing.T) {
	cfg, _ := mustLoad(t, assetPlan)
	house, car := cfg.Common.Assets[0], cfg.Common.Assets[1]
	if got := house.ResolvedFirst.String(); got != "2026-01" {
		t.Errorf("house first month = %s, want the plan's start", got)
	}
	if got := house.ResolvedSell.String(); got != "2034-06" {
		t.Errorf("house sale = %s", got)
	}
	if got := car.ResolvedFirst.String(); got != "2027-03" {
		t.Errorf("car first month = %s", got)
	}
	if car.ResolvedSell != -1 {
		t.Errorf("a kept car has sale month %s", car.ResolvedSell)
	}
	if got := car.Appreciation.Rate(); got != -15 {
		t.Errorf("car appreciation = %v", got)
	}
}

// Spec chapter 03, Choices: assets are a fourth kind an option adds, changes
// and removes, resolved like the other three.
func TestAssetsResolveThroughChoices(t *testing.T) {
	cfg, _ := mustLoad(t, assetPlan)
	names := func(as []*Asset) string {
		var out []string
		for _, a := range as {
			out = append(out, a.Name+"@"+a.ResolvedSell.String())
		}
		return strings.Join(out, ",")
	}
	keep, sell, walk := cfg.Scenarios[0], cfg.Scenarios[1], cfg.Scenarios[2]
	if got := names(keep.ResolvedShared.Assets); !strings.HasPrefix(got, "House@2034-06,Car@") {
		t.Errorf("keep shares %s", got)
	}
	if got := names(sell.ResolvedShared.Assets); !strings.HasPrefix(got, "House@2028-06,Car@") {
		t.Errorf("sell shares %s, want the house sold in 2028-06", got)
	}
	if got := names(sell.Resolved.Assets); !strings.HasPrefix(got, "Cabin@") {
		t.Errorf("sell adds %s, want the cabin", got)
	}
	if got := names(walk.ResolvedShared.Assets); !strings.HasPrefix(got, "House@2034-06") || strings.Contains(got, "Car") {
		t.Errorf("walk shares %s, want no car", got)
	}
	if cfg.Common.Assets[0].ResolvedSell.String() != "2034-06" {
		t.Error("the option's change reached the baseline asset")
	}
}

// Spec chapter 03, Asset, canonical form: assets after investments, an
// asset's keys in order with fixed left out, a loan's asset after its name.
func TestAssetCanonicalForm(t *testing.T) {
	cfg, _ := mustLoad(t, assetPlan)
	out, err := yaml.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	// Compared line by line, without indentation.
	lines := strings.Split(string(out), "\n")
	for i := range lines {
		lines[i] = strings.TrimSpace(lines[i])
	}
	text := strings.Join(lines, "\n")
	for _, want := range []string{
		"loans:\n- name: Mortgage\nasset: House\nprincipal: 240000\n",
		"assets:\n- name: House\nvalue: 300000\nstartDate: 2025-01\nsellDate: 2034-06\nsellCosts: 6\n",
		"- name: Car\nvalue: 20000\nappreciation: -15\nstartDate: 2027-03\n",
		"assets:\n- name: Cabin\nvalue: 90000\nappreciation: inflation\nchange:\n",
		"remove:\nassets:\n- Car\n",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("canonical form lacks\n%s\nin\n%s", want, out)
		}
	}
	if strings.Index(text, "loans:") > strings.Index(text, "assets:") {
		t.Errorf("assets come before loans:\n%s", text)
	}
}

// A secured loan's asset may come from any of a path's lists, and an option
// may move the loan onto an asset it adds.
func TestSecuredLoanFindsItsAssetOnThePath(t *testing.T) {
	doc := strings.Replace(assetPlan, "        assets: [{name: Cabin",
		"        change: {loans: [{name: Mortgage, set: {asset: Cabin}}]}\n        assets: [{name: Cabin", 1)
	doc = strings.Replace(doc, "        change: {assets: [{name: House, set: {sellDate: 2028-06}}]}\n", "", 1)
	if _, _, err := load(t, doc); err != nil {
		t.Fatalf("a loan moved onto an option's asset: %v", err)
	}
	// On a path without the cabin, the changed loan's asset is placed at the
	// change's set, where it is written.
	doc = strings.Replace(assetPlan, "      - name: No car\n",
		"      - name: No car\n        change: {loans: [{name: Mortgage, set: {asset: Cabin}}]}\n", 1)
	_, problems := Load([]byte(doc), ym("2026-01"))
	p := findProblem(problems, "choices.0.options.2.change.loans.0.set.asset")
	if p == nil || p.Level != LevelError {
		t.Fatalf("no error at the change's asset; got %+v", problems)
	}
}
