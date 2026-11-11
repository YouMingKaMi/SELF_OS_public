import { useState } from "react";
import { pairDevice } from "../data/entities.ts";

/** Shown when the server does not know this browser. The code comes from the server's admin command. */
export function Pairing() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError((await pairDevice(code)) ?? "");
    setBusy(false);
  }
  return (
    <div className="pairing-scrim" role="dialog" aria-modal="true" aria-labelledby="pairing-title">
      <form className="pairing-card" onSubmit={submit}>
        <span className="pairing-eyebrow">DEVICE PAIRING</span>
        <h2 id="pairing-title">连接这台设备</h2>
        <p>输入服务器上生成的一次性连接码。连接后，这台浏览器会记住身份，本机记录会自动同步。</p>
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXX"
          maxLength={12}
          autoComplete="one-time-code"
          spellCheck={false}
          aria-label="连接码"
        />
        {error && <small className="pairing-error">{error}</small>}
        <button className="primary" disabled={busy || code.replace(/[\s-]/g, "").length < 8}>
          {busy ? "正在连接…" : "连接"}
        </button>
        <small className="pairing-foot">未连接期间写下的内容已保存在本机，连接后补发。</small>
      </form>
    </div>
  );
}
