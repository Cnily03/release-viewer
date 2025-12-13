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
