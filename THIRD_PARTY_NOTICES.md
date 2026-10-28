# Third-party notices

Project-authored source is licensed under [MIT](LICENSE). Dependencies and other third-party
materials retain their own licenses. The lockfile records the exact installed versions.

## Browser distribution

`pnpm build` uses Vite's license collection to write the complete notices for dependencies bundled
in the viewer to `dist/licenses/dependencies.md`. This includes:

| Component | License | Upstream |
| --- | --- | --- |
| React, React DOM, Scheduler | MIT | [React](https://github.com/facebook/react) |
| Lucide icons, including icons derived from Feather | ISC and MIT | [Lucide license](https://github.com/lucide-icons/lucide/blob/main/LICENSE) |
| Geist and Geist Mono | SIL Open Font License 1.1 | [Geist fonts](https://github.com/vercel/geist-font) |

Vite's license collection does not include the separate referee worker. Its QuickJS engine and
quickjs-emscripten wrapper notices are preserved together in
[public/licenses/quickjs.txt](public/licenses/quickjs.txt), copied verbatim from the installed
`@jitl/quickjs-wasmfile-release-sync` package. This notice also covers the wrapper code from
`quickjs-emscripten-core` and `@jitl/quickjs-ffi-types`; all three packages are pinned to 0.32.0.
Upstreams: [QuickJS](https://bellard.org/quickjs/) and
[quickjs-emscripten](https://github.com/justjake/quickjs-emscripten).

The build also copies the project's MIT license and voice provenance from `public/licenses/`.
Deploy the complete `dist/` directory, including `licenses/`. CI checks that the project and
QuickJS notices match their source files and that the viewer notices include the font and icon
attributions. When upgrading QuickJS, review the new package licenses and refresh `quickjs.txt`.
If the project copyright notice changes, refresh `public/licenses/project.txt` from `LICENSE`.

Development tools are not shipped with the static viewer. Their licenses remain in their installed
packages; `pnpm licenses list` inspects the installed dependency inventory.

## Commentary voices

The repository includes generated commentary MP3s, not voice model weights, training recordings,
Piper, or ffmpeg binaries. The commentary text is authored for the project or derived from its
referee events. The voice models' upstream cards describe their datasets as public domain:

- **Bryce, en_US medium:** recordings of the trainer's own voice.
- **Cori, en_GB high:** recordings from LibriVox.

[Voice provenance, pinned model sources, and checksums](public/licenses/voices.md) accompany the
distributed recordings. These upstream statements are not a blanket guarantee about rights in
every jurisdiction. LibriVox specifically describes its public-domain assessment as applying in
the United States. Replacement voices require their own model, dataset, and output-rights review.

Piper and ffmpeg are optional local rendering tools with licenses separate from the generated
recordings. The current Piper project uses GPL-3.0; it is not embedded in the app. If distributing
rendering tools or model weights, preserve their respective licenses and comply with their
distribution requirements separately.

## Project assets and names

The game faces and favicon are drawn in project source. UI icons and fonts are covered above.
The named model providers, voice creators, and benchmark authors do not sponsor or endorse this
project. Names used to identify competitors or reference evaluations do not grant trademark rights.
