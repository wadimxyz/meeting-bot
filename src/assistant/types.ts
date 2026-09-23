export type Status = 'joining' | 'recording' | 'importing' | 'processing' | 'ready' | 'failed' | 'cancelled';
export interface Segment { start: number; end: number; text: string }
export interface Evidence { time: number; text: string; image?: string }
export interface Meeting {
  id: string;
  title: string;
  createdAt: string;
  status: Status;
  source: 'meet' | 'import';
  url?: string;
  error?: string;
  stage?: string;
  duration?: number;
  bytes?: number;
  audioLevel?: number;
  lastAudioAt?: string;
  media?: string;
  transcript?: Segment[];
  candidates?: Evidence[];
  screenshots?: Evidence[];
  artifacts: string[];
  consentAt: string;
}
export const activeStatuses: Status[] = ['joining', 'recording', 'importing', 'processing'];
