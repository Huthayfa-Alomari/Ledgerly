export function createStoredZip(entries: Array<{name: string; data: string | Uint8Array}>): Uint8Array;
export function buildDocxBytes(input?: {title?:string; paragraphs?:Array<string|Record<string,unknown>>; tables?:unknown[][][]; language?:string; rtl?:boolean}): Uint8Array;
