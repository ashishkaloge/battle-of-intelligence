# Release readiness review

Reviewed 25 October 2026. This records a bounded engineering review, not a guarantee that every
bug or vulnerability has been found. The intended release is the static replay viewer and its
source; local model recording is a separate operator workflow.

## Corrections made

| Area | Finding and correction |
| --- | --- |
| Bot execution | QuickJS allocator accounting under-enforced the nominal heap limit. Added independent heap checks and a 64 MiB shared WebAssembly ceiling, disabled regular expressions, and made malformed thrown errors safe to report. |
| Worker recovery | A stalled referee could leave playback waiting indefinitely. Added a 30-second progress watchdog that terminates the worker and displays a retry message. |
| CLI cleanup | Closing the parent CLI's pipes could leave descendants running after cancellation. Finish process-group termination and stop retaining oversized unfinished output lines. |
| Bluff scoring | Numeric punctuation could collapse different answers into one. Preserve signs, decimals and units, validate thousands separators, and settle simultaneous busts as a draw with conserved chips and identical live/replay events. |
| Mirror rules | An attack valid on the next board could become invalid on a later board. Validate its persistent stack against later bases. Version the new rules while preserving historical recordings. |
| Solver cost | Check unknown base transformations with the known public attack suffix instead of rediscovering the entire chain. A representative case examines over ten times fewer candidate rules. This is a candidate-count comparison, not a universal latency guarantee. |
| Playback and controls | Expose low/medium/high effort choices and default to third tier/low effort; stop announcing ring closures after the final closure; let playback continue if browser audio is unavailable. |
| Accessibility | Add standalone page headings and main landmarks, and make scrollable rules/benchmark content keyboard-focusable. |
| Distribution | Include project, dependency, worker/WASM and voice notices in the built site; pin voice provenance; remove an unsupported blanket voice-licensing claim. |
| CI | Pin the pnpm setup action to its actual commit and add dependency audit and distributed-license verification to the existing read-only workflow. |

## Verification

- Frozen-lockfile installation, Biome, both TypeScript projects, production build and
  `git diff --check` passed on Node 22.23.2 and pnpm 10.24.0.
- All **276 tests in 37 files** passed, including saved-record parity, cancellation, output limits,
  sandbox exhaustion/recovery, worker failure, scoring and solver regressions.
- `pnpm audit` reported no known vulnerabilities in 106 dependencies at review time.
- A redacted secret scan covered all 52 pre-review commits; a separate historical-content and
  changed-file check found no private-data candidates. Automated scans cannot prove absence.
- Production Chromium playback completed Ring → Mirror → Buzzer → Bot Brawl → Bluff → final
  without an error. This bounded smoke used an accelerated playback clock and real worker execution.
- Axe checks reported zero violations on ten views at desktop and mobile widths. Layout was
  checked at 1440, 1024, 390 and 320 CSS pixels. These automated checks are not a full WCAG audit
  or a substitute for assistive-technology and real-device testing.
- Pause, resume, restart and Escape were exercised in the production build. A build under
  `/battle-of-intelligence/` successfully loaded its referee worker, WebAssembly and MP3 narration.
- Build output retained the exact project and QuickJS license texts, generated dependency notices,
  Feather attribution and voice provenance.
- Entry JavaScript was about 69 kB gzip; CSS about 14 kB gzip. The roughly 236 kB gzip interpreter
  is loaded on demand. These are build sizes, not a network or device performance promise.

## Release conditions and limits

1. Require the existing GitHub CI workflow to pass on the proposed changes before merging.
2. Run and review fresh third-tier, low-effort recordings through both subscription CLIs when
   provider allowance is available. This review used fake CLI responses and existing recordings;
   it did not validate current live model access, provider response formats or billing behavior.
3. Review the public repository contents and history before changing visibility. Enable GitHub's
   private vulnerability reporting when the public repository supports it.
4. On the selected static host, retain the entire build output, revalidate HTML, and smoke-test the
   actual URL. This review did not deploy a public site or test its final hosting configuration.
5. Test Safari/Firefox and physical mobile devices before claiming cross-browser certification.
   Chromium emulation does not establish those results.

QuickJS instruction and per-bot heap checks are cooperative; native operations can delay them.
The browser worker has a wall-clock watchdog, but the synchronous local recorder does not.
Keep that recorder local, review imported code, and follow [SECURITY.md](../SECURITY.md).
Voice model cards identify public-domain source datasets; jurisdiction-specific rights and
third-party terms remain qualified as described in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Research references

- [Vite production deployment and base paths](https://vite.dev/guide/build)
- [Vite build license output](https://vite.dev/config/build-options#build-license)
- [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use)
- [Private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [QuickJS allocator accounting issue](https://github.com/justjake/quickjs-emscripten/issues/275)
- [QuickJS native-operation interrupt limitations](https://github.com/justjake/quickjs-emscripten/issues/219)
- [Open Font License guidance](https://openfontlicense.org/ofl-faq/)
- [LibriVox public-domain qualification](https://librivox.org/pages/public-domain/)

Pinned voice model cards and checksums are included in [voice provenance](../public/licenses/voices.md).
