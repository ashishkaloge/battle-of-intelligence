# Commentary voice provenance

The bundled MP3 files are synthetic commentary rendered locally with Piper and ffmpeg. No voice
model weights, original training recordings, or rendering-tool binaries are distributed here.

The configured models are `en_US-bryce-medium` (play-by-play) and `en_GB-cori-high` (analyst).
The [upstream voice repository](https://huggingface.co/rhasspy/piper-voices) is pinned for
reproduction to revision `5041a7a49ae5b3a0f30e6837769eb03fdbb231bd`.

- [Bryce model card](https://huggingface.co/rhasspy/piper-voices/blob/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/en/en_US/bryce/medium/MODEL_CARD):
  identifies a public-domain dataset recorded by the voice trainer himself.
- [Cori model card](https://huggingface.co/rhasspy/piper-voices/blob/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/en/en_GB/cori/high/MODEL_CARD):
  identifies a public-domain dataset assembled from LibriVox recordings.
- [LibriVox public-domain policy](https://librivox.org/pages/public-domain/): its assessment applies
  to the United States and can differ elsewhere. The model cards do not provide a separate
  worldwide legal opinion or a guarantee covering every use of generated recordings.

The local models and configurations matched the pinned upstream files on 2026-10-25. SHA-256:

| File | SHA-256 |
| --- | --- |
| `en_US-bryce-medium.onnx` | `dc9caa6c313199ffb5ac698b6e542fa6cba388aeaf2731e25262e33b9810aef1` |
| `en_US-bryce-medium.onnx.json` | `7ceb1bc4af6d4e41b6d1edbb86c67e91e01eaa71f66db4cd0ae92ac704d415be` |
| `en_GB-cori-high.onnx` | `470b4dd634c98f8a4850d7626ffc3dfc90774628eeef6605a6dd8f88f30a5903` |
| `en_GB-cori-high.onnx.json` | `9e7fb5b5671612c22f3c81cbe46c1ae87b031a4632bcb509e499dad6f1e2adec` |

[Piper](https://github.com/OHF-Voice/piper1-gpl) and [ffmpeg](https://ffmpeg.org/legal.html) are
optional local tools. Their software licenses are separate from the voice provenance and output
rights. Replacing a model, redistributing model weights, or bundling a renderer requires reviewing
the relevant license again.

These are synthetic voices; their creators do not sponsor or endorse Battle of Intelligence.
