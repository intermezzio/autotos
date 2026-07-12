# AutoTOS Browser Extension Publishing Guide

This document provides step-by-step instructions for publishing the AutoTOS browser extension to the Chrome Web Store, Firefox Add-ons (AMO), and Safari (App Store).

## Current State Assessment

**Built artifacts:**
- Chrome MV3: `packages/extension/.output/autotosextension-0.1.0-chrome.zip` (92 KB)
- Firefox MV2: `packages/extension/.output/autotosextension-0.1.0-firefox.zip` (92 KB)
- Firefox sources: `packages/extension/.output/autotosextension-0.1.0-sources.zip` (24 KB)
- Safari: Not yet built (requires `npm run build:safari` + `xcrun safari-web-extension-converter`)

**Current manifest values:**
- Name: `AutoTOS`
- Description: `See how fair a website's Terms of Service are — flagged clauses and a 0–10 fairness score, right in your browser.`
- Version: `0.1.0`
- Permissions: `activeTab`, `storage`
- Host permissions: `https://autotos-data.amascillaro.workers.dev/*`, `https://autotos-request.amascillaro.workers.dev/*`
- Icons: 16/32/48/128px (unknown.png default + A-E grade badges)
- Firefox gecko ID: `autotos@amascillaro.workers.dev`
- Homepage referenced in popup: `https://github.com/intermezzio/autotos`

## Readiness Gaps

### Critical (must have before submission)

1. **Privacy Policy** (required by all three stores)
   - AutoTOS only sends the eTLD+1 domain (e.g., `github.com`) to its backend, never full URLs or PII
   - The extension uses `storage` permission to cache the alias map locally
   - **Action required:** Write a privacy policy and host it (suggest: `https://raw.githubusercontent.com/intermezzio/autotos/main/PRIVACY.md`)
   - **Content should cover:** what data is collected (domain only), why (to fetch TOS analysis), where it's sent (autotos-data/autotos-request.amascillaro.workers.dev), how long it's retained, that no PII is collected

2. **Support/Homepage URL** (Chrome requires, Firefox/Safari strongly recommend)
   - The popup already links to `https://github.com/intermezzio/autotos`
   - **Action required:** Ensure `https://github.com/intermezzio/autotos` is live and provides:
     - Project description
     - How to use the extension
     - Contact/support information (email or GitHub issues link)
     - Link to privacy policy

3. **Developer Accounts**
   - **Chrome Web Store:** Requires a one-time $5 developer registration fee
   - **Firefox AMO:** Free account at `addons.mozilla.org`
   - **Apple Developer Program:** $99/year membership (required for Safari App Store submission)

### Recommended (improves listing quality)

4. **Store Listing Screenshots** (strongly recommended for all stores)
   - **Chrome:** Up to 5 screenshots (1280x800 or 640x400 recommended)
   - **Firefox:** Up to 10 screenshots (minimum 650px wide)
   - **Safari:** Multiple screenshots required per device (iPhone, iPad, Mac)
   - **Suggested screenshots:**
     - Extension popup showing a site with an A grade
     - Extension popup showing a site with an E grade
     - Popup showing the "Request Analysis" state for an unanalyzed site
     - Popup showing flagged clauses with categories
     - Browser toolbar with the extension icon

5. **Promotional Images** (optional but improves visibility)
   - **Chrome:** 440x280px small tile (required for featured placement)
   - **Chrome:** 1400x560px marquee promo tile (optional)
   - **Firefox:** No promo images required
   - **Safari:** App icon must be distinct from extension icon (no grade badges)

6. **Manifest Enhancements** (optional)
   - Add `author` field to package.json (currently missing)
   - Add `homepage_url` to manifest (Chrome/Firefox support this)
   - Consider a `short_description` for Firefox (up to 132 chars)

---

## Publishing Workflows

### 1. Chrome Web Store

**Prerequisites:**
- Google account
- $5 one-time developer registration fee
- Privacy policy hosted at a public URL
- Chrome build artifact (`npm run zip`)

**Steps:**

