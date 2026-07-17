/** Resolve files copied from public/ under Vite's configured deployment base. */
export function publicUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
}
