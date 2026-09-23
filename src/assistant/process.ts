import { spawn, ChildProcess } from 'node:child_process';
const children = new Set<ChildProcess>();
process.on('exit', () => { for (const child of children) child.kill('SIGKILL'); });
export function command(binary: string, args: string[], timeout = 60_000, includeStderr = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${binary}: Zeitlimit überschritten.`)); }, timeout);
    child.stdout.on('data', data => { out += data.toString(); if (out.length > 16_000_000) { child.kill('SIGKILL'); reject(new Error('Ausgabe zu groß.')); } });
    child.stderr.on('data', data => { err = (err + data.toString()).slice(-6000); });
    child.on('error', error => { children.delete(child); clearTimeout(timer); reject(error); });
    child.on('close', code => { children.delete(child); clearTimeout(timer); code === 0 ? resolve(includeStderr ? out + err : out) : reject(new Error(`${binary} fehlgeschlagen (${code}): ${err}`)); });
  });
}