1. **Register as a Chrome Web Store developer**
   - Go to: https://chrome.google.com/webstore/devconsole
   - Sign in with your Google account
   - Pay the $5 registration fee
   - Accept the Chrome Web Store Developer Agreement

2. **Build the Chrome extension**
   ```bash
   cd packages/extension
   npm run build:chrome
   npm run zip
   # Output: .output/autotosextension-0.1.0-chrome.zip
   ```

3. **Create a new item in the Chrome Web Store Developer Dashboard**
   - Click "New Item"
   - Upload `.output/autotosextension-0.1.0-chrome.zip`
   - Wait for the automated security scan to complete

4. **Fill out the store listing**
   - **Store listing tab:**
     - Detailed description: Expand on the short description; explain the grading system (A-E), the category-based penalty model, that it works offline for analyzed sites, the "Request Analysis" button for new sites
     - Category: Choose "Productivity" or "Developer Tools"
     - Language: English
     - Icon: The 128x128 unknown.png (or create a store-specific icon without the "?")
     - Screenshots: Upload 3-5 screenshots (see recommendations above)
     - Promotional tiles: Optional for initial launch
     - YouTube video: Optional
   
   - **Privacy practices tab:**
     - Select "Yes" for data usage (you collect the domain)
     - **Justify each permission:**
       - `activeTab`: "Required to read the current tab's URL when the user clicks the extension icon, so we can determine which site's Terms of Service to display."
       - `storage`: "Required to cache the domain alias map locally, enabling the extension to work offline and reducing network requests."
       - `host_permissions` to `autotos-data.amascillaro.workers.dev`: "The CDN serving pre-analyzed Terms of Service data as static JSON files."
       - `host_permissions` to `autotos-request.amascillaro.workers.dev`: "The request endpoint where users can submit new domains for analysis."
     - Privacy policy URL: `https://raw.githubusercontent.com/intermezzio/autotos/main/PRIVACY.md` (must be live before submission)
   
   - **Distribution tab:**
     - Visibility: Public or Unlisted (start with Unlisted for testing, then switch to Public)
     - Regions: All regions (or select specific countries)

5. **Submit for review**
   - Click "Submit for review"
   - Review typically takes **1-3 business days**
   - You'll receive an email when the review is complete

6. **Post-approval**
   - Extension will be live at: `https://chrome.google.com/webstore/detail/<extension-id>`
   - Monitor reviews and update as needed

**Estimated effort:** 2-3 hours (mostly form-filling)  
**Cost:** $5 one-time  
**Review time:** 1-3 business days

---

### 2. Firefox Add-ons (AMO)

**Prerequisites:**
- Firefox account
- Privacy policy hosted at a public URL
- Firefox build artifact (`npm run zip:firefox`)
- Source code zip (WXT auto-generates this because the build is minified)

**Steps:**

1. **Create an AMO account**
   - Go to: https://addons.mozilla.org/developers/
   - Sign in with a Firefox account (free)
   - Read and accept the Firefox Add-on Distribution Agreement

2. **Build the Firefox extension and source zip**
   ```bash
   cd packages/extension
   npm run build:firefox
   npm run zip:firefox
   # Output: 
   #   .output/autotosextension-0.1.0-firefox.zip (extension)
   #   .output/autotosextension-0.1.0-sources.zip (source code)
   ```

3. **Submit to AMO**
   - Go to: https://addons.mozilla.org/developers/addon/submit/distribution
   - Choose **"On this site"** (listed on AMO) or **"On your own"** (self-distributed, signed by Mozilla but not listed)
     - **Recommendation:** Start with "On this site" for maximum visibility
   - Upload `.output/autotosextension-0.1.0-firefox.zip`

4. **Upload source code**
   - **Critical:** Mozilla requires source code submission if the extension is minified (WXT/Vite minifies by default)
   - Upload `.output/autotosextension-0.1.0-sources.zip`
   - In the "Notes to Reviewer" field, add:
     ```
     This extension is built with WXT (wxt.dev), a WebExtension framework.
     
     Build instructions:
     1. npm install (from the monorepo root)
     2. npm run build:firefox --workspace @autotos/extension
     
     The source zip includes all extension source code. The build uses Vite for 
     bundling, which minifies the output. No obfuscation is applied.
     
     The extension connects to two Cloudflare Workers endpoints:
     - autotos-data.amascillaro.workers.dev (CDN for pre-analyzed TOS data)
     - autotos-request.amascillaro.workers.dev (request queue for new domains)
     ```

