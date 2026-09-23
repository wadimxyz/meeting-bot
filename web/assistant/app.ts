interface Segment { start: number; end: number; text: string }
interface Evidence { time: number; text: string; image?: string }
interface Meeting { id: string; title: string; createdAt: string; status: string; source: string; error?: string; stage?: string; duration?: number; bytes?: number; audioLevel?: number; lastAudioAt?: string; media?: string; transcript?: Segment[]; candidates?: Evidence[]; screenshots?: Evidence[]; artifacts: string[] }
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => { const el = document.querySelector<T>(selector); if (!el) throw new Error(selector); return el; };
const text = (tag: string, value: string, className = ''): HTMLElement => { const el = document.createElement(tag); el.textContent = value; el.className = className; return el; };
const labels: Record<string, string> = { joining: 'Wartet auf Einlass', recording: 'Nimmt auf', importing: 'Importiert', processing: 'Wertet aus', ready: 'Bereit', failed: 'Prüfung nötig', cancelled: 'Abgebrochen' };
const time = (seconds: number): string => new Date(Math.max(0, seconds) * 1000).toISOString().slice(11, 19);
let meetings: Meeting[] = [], selected: string | undefined, tab = 'transcript', signature = '', inFlight = false, uploadBusy = false;
async function api<T>(url: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetch(url, { method, headers: { 'X-Assistant-Request': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Anfrage fehlgeschlagen.'); return result;
}
function alertError(error: unknown): void { const el = $('#message'); el.textContent = error instanceof Error ? error.message : String(error); el.hidden = false; setTimeout(() => { el.hidden = true; }, 10_000); }
function button(label: string, action: () => void | Promise<void>, className = 'secondary'): HTMLButtonElement {
  const el = document.createElement('button'); el.type = 'button'; el.textContent = label; el.className = className;
  el.onclick = () => { el.disabled = true; void Promise.resolve().then(action).catch(alertError).finally(() => { el.disabled = false; }); }; return el;
}
function mediaLink(meeting: Meeting, file: string): string { return `/api/meetings/${meeting.id}/files/${encodeURIComponent(file)}`; }
function seek(seconds: number): void { const media = document.querySelector<HTMLMediaElement>('#recording'); if (media) { media.currentTime = seconds; void media.play().catch(alertError); } }
function renderList(): void {
  const list = $('#meetings'); list.replaceChildren(); $('#count').textContent = String(meetings.length);
  for (const meeting of meetings) {
    const item = button('', () => { selected = meeting.id; signature = ''; renderList(); renderDetail(); }, `meeting-card${selected === meeting.id ? ' selected' : ''}`);
    const title = text('span', meeting.title); title.append(text('small', `${new Date(meeting.createdAt).toLocaleString('de-DE')} · ${meeting.source === 'meet' ? 'Google Meet' : 'Import'}`));
    item.append(title, text('span', labels[meeting.status] ?? meeting.status, `badge ${meeting.status}`)); list.append(item);
  }
}
function renderDetail(): void {
  const meeting = meetings.find(value => value.id === selected); if (!meeting) return;
  const nextSignature = JSON.stringify([meeting.id, meeting.status, meeting.stage, meeting.error, meeting.transcript?.length, tab]);
  if (signature === nextSignature) { updateMeter(meeting); return; } signature = nextSignature;
  const detail = $('#detail'); detail.replaceChildren();
  const head = text('div', '', 'detail-head'), title = text('div', ''); title.append(text('h2', meeting.title), text('span', labels[meeting.status] ?? meeting.status, 'hint')); head.append(title); detail.append(head);
  const live = ['joining', 'recording'].includes(meeting.status);
  if (meeting.error || meeting.stage || live) detail.append(text('p', meeting.error ?? meeting.stage ?? 'Der Bot wartet auf den Gastgeber.', `status-info${meeting.error ? ' error' : ''}`));
  const meter = text('p', '', 'hint'); meter.id = 'meter'; detail.append(meter); updateMeter(meeting);
  const actions = text('div', '', 'actions');
  if (live) actions.append(button('Aufnahme beenden', async () => { await api(`/api/meetings/${meeting.id}/stop`, 'POST'); await refresh(); }));
  if (!['joining', 'recording', 'processing', 'importing'].includes(meeting.status)) {
    if (meeting.media) actions.append(button('Erneut auswerten', async () => { await api(`/api/meetings/${meeting.id}/process`, 'POST'); await refresh(); }));
    actions.append(button('Löschen', async () => { if (!confirm(`„${meeting.title}“ und alle zugehörigen Dateien endgültig löschen?`)) return; await api(`/api/meetings/${meeting.id}`, 'DELETE'); selected = undefined; signature = ''; detail.replaceChildren(text('p', 'Besprechung gelöscht.', 'hint')); await refresh(); }, 'secondary danger'));
  }
  detail.append(actions);
  if (meeting.media) {
    const audioOnly = /\.(wav|mp3|m4a|flac)$/.test(meeting.media);
    const media = document.createElement(audioOnly ? 'audio' : 'video'); media.id = 'recording'; media.controls = true; media.preload = 'metadata'; media.src = mediaLink(meeting, meeting.media); detail.append(media);
    const downloads = text('div', '', 'downloads');
    for (const [filename, label] of [[meeting.media, 'Aufnahme'], ['transcript.md', 'Transkript'], ['transcript.srt', 'Untertitel'], ['notes.md', 'Notizen'], ['tasks.json', 'Aufgaben JSON']]) {
      if (!meeting.artifacts.includes(filename)) continue;
      const link = document.createElement('a'); link.href = `${mediaLink(meeting, filename)}?download=1`; link.textContent = `${label} ↓`; downloads.append(link);
    }
    detail.append(downloads);
  }
  if (!meeting.transcript) return;
  const tabs = text('div', '', 'tabs'); tabs.setAttribute('aria-label', 'Besprechungsinhalte');
  for (const [key, label] of [['transcript', 'Transkript'], ['tasks', `Aufgaben (${meeting.candidates?.length ?? 0})`], ['screenshots', `Screenshots (${meeting.screenshots?.length ?? 0})`]]) {
    const control = button(label, () => { tab = key; renderDetail(); }, key === tab ? 'active' : ''); control.setAttribute('aria-pressed', String(key === tab)); tabs.append(control);
  }
  detail.append(tabs);
  if (tab === 'transcript') {
    detail.append(text('p', 'Automatisch transkribiert. Sprecher sind nicht zugeordnet. Zeitstempel springen zur Aufnahme.', 'hint'));
    for (const segment of meeting.transcript) { const row = text('div', '', 'transcript-row'); row.append(button(time(segment.start), () => seek(segment.start), 'time'), text('p', segment.text)); detail.append(row); }
  } else if (tab === 'tasks') {
    detail.append(text('p', 'Vorschläge aus Originalaussagen, anhand von Formulierungen erkannt. Bitte prüfen; keine bestätigten Beschlüsse oder zugewiesenen Verantwortlichen.', 'hint'));
    const list = text('ul', '', 'tasks');
    for (const task of meeting.candidates ?? []) { const row = text('li', ''); row.append(button(time(task.time), () => seek(task.time), 'time'), text('p', task.text)); list.append(row); }
    detail.append(list); if (!meeting.candidates?.length) detail.append(text('p', 'Keine Aufgabenformulierungen erkannt.', 'hint'));
  } else {
    detail.append(text('p', 'Frames zu visuellen Hinweisen im Gespräch. Der Bildausschnitt zeigt die Ansicht des Bots; bitte Relevanz prüfen.', 'hint'));
    const gallery = text('div', '', 'gallery');
    for (const shot of meeting.screenshots ?? []) { const figure = text('figure', ''); const image = document.createElement('img'); image.loading = 'lazy'; image.src = mediaLink(meeting, shot.image!); image.alt = `Meeting bei ${time(shot.time)}`; figure.append(button(time(shot.time), () => seek(shot.time), 'time'), image, text('figcaption', shot.text)); gallery.append(figure); } detail.append(gallery);
  }
}
function updateMeter(meeting: Meeting): void {
  const meter = document.querySelector('#meter'); if (!meter) return;
  meter.textContent = meeting.status === 'recording' ? `Gespeichert: ${((meeting.bytes ?? 0) / 1_000_000).toFixed(1)} MB · ${meeting.lastAudioAt ? `Letztes Audiosignal: ${new Date(meeting.lastAudioAt).toLocaleTimeString('de-DE')}` : 'Noch kein Audiosignal erkannt'}` : (meeting.duration ? `Dauer ${time(meeting.duration)}` : '');
}
async function refresh(): Promise<void> {
  if (inFlight) return; inFlight = true;
  try {
    meetings = await api<Meeting[]>('/api/meetings'); if (!selected && meetings.length) selected = meetings[0].id; renderList(); renderDetail();
    const current = meetings.find(meeting => meeting.id === selected);
    if (!uploadBusy && current?.source === 'import' && ['ready', 'failed'].includes(current.status)) $('#upload-status').textContent = current.status === 'ready' ? 'Auswertung abgeschlossen.' : 'Aufnahme gespeichert. Bitte Fehlermeldung prüfen.';
    const health = await api<{ busy?: string; model: boolean; dependencies: { name: string; ready: boolean }[] }>('/api/health');
    const el = $('#health'); el.replaceChildren();
    for (const dep of health.dependencies) el.append(text('p', `${dep.ready ? '✓' : '×'} ${dep.name}`, dep.ready ? 'good' : 'bad'));
    el.append(text('p', health.model ? '✓ Whisper-Modell bereit' : '× WHISPER_MODEL konfigurieren (README)', health.model ? 'good' : 'bad'));
    $<HTMLButtonElement>('#join').disabled = Boolean(health.busy) || !health.model || health.dependencies.some(d => !d.ready);
    $<HTMLInputElement>('#upload').disabled = Boolean(health.busy) || uploadBusy;
  } catch (error) { alertError(error); } finally { inFlight = false; }
}
$('#start-form').addEventListener('submit', event => {
  event.preventDefault(); $<HTMLButtonElement>('#join').disabled = true;
  void api<Meeting>('/api/meetings', 'POST', { title: $<HTMLInputElement>('#title').value, url: $<HTMLInputElement>('#url').value, consent: $<HTMLInputElement>('#consent').checked }).then(meeting => { selected = meeting.id; signature = ''; }).catch(alertError).finally(() => void refresh());
});
$('#upload').addEventListener('change', () => {
  const input = $<HTMLInputElement>('#upload'), file = input.files?.[0]; if (!file) return;
  if (!$<HTMLInputElement>('#consent').checked) { alertError('Bitte zuerst die Zustimmung der Beteiligten bestätigen.'); input.value = ''; return; }
  const name = $<HTMLInputElement>('#title').value.trim() || file.name.replace(/\.[^.]+$/, '');
  uploadBusy = true; input.disabled = true;
  const request = new XMLHttpRequest(); request.open('POST', `/api/import?title=${encodeURIComponent(name)}&extension=${encodeURIComponent(file.name.split('.').pop()?.toLowerCase() ?? '')}`);
  request.setRequestHeader('X-Assistant-Request', '1'); request.setRequestHeader('X-Recording-Consent', 'true'); request.setRequestHeader('Content-Type', 'application/octet-stream');
  request.upload.onprogress = event => { $('#upload-status').textContent = `Übertragen: ${Math.round(event.loaded / file.size * 100)} %`; };
  request.onload = () => { try { const result = JSON.parse(request.responseText); if (request.status >= 400) throw new Error(result.error); selected = result.id; signature = ''; $('#upload-status').textContent = 'Gespeichert. Auswertung läuft.'; } catch (error) { alertError(error); } };
  request.onerror = () => alertError('Übertragung unterbrochen oder Datei überschreitet das Limit.');
  request.onloadend = () => { uploadBusy = false; input.value = ''; void refresh(); };
  request.send(file);
});
void refresh(); setInterval(() => void refresh(), 2500);
