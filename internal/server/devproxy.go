package server

import (
	"net/http"
	"net/http/httputil"
	"net/url"
)

// devProxy forwards everything the server does not handle itself to the Vite
// dev server.
//
// The direction is the point. Vite could front the app and forward /api and
// /ws here — that is the usual arrangement — but then the browser's origin is
// Vite's, which means two URLs to keep straight, CORS on every call, and,
// because Vite would reach us from loopback, every request arriving already
// trusted. Pairing could not be exercised in development at all. Fronting from
// here keeps one origin and one URL, and makes auth behave in development
// exactly as it does in production.
//
// Only reachable with -dev, and only for paths the server does not own.
func devProxy(target *url.URL) http.Handler {
	proxy := httputil.NewSingleHostReverseProxy(target)

	inner := proxy.Director
	proxy.Director = func(r *http.Request) {
		inner(r)

		// Vite refuses requests whose Host it does not recognise, and the
		// inbound Host is whatever address the browser used — a LAN address or
		// a tailnet name. Presenting the target's own host satisfies that
		// check without enumerating every name this machine answers to. The
		// Origin header has to move with it, or Vite's HMR socket sees a
		// cross-origin upgrade and refuses.
		r.Host = target.Host
		if r.Header.Get("Origin") != "" {
			r.Header.Set("Origin", target.Scheme+"://"+target.Host)
		}
	}
	return proxy
}
