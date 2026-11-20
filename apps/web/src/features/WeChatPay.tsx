import { useLayoutEffect, useRef, useState } from "react";
import { Panel } from "../ui/shared.tsx";

const bridgeOrigin = "http://127.0.0.1:18766";

export function WeChatPay() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [height, setHeight] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  useLayoutEffect(() => {
    const timeout = window.setTimeout(() => setUnavailable(true), 8000);
    const root = document.documentElement;
    const sendTheme = () =>
      frame.current?.contentWindow?.postMessage(
        { type: "council-wechat-pay-theme", theme: root.dataset.theme },
        bridgeOrigin,
      );
    const themeObserver = new MutationObserver(sendTheme);
    themeObserver.observe(root, { attributeFilter: ["data-theme"] });
    function receive(event: MessageEvent) {
      if (
        event.origin !== bridgeOrigin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      const data = event.data;
      if (
        data?.type !== "council-wechat-pay-size" ||
        !Number.isSafeInteger(data.height) ||
        data.height < 1
      )
        return;
      window.clearTimeout(timeout);
      sendTheme();
      setUnavailable(false);
      setHeight(data.height);
    }
    window.addEventListener("message", receive);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
      themeObserver.disconnect();
    };
  }, [attempt]);

  return (
    <div className="wechat-pay-view">
      {height === 0 && (
        <Panel>
          <p role="status">
            {unavailable
              ? "未连上这台 Mac 的微信支付工具。请在运行工具的 Mac 上打开花销，并允许浏览器访问本机。"
              : "正在连接本机微信支付。若浏览器询问是否允许访问本机，请选择允许。"}
          </p>
          {unavailable && (
            <div className="wechat-pay-actions">
              <button
                type="button"
                onClick={() => {
                  setUnavailable(false);
                  setAttempt(attempt + 1);
                }}
              >
                重试
              </button>
              <a href={bridgeOrigin + "/"} target="_blank" rel="noreferrer">
                单独打开本机记账页 ↗
              </a>
            </div>
          )}
        </Panel>
      )}
      <iframe
        key={attempt}
        ref={frame}
        title="微信支付记账"
        src={bridgeOrigin + "/embedded"}
        allow="loopback-network; local-network-access"
        sandbox="allow-forms allow-same-origin allow-scripts"
        style={{
          height: height || 1,
          visibility: height ? "visible" : "hidden",
        }}
      />
    </div>
  );
}
