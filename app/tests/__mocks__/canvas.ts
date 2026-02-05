export function createCanvas() {
  return {
    getContext: () => null,
    toBuffer: () => Buffer.from([]),
  };
}

export async function loadImage() {
  return {};
}

export const Image = class {};
export const ImageData = class {};
export const Canvas = class {};
