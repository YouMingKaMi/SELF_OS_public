#!/bin/sh
# Disable shell tracing before reading any local build inputs.
set +x
set -eu
umask 077

fail() {
    printf '%s\n' "$1" >&2
    exit 1
}

repo=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
project="$repo/apps/android"
variant=${SELF_OS_ANDROID_VARIANT:-release}
version=0.3.15
with_site_env=false
skip_tests=false
skip_web_build=false

for argument do
    case "$argument" in
        --with-site-env) with_site_env=true ;;
        --skip-tests) skip_tests=true ;;
        --skip-web-build) skip_web_build=true ;;
        *) fail 'Usage: scripts/build-android-apk.sh [--with-site-env] [--skip-tests] [--skip-web-build]' ;;
    esac
done

case "$variant" in
    debug) assemble=assembleDebug; apk_name=app-debug.apk ;;
    release) assemble=assembleRelease; apk_name=app-release-unsigned.apk ;;
    *) fail 'SELF_OS_ANDROID_VARIANT must be debug or release.' ;;
esac

jdk_ready() {
    [ -n "$1" ] && [ -x "$1/bin/java" ] && [ -x "$1/bin/javac" ] && [ -x "$1/bin/keytool" ]
}

if ! jdk_ready "${JAVA_HOME:-}"; then
    JAVA_HOME=
    if [ -x /usr/libexec/java_home ]; then
        JAVA_HOME=$(/usr/libexec/java_home -v 17+ 2>/dev/null) || JAVA_HOME=
    fi
    if ! jdk_ready "$JAVA_HOME" && command -v java >/dev/null 2>&1; then
        JAVA_HOME=$(java -XshowSettings:properties -version 2>&1 |
            sed -n 's/^[[:space:]]*java\.home = //p')
    fi
fi
jdk_ready "$JAVA_HOME" || fail 'A JDK (17 or 21) is required. Set JAVA_HOME.'
JAVA_HOME=$(CDPATH='' cd -- "$JAVA_HOME" && pwd -P)
export JAVA_HOME

sdk=
for candidate in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "${HOME:-}/Library/Android/sdk" /opt/homebrew/share/android-commandlinetools; do
    if [ -n "$candidate" ] && [ -f "$candidate/platforms/android-35/android.jar" ]; then
        sdk=$candidate
        break
    fi
done
[ -n "$sdk" ] || fail 'Install Android SDK Platform 35 and set ANDROID_HOME.'
sdk=$(CDPATH='' cd -- "$sdk" && pwd -P)
ANDROID_HOME=$sdk
ANDROID_SDK_ROOT=$sdk
export ANDROID_HOME ANDROID_SDK_ROOT

apksigner=
for candidate in "$sdk/build-tools/35.0.0/apksigner" "$sdk/build-tools/34.0.0/apksigner" "$sdk"/build-tools/*/apksigner; do
    if [ -x "$candidate" ]; then
        apksigner=$candidate
        break
    fi
done
[ -n "$apksigner" ] || fail 'Install Android SDK Build Tools with apksigner.'
[ -x "$project/gradlew" ] && [ -f "$project/gradle/wrapper/gradle-wrapper.jar" ] ||
    fail 'The Gradle wrapper is missing. See work/android-apk.md for its generation command.'

if command -v sha256sum >/dev/null 2>&1; then
    hash_apk() { sha256sum < "$1"; }
elif command -v shasum >/dev/null 2>&1; then
    hash_apk() { shasum -a 256 < "$1"; }
else
    fail 'Install sha256sum or shasum to produce the APK checksum.'
fi

requested=${SELF_OS_URL:-}
if [ -z "$requested" ] && [ "$with_site_env" = true ]; then
    site_env="$repo/infra/deploy/site.env"
    [ -r "$site_env" ] || fail 'The optional site.env file is missing or unreadable.'
    # Read one assignment as data. Never execute the deployment environment file.
    requested=$(awk '
        /^[[:space:]]*(export[[:space:]]+)?COUNCIL_SITE[[:space:]]*=/ {
            found++
            sub(/^[^=]*=[[:space:]]*/, "")
            sub(/[[:space:]]+#.*$/, "")
            sub(/[[:space:]]*$/, "")
            quote = substr($0, 1, 1)
            if ((quote == "\"" || quote == sprintf("%c", 39)) && substr($0, length($0)) == quote)
                $0 = substr($0, 2, length($0)-2)
            value = $0
        }
        END { if (found != 1 || value == "") exit 1; print value }
    ' "$site_env") || fail 'site.env must contain one nonempty COUNCIL_SITE assignment.'