5. **Fill out the listing details**
   - **Basic Information:**
     - Name: `AutoTOS`
     - Summary: Use the existing description (stays under 250 chars)
     - Description: Expand with details on the grading system, how it works, the "Request Analysis" feature
     - Categories: Select "Privacy & Security" and/or "Other"
     - Tags: `terms-of-service`, `privacy`, `tos`, `legal`, `transparency`
     - Homepage: `https://github.com/intermezzio/autotos`
     - Support email or URL: `https://github.com/intermezzio/autoTOS/issues` (or create a support email)
     - Privacy policy: `https://raw.githubusercontent.com/intermezzio/autotos/main/PRIVACY.md`
   
   - **Version notes:**
     - "Initial public release"
   
   - **Permissions justification:**
     - Explain `activeTab` and `storage` as in Chrome
     - Explain the two `host_permissions` entries

6. **Screenshots**
   - Upload 3-10 screenshots (same ones as Chrome)
   - Add captions for each

7. **Submit for review**
   - Click "Submit Version"
   - Mozilla's review is typically **thorough** and can take **1-7 days**
   - Reviewers will build the extension from source and compare to the submitted artifact
   - If the build doesn't match or the instructions are unclear, the review will be rejected

8. **Post-approval**
   - Extension will be live at: `https://addons.mozilla.org/firefox/addon/<slug>/`
   - Monitor reviews and respond to user feedback

**Estimated effort:** 3-4 hours (source code submission adds complexity)  
**Cost:** Free  
**Review time:** 1-7 business days (source review is manual and thorough)

**Important notes:**
- Mozilla reviewers are strict about source code. Ensure the build instructions in the "Notes to Reviewer" are accurate
- Test the build instructions yourself in a clean environment before submitting
- If rejected, you can resubmit with clarifications

---

### 3. Safari (macOS + iOS via App Store)

**Prerequisites:**
- macOS machine with Xcode installed (latest version recommended)
- Apple Developer Program membership ($99/year)
- Safari build artifact + Xcode project
- Privacy policy hosted at a public URL
- Screenshots for all platforms (iPhone, iPad, Mac)

**Steps:**

1. **Enroll in the Apple Developer Program**
   - Go to: https://developer.apple.com/programs/
   - Enroll with your Apple ID
   - Pay the $99/year membership fee
   - Wait for approval (typically 24-48 hours)

2. **Build the Safari WebExtension bundle**
   ```bash
   cd packages/extension
   npm run build:safari
   # Output: .output/safari-mv3/
   ```

3. **Generate the Xcode project** (first time only)
   ```bash
   cd packages/extension-safari
   xcrun safari-web-extension-converter \
     ../extension/.output/safari-mv3 \
     --project-location . \
     --app-name AutoTOS \
     --bundle-identifier me.autotos.extension \
     --macos --ios
   # This creates AutoTOS.xcodeproj with macOS and iOS targets
   ```

4. **Configure the Xcode project**
   - Open `packages/extension-safari/AutoTOS.xcodeproj` in Xcode
   - Select the AutoTOS project in the navigator
   - For **both the macOS and iOS targets:**
     - **General tab:**
       - Bundle Identifier: `me.autotos.extension` (must match Apple Developer account)
       - Version: `0.1.0`
       - Build: `1`
       - Team: Select your Apple Developer team
       - Minimum Deployment: macOS 11.0 / iOS 15.0
     - **Signing & Capabilities tab:**
       - Automatically manage signing: Enable
       - Team: Select your Apple Developer team
   - Repeat for the **Extension** targets (AutoTOS Extension macOS / iOS)

