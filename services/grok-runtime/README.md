# Grok Runtime

Host-native Grok Build adapter for the Prism runtime job contract. It wraps an
authenticated `grok` CLI and exposes normalized asynchronous job, polling,
cancellation, capability discovery, and session-continuation routes.

The adapter is local-first. Provider authentication stays in the operator's
normal `GROK_HOME`; credentials are not copied into Site or Docker.
