import { spawn } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const trainer = spawn(process.execPath, [join(__dirname, 'gunship_live_trainer.js')], { cwd: root, stdio: 'inherit' });
const electronCli = join(root, 'node_modules', 'electron', 'cli.js');
const electron = spawn(process.execPath, [electronCli, '.', '--page=gunship'], { cwd: root, stdio: 'inherit' });
electron.on('exit', (code) => { trainer.kill(); process.exitCode = code ?? 0; });
electron.on('error', (error) => { trainer.kill(); throw error; });