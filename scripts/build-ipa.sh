#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "$(uname -s)" != Darwin ]] || ! command -v xcodebuild >/dev/null; then
  printf '%s\n' '请在安装 Xcode 16 或更新版的 macOS 上构建。' >&2
  exit 1
fi
mode="${1:-unsigned}"
if [[ "$mode" != unsigned && "$mode" != signed ]]; then
  echo "Usage: bash scripts/build-ipa.sh [unsigned|signed]" >&2
  exit 1
fi
if [[ "$mode" == signed && ( -z "${TEAM_ID:-}" || -z "${BUNDLE_ID:-}" ) ]]; then
  echo '签名构建必须提供 TEAM_ID 和属于该团队的 BUNDLE_ID。' >&2
  exit 1
fi
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
output_dir="$project_root/dist"
mkdir -p "$output_dir"
project_args=(-project "$project_root/ios/BiliMusic.xcodeproj" -scheme BiliMusic
  -configuration Release -destination 'generic/platform=iOS' -derivedDataPath "$scratch/build")

if [[ "$mode" == unsigned ]]; then
  xcodebuild "${project_args[@]}" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
  mkdir "$scratch/Payload"
  ditto "$scratch/build/Build/Products/Release-iphoneos/BiliMusic.app" "$scratch/Payload/BiliMusic.app"
  (cd "$scratch" && ditto -c -k --keepParent Payload BiliMusic-unsigned.ipa)
  target="$output_dir/BiliMusic-unsigned.ipa"
  mv "$scratch/BiliMusic-unsigned.ipa" "$target"
else
  archive="$scratch/BiliMusic.xcarchive"
  xcodebuild "${project_args[@]}" -archivePath "$archive" -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM_ID" PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" archive
  options="$scratch/ExportOptions.plist"
  /usr/libexec/PlistBuddy -c 'Add :method string debugging' \
    -c 'Add :signingStyle string automatic' -c "Add :teamID string $TEAM_ID" "$options"
  xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$options" \
    -exportPath "$scratch/export" -allowProvisioningUpdates
  target="$output_dir/BiliMusic-development.ipa"
  mv "$scratch/export/BiliMusic.ipa" "$target"
fi
unzip -tq "$target"
unzip -Z1 "$target" | grep -Fx 'Payload/BiliMusic.app/src/index.html' > /dev/null
printf 'IPA: %s\n' "$target"
