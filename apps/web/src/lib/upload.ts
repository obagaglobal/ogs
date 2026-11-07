/**
 * PUT a file with upload progress (fetch has no upload progress, XHR does).
 * Used with presigned object-storage URLs; reports 0…1 to `onProgress`.
 */
export function uploadWithProgress(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(new Error(`upload_failed_${String(request.status)}`));
      }
    };
    request.onerror = () => {
      reject(new Error('upload_failed'));
    };
    request.send(file);
  });
}