5. **Prepare App Store listing assets**
   - **macOS screenshots:**
     - At least 1 screenshot (minimum 1280x800)
     - Capture the extension running in Safari on macOS
   - **iPhone screenshots:**
     - At least 1 screenshot per required size (6.5", 5.5")
     - Capture the extension running in Safari on iOS
   - **iPad screenshots:**
     - At least 1 screenshot (12.9" recommended)
     - Capture the extension running in Safari on iPad
   - **App Icon:**
     - 1024x1024px icon (required)
     - **Important:** Cannot use the grade badge icons (A-E) as the main app icon
     - Create a generic AutoTOS icon (suggest: stylized "A" or "TOS" text)

6. **Create an App Store Connect record**
   - Go to: https://appstoreconnect.apple.com
   - Click "My Apps" → "+" → "New App"
   - **Platform:** Select "macOS" and "iOS" (two separate app records, or one universal app)
     - **Recommendation:** Create one **universal app** (both macOS and iOS)
   - **Name:** AutoTOS
   - **Primary Language:** English
   - **Bundle ID:** Select `me.autotos.extension`
   - **SKU:** `autotos-extension` (internal identifier)
   - **User Access:** Full Access
   - Click "Create"

7. **Fill out the App Store listing (App Store Connect)**
   - **App Information:**
     - Name: `AutoTOS`
     - Subtitle (optional): "Fair Terms of Service Analyzer"
     - Category: **Utilities** or **Productivity**
     - Privacy Policy URL: `https://raw.githubusercontent.com/intermezzio/autotos/main/PRIVACY.md`
     - Support URL: `https://github.com/intermezzio/autotos`
   
   - **Pricing and Availability:**
     - Price: Free
     - Availability: All countries
   
   - **App Privacy:**
     - Fill out the privacy questionnaire:
       - Data collected: "Domain name of the active tab"
       - Purpose: "App Functionality"
       - Linked to user: No
       - Used for tracking: No
   
   - **Version Information (for version 0.1.0):**
     - Description: Detailed explanation of AutoTOS, how it works, the grading system, the request feature
     - Keywords: `terms of service,privacy,tos,legal,transparency,grade,fairness`
     - Screenshots: Upload the screenshots prepared in step 5
     - Promotional text (optional): Highlight the A-E grading system
     - What's New: "Initial release"

8. **Archive and upload the app to App Store Connect**
   - In Xcode, select "Any Mac (Apple Silicon, Intel)" (or "Any iOS Device") as the destination
   - **Product → Archive**
   - Once the archive completes, the Organizer window opens
   - Select the archive and click **Distribute App**
   - Choose **App Store Connect**
   - Upload
   - Wait for processing (typically 5-15 minutes)

9. **Submit for review**
   - In App Store Connect, go to your app → version 0.1.0
   - Fill out the **App Review Information:**
     - Contact information (email, phone)
     - Demo account (if needed): N/A
     - Notes: "This is a Safari web extension that analyzes website Terms of Service. To test, visit any website (e.g., github.com), click the AutoTOS toolbar icon in Safari, and view the analysis."
   - **Export Compliance:** Select "No" (the extension does not use encryption beyond standard HTTPS)
   - Click **Submit for Review**

10. **Review and approval**
    - Apple's review typically takes **1-7 days**
    - Reviewers will test the extension on macOS and iOS
    - Common rejection reasons:
      - Insufficient functionality (the extension must work on multiple sites)
      - Misleading screenshots
      - Privacy policy missing or incomplete
      - Crashes or bugs
    - If rejected, respond to the reviewer's comments, fix issues, and resubmit

11. **Post-approval**
    - Extension will be live on the Mac App Store and iOS App Store
    - Monitor reviews and update as needed
    - Users install the app, then enable the extension in Safari → Preferences → Extensions

**Estimated effort:** 6-10 hours (Xcode setup, screenshots for 3 platforms, App Store Connect forms)  
**Cost:** $99/year  
**Review time:** 1-7 business days  
**Blockers:** Requires macOS + Xcode, paid Apple Developer account

**Important notes:**
- Safari extensions must be installed as apps (not directly from Safari)
- The app itself is a thin wrapper; the extension logic is in the WebExtension bundle
- You must provide screenshots for **every platform** (macOS, iPhone, iPad) even if the extension UI is identical
- iOS Safari has lifecycle constraints (the background script may be terminated aggressively), but the extension design (alias cache in `chrome.storage`, popup does all the work) handles this gracefully

---

## Recommended Publishing Sequence

### Phase 1: Pre-Launch Preparation (1-2 days)
1. Write and host the privacy policy at `https://raw.githubusercontent.com/intermezzio/autotos/main/PRIVACY.md`
2. Ensure `https://github.com/intermezzio/autotos` is live with project info and support contact
3. Create promotional screenshots (5 total, reusable across all stores)
4. (Optional) Create a store-specific 128x128 icon without the "?" (for Chrome/Firefox)
5. Register developer accounts:
   - Chrome Web Store ($5)
   - Firefox AMO (free)
   - Apple Developer Program ($99/year, if targeting Safari)

### Phase 2: Chrome Web Store (2-3 hours + 1-3 day review)
- **Rationale:** Fastest to publish, largest user base, simplest workflow
- **Blockers:** Privacy policy URL (from Phase 1)
- **Output:** Extension live on Chrome Web Store

### Phase 3: Firefox AMO (3-4 hours + 1-7 day review)
- **Rationale:** Second-largest user base, free, good for credibility
- **Blockers:** Privacy policy URL (from Phase 1)
- **Complexity:** Source code submission requires careful documentation
- **Output:** Extension live on Firefox Add-ons

### Phase 4: Safari App Store (6-10 hours + 1-7 day review)
- **Rationale:** High-quality user base, but macOS/iOS-only and highest barrier to entry
- **Blockers:** macOS machine, Xcode, $99/year Apple Developer membership, platform-specific screenshots
- **Complexity:** Multi-platform builds (macOS + iOS), Xcode project setup, App Store Connect forms
- **Output:** Extension live on Mac App Store and iOS App Store

**Total time estimate:** 11-17 hours of active work + 3-17 days of review time  
**Total cost:** $5 (Chrome) + $0 (Firefox) + $99/year (Safari) = **$104 first year, $99/year thereafter**

---

## Checklist

### Pre-Launch
- [ ] Privacy policy written and hosted at `https://raw.githubusercontent.com/intermezzio/autotos/main/PRIVACY.md`
- [ ] `https://github.com/intermezzio/autotos` live with project info, how-to, support contact
- [ ] 5 promotional screenshots created (extension popup in various states)
- [ ] (Optional) Store-specific 128x128 icon without "?"

### Chrome Web Store
- [ ] Developer account registered ($5)
- [ ] Build and zip: `npm run build:chrome && npm run zip`
- [ ] Upload `.output/autotosextension-0.1.0-chrome.zip` to CWS dashboard
- [ ] Fill out store listing (description, screenshots, category)
- [ ] Fill out privacy practices (permissions justification, privacy policy URL)
- [ ] Submit for review
- [ ] Monitor review status, respond to any requests

### Firefox AMO
- [ ] AMO account created (free)
- [ ] Build and zip: `npm run build:firefox && npm run zip:firefox`
- [ ] Upload `.output/autotosextension-0.1.0-firefox.zip` to AMO
- [ ] Upload `.output/autotosextension-0.1.0-sources.zip` with build instructions
- [ ] Fill out listing details (description, screenshots, homepage, privacy policy)
- [ ] Submit for review
- [ ] Monitor review status, respond to any requests (especially source code questions)

### Safari App Store
- [ ] macOS machine with Xcode installed
- [ ] Apple Developer Program membership ($99/year)
- [ ] Build Safari bundle: `npm run build:safari`
- [ ] Generate Xcode project: `xcrun safari-web-extension-converter ...`
- [ ] Configure signing and provisioning in Xcode
- [ ] Create macOS, iPhone, and iPad screenshots
- [ ] Create 1024x1024 app icon (no grade badges)
- [ ] Create App Store Connect record
- [ ] Fill out App Store listing (description, privacy, pricing)
- [ ] Archive and upload to App Store Connect
- [ ] Submit for review
- [ ] Monitor review status, respond to any requests

---

## Automated Releases (GitHub Actions)

The Chrome package is **not committed to git**. It's built on demand as a release
artifact by `.github/workflows/release.yml`, which fires only when a version tag
is pushed. This keeps the (binary, regenerable) zip out of git history while still
producing a downloadable, uploadable artifact for every release.

### Cutting a release

```bash
# 1. Bump the version in the manifest (source of truth for the build).
cd packages/extension
# edit package.json: "version": "0.2.0"
npm install                    # refresh package-lock.json
git commit -am "extension: v0.2.0"

# 2. Tag with the matching version and push the tag.
git tag v0.2.0
git push origin main --tags
```

Pushing the `v0.2.0` tag triggers the workflow, which defines **two independent jobs**
(`build` for Chrome, `firefox` for Firefox). They're deliberately decoupled so a
store misconfiguration on one side can't block the other's release.

> **Current status:** the **Chrome job is disabled** (`if: false` in `release.yml`)
> until a Chrome Web Store developer account exists. Only the **Firefox job runs**.
> Re-enable Chrome by deleting that `if: false` — the store-upload step stays
> secret-gated, so it's still a safe no-op until the `CWS_*` secrets are set.

Each job:

1. **Verifies the tag matches `packages/extension/package.json`** — `v0.2.0` must
   equal version `0.2.0`, or the job fails loudly (prevents a mislabeled build).
2. **Builds + zips the package** — Chrome MV3, and Firefox MV2 (which also emits a
   `-sources.zip`, required by AMO because the build is minified).
3. **Uploads the zip(s) as workflow build artifacts** (downloadable from the Actions run).
4. **Creates/updates the GitHub Release** for the tag and attaches the zip(s), with
   auto-generated release notes. Both jobs attach to the same Release (idempotent).
5. **Uploads to the store** — *only if* that store's secrets are configured (see below):
   - **Chrome:** uploads a draft (no `--auto-publish`) — nothing goes live until a
     human clicks **Publish** in the CWS dashboard.
   - **Firefox:** submits the version to AMO's `listed` review queue via `web-ext`
     (with the sources zip). Mozilla publishes it once its review passes — there's
     no draft-only mode for listed add-ons.

If a store's secrets aren't set, step 5 for that store is skipped cleanly and the
workflow still produces the GitHub Release + artifacts — so you can download the
zip and upload it by hand (the manual flow below still works exactly as before).

### Chrome Web Store secrets (optional — enables auto-upload)

Set these as repository secrets (`Settings → Secrets and variables → Actions`) to
enable the auto-upload step. Until all four exist, the store step no-ops.

| Secret | What it is / where to get it |
|---|---|
| `CWS_EXTENSION_ID` | The extension's ID from the CWS dashboard (the item must already exist — create it once by uploading the first zip manually). |
| `CWS_CLIENT_ID` | OAuth client ID from a Google Cloud project with the **Chrome Web Store API** enabled. |
| `CWS_CLIENT_SECRET` | OAuth client secret for that same client. |
| `CWS_REFRESH_TOKEN` | A refresh token minted for that client with the `chromewebstore` scope. |

To obtain the OAuth credentials, follow the `chrome-webstore-upload` setup guide:
<https://github.com/fregante/chrome-webstore-upload/blob/main/How-to-generate-Google-API-keys.md>.
Steps in brief: create a Google Cloud project → enable the Chrome Web Store API →
create an OAuth client (type "Desktop app") → use the client to authorize once and
capture the refresh token. The item itself must be created manually the first time
(you can't create a brand-new listing via the API, only push new versions to an
existing one).

> **Note on the $5 developer account:** the store-upload step stays dormant until
> you register a Chrome Web Store developer account, create the item, and add the
> four secrets. Everything up to the GitHub Release works without any of that.

### Firefox Add-ons (AMO) secrets (optional — enables auto-submit)

Set these two repository secrets to enable the Firefox auto-submit step. Until both
exist, the AMO step no-ops (the job still builds + attaches the zips to the Release).

| Secret | What it is / where to get it |
|---|---|
| `AMO_JWT_ISSUER` | The **JWT issuer** (API key) from your AMO account: <https://addons.mozilla.org/developers/addon/api/key/>. Looks like `user:12345:67`. |
| `AMO_JWT_SECRET` | The **JWT secret** shown on that same page (only displayed once — regenerate if lost). |

Unlike Chrome, there are no OAuth client/refresh-token steps — AMO uses a single
issuer/secret pair to mint short-lived JWTs, which `web-ext` handles internally.

**Setting up the AMO account (first time):**

1. **Create a Firefox account** and sign in at <https://addons.mozilla.org/developers/>.
   AMO registration is **free** (no fee, unlike Chrome's $5).
2. **Accept the Firefox Add-on Distribution Agreement** (prompted on first submission).
3. **Generate API credentials** at <https://addons.mozilla.org/developers/addon/api/key/>:
   click "Generate new credentials", copy the **JWT issuer** and **JWT secret**
   immediately (the secret is shown only once).
4. **Add them as repo secrets** (`Settings → Secrets and variables → Actions`) as
   `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`.
5. **First submission creates the listing.** Unlike Chrome (where you must create
   the item manually before the API can push to it), `web-ext sign --channel=listed`
   can create a brand-new listed add-on on first run — but you'll still need to fill
   out the listing metadata (description, screenshots, categories) in the AMO
   dashboard afterward, and complete the listing before it can be publicly approved.
   The add-on id is already pinned in `wxt.config.ts`
   (`gecko.id = autotos@amascillaro.workers.dev`), so submissions map to the same
   listing every time.

> **AMO reviews the source.** Because the build is minified, Mozilla requires the
> source zip (the workflow passes it via `--upload-source-code`). If a reviewer asks
> for build steps, they're in the "Firefox AMO" section above. Reviews can take
> 1–7 days and are done by a human comparing your source to the built artifact.

## Maintenance and Updates

### Version Updates

For an automated release, see **Automated Releases** above — bump the version, tag,
and push. To build/upload **manually** (Firefox and Safari have no CI yet):

1. **Update version in package.json**
   ```bash
   cd packages/extension
   # Edit package.json: "version": "0.2.0"
   npm install  # Updates package-lock.json
   ```

2. **Rebuild all targets**
   ```bash
   npm run build:chrome && npm run zip
   npm run build:firefox && npm run zip:firefox
   npm run build:safari
   ```

3. **Upload to stores**
   - **Chrome:** Prefer the tagged release (CI). To do it by hand: upload the new zip in the CWS dashboard → "Package" → "Upload new package"
   - **Firefox:** Create new version in AMO → upload new zip + sources
   - **Safari:** Increment build number in Xcode → archive → upload → create new version in App Store Connect

4. **Fill out "What's New" / version notes**
   - Summarize changes (bug fixes, new features, performance improvements)

### Monitoring
- Check store reviews weekly
- Respond to user issues promptly (within 48 hours recommended)
- Monitor crash reports (especially for Safari, via Xcode Organizer)
- Track download/install metrics in each store's dashboard

---

## Additional Resources

- **Chrome Web Store Developer Documentation:** https://developer.chrome.com/docs/webstore/
- **Firefox Add-on Developer Hub:** https://extensionworkshop.com/
- **Apple Safari Extensions:** https://developer.apple.com/documentation/safariservices/safari_web_extensions
- **WXT Framework:** https://wxt.dev/
- **WebExtension Polyfill:** https://github.com/mozilla/webextension-polyfill

---

## Questions or Issues?

If you encounter issues during publishing, common troubleshooting steps:

1. **Chrome rejection for permissions:** Provide detailed justification in the "Why do you need this permission?" field
2. **Firefox source code mismatch:** Ensure build instructions are accurate; test in a clean environment (e.g., new VM or Docker container)
3. **Safari entitlements error:** Ensure the bundle identifier matches across Xcode, App Store Connect, and your provisioning profile
4. **Screenshot rejection:** Ensure screenshots are the correct dimensions and show actual extension functionality (not just the icon or placeholder states)

For extension-specific questions, open an issue in the GitHub repository or contact the original AutoTOS authors.
