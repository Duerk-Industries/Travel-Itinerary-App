export type ImageSize = {
  width: number;
  height: number;
  type?: string;
};

declare function imageSize(input: Uint8Array | string): ImageSize;

export declare const imageSize: typeof imageSize;
export declare const types: string[];
export declare const disableFS: (disabled: boolean) => void;
export declare const disableTypes: (types: string[]) => void;
export declare const setConcurrency: (_concurrency: number) => void;
export default imageSize;
