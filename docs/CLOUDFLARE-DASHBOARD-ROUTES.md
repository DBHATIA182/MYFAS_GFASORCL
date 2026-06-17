# Fix demo `/api/health` HTTP 500

## Proof (from your PC today)

When cloudflared starts, Cloudflare **pushes** this config (your `config.yml` path rules are **ignored**):

```json
{
  "ingress": [
    { "hostname": "demo.fasaccountingsoftware.in", "service": "http://localhost:5173" },
    { "hostname": "demo-api.fasaccountingsoftware.in", "service": "http://localhost:5002" },
    { "service": "http_status:404" }
  ]
}
```

There is **no** `/api` → port **5002** rule. So:

- `https://demo.fasaccountingsoftware.in/` → Vite **200** (page loads)
- `https://demo.fasaccountingsoftware.in/api/health` → **500** (Vite proxy fails through tunnel)
- `http://127.0.0.1:5002/api/health` on the PC → **OK**

**Login will not work until the dashboard (or API script) adds the `/api` route.**

---

## Option A — Cloudflare dashboard (recommended)

**You cannot drag** the diagram or table rows to reorder routes — that is normal. Use **+ Add route**.

See click-by-click: `docs\ADD-DEMO-API-ROUTE-CLICKS.txt`

1. **Zero Trust** → **Networks** → **Tunnels** → tunnel **demo** (`1f7d513b-066e-4d0c-bc0f-7718109dad24`).
2. **Routes** tab → **+ Add route**.
3. Add a route with **Path** (not a separate hostname only):

| Public hostname | Path | Service |
|-----------------|------|---------|
| `demo.fasaccountingsoftware.in` | `/api` or `/api/*` | `http://127.0.0.1:5002` |

4. **Edit** existing routes to use **`127.0.0.1`** (not `localhost`):

| Public hostname | Path | Service |
|-----------------|------|---------|
| `demo.fasaccountingsoftware.in` | *(empty)* | `http://127.0.0.1:5173` |
| `demo-api.fasaccountingsoftware.in` | *(empty)* | `http://127.0.0.1:5002` |

5. **Save**. Wait 30 seconds.
6. Run **`start services batch file.bat`** (only **one** cloudflared window).
7. Open: **https://demo.fasaccountingsoftware.in/api/health**  
   Must show: `{"ok":true,"port":5002}`

---

## Option B — API script (same change, no clicking)

1. Cloudflare dashboard → **My Profile** → **API Tokens** → Create token with **Account** → **Cloudflare Tunnel** → **Edit**.
2. Copy **Account ID** (Zero Trust / account overview).
3. Run **`push-demo-tunnel-routes.cmd`** and paste token + account ID.

---

## One connector only

`cloudflared tunnel info` showed **two** connectors on the same tunnel. That can cause random failures.

- Run **`stop-cloudflared-service-admin.cmd`** as Administrator (once).
- Close extra **GFASORCL-Tunnel** windows.
- Start **`start services batch file.bat`** once.

---

## After health is OK

- Hard refresh demo (Ctrl+Shift+R).
- Console: **`[GFASORCL-5002]`** and port **5002** (not 5001).
- Sign in **MAIN** / **MAIN** on phone.
