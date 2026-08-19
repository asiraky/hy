//go:build !bundled_sidecar

package claudecode

// bundledSidecarPath reports no bundled runtime: this build relies on a JS
// runtime present on the host. See bundled.go for the self-contained build.
func bundledSidecarPath() string { return "" }
