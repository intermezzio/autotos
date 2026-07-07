# @autotos/extension-safari

The Safari (macOS + iOS/iPadOS) wrapper for the AutoTOS WebExtension.

Safari extensions must be embedded in a native app and shipped through the App
Store. This package is a **thin quarantined wrapper** over the built output of
`@autotos/extension` — it contains no extension logic of its own, only the Xcode
project. It is intentionally **not** part of the npm workspace build graph; it
consumes a build artifact, not source.

## Generating / updating the Xcode project

1. Build the Safari target from the extension package:
   ```bash
   npm run build:safari --workspace @autotos/extension
   # output: packages/extension/.output/safari-mv3
   ```
2. Convert to an Xcode project (first time), or re-run to refresh resources:
   ```bash
   xcrun safari-web-extension-converter \
     ../extension/.output/safari-mv3 \
     --project-location . \
     --app-name AutoTOS \
     --bundle-identifier me.autotos.extension \
     --macos --ios
   ```
   This creates one Xcode project with **two app targets** (macOS + iOS) that
   share the same web-extension resources.
3. Open `AutoTOS.xcodeproj`, sign with your Apple Developer account, archive, and
   submit each target to the App Store.

## Notes

- Requires macOS + Xcode + a paid Apple Developer account ($99/yr).
- iOS Safari supports web extensions (iOS 15+), so the same popup/logic runs on
  mobile — subject to iOS lifecycle constraints (the alias cache lives in
  `chrome.storage`, which is why it survives service-worker restarts on all targets).
- Regenerate resources whenever `@autotos/extension` changes; the native shell
  rarely needs edits.
```
