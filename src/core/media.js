export const MEDIA_VIDEO_EXT_RE = /\.(mp4|webm|mkv|mov|m4v|avi)$/i;
export const MEDIA_IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|avif|bmp|ico)$/i;

export function isVideoFileLike(fileLike = {}) {
  const type = fileLike.type || '';
  const name = fileLike.name || '';
  return type.startsWith('video/') || MEDIA_VIDEO_EXT_RE.test(name);
}

export function isSupportedMediaName(name = '') {
  return MEDIA_VIDEO_EXT_RE.test(name) || MEDIA_IMAGE_EXT_RE.test(name);
}

export function isSupportedMediaFile(fileLike = {}) {
  const type = fileLike.type || '';
  const name = fileLike.name || '';
  return type.startsWith('image/') || isVideoFileLike(fileLike) || isSupportedMediaName(name);
}
