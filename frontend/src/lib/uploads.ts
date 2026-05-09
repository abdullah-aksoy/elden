import { Platform } from 'react-native';
import api from '../services/api';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

type PresignResponse = {
  key: string;
  uploadUrl: string;
  publicUrl: string;
  contentType: string;
};

function guessContentTypeFromAsset(params: { uri: string; mimeType?: string; fileName?: string }): string {
  const mt = (params.mimeType || '').trim().toLowerCase();
  if (mt.startsWith('image/')) return mt;
  const u = `${params.fileName || ''} ${params.uri}`.toLowerCase();
  if (u.includes('.png')) return 'image/png';
  if (u.includes('.webp')) return 'image/webp';
  if (u.includes('.heic') || u.includes('.heif')) return 'image/heic';
  return 'image/jpeg';
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: any;
  const timeout = new Promise<T>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label}_timeout`)), ms);
  });
  return Promise.race([p.finally(() => clearTimeout(t)), timeout]);
}

function blobFromUri(uri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.onerror = () => reject(new Error('blob_read_failed'));
      xhr.onreadystatechange = () => {
        if (xhr.readyState !== 4) return;
        // RN returns status 0 for local file/content URIs.
        const ok = (xhr.status >= 200 && xhr.status < 300) || xhr.status === 0;
        if (!ok) return reject(new Error(`blob_read_status_${xhr.status}`));
        if (!xhr.response) return reject(new Error('blob_read_empty'));
        resolve(xhr.response as Blob);
      };
      xhr.open('GET', uri, true);
      xhr.responseType = 'blob';
      xhr.send(null);
    } catch (e) {
      reject(e);
    }
  });
}

async function ensureJpegIfHeic(uri: string, contentType: string): Promise<{ uri: string; contentType: string }> {
  const ct = (contentType || '').toLowerCase();
  if (ct !== 'image/heic' && ct !== 'image/heif') return { uri, contentType };
  // Convert HEIC/HEIF to JPEG for maximum Android compatibility and backend acceptance.
  const out = await manipulateAsync(uri, [], { compress: 0.85, format: SaveFormat.JPEG });
  return { uri: out.uri, contentType: 'image/jpeg' };
}

export class UploadError extends Error {
  stage: 'presign' | 'put';
  info?: string;
  constructor(stage: 'presign' | 'put', message: string, info?: string) {
    super(message);
    this.stage = stage;
    this.info = info;
  }
}

export async function uploadImageToR2(params: {
  uri: string;
  sizeBytes?: number;
  mimeType?: string;
  fileName?: string;
}): Promise<string> {
  const initialUri = params.uri;
  const guessed = guessContentTypeFromAsset({ uri: initialUri, mimeType: params.mimeType, fileName: params.fileName });
  const normalized = await ensureJpegIfHeic(initialUri, guessed);
  const uri = normalized.uri;
  const contentType = normalized.contentType;

  // Size: best-effort. Some platforms may not provide this.
  let sizeBytes = params.sizeBytes;
  if (!sizeBytes || sizeBytes <= 0) sizeBytes = 500_000;

  let presign: PresignResponse;
  try {
    const { data } = await withTimeout(
      api.post<PresignResponse>('/uploads/presign', { contentType, sizeBytes }),
      20000,
      'presign'
    );
    presign = data;
  } catch (e: any) {
    const code = e?.response?.status;
    const detail = e?.response?.data?.detail;
    const info = `${code || ''} ${typeof detail === 'string' ? detail : ''}`.trim();
    throw new UploadError('presign', 'Presign failed', info || (e?.message ? String(e.message) : undefined));
  }

  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    const blob = await res.blob();
    const put = await withTimeout(
      fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob }),
      120000,
      'put'
    );
    if (!put.ok) throw new UploadError('put', 'Upload failed', `status=${put.status}`);
    return presign.publicUrl;
  }

  // Native: avoid expo-file-system uploadAsync / FileSystemFile (can crash depending on native linkage).
  // Read as Blob via XHR and PUT via fetch.
  let blob: Blob;
  try {
    blob = await withTimeout(blobFromUri(uri), 60000, 'read');
  } catch (e: any) {
    throw new UploadError('put', 'Upload failed', e?.message ? String(e.message) : 'read_failed');
  }

  let put: Response;
  try {
    put = await withTimeout(
      fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob }),
      120000,
      'put'
    );
  } catch (e: any) {
    throw new UploadError('put', 'Upload failed', e?.message ? String(e.message) : 'put_failed');
  }
  if (!put.ok) throw new UploadError('put', 'Upload failed', `status=${put.status}`);
  return presign.publicUrl;
}

