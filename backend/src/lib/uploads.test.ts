import { describe, expect, it } from 'vitest';
import { extensionForMimeType } from './uploads';

describe('extensionForMimeType', () => {
  const MIME_TO_EXTENSION = { 'text/plain': '.txt', 'image/png': '.png' };

  it('returns the extension mapped to a known, validated MIME type', () => {
    expect(extensionForMimeType('text/plain', MIME_TO_EXTENSION)).toBe('.txt');
    expect(extensionForMimeType('image/png', MIME_TO_EXTENSION)).toBe('.png');
  });

  it('never derives an extension from client-supplied data such as text/html, regardless of the declared mimetype', () => {
    // Un fichier dont le nom client se termine par ".html" mais dont le
    // mimetype déclaré est "text/plain" (un type autorisé) ne doit jamais
    // aboutir à un fichier stocké en .html : l'extension physique ne dépend
    // que du mimetype, qui a déjà été validé par le fileFilter en amont.
    expect(extensionForMimeType('text/html', MIME_TO_EXTENSION)).toBe('.bin');
  });

  it('falls back to a safe, non-executable extension for an unmapped mimetype', () => {
    expect(extensionForMimeType('application/x-msdownload', MIME_TO_EXTENSION)).toBe('.bin');
  });
});
