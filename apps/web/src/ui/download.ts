import { saveViaAndroidBridge } from "./android-bridge.ts";

type ContentWriter = (
  write: (chunk: string) => void | Promise<void>,
) => Promise<void>;
type SaveFilePicker = (options: {
  suggestedName: string;
}) => Promise<FileSystemFileHandle>;

/** Use native Android SAF bridge or local file writer where available, and browser download elsewhere. */
export async function downloadFile(
  name: string,
  type: string,
  write: ContentWriter,
) {
  if (await saveViaAndroidBridge(name, type, write)) return;

  const { showSaveFilePicker } = window as Window & {
    showSaveFilePicker?: SaveFilePicker;
  };
  const usePicker =
    showSaveFilePicker && window.isSecureContext && window === window.top;
  let handle: FileSystemFileHandle | undefined;
  if (usePicker) {
    try {
      // The picker needs the activation of the original click.
      handle = await showSaveFilePicker.call(window, { suggestedName: name });
    } catch (error) {
      if (!(error instanceof DOMException)) throw error;
      if (error.name === "AbortError") return;
      if (error.name !== "SecurityError") throw error;
    }
  }
  if (handle) {
    const file = await handle.createWritable();
    try {
      await write((chunk) => file.write(chunk));
      await file.close();
    } catch (error) {
      await file.abort().catch(() => {});
      throw error;
    }
    return;
  }

  const parts: Blob[] = [];
  await write((part) => {
    parts.push(new Blob([part]));
  });
  const url = URL.createObjectURL(new Blob(parts, { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Let download consumers acquire the Blob before dropping its URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
