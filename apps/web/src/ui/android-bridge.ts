export interface SelfOSAndroidBridge {
  setTheme?: (theme: "dark" | "light") => void;
  openEndpointSettings?: () => void;
  isLocalMode?: () => boolean;
  beginExport?: (filename: string, mimeType: string) => string;
  appendExport?: (id: string, chunk: string) => boolean;
  finishExport?: (id: string) => boolean;
  abortExport?: (id: string) => void;
}

declare global {
  interface Window {
    SelfOSAndroid?: SelfOSAndroidBridge;
    __selfOSHandleBack?: () => boolean;
  }
}

const EXPORT_CHUNK_CHARS = 128 * 1024;

function bridge(): SelfOSAndroidBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.SelfOSAndroid;
}

export function isAndroidApp(): boolean {
  return Boolean(bridge());
}

export function isAndroidLocalMode(): boolean {
  return bridge()?.isLocalMode?.() === true;
}

export function syncAndroidTheme(theme: "dark" | "light"): void {
  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const mobileDark =
        typeof window !== "undefined" &&
        (isAndroidApp() || window.matchMedia("(max-width: 760px)").matches);
      meta.setAttribute(
        "content",
        theme === "light" ? "#f3f2ee" : mobileDark ? "#000000" : "#181818",
      );
    }
  }
  try {
    bridge()?.setTheme?.(theme);
  } catch {
    // Ignore bridge errors when running outside native shell.
  }
}

export function openAndroidEndpointSettings(): boolean {
  const open = bridge()?.openEndpointSettings;
  if (!open) return false;
  open();
  return true;
}

export async function saveViaAndroidBridge(
  name: string,
  type: string,
  write: (writeChunk: (chunk: string) => void | Promise<void>) => Promise<void>,
): Promise<boolean> {
  const b = bridge();
  if (!b?.beginExport || !b.appendExport || !b.finishExport) return false;
  const exportId = b.beginExport(name, type || "application/octet-stream");
  if (!exportId) return false;

  let buffered = "";
  const flush = () => {
    if (!buffered) return;
    const ok = b.appendExport!(exportId, buffered);
    buffered = "";
    if (!ok) throw new Error("Android 导出写入失败");
  };

  try {
    await write((part) => {
      buffered += part;
      while (buffered.length >= EXPORT_CHUNK_CHARS) {
        const slice = buffered.slice(0, EXPORT_CHUNK_CHARS);
        buffered = buffered.slice(EXPORT_CHUNK_CHARS);
        if (!b.appendExport!(exportId, slice)) {
          throw new Error("Android 导出写入失败");
        }
      }
    });
    flush();
    if (!b.finishExport(exportId)) {
      throw new Error("Android 导出保存失败");
    }
    return true;
  } catch (error) {
    try {
      b.abortExport?.(exportId);
    } catch {
      // Best-effort cleanup.
    }
    throw error;
  }
}