fi

endpoint=
if [ -n "$requested" ]; then
    # Only the authority is eligible for embedding. Reject userinfo and discard route/query data.
    endpoint=$(printf '%s\n' "$requested" | awk '
        NR != 1 { invalid = 1; next }
        {
            sub(/^[[:space:]]+/, "")
            sub(/[[:space:]]+$/, "")
            scheme = ""
            if (match($0, /^[A-Za-z][A-Za-z0-9+.-]*:\/\//)) {
                scheme = tolower(substr($0, 1, RLENGTH - 3))
                $0 = substr($0, RLENGTH + 1)
            }
            sub(/[\/?#].*$/, "")
            if ($0 !~ /^([A-Za-z0-9.-]+|\[[A-Fa-f0-9:.]+\])(:[0-9]+)?$/) { invalid = 1; next }
            authority = tolower($0)
            port = authority
            host = authority
            sub(/:[0-9]+$/, "", host)
            if (host != authority) {
                sub(/^.*:/, "", port)
                if (port + 0 < 1 || port + 0 > 65535) { invalid = 1; next }
                authority = host ":" (port + 0)
            }
            if (host == "appassets.androidplatform.net") { invalid = 1; next }
            local_host = (host == "localhost" || host == "127.0.0.1" || host == "10.0.2.2")
            if (scheme == "") scheme = local_host ? "http" : "https"
            if (scheme != "https" && !(scheme == "http" && local_host)) { invalid = 1; next }
            endpoint = scheme "://" authority
        }
        END { if (invalid || endpoint == "") exit 1; print endpoint }
    ') || fail 'Invalid SELF OS endpoint. Use HTTPS, or HTTP for a supported local address.'
fi
unset requested SELF_OS_URL

output=${SELF_OS_OUTPUT_APK:-"$repo/.build/android/SELF-OS-$version-$variant.apk"}
case "$output" in
    /*) ;;
    *) output="$PWD/$output" ;;
esac
[ ! -d "$output" ] && [ ! -d "$output.sha256" ] || fail 'The APK output must be a file.'
output_dir=$(dirname -- "$output")
mkdir -p "$output_dir"
output_name=$(basename -- "$output")
carriage_return=$(printf '\r')
case "$output_name" in
    *'\'*|*"$carriage_return"*|*'
'*) fail 'The APK filename contains characters incompatible with checksum files.' ;;
esac

work_tmp=
publish_tmp=
publish_lock=
key_tmp=
key_lock=
new_credentials=
cleanup() {
    if [ -n "$new_credentials" ] && [ ! -f "$keystore" ]; then rm -f -- "$new_credentials" || :; fi
    if [ -n "$key_tmp" ]; then rm -rf -- "$key_tmp" || :; fi
    if [ -n "$key_lock" ]; then rmdir -- "$key_lock" || :; fi
    if [ -n "$publish_lock" ]; then rmdir -- "$publish_lock" || :; fi
    if [ -n "$publish_tmp" ]; then rm -rf -- "$publish_tmp" || :; fi
    if [ -n "$work_tmp" ]; then rm -rf -- "$work_tmp" || :; fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
work_tmp=$(mktemp -d "${TMPDIR:-/tmp}/self-os-android.XXXXXXXX")
publish_tmp=$(mktemp -d "$output_dir/.self-os-android.XXXXXXXX")

web_dist="$repo/apps/web/dist"
web_assets="$work_tmp/web-assets"
if [ "$skip_web_build" = false ]; then
    printf '%s\n' 'Building embedded Web workspace.'
    (
        cd "$repo"
        unset SELF_OS_ANDROID_STORE_PASS SELF_OS_ANDROID_KEY_PASS
        npm run build:web
    ) || fail 'Could not build the embedded Web workspace.'
fi
[ -f "$web_dist/index.html" ] || fail 'apps/web/dist/index.html is missing. Run npm run build:web first.'
mkdir -p "$web_assets/web"
(
    cd "$web_dist"
    find . -mindepth 1 -name '.*' -prune -o -type f -exec sh -ec '
        destination=$1
        shift
        for source do
            target="$destination/${source#./}"
            mkdir -p "$(dirname -- "$target")"
            cp -- "$source" "$target"
        done
    ' sh "$web_assets/web" {} +
) || fail 'Could not stage the Web assets.'
[ -f "$web_assets/web/index.html" ] || fail 'The staged Web workspace is missing index.html.'

run_gradle() (
    cd "$project"
    # Signing passwords are used only by keytool/apksigner.
    unset SELF_OS_ANDROID_STORE_PASS SELF_OS_ANDROID_KEY_PASS
    export SELF_OS_ANDROID_BUILD_ENDPOINT="$endpoint"
    if [ -n "$endpoint" ]; then
        # Kotlin/Gradle diagnostics can include generated BuildConfig source.
        exec ./gradlew --no-daemon --no-build-cache --no-configuration-cache --console=plain \
            --project-cache-dir "$work_tmp/cache" "-PselfOsBuildDirectory=$work_tmp/app" "-PselfOsAssetsDir=$web_assets" "$1" >/dev/null 2>&1
    fi
    exec ./gradlew --no-daemon --no-build-cache --no-configuration-cache --console=plain \
        --project-cache-dir "$work_tmp/cache" "-PselfOsBuildDirectory=$work_tmp/app" "-PselfOsAssetsDir=$web_assets" "$1"
)

if [ "$skip_tests" = false ]; then
    printf '%s\n' 'Running Android JVM unit tests.'
    run_gradle testDebugUnitTest || fail 'Android JVM unit tests failed. For Gradle diagnostics, rerun without a prefilled endpoint.'
fi
printf 'Building Android %s APK.\n' "$variant"
run_gradle "$assemble" || fail 'Android assembly failed. For Gradle diagnostics, rerun without a prefilled endpoint.'
built="$work_tmp/app/outputs/apk/$variant/$apk_name"
[ -f "$built" ] || fail 'Gradle did not produce the expected APK.'
signed="$publish_tmp/package.apk"

if [ "$variant" = release ]; then
    if [ -n "${SELF_OS_ANDROID_KEYSTORE:-}" ]; then
        keystore=$SELF_OS_ANDROID_KEYSTORE
        alias=${SELF_OS_ANDROID_KEY_ALIAS:-}
        [ -f "$keystore" ] && [ -n "$alias" ] &&
            [ -n "${SELF_OS_ANDROID_STORE_PASS:-}" ] && [ -n "${SELF_OS_ANDROID_KEY_PASS:-}" ] ||
            fail 'Set the external release keystore, key alias, store password, and key password.'
    else
        [ -z "${SELF_OS_ANDROID_KEY_ALIAS:-}${SELF_OS_ANDROID_STORE_PASS:-}${SELF_OS_ANDROID_KEY_PASS:-}" ] ||
            fail 'Set SELF_OS_ANDROID_KEYSTORE when supplying custom signing credentials.'
        [ -n "${HOME:-}" ] || fail 'HOME is required for local release signing.'
        config="$HOME/.config/self-os"
        mkdir -p "$config"
        config=$(CDPATH='' cd -- "$config" && pwd -P)
        case "$config/" in "$repo/"*) fail 'Local signing files must live outside the repository.' ;; esac
        keystore="$config/android-release.jks"
        credentials="$config/android-release.env"
        alias=self-os-android

        lock_candidate="$config/.android-release.lock"
        mkdir "$lock_candidate" 2>/dev/null || fail 'The local signing files are locked by another build or interrupted setup.'
        key_lock=$lock_candidate
        [ ! -L "$keystore" ] && [ ! -L "$credentials" ] || fail 'Local signing files must be regular files.'
        if [ ! -e "$keystore" ] && [ ! -e "$credentials" ]; then
            key_tmp=$(mktemp -d "$config/.android-release.XXXXXXXX")
            SELF_OS_ANDROID_STORE_PASS=$(openssl rand -hex 32) || fail 'Could not generate a local signing password.'
            SELF_OS_ANDROID_KEY_PASS=$SELF_OS_ANDROID_STORE_PASS
            export SELF_OS_ANDROID_STORE_PASS SELF_OS_ANDROID_KEY_PASS
            "$JAVA_HOME/bin/keytool" -genkeypair -storetype JKS -keystore "$key_tmp/key.jks" \
                -alias "$alias" -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=SELF OS Android Release' \
                -storepass:env SELF_OS_ANDROID_STORE_PASS -keypass:env SELF_OS_ANDROID_KEY_PASS \
                >/dev/null 2>&1 || fail 'Could not create the local release keystore.'
            printf 'SELF_OS_ANDROID_STORE_PASS=%s\n' "$SELF_OS_ANDROID_STORE_PASS" > "$key_tmp/credentials"
            chmod 600 "$key_tmp/key.jks" "$key_tmp/credentials"
            new_credentials=$credentials
            mv -- "$key_tmp/credentials" "$credentials"
            mv -- "$key_tmp/key.jks" "$keystore"
            new_credentials=
        fi
        [ -f "$keystore" ] && [ -f "$credentials" ] ||
            fail 'Local release signing files are incomplete. Restore the existing pair before signing.'
        chmod 600 "$keystore" "$credentials"
        SELF_OS_ANDROID_STORE_PASS=$(awk -F= '
            NR == 1 && $1 == "SELF_OS_ANDROID_STORE_PASS" && $2 ~ /^[a-f0-9]+$/ && length($2) == 64 && NF == 2 { pass = $2 }
            END { if (NR != 1 || pass == "") exit 1; print pass }
        ' "$credentials") || fail 'The local release signing credentials are invalid.'
        SELF_OS_ANDROID_KEY_PASS=$SELF_OS_ANDROID_STORE_PASS
        rmdir -- "$key_lock"
        key_lock=
    fi

    export SELF_OS_ANDROID_STORE_PASS SELF_OS_ANDROID_KEY_PASS
    "$apksigner" sign --ks "$keystore" --ks-key-alias "$alias" \
        --ks-pass env:SELF_OS_ANDROID_STORE_PASS --key-pass env:SELF_OS_ANDROID_KEY_PASS \
        --v4-signing-enabled false --out "$signed" "$built" >/dev/null 2>&1 ||
        fail 'APK release signing failed.'
    unset SELF_OS_ANDROID_STORE_PASS SELF_OS_ANDROID_KEY_PASS
else
    cp -- "$built" "$signed"
fi

"$apksigner" verify "$signed" >/dev/null 2>&1 || fail 'APK signature verification failed.'
digest=$(hash_apk "$signed") || fail 'Could not compute the APK checksum.'
printf '%s  %s\n' "${digest%% *}" "$output_name" > "$publish_tmp/package.sha256"
lock_candidate="$output.lock"
mkdir "$lock_candidate" 2>/dev/null || fail 'Another Android build is publishing to the same output.'
publish_lock=$lock_candidate
[ ! -d "$output" ] && [ ! -d "$output.sha256" ] || fail 'The APK output must be a file.'
mv -f -- "$signed" "$output"
mv -f -- "$publish_tmp/package.sha256" "$output.sha256"
printf '%s\n' 'APK signature verified. APK and SHA-256 saved.'
