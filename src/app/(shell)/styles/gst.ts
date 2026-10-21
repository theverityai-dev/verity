/** 500 basis points reads as "5%"; null is "not yet classified", never a zero. */
export const gstLabel = (bp: number | null) => (bp === null ? "Not set" : `${bp / 100}%`);
