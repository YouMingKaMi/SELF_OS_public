import { useEffect, useRef, useState } from "react";

export type MobileSubView = {
  title: string;
  onBack: () => void;
};

type Listener = (sub: MobileSubView | null) => void;
let activeSub: MobileSubView | null = null;
const listeners = new Set<Listener>();

function publish(next: MobileSubView | null) {
  activeSub = next;
  for (const fn of listeners) fn(next);
}

/** Observed by MobileStudio to update the top navbar & back gesture for drilled-in sub-views. */
export function useActiveMobileSubView(): MobileSubView | null {
  const [sub, setSub] = useState<MobileSubView | null>(activeSub);
  useEffect(() => {
    listeners.add(setSub);
    setSub(activeSub);
    return () => {
      listeners.delete(setSub);
    };
  }, []);
  return sub;
}

/**
 * Push-navigation helper for master-detail screens on mobile (<= 760px).
 * Desktop (> 760px) renders both master & detail side-by-side untouched.
 */
export function useMobileDetail(detailTitle: string) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 760px)").matches
      : false,
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const closeRef = useRef(() => setOpen(false));
  closeRef.current = () => setOpen(false);

  useEffect(() => {
    if (!isMobile || !open) return;
    const entry: MobileSubView = {
      title: detailTitle,
      onBack: () => closeRef.current(),
    };
    publish(entry);
    const scroller = document.querySelector(".ms-scroll");
    if (scroller) scroller.scrollTop = 0;
    return () => {
      if (activeSub === entry) publish(null);
    };
  }, [isMobile, open, detailTitle]);

  return {
    isMobile,
    detailOpen: isMobile && open,
    showList: !isMobile || !open,
    showDetail: !isMobile || open,
    openDetail: () => setOpen(true),
    closeDetail: () => setOpen(false),
  };
}
