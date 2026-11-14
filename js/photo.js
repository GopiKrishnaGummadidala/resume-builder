// Profile photo: an uploaded image is cropped to a centred square and shrunk before it is stored,
// so a multi-megabyte camera picture becomes a few tens of kilobytes in localStorage and in the PDF.

/** Side of the stored square in pixels (the largest photo on a page is 120 px, drawn at 2x for PDF). */
export const PHOTO_SIDE = 320;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * @param {File} file an image chosen by the user
 * @returns {Promise<string>} a JPEG data URL
 * @throws {Error} with a readable message when the file is not a usable image
 */
export async function fileToPhoto(file) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPG, PNG or WebP image.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('That image is larger than 15 MB.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That file could not be read as an image.');
  }
  const photo = squarePhoto(bitmap, bitmap.width, bitmap.height);
  bitmap.close?.();
  return photo;
}

/**
 * The centred square of an image (a bitmap or a canvas), shrunk to PHOTO_SIDE and encoded as JPEG.
 * Transparent areas become white.
 */
export function squarePhoto(source, width, height) {
  const side = Math.min(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PHOTO_SIDE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PHOTO_SIDE, PHOTO_SIDE);
  ctx.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, PHOTO_SIDE, PHOTO_SIDE);
  return canvas.toDataURL('image/jpeg', 0.85);
}
