# Signing and notarizing the macOS app

A Mac downloads an app with a quarantine flag; Gatekeeper then opens it only if it is signed with a
**Developer ID Application** certificate and notarized by Apple. The build does both when the
certificate is in the keychain and notarization credentials are in the environment.

## 1. The certificate (once per team)

The **Account Holder** of the Apple Developer team creates it, or an Admin given access to
Developer ID certificates:

- Xcode → Settings → Accounts → the team → **Manage Certificates…** → **+** → **Developer ID Application**,
  or developer.apple.com → Certificates → **+** → Developer ID Application, with a CSR from Keychain Access.

Check that the keychain has it, with its private key:

```bash
security find-identity -v -p codesigning
```

It lists `Developer ID Application: <Company> (<TEAM ID>)`. Other machines and CI get it as a `.p12`
export (Keychain Access → the certificate with its key → Export).

## 2. Notarization credentials (once per machine)

Stored in the keychain, so no password sits in files or shell history. With an App Store Connect API
key (Users and Access → Integrations → Keys, role Developer):

```bash
xcrun notarytool store-credentials vision-inspector --key AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX --issuer <issuer id>
```

or with an Apple ID and an app-specific password (appleid.apple.com → Sign-In and Security):

```bash
xcrun notarytool store-credentials vision-inspector --apple-id <apple id> --team-id <TEAM ID>
```

## 3. Build

```bash
APPLE_KEYCHAIN_PROFILE=vision-inspector APPLE_KEYCHAIN=~/Library/Keychains/login.keychain-db npm run pack:mac
```

`release/` gets signed and notarized `.dmg` and `.zip` files for Apple Silicon and Intel. To check one:

```bash
spctl --assess --type execute --verbose "release/mac-arm64/Vision Inspector.app"
```

It says `accepted` and `source=Notarized Developer ID`.

## CI

The macOS job of `.github/workflows/package.yml` takes the certificate as `CSC_LINK` (the `.p12`,
base64) and `CSC_KEY_PASSWORD`, and notarizes with `APPLE_API_KEY` (path to the `.p8`),
`APPLE_API_KEY_ID` and `APPLE_API_ISSUER`, or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and
`APPLE_TEAM_ID`.

## Entitlements

`build/entitlements.mac.plist` keeps Electron's JIT entitlements and adds
`com.apple.security.cs.disable-library-validation`: the Appium that Vision Inspector installs and runs
on its own Node.js loads native modules npm downloaded, which are not signed by the team.
