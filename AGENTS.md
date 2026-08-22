# Omniplex

Omniplex drives multiple coding harnesses behind one canonical event protocol, with a web UI that
attaches to sessions from any device. It is heavily inspired by **T3 Code**
(https://github.com/pingdotgg/t3code) — that repo is the reference when I tell you to look at it.
T3 Code solved about 80% of my problem. The remaining 20% is what Omniplex is for: how worktrees are
managed, how sessions are labelled and organised, and a handful of similar things that matter a lot
to me. When a decision touches those, they win.

Half the work here happens on a phone while commuting, so mobile matters more than it does in most
products. We are not mobile-first, but every UI change gets looked at in a mobile viewport before it
is called done, and "it looks fine on desktop" is not a report. Assume a flaky 4G connection with
multi-second round trips is the normal case, not the degraded one: keep what goes over the wire
small, and make reconnect and resume cheap.

Otherwise, move fast and break things. One maintainer, no install base to protect: prefer the direct
change over the migration path, delete rather than deprecate, and do not preserve complexity because
it already exists. Everything here is a good default, not a hard rule — say so and get a decision if
it fights the task.

Omniplex is used to develop Omniplex, so be careful in the main checkout: it is probably running the
live server driving the session you are in. Never kill a process you found by matching a name or
path, and do not restart or clear the main checkout's state. Work in a worktree. Verify in a real
browser, at mobile width for anything touching UI. Never open a PR unless asked; when you do, attach
screenshots, including a mobile-width one.
