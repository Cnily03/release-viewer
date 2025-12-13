export function fmtDate(d: number | string | Date, long: boolean = false): string {
  const date = new Date(d);
  const now = new Date();
  const localDelta = -date.getTimezoneOffset();
  const timezone = `GMT${localDelta >= 0 ? "+" : ""}${Math.floor(localDelta / 60)}`;
  const monLiteral = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = date.getDate();
  const mon = monLiteral[date.getMonth()];
  const year = date.getFullYear();
  if (long) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";
    const hours12 = hours % 12 === 0 ? 12 : hours % 12;
    return `${mon} ${day}, ${year}, ${hours12}:${minutes.toString().padStart(2, "0")} ${ampm} ${timezone}`;
  }
  if (year === now.getFullYear()) {
    return `${mon} ${day}`;
  } else {
    return `${mon} ${day}, ${year}`;
  }
}

export function fmtLocalRelatedDate(d: number | string | Date): string {
  const date = new Date(d);
  const now = new Date();
  const deltaMs = now.getTime() - date.getTime();
  const deltaSec = Math.round(deltaMs / 1000);
  if (deltaSec < 10) {
    return "now";
  }
  if (deltaSec < 60) {
    return `${deltaSec} second${deltaSec === 1 ? "" : "s"} ago`;
  }
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 50) {
    return `${deltaMin} minute${deltaMin === 1 ? "" : "s"} ago`;
  }
  const deltaHrs = Math.round(deltaMin / 60);
  if (deltaHrs < 24) {
    return `${deltaHrs} hour${deltaHrs === 1 ? "" : "s"} ago`;
  }
  const deltaDays = Math.round(deltaHrs / 24);
  if (deltaDays < 7) {
    return `${deltaDays} day${deltaDays === 1 ? "" : "s"} ago`;
  }
  const deltaWeeks = Math.round(deltaDays / 7);
  if (deltaWeeks < 4) {
    return `${deltaWeeks} week${deltaWeeks === 1 ? "" : "s"} ago`;
  }
  return ""; // return empty string to detect whether to use absolute date
}

export function bindLocalRelatedDateUpdate(selector: string | NodeListOf<Element>) {
  const els = typeof selector === "string" ? document.querySelectorAll(selector) : selector;
  const pools = new Set([...els]);
  const secondsPools = new Set<Element>();

  function updateEl(el: Element) {
    // if (!el) return;
    const datetime = el.getAttribute("data-datetime");
    const d = new Date(datetime ?? "");
    if (!datetime || Number.isNaN(d.getTime())) {
      pools.delete(el);
      return;
    }
    const related = fmtLocalRelatedDate(d);
    if (!related) {
      pools.delete(el);
      const abs = fmtDate(d);
      el.textContent = abs; // set absolute date
      return abs;
    }
    el.textContent = related; // set related date
    return related;
  }
  function update() {
    for (const el of pools) {
      updateEl(el);
    }
  }

  const lowerThanOneMinute = (s?: string) => {
    return s?.includes("now") || s?.includes("second");
  };

  const secTimeout = setInterval(() => {
    for (const el of secondsPools) {
      const t = updateEl(el);
      if (!lowerThanOneMinute(t)) {
        secondsPools.delete(el);
      }
    }
    if (secondsPools.size === 0) {
      clearInterval(secTimeout);
    }
  }, 500);
  // instant update, and classify seconds pools
  for (const el of pools) {
    const t = updateEl(el);
    if (lowerThanOneMinute(t)) {
      secondsPools.add(el);
    }
  }

  // when focused, update immediately
  window.addEventListener("focus", update);

  const timeout = setInterval(update, 20 * 1000);
  return timeout;
}

export function fmtSize(size: number): string {
  const sizeUnit = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let sz = size;
  while (sz >= 1000 && idx < sizeUnit.length - 1) {
    sz /= 1024;
    idx++;
  }
  return `${Math.round(sz * 100) / 100} ${sizeUnit[idx]}`;
}

const labelTypeMap: Record<string, "success" | "primary" | "warning" | "danger" | "info"> = {
  latest: "success",
  "pre-release": "warning",
};

export const labelType = new Proxy(labelTypeMap, {
  get: (target, prop: string) => target[prop.toLowerCase().replace(/[^a-z0-9_-]/gi, "")] ?? "info",
});
