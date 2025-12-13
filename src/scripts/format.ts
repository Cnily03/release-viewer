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
  const deltaSec = Math.floor(deltaMs / 1000);
  if (deltaSec < 60) {
    return "now";
  }
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) {
    return `${deltaMin} minute${deltaMin === 1 ? "" : "s"} ago`;
  }
  const deltaHrs = Math.floor(deltaMin / 60);
  if (deltaHrs < 24) {
    return `${deltaHrs} hour${deltaHrs === 1 ? "" : "s"} ago`;
  }
  const deltaDays = Math.floor(deltaHrs / 24);
  if (deltaDays < 7) {
    return `${deltaDays} day${deltaDays === 1 ? "" : "s"} ago`;
  }
  const deltaWeeks = Math.floor(deltaDays / 7);
  if (deltaWeeks < 4) {
    return `${deltaWeeks} week${deltaWeeks === 1 ? "" : "s"} ago`;
  }
  return fmtDate(date);
}

export function bindLocalRelatedDateUpdate(selector: string | NodeListOf<Element>, interval: number = 60000) {
  const els = typeof selector === "string" ? document.querySelectorAll(selector) : selector;
  const pools = new Set([...els]);
  function update() {
    for (const el of pools) {
      const datetime = el.getAttribute("data-datetime");
      if (!datetime) {
        pools.delete(el);
        continue;
      }
      const d = new Date(datetime);
      if (Number.isNaN(d.getTime())) {
        pools.delete(el);
        continue;
      }
      const original = el.textContent.trim();
      const related = fmtLocalRelatedDate(d).trim();
      if (original !== related) {
        pools.delete(el);
        el.textContent = related;
        continue;
      }
      el.textContent = related;
    }
  }
  const timeout = setInterval(update, interval);
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
