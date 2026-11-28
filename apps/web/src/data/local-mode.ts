const localAssetHost = "appassets.androidplatform.net";
let override: boolean | null = null;

export function setLocalModeOverrideForTest(value: boolean | null): void {
  override = value;
}

export function isLocalMode(): boolean {
  if (override !== null) return override;
  if (typeof location !== "undefined" && location.hostname === localAssetHost) return true;
  return typeof window !== "undefined" && window.SelfOSAndroid?.isLocalMode?.() === true;
}
