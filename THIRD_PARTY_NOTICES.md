# Third-Party Notices

JCut.AI includes and/or vendors third-party open-source components.

This file is the human-readable acknowledgement index. Where a component requires
that its license text travel with distributions, the original license file is
kept alongside the bundled component when available.

## Included notices

### Shot Type Classification

- Component: `sssabet/Shot_Type_Classification`
- Upstream location: `third_party/Shot_Type_Classification/`
- License: MIT

JCut.AI vendors the pretrained shot-composition classifier assets used by
`analyze-video`, including the upstream model file and license text.

The upstream MIT license is included at:

- [third_party/Shot_Type_Classification/LICENSE](/Users/bradyjordan/Documents/JcutAI-app/third_party/Shot_Type_Classification/LICENSE)

The local packaging note for this dependency is included at:

- [third_party/Shot_Type_Classification/NOTICE.md](/Users/bradyjordan/Documents/JcutAI-app/third_party/Shot_Type_Classification/NOTICE.md)

Important note: although the repository itself is MIT-licensed, the upstream
project README states that its dataset terms may restrict commercial use. Review
that constraint before shipping this model in any commercial build.

### OpenCV-based motion analysis approach

- Component type: implementation approach
- License family: BSD / Apache-compatible ecosystem

JCut.AI's motion-curve and cut-timing analysis uses our own implementation in:

- [src/tools/analyze_video.py](/Users/bradyjordan/Documents/JcutAI-app/src/tools/analyze_video.py)

This analysis relies on commonly used computer-vision techniques such as frame
differencing and dense optical flow. No separate vendored upstream repository is
currently bundled for this portion beyond standard project dependencies managed
through the app/backend dependency manifests.

## Distribution guidance

- Keep this file with the project source and packaged distributions.
- Keep the vendored `LICENSE` and `NOTICE` files under `third_party/` intact.
- If additional third-party models, weights, or repositories are bundled later,
  add them here and carry forward their original license text where required.
