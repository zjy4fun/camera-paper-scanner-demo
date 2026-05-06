export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, base64] = dataUrl.split(',');
  const mime = meta.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function getDisplayScale(video: HTMLVideoElement) {
  const rect = video.getBoundingClientRect();
  return {
    scaleX: rect.width / video.videoWidth,
    scaleY: rect.height / video.videoHeight,
    displayWidth: rect.width,
    displayHeight: rect.height,
  };
}
