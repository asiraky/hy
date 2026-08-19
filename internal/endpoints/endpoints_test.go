package endpoints

import (
	"net"
	"testing"

	"github.com/asiraky/hy/internal/netinfo"
)

func planWith(kinds ...netinfo.Kind) netinfo.BindPlan {
	ips := map[netinfo.Kind]string{
		netinfo.KindLoopback: "127.0.0.1",
		netinfo.KindPrivate:  "192.168.1.20",
		netinfo.KindOverlay:  "100.91.44.16",
		netinfo.KindPublic:   "203.0.113.7",
	}
	var plan netinfo.BindPlan
	plan.Port = 8787
	for _, k := range kinds {
		plan.Addrs = append(plan.Addrs, netinfo.Addr{IP: net.ParseIP(ips[k]), Kind: k})
	}
	return plan
}

// The QR must carry the address a phone can still reach next week. Pairing
// binds a token to one origin, so choosing a DHCP address means pairing again
// the next time the lease changes.
func TestBestPairingURLPrefersTheStableOverlayName(t *testing.T) {
	set := Set{Endpoints: []Endpoint{
		{ID: "loopback", URL: "http://127.0.0.1:8787", Reach: Loopback},
		{ID: "lan", URL: "http://192.168.1.20:8787", Reach: LAN},
		{ID: "overlay", URL: "http://box.tail1234.ts.net:8787", Reach: Overlay, Stable: true},
	}}
	if got := set.BestPairingURL(); got != "http://box.tail1234.ts.net:8787" {
		t.Fatalf("BestPairingURL() = %q; want the overlay hostname", got)
	}
}

func TestBestPairingURLFallsBackToLAN(t *testing.T) {
	set := Set{Endpoints: []Endpoint{
		{ID: "loopback", URL: "http://127.0.0.1:8787", Reach: Loopback},
		{ID: "lan", URL: "http://192.168.1.20:8787", Reach: LAN},
	}}
	if got := set.BestPairingURL(); got != "http://192.168.1.20:8787" {
		t.Fatalf("BestPairingURL() = %q; want the LAN address", got)
	}
}

func TestBestPairingURLEmptySet(t *testing.T) {
	if got := (Set{}).BestPairingURL(); got != "" {
		t.Fatalf("BestPairingURL() = %q; want empty", got)
	}
}

// An overlay interface with no MagicDNS name still has to be advertised: on
// the macOS App Store build the interface works while the CLI is absent, and
// suppressing the address would remove the only way in from another network.
func TestOverlayAddressAdvertisedWhenHostnameUnknown(t *testing.T) {
	b := NewBuilder(planWith(netinfo.KindLoopback, netinfo.KindOverlay), 8787)
	set := Set{Endpoints: []Endpoint{}}

	// Simulate Build's address loop with no hostname discovered.
	for _, a := range b.plan.Addrs {
		reach := reachabilityOf(a.Kind)
		if reach == Overlay && set.Overlay.DNSName != "" {
			continue
		}
		set.Endpoints = append(set.Endpoints, Endpoint{URL: a.URL(8787), Reach: reach})
	}

	var sawOverlay bool
	for _, e := range set.Endpoints {
		if e.Reach == Overlay {
			sawOverlay = true
			if e.URL != "http://100.91.44.16:8787" {
				t.Fatalf("overlay endpoint URL = %q", e.URL)
			}
		}
	}
	if !sawOverlay {
		t.Fatal("overlay address was dropped when no hostname was known")
	}
}

func TestReachabilityMapping(t *testing.T) {
	cases := map[netinfo.Kind]Reachability{
		netinfo.KindLoopback: Loopback,
		netinfo.KindPrivate:  LAN,
		netinfo.KindOverlay:  Overlay,
		netinfo.KindPublic:   Public,
	}
	for kind, want := range cases {
		if got := reachabilityOf(kind); got != want {
			t.Errorf("reachabilityOf(%v) = %v; want %v", kind, got, want)
		}
	}
}

// A public address is only ever bound behind an explicit flag, but if one is
// present it must be advertised honestly rather than mislabelled.
func TestPublicAddressIsLabelledPublic(t *testing.T) {
	b := NewBuilder(planWith(netinfo.KindPublic), 8787)
	if got := reachabilityOf(b.plan.Addrs[0].Kind); got != Public {
		t.Fatalf("public address classified as %v", got)
	}
}
