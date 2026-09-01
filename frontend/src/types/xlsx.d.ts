/** 通过 index.html 引入 xlsx UMD 文件，window 上挂载 XLSX */

declare global {
  interface Window {
    XLSX: {
      read: (
        data: ArrayBuffer | Uint8Array | string,
        opts?: { type?: "array" | "buffer" | "string" | "binary" | "base64"; cellDates?: boolean }
      ) => { SheetNames: string[]; Sheets: Record<string, unknown> };
      utils: {
        sheet_to_json: (
          sheet: unknown,
          opts?: { header?: number | string[]; defval?: unknown; raw?: boolean; range?: number | string }
        ) => Array<Record<string, unknown>>;
      };
    };
  }
}

export {};
