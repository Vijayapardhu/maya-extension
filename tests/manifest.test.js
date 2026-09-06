import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('manifest.json', () => {
  const manifestPath = path.join(process.cwd(), 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  it('should have required Manifest V3 fields', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBeDefined();
    expect(manifest.version).toBeDefined();
    expect(manifest.description).toBeDefined();
  });

  it('should reference existing script files', () => {
    const scripts = [
      manifest.background?.service_worker,
      ...(manifest.content_scripts?.flatMap(cs => cs.js) || []),
    ];

    scripts.forEach(file => {
      if (file) {
        expect(fs.existsSync(path.join(process.cwd(), file))).toBe(true);
      }
    });
  });

  it('should reference existing popup HTML', () => {
    const popup = manifest.action?.default_popup;
    if (popup) {
      expect(fs.existsSync(path.join(process.cwd(), popup))).toBe(true);
    }
  });

  it('should reference existing icon files', () => {
    const icons = manifest.icons || {};
    Object.values(icons).forEach(iconPath => {
      expect(fs.existsSync(path.join(process.cwd(), iconPath))).toBe(true);
    });
  });

  it('should reference existing web accessible resources', () => {
    const resources = manifest.web_accessible_resources?.flatMap(r => r.resources) || [];
    resources.forEach(file => {
      expect(fs.existsSync(path.join(process.cwd(), file))).toBe(true);
    });
  });

  it('should have valid permissions', () => {
    expect(Array.isArray(manifest.permissions)).toBe(true);
    expect(manifest.permissions.length).toBeGreaterThan(0);
  });

  it('should have valid host permissions', () => {
    expect(Array.isArray(manifest.host_permissions)).toBe(true);
    expect(manifest.host_permissions.length).toBeGreaterThan(0);
  });
});
