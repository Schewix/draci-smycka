export function formatCentiseconds(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  const totalSeconds = Math.floor(value / 100);
  const centiseconds = value % 100;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds
    .toString()
    .padStart(2, '0')}`;
}

export function parseTimeInput(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/^(\d{1,2}):(\d{2})\.(\d{2})$/);
  if (!match) {
    return null;
  }
  const minutes = Number.parseInt(match[1] ?? '0', 10);
  const seconds = Number.parseInt(match[2] ?? '0', 10);
  const centiseconds = Number.parseInt(match[3] ?? '0', 10);
  if (seconds >= 60 || minutes > 20) {
    return null;
  }
  return (minutes * 60 + seconds) * 100 + centiseconds;
}
