# Security

## Boundaries

The browser is a static viewer. It does not receive model credentials or launch model CLIs.
Fight recording and optional commentary generation are explicit local commands, authenticated
through the official CLIs. Use trusted CLI installations and review your account's usage settings.

Generated Bot Brawl code runs in QuickJS WebAssembly, with no host imports, filesystem or network.
The shared interpreter has a hard 64 MiB linear-memory ceiling. Each bot has a 16 MiB heap budget,
checked during interpreter interrupts and after loading or returning a move; transient allocations
between checks can exceed that budget but remain inside the shared ceiling. This independent heap
check compensates for the published interpreter's [allocator accounting limitation](https://github.com/justjake/quickjs-emscripten/issues/275).
Regular expressions are disabled, including literals and implicit string matching.

The fixed instruction budget is cooperative. Native operations such as large array or string
operations can delay an interrupt, so it is not a wall-clock deadline. Browser replays run in a
worker that is terminated after 30 seconds without a completed match, with a visible retry message.
The local Node recorder runs matches synchronously and has no separate worker wall-clock deadline;
its cancellation and round clock resume when an interpreter operation returns. Review imported
bots and records before running them. These controls do not turn the recorder or a provider CLI
into a hostile multi-tenant execution service.

CLI calls allow only subscription authentication, restrict inherited environment variables,
disable available tools and use ephemeral working directories. They enforce output and timeout
limits. On macOS and Linux, cancellation also terminates the CLI process group. An empty directory,
CLI flags and a read-only sandbox do not constitute a host security boundary: run locally with
trusted CLI installations and do not expose the recorder as a public execution API.

Current prompts request final game actions, answers or code. The recorder ignores provider
reasoning streams, and replay captions are derived from structured actions and referee results.
Historical JSON may contain older explanation fields; it remains unchanged, but those fields
are not used in displayed captions or generated commentary. Review historical records and
unreferenced audio separately before any public release.

Model text and saved JSON are untrusted input. Review records before publishing them. Do not put
credentials, personal information, local account configuration or private files into prompts,
committed fixtures or bug reports. Keep dependency and CLI versions current and run the documented
checks after updating them.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** route if private reporting is enabled.
If that option is unavailable, open an issue asking for a private reporting channel, without
including exploit details, credentials or personal data. Include affected versions, reproduction
steps and impact only once a private channel is available.
