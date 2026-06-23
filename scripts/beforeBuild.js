import { rmSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export default function (context) {
    if (context.platform.name !== "windows") {
        const nm = resolve('node_modules');
        // remove pnpm symlink
        const direct = resolve(nm, 'node-smtc');
        if (existsSync(direct)) rmSync(direct, { recursive: true, force: true });
        // remove from pnpm virtual store too
        const store = resolve(nm, '.pnpm');
        if (existsSync(store)) {
            for (const e of readdirSync(store)) {
                if (e.startsWith('node-smtc')) rmSync(resolve(store, e), { recursive: true, force: true });
            }
        }
    }
    return true; // let the build proceed
}