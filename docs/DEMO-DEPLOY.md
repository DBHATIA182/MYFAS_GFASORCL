# GFASORCL demo — deploy after git push

**If `git pull` says "Already up to date" but login still fails:** your fixes may not be on GitHub yet. On the dev PC run `git status` — if you see many modified files, run `git add -A`, `git commit`, `git push` first, then pull on the demo PC.

`git push` only updates GitHub. **demo.fasaccountingsoftware.in** does not change until the **demo server PC** runs these steps.

## On the demo server PC (once per push)

```powershell
cd E:\GFASORCL\APPTEST
git pull origin main
npm ci
npm run build
```

Check `config.yml` (API must be port **5002**):

```yaml
  - hostname: demo-api.fasaccountingsoftware.in
    service: http://localhost:5002
```

Restart — easiest on Windows CMD:

```cmd
cd /d E:\GFASORCL\APPTEST
start-gfasorcl.cmd
```

Or three windows:

```cmd
start-api.cmd
npm run dev -- --host 0.0.0.0 --port 5173
cloudflared tunnel --config config.yml run
```

**Important:** Close old GFAS/Vite/node windows first. If the browser console still says `localhost:5001`, Vite was not restarted.

## Verify before login

In browser on the demo PC:

- https://demo.fasaccountingsoftware.in/api/health → `{"ok":true,"port":5002}`

On the login screen you should see:

- `API: Same page (/api proxy) · reachable`

If you still see only “Request failed with status code 500” with **no** API line, the old build is still running — repeat build + restart Vite.

## Phone / mobile

Use **https://demo.fasaccountingsoftware.in** (not localhost).
